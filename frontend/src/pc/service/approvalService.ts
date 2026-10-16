import { workflowErrors } from './workflowAccess';
import type { AwcpFieldError, JsonObject } from '@app/awcp';

import { businessError, fieldError } from '../../common/awcp/contracts';
import type {
  DemoState,
  OfficeApprovalOperationRecord,
  OfficeApprovalRequest,
  Todo
} from '../../common/fixtures/types';
import type { DemoRepository } from '../../common/store/repository';

export interface ApprovalSubmitInput extends JsonObject {
  requestId: string | null;
  actorId: string;
  expectedVersion: number | null;
  title: string;
  description: string;
  materialIds: string[];
  idempotencyKey: string;
}
export interface ApprovalReviewInput extends JsonObject {
  requestId: string;
  actorId: string;
  expectedVersion: number;
  opinion: string;
  idempotencyKey: string;
}
export interface ApprovalWithdrawInput extends JsonObject {
  requestId: string;
  actorId: string;
  expectedVersion: number;
  reason: string;
  idempotencyKey: string;
}
export interface ApprovalReadInput extends JsonObject {
  requestId: string;
  actorId: string;
}
export interface ApprovalResult extends JsonObject {
  requestId: string;
  taskId: string | null;
  status: OfficeApprovalRequest['status'];
  businessVersion: number;
}

type Operation = OfficeApprovalOperationRecord['operation'];

function id(prefix: string, ids: string[]): string {
  const next =
    Math.max(
      0,
      ...ids.map((item) => {
        const match = new RegExp(`^${prefix}-([0-9]+)$`).exec(item);
        return match ? Number(match[1]) : 0;
      })
    ) + 1;
  return `${prefix}-${String(next).padStart(3, '0')}`;
}

function fingerprint(input: JsonObject): string {
  const { idempotencyKey: _key, ...payload } = input;
  const ordered = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(ordered);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([name, item]) => [name, ordered(item)])
      );
    }
    return value;
  };
  return JSON.stringify(ordered(payload));
}

function recordErrors(
  state: DemoState,
  operation: Operation,
  input: { idempotencyKey: string } & JsonObject
): { errors: AwcpFieldError[]; replay: OfficeApprovalOperationRecord | null } {
  if (typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.idempotencyKey)) {
    return { errors: [fieldError(['idempotencyKey'], '业务幂等键格式无效。')], replay: null };
  }
  const previous = state.officeApprovalOperationRecords.find((item) => item.idempotencyKey === input.idempotencyKey);
  if (!previous) return { errors: [], replay: null };
  return previous.operation === operation && previous.fingerprint === fingerprint(input)
    ? { errors: [], replay: previous }
    : { errors: [fieldError(['idempotencyKey'], '业务幂等键已用于其他操作或参数。')], replay: null };
}

function actorError(state: DemoState, actorId: string): AwcpFieldError[] {
  return state.employees.some((item) => item.id === actorId && item.active)
    ? []
    : [fieldError(['actorId'], '操作人不存在或已停用。')];
}

function requireValid(errors: AwcpFieldError[]): void {
  if (errors.length)
    throw businessError(
      'action.invalid-office-approval',
      errors.flatMap((item) => item.messages).join('；'),
      errors.map((item) => ({ path: item.path, messages: item.messages }))
    );
}

function result(request: OfficeApprovalRequest): ApprovalResult {
  return {
    requestId: request.id,
    taskId: request.currentTaskId,
    status: request.status,
    businessVersion: request.businessVersion
  };
}

function remember(state: DemoState, operation: Operation, input: JsonObject, value: ApprovalResult): void {
  state.officeApprovalOperationRecords.push({
    idempotencyKey: String(input.idempotencyKey),
    operation,
    fingerprint: fingerprint(input),
    result: {
      requestId: value.requestId,
      taskId: value.taskId,
      status: value.status,
      businessVersion: value.businessVersion
    }
  });
}

function audit(
  state: DemoState,
  request: OfficeApprovalRequest,
  action: Operation,
  actorId: string,
  fromStatus: string | null,
  at: string,
  note?: string
): void {
  state.auditEntries.push({
    id: id(
      'AUD',
      state.auditEntries.map((item) => item.id)
    ),
    entityType: 'approval',
    entityId: request.id,
    action,
    actorId,
    at,
    fromStatus,
    toStatus: request.status,
    businessVersion: request.businessVersion,
    ...(note ? { note } : {})
  });
}

function currentTask(state: DemoState, request: OfficeApprovalRequest): Todo | null {
  if (!request.currentTaskId) return null;
  return (
    state.todos.find(
      (item) => item.id === request.currentTaskId && item.sourceType === 'approval' && item.sourceId === request.id
    ) ?? null
  );
}

