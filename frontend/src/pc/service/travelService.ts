import { workflowErrors } from './workflowAccess';
import type { AwcpFieldError, JsonObject } from '@app/awcp';

import { businessError, fieldError } from '../../common/awcp/contracts';
import type { BusinessForm, DemoState, TravelRequest } from '../../common/fixtures/types';
import type { DemoRepository } from '../../common/store/repository';

export interface TravelSubmitInput extends JsonObject {
  actorId: string;
  departmentId: string;
  travelerIds: string[];
  origin: string;
  destination: string;
  startAt: string;
  endAt: string;
  estimatedAmountCents: number;
  idempotencyKey: string;
}

export interface TravelSubmitResult extends JsonObject {
  formId: string;
  status: 'submitted';
  businessVersion: number;
}

export interface TravelListItem {
  formId: string;
  origin: string;
  destination: string;
  startAt: string;
  endAt: string;
  travelerIds: string[];
  status: BusinessForm['status'];
  businessVersion: number;
}

const IDEMPOTENCY_OPERATION = 'travel.submit';

export class TravelService {
  constructor(private readonly repository: DemoRepository) {}

  subscribe(listener: () => void): () => void {
    return this.repository.subscribe(listener);
  }

  employees() {
    return this.repository.snapshot().employees.filter((employee) => employee.active);
  }

  list(): TravelListItem[] {
    const state = this.repository.snapshot();
    return state.travelRequests.flatMap((request) => {
      const form = state.forms.find((item) => item.id === request.formId);
      return form ? [{ ...request, status: form.status, businessVersion: form.businessVersion }] : [];
    });
  }

