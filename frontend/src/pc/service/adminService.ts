import { workflowErrors } from './workflowAccess';
import type { AwcpFieldError, JsonObject } from '@app/awcp';

import { businessError, fieldError } from '../../common/awcp/contracts';
import type { AdminOperationRecord, DemoState } from '../../common/fixtures/types';
import type { DemoRepository } from '../../common/store/repository';

export interface AdminReadInput extends JsonObject {
  actorId: string;
}
export interface AssetAssignInput extends AdminReadInput {
  assetId: string;
  holderId: string;
  expectedVersion: number;
  idempotencyKey: string;
}
export interface AssetReturnInput extends AdminReadInput {
  assetId: string;
  expectedVersion: number;
  idempotencyKey: string;
}
export interface ResourceReserveInput extends AdminReadInput {
  resourceId: string;
  participantIds: string[];
  driverId: string | null;
  startAt: string;
  endAt: string;
  idempotencyKey: string;
}
export interface RepairResolveInput extends AdminReadInput {
  ticketId: string;
  resolution: string;
  expectedVersion: number;
  idempotencyKey: string;
}
export interface RepairAcceptInput extends AdminReadInput {
  ticketId: string;
  expectedVersion: number;
  idempotencyKey: string;
}
export interface AdminResult extends JsonObject {
  id: string;
  status: string;
  businessVersion: number;
}
type Operation = AdminOperationRecord['operation'];

function nextId(prefix: string, ids: string[]): string {
  const next =
    Math.max(
      0,
      ...ids.map((id) => {
        const match = new RegExp(`^${prefix}-([0-9]+)$`).exec(id);
        return match ? Number(match[1]) : 0;
      })
    ) + 1;
  return `${prefix}-${String(next).padStart(3, '0')}`;
}
function fingerprint(input: JsonObject): string {
  const { idempotencyKey: _key, ...payload } = input;
  const ordered = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(ordered);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, ordered(v)])
      );
    return value;
  };
  return JSON.stringify(ordered(payload));
}
function replay(
  state: DemoState,
  operation: Operation,
  input: JsonObject & { idempotencyKey: string }
): {
  errors: AwcpFieldError[];
  record: AdminOperationRecord | null;
} {
  if (typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.idempotencyKey))
    return { errors: [fieldError(['idempotencyKey'], '业务幂等键格式无效。')], record: null };
  const record = state.adminOperationRecords.find((item) => item.idempotencyKey === input.idempotencyKey);
  if (!record) return { errors: [], record: null };
  return record.operation === operation && record.fingerprint === fingerprint(input)
    ? { errors: [], record }
    : { errors: [fieldError(['idempotencyKey'], '业务幂等键已用于其他操作或参数。')], record: null };
}
function remember(
  state: DemoState,
  operation: Operation,
  input: JsonObject & { idempotencyKey: string },
  result: AdminResult
): void {
  state.adminOperationRecords.push({
    idempotencyKey: input.idempotencyKey,
    operation,
    fingerprint: fingerprint(input),
    result: { id: result.id, status: result.status, businessVersion: result.businessVersion }
  });
}
function valid(errors: AwcpFieldError[]): void {
  if (errors.length)
    throw businessError(
      'action.invalid-admin-request',
      errors.flatMap((item) => item.messages).join('；'),
      errors.map((item) => ({ path: item.path, messages: item.messages }))
    );
}
function actor(state: DemoState, actorId: string): AwcpFieldError[] {
  return state.employees.some((item) => item.id === actorId && item.active)
    ? []
    : [fieldError(['actorId'], '操作人不存在或已离职。')];
}
function manager(state: DemoState, actorId: string): AwcpFieldError[] {
  if (state.workflowProfile === 'coarse-roles' && state.employees.find((employee) => employee.id === actorId)?.roles.includes('workflow-initiator')) return actor(state, actorId);
  return state.employees.find((item) => item.id === actorId)?.roles.includes('manager')
    ? []
    : [fieldError(['actorId'], '仅演示资产管理员可分配设备。')];
}
function assignErrors(state: DemoState, input: AssetAssignInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const key = replay(state, 'asset.assign', input);
  if (key.record || key.errors.length) return key.errors;
  const errors = [...actor(state, input.actorId), ...manager(state, input.actorId)];
  const asset = state.adminAssets.find((item) => item.id === input.assetId);
  if (!asset) return [...errors, fieldError(['assetId'], '设备不存在。')];
  if (asset.status !== 'available' || asset.holderId !== null)
    errors.push(fieldError(['assetId'], '设备已占用或维修中，不能重复领用。'));
  if (asset.businessVersion !== input.expectedVersion)
    errors.push(fieldError(['expectedVersion'], `设备版本应为 ${asset.businessVersion}。`));
  if (!state.employees.some((item) => item.id === input.holderId && item.active))
    errors.push(fieldError(['holderId'], '持有人不存在或已离职。'));
  return errors;
}
function returnErrors(state: DemoState, input: AssetReturnInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const key = replay(state, 'asset.return', input);
  if (key.record || key.errors.length) return key.errors;
  const errors = actor(state, input.actorId);
  const asset = state.adminAssets.find((item) => item.id === input.assetId);
  if (!asset) return [...errors, fieldError(['assetId'], '设备不存在。')];
  if (asset.status !== 'assigned' || !asset.holderId) errors.push(fieldError(['assetId'], '设备未被领用。'));
  if (
    asset.holderId !== input.actorId &&
    !state.employees.find((item) => item.id === input.actorId)?.roles.includes('manager')
  )
    errors.push(fieldError(['actorId'], '仅当前持有人或资产管理员可归还。'));
  if (asset.businessVersion !== input.expectedVersion)
    errors.push(fieldError(['expectedVersion'], `设备版本应为 ${asset.businessVersion}。`));
  return errors;
}
function instant(value: string): number | null {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  )
    return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}
