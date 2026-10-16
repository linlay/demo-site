import { workflowErrors } from './workflowAccess';
import type { AwcpFieldError, JsonObject } from '@app/awcp';

import { businessError, fieldError } from '../../common/awcp/contracts';
import type { DemoState, ItOperationRecord, ItTicket } from '../../common/fixtures/types';
import type { DemoRepository } from '../../common/store/repository';

export interface ItReadInput extends JsonObject {
  actorId: string;
}
export interface AccessRequestInput extends ItReadInput {
  systemId: string;
  permissionId: string;
  materialIds: string[];
  reason: string;
  idempotencyKey: string;
}
export interface TicketAssignInput extends ItReadInput {
  ticketId: string;
  assigneeId: string;
  expectedVersion: number;
  idempotencyKey: string;
}
export interface TicketResolveInput extends ItReadInput {
  ticketId: string;
  resolution: string;
  expectedVersion: number;
  idempotencyKey: string;
}
export interface TicketCloseInput extends ItReadInput {
  ticketId: string;
  acceptanceNote: string;
  expectedVersion: number;
  idempotencyKey: string;
}
export interface ItResult extends JsonObject {
  id: string;
  status: string;
  businessVersion: number;
}
type Operation = ItOperationRecord['operation'];
type WriteInput = AccessRequestInput | TicketAssignInput | TicketResolveInput | TicketCloseInput;

function nextId(prefix: string, ids: string[]): string {
  const numbers = ids.map((id) => Number(new RegExp(`^${prefix}-([0-9]+)$`).exec(id)?.[1] ?? 0));
  return `${prefix}-${String(Math.max(0, ...numbers) + 1).padStart(3, '0')}`;
}
function fingerprint(input: WriteInput): string {
  const { idempotencyKey: _key, ...payload } = input;
  const ordered = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(ordered)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, ordered(item)])
          )
        : value;
  return JSON.stringify(ordered(payload));
}
function keyCheck(
  state: DemoState,
  operation: Operation,
  input: WriteInput
): { errors: AwcpFieldError[]; record: ItOperationRecord | null } {
  if (typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.idempotencyKey))
    return { errors: [fieldError(['idempotencyKey'], '业务幂等键格式无效。')], record: null };
  const record = state.itOperationRecords.find((item) => item.idempotencyKey === input.idempotencyKey);
  if (!record) return { errors: [], record: null };
  return record.operation === operation && record.fingerprint === fingerprint(input)
    ? { errors: [], record }
    : { errors: [fieldError(['idempotencyKey'], '业务幂等键已用于其他操作或参数。')], record: null };
}
function ensure(errors: AwcpFieldError[]): void {
  if (errors.length)
    throw businessError(
      'action.invalid-it-request',
      errors.flatMap((error) => error.messages).join('；'),
      errors.map((error) => ({ path: error.path, messages: error.messages }))
    );
}
function active(state: DemoState, actorId: string): AwcpFieldError[] {
  return state.employees.some((item) => item.id === actorId && item.active)
    ? []
    : [fieldError(['actorId'], '操作人不存在或已离职。')];
}
function ticketErrors(
  state: DemoState,
  input: TicketAssignInput | TicketResolveInput | TicketCloseInput,
  status: ItTicket['status']
): AwcpFieldError[] {
  const errors = active(state, input.actorId);
  const ticket = state.itTickets.find((item) => item.id === input.ticketId);
  if (!ticket) return [...errors, fieldError(['ticketId'], 'IT 工单不存在。')];
  if (ticket.status !== status) errors.push(fieldError(['ticketId'], `工单状态须为 ${status}。`));
  if (ticket.businessVersion !== input.expectedVersion)
    errors.push(fieldError(['expectedVersion'], `工单版本应为 ${ticket.businessVersion}。`));
  return errors;
}
function requiredTicket(state: DemoState, ticketId: string): ItTicket {
  const ticket = state.itTickets.find((item) => item.id === ticketId);
  if (!ticket) throw businessError('action.invalid-it-request', 'IT 工单不存在。');
  return ticket;
}
function textError(value: string, path: string): AwcpFieldError[] {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 200
    ? []
    : [fieldError([path], '内容须为 1 到 200 字。')];
}
function shanghaiDate(now: string): string {
  return new Date(Date.parse(now) + 8 * 3_600_000).toISOString().slice(0, 10);
}
function event(
  state: DemoState,
  ticket: ItTicket,
  actorId: string,
  fromStatus: ItTicket['status'],
  note: string,
  now: string
): void {
  state.itTicketEvents.push({
    id: nextId(
      'TEVT',
      state.itTicketEvents.map((item) => item.id)
    ),
    ticketId: ticket.id,
    actorId,
    fromStatus,
    toStatus: ticket.status,
    note,
    businessVersion: ticket.businessVersion,
    at: now
  });
}
function audit(
  state: DemoState,
  entityType: 'access-request' | 'it-ticket',
  entityId: string,
  action: string,
  actorId: string,
  now: string
): void {
  state.auditEntries.push({
    id: nextId(
      'AUD',
      state.auditEntries.map((item) => item.id)
    ),
    entityType,
    entityId,
    action,
    actorId,
    at: now,
    fromStatus: null,
    toStatus:
      entityType === 'access-request'
        ? 'pending'
        : (state.itTickets.find((item) => item.id === entityId)?.status ?? ''),
    businessVersion:
      entityType === 'access-request'
        ? 1
        : (state.itTickets.find((item) => item.id === entityId)?.businessVersion ?? null)
  });
}