function closeTask(state: DemoState, request: OfficeApprovalRequest, at: string): string {
  const task = currentTask(state, request);
  if (!task || task.status !== 'open')
    throw businessError('action.approval-task-missing', '当前审批任务不存在或已处理。');
  task.status = 'done';
  task.completedAt = at;
  request.currentTaskId = null;
  return task.id;
}

function submitErrors(state: DemoState, input: ApprovalSubmitInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const key = recordErrors(state, 'submit', input);
  if (key.replay || key.errors.length) return key.errors;
  const errors = actorError(state, input.actorId);
  const actor = state.employees.find((item) => item.id === input.actorId && item.active);
  if (actor && !actor.roles.includes('employee')) errors.push(fieldError(['actorId'], '只有在职员工可以提交。'));
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 120)
    errors.push(fieldError(['title'], '标题须为 1 到 120 字。'));
  if (typeof input.description !== 'string' || !input.description.trim() || input.description.trim().length > 2000)
    errors.push(fieldError(['description'], '申请说明须为 1 到 2000 字。'));
  if (!Array.isArray(input.materialIds) || !input.materialIds.length || input.materialIds.length > 10) {
    errors.push(fieldError(['materialIds'], '至少选择一份、最多十份资料。'));
  } else {
    const seen = new Set<string>();
    input.materialIds.forEach((materialId, index) => {
      if (seen.has(materialId)) errors.push(fieldError(['materialIds', index], '资料不能重复。'));
      seen.add(materialId);
      if (!state.officeApprovalMaterials.some((item) => item.id === materialId))
        errors.push(fieldError(['materialIds', index], '资料不存在。'));
    });
  }
  if (input.requestId === null) {
    if (input.expectedVersion !== null) errors.push(fieldError(['expectedVersion'], '新申请的预期版本须为 null。'));
  } else {
    const request = state.officeApprovalRequests.find((item) => item.id === input.requestId);
    if (!request) errors.push(fieldError(['requestId'], '申请不存在。'));
    else {
      if (request.applicantId !== input.actorId) errors.push(fieldError(['actorId'], '只有原申请人可以重新提交。'));
      if (request.status !== 'returned' && request.status !== 'withdrawn')
        errors.push(fieldError(['requestId'], '只有退回或撤回的申请可以重新提交。'));
      if (request.businessVersion !== input.expectedVersion)
        errors.push(fieldError(['expectedVersion'], `当前业务版本为 ${request.businessVersion}。`));
    }
  }
  const departmentId =
    input.requestId === null
      ? actor?.departmentId
      : state.officeApprovalRequests.find((item) => item.id === input.requestId)?.departmentId;
  if (
    departmentId &&
    !state.employees.some(
      (item) =>
        item.active && item.departmentId === departmentId && item.id !== input.actorId && item.roles.includes('manager')
    )
  )
    errors.push(fieldError(['actorId'], '所属部门没有可用审批主管。'));
  return errors;
}

function reviewErrors(state: DemoState, input: ApprovalReviewInput, operation: 'approve' | 'return'): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'approve');
    if (workflowDenied.length) return workflowDenied;
  const key = recordErrors(state, operation, input);
  if (key.replay || key.errors.length) return key.errors;
  const errors = actorError(state, input.actorId);
  const request = state.officeApprovalRequests.find((item) => item.id === input.requestId);
  if (!request) return [...errors, fieldError(['requestId'], '申请不存在。')];
  if (request.status !== 'submitted') errors.push(fieldError(['requestId'], '只有待审批申请可处理。'));
  if (request.businessVersion !== input.expectedVersion)
    errors.push(fieldError(['expectedVersion'], `当前业务版本为 ${request.businessVersion}。`));
  const actor = state.employees.find((item) => item.id === input.actorId && item.active);
  if (
    !actor ||
    actor.id !== request.reviewerId ||
    actor.departmentId !== request.departmentId ||
    !actor.roles.includes('manager')
  )
    errors.push(fieldError(['actorId'], '只有当前指定的同部门主管可处理。'));
  const task = currentTask(state, request);
  if (!task || task.status !== 'open' || task.assigneeId !== input.actorId)
    errors.push(fieldError(['requestId'], '当前审批任务不存在或未分派给操作人。'));
  if (typeof input.opinion !== 'string' || !input.opinion.trim() || input.opinion.trim().length > 200)
    errors.push(fieldError(['opinion'], '审批意见须为 1 到 200 字。'));
  return errors;
}