  validate(input: TravelSubmitInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(this.repository.snapshot(), input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
    const state = this.repository.snapshot();
    const replay = state.idempotencyRecords.find((item) => item.key === input.idempotencyKey);
    if (replay) {
      return replay.operation === IDEMPOTENCY_OPERATION && replay.fingerprint === fingerprint(input)
        ? []
        : [fieldError(['idempotencyKey'], '业务幂等键已用于其他操作或参数。')];
    }
    return validateTravel(state, input, this.repository.clock.now());
  }

  submit(input: TravelSubmitInput): TravelSubmitResult {
    return this.repository.transact((draft) => {
      const replay = draft.idempotencyRecords.find((item) => item.key === input.idempotencyKey);
      if (replay) {
        if (replay.operation !== IDEMPOTENCY_OPERATION || replay.fingerprint !== fingerprint(input)) {
          throw businessError('action.idempotency-conflict', '业务幂等键已用于其他操作或参数。');
        }
        return { formId: replay.resultId, status: 'submitted', businessVersion: replay.resultVersion ?? 1 };
      }
      const errors = validateTravel(draft, input, this.repository.clock.now());
      if (errors.length)
        throw businessError('action.invalid-travel', errors.flatMap((error) => error.messages).join('；'));

      const manager = draft.employees.find(
        (employee) =>
          employee.active && employee.departmentId === input.departmentId && employee.roles.includes('manager')
      );
      if (!manager) throw businessError('action.approver-not-found', '当前部门没有可用审批人。');

      const formId = nextId(
        'FORM',
        draft.forms.map((form) => form.id)
      );
      const form: BusinessForm = {
        id: formId,
        kind: 'travel',
        applicantId: input.actorId,
        departmentId: input.departmentId,
        status: 'submitted',
        businessVersion: 1,
        amountCents: input.estimatedAmountCents,
        createdAt: this.repository.clock.now()
      };
      const request: TravelRequest = {
        formId,
        origin: input.origin.trim(),
        destination: input.destination.trim(),
        startAt: input.startAt,
        endAt: input.endAt,
        travelerIds: [...input.travelerIds]
      };
      draft.forms.push(form);
      draft.travelRequests.push(request);
      draft.todos.push({
        id: nextId(
          'TODO',
          draft.todos.map((todo) => todo.id)
        ),
        title: '审批演示出差申请',
        assigneeId: manager.id,
        sourceType: 'form',
        sourceId: formId,
        dueAt: new Date(Date.parse(this.repository.clock.now()) + 24 * 60 * 60 * 1000).toISOString(),
        status: 'open'
      });
      draft.auditEntries.push({
        id: nextId(
          'AUD',
          draft.auditEntries.map((entry) => entry.id)
        ),
        entityType: 'form',
        entityId: formId,
        action: 'travel-submit',
        actorId: input.actorId,
        at: this.repository.clock.now(),
        fromStatus: null,
        toStatus: 'submitted',
        businessVersion: 1
      });
      draft.idempotencyRecords.push({
        key: input.idempotencyKey,
        operation: IDEMPOTENCY_OPERATION,
        fingerprint: fingerprint(input),
        resultId: formId,
        resultVersion: 1,
        resultStatus: 'submitted'
      });
      return { formId, status: 'submitted', businessVersion: 1 };
    });
  }
}

function fingerprint(input: TravelSubmitInput): string {
  return JSON.stringify([
    input.actorId,
    input.departmentId,
    input.travelerIds,
    input.origin,
    input.destination,
    input.startAt,
    input.endAt,
    input.estimatedAmountCents
  ]);
}

function validateTravel(state: DemoState, input: TravelSubmitInput, now: string): AwcpFieldError[] {
  const errors: AwcpFieldError[] = [];
  if (typeof input.idempotencyKey !== 'string' || !/^[\w.:-]{1,128}$/.test(input.idempotencyKey)) {
    errors.push(fieldError(['idempotencyKey'], '业务幂等键必须是 1～128 位字母、数字、下划线或 .:-。'));
  }

  const actor = state.employees.find((item) => item.id === input.actorId && item.active);
  if (!actor || !actor.roles.includes('employee')) errors.push(fieldError(['actorId'], '申请人必须是有效员工。'));
  if (!state.departments.some((item) => item.id === input.departmentId) || actor?.departmentId !== input.departmentId) {
    errors.push(fieldError(['departmentId'], '部门必须与当前申请人一致。'));
  }
  if (!Array.isArray(input.travelerIds) || input.travelerIds.length < 1 || input.travelerIds.length > 10) {
    errors.push(fieldError(['travelerIds'], '请选择 1～10 位同行人员。'));
  } else {
    if (new Set(input.travelerIds).size !== input.travelerIds.length) {
      errors.push(fieldError(['travelerIds'], '同行人员不能重复。'));
    }
    input.travelerIds.forEach((id, index) => {
      if (!state.employees.some((item) => item.id === id && item.active && item.departmentId === input.departmentId)) {
        errors.push(fieldError(['travelerIds', index], '同行人员必须是本部门有效员工。'));
      }
    });
    if (!input.travelerIds.includes(input.actorId)) {
      errors.push(fieldError(['travelerIds'], '同行人员需包含申请人。'));
    }
  }

  if (typeof input.origin !== 'string' || !input.origin.trim() || input.origin.trim().length > 80) {
    errors.push(fieldError(['origin'], '出发地必须是 1～80 字。'));
  }
  if (typeof input.destination !== 'string' || !input.destination.trim() || input.destination.trim().length > 80) {
    errors.push(fieldError(['destination'], '目的地必须是 1～80 字。'));
  } else if (typeof input.origin === 'string' && input.origin.trim() === input.destination.trim()) {
    errors.push(fieldError(['destination'], '目的地不能与出发地相同。'));
  }

  const start = parseTimestamp(input.startAt);
  const end = parseTimestamp(input.endAt);
  if (start === null || start < Date.parse(now)) errors.push(fieldError(['startAt'], '开始时间必须是有效的未来时间。'));
  if (end === null || (start !== null && end <= start)) {
    errors.push(fieldError(['endAt'], '结束时间必须晚于开始时间。'));
  }
  if (!Number.isSafeInteger(input.estimatedAmountCents) || input.estimatedAmountCents <= 0) {
    errors.push(fieldError(['estimatedAmountCents'], '预计金额必须是正整数分。'));
  }
  return errors;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const milliseconds = Number((match[7] ?? '').padEnd(3, '0'));
  const zone = match[8];
  const offset =
    zone === 'Z' ? 0 : (zone[0] === '+' ? 1 : -1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 14 || Number(zone.slice(4, 6)) > 59)) return null;
  const localTime = Date.UTC(year, month - 1, day, hour, minute, second, milliseconds);
  const local = new Date(localTime);
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() + 1 !== month ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second
  )
    return null;
  return localTime - offset * 60_000;
}

function nextId(prefix: string, ids: readonly string[]): string {
  const max = ids.reduce((current, id) => {
    const match = new RegExp(`^${prefix}-([0-9]+)$`).exec(id);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}