export class ItService {
  constructor(private readonly repository: DemoRepository) {}
  snapshot(): DemoState {
    return this.repository.snapshot();
  }
  subscribe(listener: () => void): () => void {
    return this.repository.subscribe(listener);
  }
  validateRead(input: ItReadInput): AwcpFieldError[] {
    return active(this.snapshot(), input.actorId);
  }
  read(input: ItReadInput): JsonObject {
    ensure(this.validateRead(input));
    const state = this.snapshot();
    return {
      systems: state.itSystems.map((item) => ({ ...item })),
      permissions: state.itPermissions.map((item) => ({ ...item })),
      materials: state.accessMaterials.filter((item) => item.ownerId === input.actorId).map((item) => ({ ...item })),
      requests: state.accessRequests.map((item) => ({ ...item })),
      grants: state.accessGrants.map((item) => ({ ...item })),
      tickets: state.itTickets.map((item) => ({ ...item })),
      events: state.itTicketEvents.map((item) => ({ ...item }))
    };
  }
  validateRequest(input: AccessRequestInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(this.repository.snapshot(), input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
    const state = this.snapshot();
    const key = keyCheck(state, 'access.request', input);
    if (key.record || key.errors.length) return key.errors;
    const errors = [...active(state, input.actorId), ...textError(input.reason, 'reason')];
    const permission = state.itPermissions.find(
      (item) => item.id === input.permissionId && item.systemId === input.systemId
    );
    if (!state.itSystems.some((item) => item.id === input.systemId))
      errors.push(fieldError(['systemId'], '系统不存在。'));
    if (!permission) errors.push(fieldError(['permissionId'], '系统与权限 ID 不匹配。'));
    const employee = state.employees.find((item) => item.id === input.actorId);
    if (permission && !employee?.roles.some((role) => permission.allowedRoles.includes(role)))
      errors.push(fieldError(['actorId'], '申请人角色不符合权限规则。'));
    const ids = input.materialIds;
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length)
      errors.push(fieldError(['materialIds'], '资料 ID 须非空且不重复。'));
    else {
      const materials = ids.map((id) => state.accessMaterials.find((item) => item.id === id));
      materials.forEach((material, index) => {
        if (
          !material ||
          material.ownerId !== input.actorId ||
          material.expiresOn < shanghaiDate(this.repository.clock.now())
        )
          errors.push(fieldError(['materialIds', index], '资料不存在、不属于申请人或已过期。'));
      });
      permission?.requiredMaterialKinds.forEach((kind) => {
        if (
          !materials.some(
            (material) =>
              material?.kind === kind &&
              material.ownerId === input.actorId &&
              material.expiresOn >= shanghaiDate(this.repository.clock.now())
          )
        )
          errors.push(fieldError(['materialIds'], `缺少有效的 ${kind} 资料。`));
      });
    }
    return errors;
  }
  request(input: AccessRequestInput): ItResult {
    ensure(this.validateRequest(input));
    return this.write('access.request', input, (state, now) => {
      const id = nextId(
        'AREQ',
        state.accessRequests.map((item) => item.id)
      );
      state.accessRequests.push({
        id,
        applicantId: input.actorId,
        systemId: input.systemId,
        permissionId: input.permissionId,
        materialIds: [...input.materialIds],
        reason: input.reason.trim(),
        status: 'pending',
        reviewerId: 'EMP-004',
        businessVersion: 1,
        submittedAt: now
      });
      audit(state, 'access-request', id, 'access.request', input.actorId, now);
      return { id, status: 'pending', businessVersion: 1 };
    });
  }
  validateAssign(input: TicketAssignInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(this.repository.snapshot(), input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
    const state = this.snapshot();
    const key = keyCheck(state, 'ticket.assign', input);
    if (key.record || key.errors.length) return key.errors;
    const errors = ticketErrors(state, input, 'new');
    if (
      !state.employees.some((item) => item.id === input.actorId && item.active && item.roles.includes('it-coordinator'))
    )
      errors.push(fieldError(['actorId'], '仅 IT 协调员可分派。'));
    if (!state.employees.some((item) => item.id === input.assigneeId && item.active && item.roles.includes('it-agent')))
      errors.push(fieldError(['assigneeId'], '处理人须为在职 IT 处理员。'));
    return errors;
  }
  assign(input: TicketAssignInput): ItResult {
    ensure(this.validateAssign(input));
    return this.write('ticket.assign', input, (state, now) => {
      const ticket = requiredTicket(state, input.ticketId);
      ticket.assigneeId = input.assigneeId;
      ticket.status = 'assigned';
      ticket.businessVersion += 1;
      event(state, ticket, input.actorId, 'new', `分派给 ${input.assigneeId}`, now);
      audit(state, 'it-ticket', ticket.id, 'ticket.assign', input.actorId, now);
      return { id: ticket.id, status: ticket.status, businessVersion: ticket.businessVersion };
    });
  }
  validateResolve(input: TicketResolveInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(this.repository.snapshot(), input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
    const state = this.snapshot();
    const key = keyCheck(state, 'ticket.resolve', input);
    if (key.record || key.errors.length) return key.errors;
    const errors = [...ticketErrors(state, input, 'assigned'), ...textError(input.resolution, 'resolution')];
    if (state.itTickets.find((item) => item.id === input.ticketId)?.assigneeId !== input.actorId)
      errors.push(fieldError(['actorId'], '仅指定处理人可登记处理结果。'));
    return errors;
  }
  resolve(input: TicketResolveInput): ItResult {
    ensure(this.validateResolve(input));
    return this.write('ticket.resolve', input, (state, now) => {
      const ticket = requiredTicket(state, input.ticketId);
      ticket.status = 'resolved';
      ticket.resolution = input.resolution.trim();
      ticket.resolvedAt = now;
      ticket.businessVersion += 1;
      event(state, ticket, input.actorId, 'assigned', ticket.resolution, now);
      audit(state, 'it-ticket', ticket.id, 'ticket.resolve', input.actorId, now);
      return { id: ticket.id, status: ticket.status, businessVersion: ticket.businessVersion };
    });
  }
  validateClose(input: TicketCloseInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(this.repository.snapshot(), input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
    const state = this.snapshot();
    const key = keyCheck(state, 'ticket.close', input);
    if (key.record || key.errors.length) return key.errors;
    const errors = [...ticketErrors(state, input, 'resolved'), ...textError(input.acceptanceNote, 'acceptanceNote')];
    const ticket = state.itTickets.find((item) => item.id === input.ticketId);
    if (ticket?.requesterId !== input.actorId) errors.push(fieldError(['actorId'], '仅报单人可验收关闭。'));
    if (ticket && (!ticket.assigneeId || !ticket.resolution?.trim() || !ticket.resolvedAt))
      errors.push(fieldError(['ticketId'], '工单须先分派并记录完整处理结果。'));
    return errors;
  }
  close(input: TicketCloseInput): ItResult {
    ensure(this.validateClose(input));
    return this.write('ticket.close', input, (state, now) => {
      const ticket = requiredTicket(state, input.ticketId);
      ticket.status = 'closed';
      ticket.acceptanceNote = input.acceptanceNote.trim();
      ticket.closedAt = now;
      ticket.businessVersion += 1;
      event(state, ticket, input.actorId, 'resolved', ticket.acceptanceNote, now);
      audit(state, 'it-ticket', ticket.id, 'ticket.close', input.actorId, now);
      return { id: ticket.id, status: ticket.status, businessVersion: ticket.businessVersion };
    });
  }
  private write(operation: Operation, input: WriteInput, apply: (state: DemoState, now: string) => ItResult): ItResult {
    return this.repository.transact((state) => {
      const replay = keyCheck(state, operation, input);
      ensure(replay.errors);
      if (replay.record) return { ...replay.record.result };
      const result = apply(state, this.repository.clock.now());
      state.itOperationRecords.push({
        idempotencyKey: input.idempotencyKey,
        operation,
        fingerprint: fingerprint(input),
        result: { ...result }
      });
      return result;
    });
  }
}