function withdrawErrors(state: DemoState, input: ApprovalWithdrawInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const key = recordErrors(state, 'withdraw', input);
  if (key.replay || key.errors.length) return key.errors;
  const errors = actorError(state, input.actorId);
  const request = state.officeApprovalRequests.find((item) => item.id === input.requestId);
  if (!request) return [...errors, fieldError(['requestId'], '申请不存在。')];
  if (request.applicantId !== input.actorId) errors.push(fieldError(['actorId'], '只有申请人可以撤回。'));
  if (request.status !== 'submitted') errors.push(fieldError(['requestId'], '只有待审批申请可以撤回。'));
  if (request.businessVersion !== input.expectedVersion)
    errors.push(fieldError(['expectedVersion'], `当前业务版本为 ${request.businessVersion}。`));
  const task = currentTask(state, request);
  if (!task || task.status !== 'open') errors.push(fieldError(['requestId'], '当前审批任务不存在或已处理。'));
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.trim().length > 200)
    errors.push(fieldError(['reason'], '撤回原因须为 1 到 200 字。'));
  return errors;
}

export class ApprovalService {
  constructor(private readonly repository: DemoRepository) {}

  subscribe(listener: () => void): () => void {
    return this.repository.subscribe(listener);
  }
  materials(): Array<{ id: string; name: string }> {
    return this.repository.snapshot().officeApprovalMaterials.map(({ id, name }) => ({ id, name }));
  }
  actors(): Array<{ id: string; name: string }> {
    return this.repository
      .snapshot()
      .employees.filter((item) => item.active)
      .map(({ id, name }) => ({ id, name }));
  }
  list(actorId: string): ApprovalResult[] {
    const state = this.repository.snapshot();
    requireValid(actorError(state, actorId));
    return state.officeApprovalRequests
      .filter((item) => item.applicantId === actorId || item.reviewerId === actorId)
      .map(result);
  }
  validateRead(input: ApprovalReadInput): AwcpFieldError[] {
    const state = this.repository.snapshot();
    const errors = actorError(state, input.actorId);
    const request = state.officeApprovalRequests.find((item) => item.id === input.requestId);
    if (!request) errors.push(fieldError(['requestId'], '申请不存在。'));
    else if (request.applicantId !== input.actorId && request.reviewerId !== input.actorId)
      errors.push(fieldError(['actorId'], '只有申请人与审批人可以读取。'));
    return errors;
  }
  read(input: ApprovalReadInput): JsonObject {
    const state = this.repository.snapshot();
    requireValid(this.validateRead(input));
    const request = state.officeApprovalRequests.find((item) => item.id === input.requestId);
    if (!request) throw businessError('action.approval-not-found', '申请不存在。');
    return {
      ...result(request),
      applicantId: request.applicantId,
      departmentId: request.departmentId,
      reviewerId: request.reviewerId,
      title: request.title,
      description: request.description,
      materialIds: [...request.materialIds],
      createdAt: request.createdAt,
      tasks: state.todos
        .filter((item) => item.sourceType === 'approval' && item.sourceId === request.id)
        .map((item) => ({
          taskId: item.id,
          assigneeId: item.assigneeId,
          status: item.status,
          completedAt: item.completedAt ?? null
        })),
      decisions: state.officeApprovalDecisions
        .filter((item) => item.requestId === request.id)
        .map((item) => ({
          id: item.id,
          taskId: item.taskId,
          action: item.action,
          actorId: item.actorId,
          opinion: item.opinion,
          businessVersion: item.businessVersion,
          decidedAt: item.decidedAt
        })),
      history: state.auditEntries
        .filter((item) => item.entityType === 'approval' && item.entityId === request.id)
        .map((item) => ({
          action: item.action,
          actorId: item.actorId,
          at: item.at,
          fromStatus: item.fromStatus,
          toStatus: item.toStatus,
          businessVersion: item.businessVersion,
          note: item.note ?? null
        }))
    };
  }