function reserveErrors(state: DemoState, input: ResourceReserveInput, now: string): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const key = replay(state, 'resource.reserve', input);
  if (key.record || key.errors.length) return key.errors;
  const errors = actor(state, input.actorId);
  const resource = state.adminResources.find((item) => item.id === input.resourceId);
  if (!resource) return [...errors, fieldError(['resourceId'], '资源不存在。')];
  if (
    !Array.isArray(input.participantIds) ||
    input.participantIds.length < 1 ||
    input.participantIds.length > resource.capacity ||
    new Set(input.participantIds).size !== input.participantIds.length
  ) {
    errors.push(fieldError(['participantIds'], `参加人员须不重复且为 1 到 ${resource.capacity} 人。`));
  } else {
    if (!input.participantIds.includes(input.actorId))
      errors.push(fieldError(['participantIds'], '预约人须包含在参加人员中。'));
    input.participantIds.forEach((id, index) => {
      if (!state.employees.some((item) => item.id === id && item.active))
        errors.push(fieldError(['participantIds', index], '参加人员不存在或已离职。'));
    });
  }
  if (resource.kind === 'meeting-room') {
    if (input.driverId !== null) errors.push(fieldError(['driverId'], '会议室预约无需驾驶员。'));
  } else if (
    !input.driverId ||
    !resource.authorizedDriverIds.includes(input.driverId) ||
    !state.employees.some((item) => item.id === input.driverId && item.active) ||
    !Array.isArray(input.participantIds) ||
    !input.participantIds.includes(input.driverId)
  ) {
    errors.push(fieldError(['driverId'], '车辆须指定参与行程的授权驾驶员。'));
  }
  const start = instant(input.startAt);
  const end = instant(input.endAt);
  if (start === null || start <= Date.parse(now))
    errors.push(fieldError(['startAt'], '预约开始时间须为有效的未来时刻。'));
  if (
    end === null ||
    start === null ||
    end <= start ||
    end - start > (resource.kind === 'meeting-room' ? 8 : 24) * 3_600_000
  )
    errors.push(
      fieldError(['endAt'], `预约结束时间须晚于开始时间，且不超过${resource.kind === 'meeting-room' ? 8 : 24}小时。`)
    );
  if (
    start !== null &&
    end !== null &&
    end > start &&
    state.resourceReservations.some(
      (item) => item.resourceId === input.resourceId && Date.parse(item.startAt) < end && Date.parse(item.endAt) > start
    )
  )
    errors.push(fieldError(['startAt'], '该资源时段已有预约。'));
  return errors;
}
function resolveErrors(state: DemoState, input: RepairResolveInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const key = replay(state, 'repair.resolve', input);
  if (key.record || key.errors.length) return key.errors;
  const errors = actor(state, input.actorId);
  const ticket = state.repairTickets.find((item) => item.id === input.ticketId);
  if (!ticket) return [...errors, fieldError(['ticketId'], '维修工单不存在。')];
  if (ticket.assigneeId !== input.actorId) errors.push(fieldError(['actorId'], '仅指定维修处理人可登记意见。'));
  if (ticket.status !== 'open') errors.push(fieldError(['ticketId'], '工单不处于待处理状态。'));
  if (ticket.businessVersion !== input.expectedVersion)
    errors.push(fieldError(['expectedVersion'], `工单版本应为 ${ticket.businessVersion}。`));
  if (typeof input.resolution !== 'string' || !input.resolution.trim() || input.resolution.trim().length > 200)
    errors.push(fieldError(['resolution'], '维修处理意见须为 1 到 200 字。'));
  if (!state.adminAssets.some((item) => item.id === ticket.assetId && item.status === 'repair'))
    errors.push(fieldError(['ticketId'], '关联设备不处于维修状态。'));
  return errors;
}
function acceptErrors(state: DemoState, input: RepairAcceptInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const key = replay(state, 'repair.accept', input);
  if (key.record || key.errors.length) return key.errors;
  const errors = actor(state, input.actorId);
  const ticket = state.repairTickets.find((item) => item.id === input.ticketId);
  if (!ticket) return [...errors, fieldError(['ticketId'], '维修工单不存在。')];
  if (ticket.reporterId !== input.actorId) errors.push(fieldError(['actorId'], '仅报修人可验收维修结果。'));
  if (ticket.status !== 'resolved' || !ticket.resolution?.trim())
    errors.push(fieldError(['ticketId'], '须先登记维修处理意见才能验收关闭。'));
  if (ticket.businessVersion !== input.expectedVersion)
    errors.push(fieldError(['expectedVersion'], `工单版本应为 ${ticket.businessVersion}。`));
  if (!state.adminAssets.some((item) => item.id === ticket.assetId && item.status === 'repair'))
    errors.push(fieldError(['ticketId'], '关联设备不处于维修状态。'));
  return errors;
}
function audit(
  state: DemoState,
  entityType: 'admin-asset' | 'resource-reservation' | 'repair-ticket',
  entityId: string,
  action: string,
  actorId: string,
  status: string,
  version: number,
  at: string
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
    at,
    fromStatus: null,
    toStatus: status,
    businessVersion: version
  });
}
export class AdminService {
  constructor(private readonly repository: DemoRepository) {}
  subscribe(listener: () => void): () => void {
    return this.repository.subscribe(listener);
  }
  snapshot(): DemoState {
    return this.repository.snapshot();
  }
  validateRead(input: AdminReadInput): AwcpFieldError[] {
    return actor(this.repository.snapshot(), input.actorId);
  }
  read(input: AdminReadInput): JsonObject {
    const state = this.repository.snapshot();
    valid(actor(state, input.actorId));
    return JSON.parse(
      JSON.stringify({
        assets: state.adminAssets,
        holdings: state.employees.map((item) => ({
          employeeId: item.id,
          assetIds: state.adminAssets.filter((asset) => asset.holderId === item.id).map((asset) => asset.id)
        })),
        movements: state.assetMovements,
        resources: state.adminResources,
        reservations: state.resourceReservations,
        repairs: state.repairTickets
      })
    ) as JsonObject;
  }
  validateAssign(input: AssetAssignInput): AwcpFieldError[] {
    return assignErrors(this.repository.snapshot(), input);
  }
  assign(input: AssetAssignInput): AdminResult {
    return this.repository.transact((state) => {
      const key = replay(state, 'asset.assign', input);
      valid(key.errors);
      if (key.record) return { ...key.record.result };
      valid(assignErrors(state, input));
      const asset = state.adminAssets.find((item) => item.id === input.assetId);
      if (!asset) throw businessError('action.asset-not-found', '设备不存在。');
      asset.status = 'assigned';
      asset.holderId = input.holderId;
      asset.businessVersion += 1;
      const at = this.repository.clock.now();
      state.assetMovements.push({
        id: nextId(
          'AMOV',
          state.assetMovements.map((item) => item.id)
        ),
        assetId: asset.id,
        holderId: input.holderId,
        actorId: input.actorId,
        action: 'assign',
        at
      });
      audit(state, 'admin-asset', asset.id, 'assign', input.actorId, asset.status, asset.businessVersion, at);
      const result = { id: asset.id, status: asset.status, businessVersion: asset.businessVersion };
      remember(state, 'asset.assign', input, result);
      return result;
    });
  }
  validateReturn(input: AssetReturnInput): AwcpFieldError[] {
    return returnErrors(this.repository.snapshot(), input);
  }
  returnAsset(input: AssetReturnInput): AdminResult {
    return this.repository.transact((state) => {
      const key = replay(state, 'asset.return', input);
      valid(key.errors);
      if (key.record) return { ...key.record.result };
      valid(returnErrors(state, input));
      const asset = state.adminAssets.find((item) => item.id === input.assetId);
      if (!asset || !asset.holderId) throw businessError('action.asset-not-found', '设备未被领用。');
      const previousHolderId = asset.holderId;
      asset.status = 'available';
      asset.holderId = null;
      asset.businessVersion += 1;
      const at = this.repository.clock.now();
      state.assetMovements.push({
        id: nextId(
          'AMOV',
          state.assetMovements.map((item) => item.id)
        ),
        assetId: asset.id,
        holderId: previousHolderId,
        actorId: input.actorId,
        action: 'return',
        at
      });
      audit(state, 'admin-asset', asset.id, 'return', input.actorId, asset.status, asset.businessVersion, at);
      const result = { id: asset.id, status: asset.status, businessVersion: asset.businessVersion };
      remember(state, 'asset.return', input, result);
      return result;
    });
  }
  validateReserve(input: ResourceReserveInput): AwcpFieldError[] {
    return reserveErrors(this.repository.snapshot(), input, this.repository.clock.now());
  }
  reserve(input: ResourceReserveInput): AdminResult {
    return this.repository.transact((state) => {
      const key = replay(state, 'resource.reserve', input);
      valid(key.errors);
      if (key.record) return { ...key.record.result };
      const at = this.repository.clock.now();
      valid(reserveErrors(state, input, at));
      const reservation = {
        id: nextId(
          'RSV',
          state.resourceReservations.map((item) => item.id)
        ),
        resourceId: input.resourceId,
        actorId: input.actorId,
        participantIds: [...input.participantIds],
        driverId: input.driverId,
        startAt: new Date(input.startAt).toISOString(),
        endAt: new Date(input.endAt).toISOString(),
        status: 'reserved' as const,
        createdAt: at
      };
      state.resourceReservations.push(reservation);
      audit(state, 'resource-reservation', reservation.id, 'reserve', input.actorId, 'reserved', 1, at);
      const result = { id: reservation.id, status: reservation.status, businessVersion: 1 };
      remember(state, 'resource.reserve', input, result);
      return result;
    });
  }
  validateResolve(input: RepairResolveInput): AwcpFieldError[] {
    return resolveErrors(this.repository.snapshot(), input);
  }
  resolve(input: RepairResolveInput): AdminResult {
    return this.repository.transact((state) => {
      const key = replay(state, 'repair.resolve', input);
      valid(key.errors);
      if (key.record) return { ...key.record.result };
      valid(resolveErrors(state, input));
      const ticket = state.repairTickets.find((item) => item.id === input.ticketId);
      if (!ticket) throw businessError('action.repair-not-found', '维修工单不存在。');
      const at = this.repository.clock.now();
      ticket.resolution = input.resolution.trim();
      ticket.resolvedAt = at;
      ticket.status = 'resolved';
      ticket.businessVersion += 1;
      audit(state, 'repair-ticket', ticket.id, 'resolve', input.actorId, ticket.status, ticket.businessVersion, at);
      const result = { id: ticket.id, status: ticket.status, businessVersion: ticket.businessVersion };
      remember(state, 'repair.resolve', input, result);
      return result;
    });
  }
  validateAccept(input: RepairAcceptInput): AwcpFieldError[] {
    return acceptErrors(this.repository.snapshot(), input);
  }
  accept(input: RepairAcceptInput): AdminResult {
    return this.repository.transact((state) => {
      const key = replay(state, 'repair.accept', input);
      valid(key.errors);
      if (key.record) return { ...key.record.result };
      valid(acceptErrors(state, input));
      const ticket = state.repairTickets.find((item) => item.id === input.ticketId);
      if (!ticket) throw businessError('action.repair-not-found', '维修工单不存在。');
      const asset = state.adminAssets.find((item) => item.id === ticket.assetId);
      if (!asset) throw businessError('action.asset-not-found', '关联设备不存在。');
      const at = this.repository.clock.now();
      ticket.status = 'accepted';
      ticket.acceptedAt = at;
      ticket.businessVersion += 1;
      asset.status = 'available';
      asset.holderId = null;
      asset.businessVersion += 1;
      audit(state, 'repair-ticket', ticket.id, 'accept', input.actorId, ticket.status, ticket.businessVersion, at);
      audit(state, 'admin-asset', asset.id, 'repair-completed', input.actorId, asset.status, asset.businessVersion, at);
      const result = { id: ticket.id, status: ticket.status, businessVersion: ticket.businessVersion };
      remember(state, 'repair.accept', input, result);
      return result;
    });
  }
}