  validateSubmit(input: ApprovalSubmitInput): AwcpFieldError[] {
    return submitErrors(this.repository.snapshot(), input);
  }
  submit(input: ApprovalSubmitInput): ApprovalResult {
    return this.repository.transact((state) => {
      const previous = recordErrors(state, 'submit', input);
      requireValid(previous.errors);
      if (previous.replay) return { ...previous.replay.result };
      requireValid(submitErrors(state, input));
      const actor = state.employees.find((item) => item.id === input.actorId);
      if (!actor) throw businessError('action.actor-not-found', '申请人不存在。');
      const existing = state.officeApprovalRequests.find((item) => item.id === input.requestId);
      const reviewer = state.employees.find(
        (item) =>
          item.active &&
          item.roles.includes('manager') &&
          item.departmentId === (existing?.departmentId ?? actor.departmentId) &&
          item.id !== actor.id
      );
      if (!reviewer) throw businessError('action.approver-not-found', '所属部门没有可用审批主管。');
      const at = this.repository.clock.now();
      const request: OfficeApprovalRequest = existing ?? {
        id: id(
          'APPR',
          state.officeApprovalRequests.map((item) => item.id)
        ),
        applicantId: actor.id,
        departmentId: actor.departmentId,
        reviewerId: reviewer.id,
        title: '',
        description: '',
        materialIds: [],
        status: 'submitted',
        businessVersion: 0,
        currentTaskId: null,
        createdAt: at
      };
      const fromStatus = existing?.status ?? null;
      request.title = input.title.trim();
      request.description = input.description.trim();
      request.materialIds = [...input.materialIds];
      request.reviewerId = reviewer.id;
      request.status = 'submitted';
      request.businessVersion += 1;
      const taskId = id(
        'APPTODO',
        state.todos.map((item) => item.id)
      );
      request.currentTaskId = taskId;
      if (!existing) state.officeApprovalRequests.push(request);
      state.todos.push({
        id: taskId,
        title: `审批${request.title}`,
        assigneeId: reviewer.id,
        sourceType: 'approval',
        sourceId: request.id,
        dueAt: new Date(Date.parse(at) + 24 * 60 * 60 * 1000).toISOString(),
        status: 'open',
        completedAt: null
      });
      audit(
        state,
        request,
        'submit',
        actor.id,
        fromStatus,
        at,
        fromStatus ? `重新提交并创建 ${taskId}` : `创建 ${taskId}`
      );
      const value = result(request);
      remember(state, 'submit', input, value);
      return value;
    });
  }

  validateApprove(input: ApprovalReviewInput): AwcpFieldError[] {
    return reviewErrors(this.repository.snapshot(), input, 'approve');
  }
  approve(input: ApprovalReviewInput): ApprovalResult {
    return this.decide(input, 'approve');
  }
  validateReturn(input: ApprovalReviewInput): AwcpFieldError[] {
    return reviewErrors(this.repository.snapshot(), input, 'return');
  }
  return(input: ApprovalReviewInput): ApprovalResult {
    return this.decide(input, 'return');
  }
  private decide(input: ApprovalReviewInput, operation: 'approve' | 'return'): ApprovalResult {
    return this.repository.transact((state) => {
      const previous = recordErrors(state, operation, input);
      requireValid(previous.errors);
      if (previous.replay) return { ...previous.replay.result };
      requireValid(reviewErrors(state, input, operation));
      const request = state.officeApprovalRequests.find((item) => item.id === input.requestId);
      if (!request) throw businessError('action.approval-not-found', '申请不存在。');
      const at = this.repository.clock.now();
      const taskId = closeTask(state, request, at);
      request.status = operation === 'approve' ? 'approved' : 'returned';
      request.businessVersion += 1;
      state.officeApprovalDecisions.push({
        id: id(
          'APDEC',
          state.officeApprovalDecisions.map((item) => item.id)
        ),
        requestId: request.id,
        taskId,
        action: operation,
        actorId: input.actorId,
        opinion: input.opinion.trim(),
        businessVersion: request.businessVersion,
        decidedAt: at
      });
      audit(state, request, operation, input.actorId, 'submitted', at, input.opinion.trim());
      const value = result(request);
      remember(state, operation, input, value);
      return value;
    });
  }

  validateWithdraw(input: ApprovalWithdrawInput): AwcpFieldError[] {
    return withdrawErrors(this.repository.snapshot(), input);
  }
  withdraw(input: ApprovalWithdrawInput): ApprovalResult {
    return this.repository.transact((state) => {
      const previous = recordErrors(state, 'withdraw', input);
      requireValid(previous.errors);
      if (previous.replay) return { ...previous.replay.result };
      requireValid(withdrawErrors(state, input));
      const request = state.officeApprovalRequests.find((item) => item.id === input.requestId);
      if (!request) throw businessError('action.approval-not-found', '申请不存在。');
      const at = this.repository.clock.now();
      const taskId = closeTask(state, request, at);
      request.status = 'withdrawn';
      request.businessVersion += 1;
      state.officeApprovalDecisions.push({
        id: id(
          'APDEC',
          state.officeApprovalDecisions.map((item) => item.id)
        ),
        requestId: request.id,
        taskId,
        action: 'withdraw',
        actorId: input.actorId,
        opinion: input.reason.trim(),
        businessVersion: request.businessVersion,
        decidedAt: at
      });
      audit(state, request, 'withdraw', input.actorId, 'submitted', at, input.reason.trim());
      const value = result(request);
      remember(state, 'withdraw', input, value);
      return value;
    });
  }
}
