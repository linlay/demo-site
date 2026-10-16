import { workflowErrors } from './workflowAccess';
import type { AwcpFieldError, JsonObject } from '@app/awcp';

import { businessError, fieldError } from '../../common/awcp/contracts';
import type {
  DemoRole,
  DemoState,
  InstitutionNeed,
  InstitutionOperationRecord,
  InstitutionProfile,
  Meeting,
  Roadshow
} from '../../common/fixtures/types';
import type { DemoRepository } from '../../common/store/repository';

export interface InstitutionQueryInput extends JsonObject {
  actorId: string;
  institutionId: string;
}
export interface EntitlementInput extends JsonObject {
  actorId: string;
  needId: string;
}
export interface ServiceMutationInput extends EntitlementInput {
  expectedVersion: number;
  idempotencyKey: string;
}
export interface NeedReviseInput extends ServiceMutationInput {
  materialIds: string[];
  reason: string;
}
export interface RoadshowReserveInput extends ServiceMutationInput {
  resourceId: string;
  startAt: string;
  endAt: string;
}
export interface MaterialPackageInput extends ServiceMutationInput {
  materialIds: string[];
}
export interface RoadshowMinutesInput extends ServiceMutationInput {
  agenda: string;
  decisions: string[];
}
export interface ServiceFollowupInput extends ServiceMutationInput {
  note: string;
  outcome: 'satisfied' | 'needs-action';
}
export interface ServiceResult extends JsonObject {
  needId: string;
  status: InstitutionNeed['status'];
  businessVersion: number;
  roadshowId: string | null;
}
type Operation = InstitutionOperationRecord['operation'];
type WriteInput =
  | NeedReviseInput
  | RoadshowReserveInput
  | MaterialPackageInput
  | ServiceMutationInput
  | RoadshowMinutesInput
  | ServiceFollowupInput;
export interface AlternativeSlot extends JsonObject {
  resourceId: string;
  startAt: string;
  endAt: string;
}

function nextId(prefix: string, ids: string[]): string {
  return `${prefix}-${String(Math.max(0, ...ids.map((id) => Number(new RegExp(`^${prefix}-([0-9]+)$`).exec(id)?.[1] ?? 0))) + 1).padStart(3, '0')}`;
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
): { record: InstitutionOperationRecord | null; errors: AwcpFieldError[] } {
  if (typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.idempotencyKey))
    return { record: null, errors: [fieldError(['idempotencyKey'], '业务幂等键格式无效。')] };
  const record = state.institutionOperationRecords.find((item) => item.idempotencyKey === input.idempotencyKey);
  if (!record) return { record: null, errors: [] };
  return record.operation === operation && record.fingerprint === fingerprint(input)
    ? { record, errors: [] }
    : { record: null, errors: [fieldError(['idempotencyKey'], '业务幂等键已用于其他操作或参数。')] };
}
function ensure(errors: AwcpFieldError[]): void {
  if (errors.length)
    throw businessError(
      'action.invalid-institution-request',
      errors.flatMap((item) => item.messages).join('；'),
      errors.map((item) => ({ path: item.path, messages: item.messages }))
    );
}
function activeRole(state: DemoState, actorId: string, roles: DemoRole[]): AwcpFieldError[] {
  const employee = state.employees.find((item) => item.id === actorId && item.active);
  if (!employee) return [fieldError(['actorId'], '操作人不存在或已离职。')];
  return employee.roles.some((item) => roles.includes(item))
    ? []
    : [fieldError(['actorId'], '操作人没有对应机构服务角色。')];
}
const TEAM_ROLES: DemoRole[] = ['institution-sales', 'research-service', 'event-organizer'];
function profileForNeed(state: DemoState, need: InstitutionNeed): InstitutionProfile | undefined {
  return state.institutionProfiles.find((item) => item.id === need.institutionId);
}
function needFor(state: DemoState, id: string): InstitutionNeed | undefined {
  return state.institutionNeeds.find((item) => item.id === id);
}
function roadshowFor(state: DemoState, need: InstitutionNeed): Roadshow | undefined {
  return state.roadshows.find((item) => item.id === need.roadshowId);
}
function result(need: InstitutionNeed): ServiceResult {
  return { needId: need.id, status: need.status, businessVersion: need.businessVersion, roadshowId: need.roadshowId };
}
function requireNeed(state: DemoState, id: string): InstitutionNeed {
  const need = needFor(state, id);
  if (!need) throw businessError('action.service-need-not-found', '机构服务需求不存在。');
  return need;
}
function textErrors(value: string, path: string, max: number): AwcpFieldError[] {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= max
    ? []
    : [fieldError([path], `内容须为 1 到 ${max} 字。`)];
}
function materialReasons(state: DemoState, profile: InstitutionProfile, materialIds: string[]): string[] {
  const reasons: string[] = [];
  if (profile.policyVersion !== state.institutionPolicy.version) reasons.push('机构服务规则版本不一致');
  if (!profile.scopes.includes(state.institutionPolicy.serviceScope)) reasons.push('机构不在研究路演服务范围内');
  if (!Array.isArray(materialIds) || !materialIds.length || new Set(materialIds).size !== materialIds.length)
    reasons.push('资料 ID 须非空且不重复');
  else
    for (const id of materialIds) {
      const material = state.institutionMaterials.find((item) => item.id === id);
      if (!material) {
        reasons.push(`${id} 不存在`);
        continue;
      }
      if (material.scope !== state.institutionPolicy.serviceScope) reasons.push(`${id} 不在服务范围内`);
      const document = state.officeDocuments.find((item) => item.id === material.documentId);
      if (
        !document ||
        document.status !== 'approved' ||
        document.currentVersion !== material.documentVersion ||
        !state.officeDocumentApprovals.some(
          (item) => item.documentId === material.documentId && item.documentVersion === material.documentVersion
        )
      )
        reasons.push(`${id} 关联文档版本尚未批准`);
    }
  return reasons;
}
function baseErrors(
  state: DemoState,
  input: ServiceMutationInput,
  statuses: InstitutionNeed['status'][]
): AwcpFieldError[] {
  const need = needFor(state, input.needId);
  if (!need) return [fieldError(['needId'], '机构服务需求不存在。')];
  const errors: AwcpFieldError[] = [];
  if (!statuses.includes(need.status)) errors.push(fieldError(['needId'], `需求状态 ${need.status} 不允许当前操作。`));
  if (need.businessVersion !== input.expectedVersion)
    errors.push(fieldError(['expectedVersion'], `需求版本应为 ${need.businessVersion}。`));
  if (!profileForNeed(state, need)) errors.push(fieldError(['needId'], '机构档案不存在。'));
  return errors;
}
function audit(
  state: DemoState,
  need: InstitutionNeed,
  action: string,
  actorId: string,
  fromStatus: InstitutionNeed['status'],
  now: string
): void {
  state.auditEntries.push({
    id: nextId(
      'AUD',
      state.auditEntries.map((item) => item.id)
    ),
    entityType: 'institution-need',
    entityId: need.id,
    action,
    actorId,
    at: now,
    fromStatus,
    toStatus: need.status,
    businessVersion: need.businessVersion
  });
}
function instant(value: string): number | null {
  if (
    typeof value !== 'string' ||
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]{1,3})?)?(Z|[+-][0-9]{2}:[0-9]{2})$/.test(value)
  )
    return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function participants(profile: InstitutionProfile): string[] {
  return [...new Set([profile.salesId, profile.researchId, profile.organizerId])];
}
function conflicts(
  state: DemoState,
  profile: InstitutionProfile,
  resourceId: string,
  start: number,
  end: number
): Meeting[] {
  const ids = participants(profile);
  return state.meetings.filter(
    (meeting) =>
      start < Date.parse(meeting.endAt) &&
      end > Date.parse(meeting.startAt) &&
      (meeting.resourceId === resourceId || meeting.participantIds.some((id) => ids.includes(id)))
  );
}
function alternatives(
  state: DemoState,
  profile: InstitutionProfile,
  resourceId: string,
  start: number,
  end: number,
  now: number
): AlternativeSlot[] {
  const duration = end - start;
  const slots: AlternativeSlot[] = [];
  for (let offset = 1; offset <= 72 && slots.length < 3; offset += 1) {
    const candidate = start + offset * 3_600_000;
    if (candidate < now || conflicts(state, profile, resourceId, candidate, candidate + duration).length) continue;
    slots.push({
      resourceId,
      startAt: new Date(candidate).toISOString(),
      endAt: new Date(candidate + duration).toISOString()
    });
  }
  return slots;
}

export class InstitutionService {
  constructor(private readonly repository: DemoRepository) {}
  snapshot(): DemoState {
    return this.repository.snapshot();
  }
  subscribe(listener: () => void): () => void {
    return this.repository.subscribe(listener);
  }
  validateQuery(input: InstitutionQueryInput): AwcpFieldError[] {
    const state = this.snapshot();
    const profile = state.institutionProfiles.find((item) => item.id === input.institutionId);
    if (profile && state.workflowProfile === 'coarse-roles' && state.employees.some((employee) => employee.id === input.actorId && employee.active && employee.roles.includes('workflow-approver'))) return [];
    const errors = activeRole(state, input.actorId, TEAM_ROLES);
    if (!profile) errors.push(fieldError(['institutionId'], '机构档案不存在。'));
    else if (![profile.salesId, profile.researchId, profile.organizerId].includes(input.actorId))
      errors.push(fieldError(['actorId'], '仅该机构服务团队可读取。'));
    return errors;
  }
  query(input: InstitutionQueryInput): JsonObject {
    ensure(this.validateQuery(input));
    const state = this.snapshot();
    const profile = state.institutionProfiles.find((item) => item.id === input.institutionId);
    if (!profile) throw businessError('action.institution-not-found', '机构档案不存在。');
    const client = state.clients.find((item) => item.id === profile.clientId);
    return {
      profile: { ...profile, scopes: [...profile.scopes] },
      client: client ? { ...client } : null,
      policy: { ...state.institutionPolicy },
      needs: state.institutionNeeds
        .filter((item) => item.institutionId === profile.id)
        .map((item) => ({ ...item, requestedMaterialIds: [...item.requestedMaterialIds] })),
      materials: state.institutionMaterials.map((item) => ({ ...item })),
      roadshows: state.roadshows
        .filter((item) =>
          state.institutionNeeds.some((need) => need.institutionId === profile.id && need.id === item.needId)
        )
        .map((item) => ({ ...item }))
    };
  }
  validateEntitlement(input: EntitlementInput): AwcpFieldError[] {
    const state = this.snapshot();
    const need = needFor(state, input.needId);
    if (!need) return [fieldError(['needId'], '机构服务需求不存在。')];
    return this.validateQuery({ actorId: input.actorId, institutionId: need.institutionId });
  }
  entitlement(input: EntitlementInput): JsonObject {
    ensure(this.validateEntitlement(input));
    const state = this.snapshot();
    const need = requireNeed(state, input.needId);
    const profile = profileForNeed(state, need);
    if (!profile) throw businessError('action.institution-not-found', '机构档案不存在。');
    const reasons = materialReasons(state, profile, need.requestedMaterialIds);
    return {
      needId: need.id,
      eligible: reasons.length === 0,
      policyVersion: state.institutionPolicy.version,
      requestedMaterialIds: [...need.requestedMaterialIds],
      reasons
    };
  }
  private validateWrite(
    state: DemoState,
    operation: Operation,
    input: WriteInput,
    check: (state: DemoState) => AwcpFieldError[]
  ): AwcpFieldError[] {
    const key = keyCheck(state, operation, input);
    return key.record || key.errors.length ? key.errors : check(state);
  }
  private write(
    operation: Operation,
    input: WriteInput,
    check: (state: DemoState) => AwcpFieldError[],
    change: (state: DemoState, now: string) => ServiceResult
  ): ServiceResult {
    return this.repository.transact((state) => {
      const key = keyCheck(state, operation, input);
      ensure(key.errors);
      if (key.record) return { ...key.record.result };
      ensure(check(state));
      const value = change(state, this.repository.clock.now());
      state.institutionOperationRecords.push({
        idempotencyKey: input.idempotencyKey,
        operation,
        fingerprint: fingerprint(input),
        result: { ...value }
      });
      return value;
    });
  }
  private reviseErrors(state: DemoState, input: NeedReviseInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
    const errors = [
      ...baseErrors(state, input, ['new', 'returned']),
      ...activeRole(state, input.actorId, ['institution-sales']),
      ...textErrors(input.reason, 'reason', 200)
    ];
    const need = needFor(state, input.needId);
    const profile = need ? profileForNeed(state, need) : undefined;
    if (profile && profile.salesId !== input.actorId)
      errors.push(fieldError(['actorId'], '仅该机构销售人员可补正需求。'));
    if (profile)
      materialReasons(state, profile, input.materialIds).forEach((reason) =>
        errors.push(fieldError(['materialIds'], reason))
      );
    return errors;
  }
  validateRevise(input: NeedReviseInput): AwcpFieldError[] {
    return this.validateWrite(this.snapshot(), 'need.revise', input, (state) => this.reviseErrors(state, input));
  }
  revise(input: NeedReviseInput): ServiceResult {
    return this.write(
      'need.revise',
      input,
      (state) => this.reviseErrors(state, input),
      (state, now) => {
        const need = requireNeed(state, input.needId);
        const from = need.status;
        need.requestedMaterialIds = [...input.materialIds];
        need.returnReason = null;
        need.status = 'new';
        need.businessVersion += 1;
        audit(state, need, `need.revise:${input.reason.trim()}`, input.actorId, from, now);
        return result(need);
      }
    );
  }
  private reserveErrors(state: DemoState, input: RoadshowReserveInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
    const errors = [...baseErrors(state, input, ['new']), ...activeRole(state, input.actorId, ['event-organizer'])];
    const need = needFor(state, input.needId);
    const profile = need ? profileForNeed(state, need) : undefined;
    if (!profile) return errors;
    if (profile.organizerId !== input.actorId) errors.push(fieldError(['actorId'], '仅该机构会议组织者可预约。'));
    materialReasons(state, profile, need?.requestedMaterialIds ?? []).forEach((reason) =>
      errors.push(fieldError(['needId'], reason))
    );
    const resource = state.meetingResources.find((item) => item.id === input.resourceId);
    if (!resource || resource.capacity < participants(profile).length)
      errors.push(fieldError(['resourceId'], '会议室不存在或容量不足。'));
    const start = instant(input.startAt);
    const end = instant(input.endAt);
    const now = Date.parse(this.repository.clock.now());
    if (start === null || start < now) errors.push(fieldError(['startAt'], '开始时刻须为有效的当前或未来时刻。'));
    if (
      end === null ||
      start === null ||
      end <= start ||
      end - start > state.institutionPolicy.maxMeetingMinutes * 60_000
    )
      errors.push(
        fieldError(['endAt'], `时长须大于 0 且不超过演示规则的 ${state.institutionPolicy.maxMeetingMinutes} 分钟。`)
      );
    if (resource && start !== null && end !== null && end > start) {
      const overlapping = conflicts(state, profile, resource.id, start, end);
      if (overlapping.length) {
        const slots = alternatives(state, profile, resource.id, start, end, now);
        errors.push(fieldError(['startAt'], `时段冲突：${overlapping.map((item) => item.id).join('、')}。`));
        if (!slots.length) errors.push(fieldError(['startAt'], '当前搜索范围无可用替代方案。'));
        for (const slot of slots)
          errors.push(fieldError(['startAt'], `可用替代方案：${slot.startAt} 至 ${slot.endAt}。`));
      }
    }
    return errors;
  }
  validateReserve(input: RoadshowReserveInput): AwcpFieldError[] {
    return this.validateWrite(this.snapshot(), 'roadshow.reserve', input, (state) => this.reserveErrors(state, input));
  }
  reserve(input: RoadshowReserveInput): ServiceResult {
    return this.write(
      'roadshow.reserve',
      input,
      (state) => this.reserveErrors(state, input),
      (state, now) => {
        const need = requireNeed(state, input.needId);
        const profile = profileForNeed(state, need);
        if (!profile) throw businessError('action.institution-not-found', '机构档案不存在。');
        const meetingId = nextId(
          'MTG',
          state.meetings.map((item) => item.id)
        );
        state.meetings.push({
          id: meetingId,
          title: `虚构机构路演：${need.title}`,
          organizerId: input.actorId,
          participantIds: participants(profile),
          resourceId: input.resourceId,
          startAt: input.startAt,
          endAt: input.endAt,
          businessVersion: 1,
          createdAt: now
        });
        const roadshowId = nextId(
          'RDS',
          state.roadshows.map((item) => item.id)
        );
        state.roadshows.push({
          id: roadshowId,
          needId: need.id,
          meetingId,
          packageId: null,
          invitationId: null,
          minutesId: null,
          followupId: null,
          createdAt: now
        });
        const from = need.status;
        need.roadshowId = roadshowId;
        need.status = 'reserved';
        need.businessVersion += 1;
        audit(state, need, 'roadshow.reserve', input.actorId, from, now);
        return result(need);
      }
    );
  }
  private packageErrors(state: DemoState, input: MaterialPackageInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
    const errors = [
      ...baseErrors(state, input, ['reserved']),
      ...activeRole(state, input.actorId, ['research-service'])
    ];
    const need = needFor(state, input.needId);
    const profile = need ? profileForNeed(state, need) : undefined;
    if (!profile || !need) return errors;
    if (profile.researchId !== input.actorId)
      errors.push(fieldError(['actorId'], '仅该机构研究服务人员可制作资料包。'));
    if (!roadshowFor(state, need)) errors.push(fieldError(['needId'], '关联路演不存在。'));
    if (
      !Array.isArray(input.materialIds) ||
      input.materialIds.length !== need.requestedMaterialIds.length ||
      new Set(input.materialIds).size !== input.materialIds.length ||
      !input.materialIds.every((id) => need.requestedMaterialIds.includes(id))
    )
      errors.push(fieldError(['materialIds'], '发送包必须与核准的需求资料 ID 完全一致。'));
    materialReasons(state, profile, input.materialIds).forEach((reason) =>
      errors.push(fieldError(['materialIds'], reason))
    );
    return errors;
  }
  validatePackage(input: MaterialPackageInput): AwcpFieldError[] {
    return this.validateWrite(this.snapshot(), 'package.create', input, (state) => this.packageErrors(state, input));
  }
  createPackage(input: MaterialPackageInput): ServiceResult {
    return this.write(
      'package.create',
      input,
      (state) => this.packageErrors(state, input),
      (state, now) => {
        const need = requireNeed(state, input.needId);
        const roadshow = roadshowFor(state, need);
        if (!roadshow) throw businessError('action.roadshow-not-found', '路演不存在。');
        const id = nextId(
          'SPKG',
          state.institutionMaterialPackages.map((item) => item.id)
        );
        const refs = input.materialIds.map((materialId) => {
          const material = state.institutionMaterials.find((item) => item.id === materialId);
          if (!material) throw businessError('action.material-not-found', '资料不存在。');
          return { documentId: material.documentId, version: material.documentVersion };
        });
        state.institutionMaterialPackages.push({
          id,
          roadshowId: roadshow.id,
          materialIds: [...input.materialIds],
          documentRefs: refs,
          policyVersion: state.institutionPolicy.version,
          createdBy: input.actorId,
          createdAt: now
        });
        roadshow.packageId = id;
        const from = need.status;
        need.status = 'packaged';
        need.businessVersion += 1;
        audit(state, need, 'material-package.create', input.actorId, from, now);
        return result(need);
      }
    );
  }
  private inviteErrors(state: DemoState, input: ServiceMutationInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
    const errors = [
      ...baseErrors(state, input, ['packaged']),
      ...activeRole(state, input.actorId, ['event-organizer'])
    ];
    const need = needFor(state, input.needId);
    const profile = need ? profileForNeed(state, need) : undefined;
    if (!profile || !need) return errors;
    if (profile.organizerId !== input.actorId) errors.push(fieldError(['actorId'], '仅该机构会议组织者可模拟邀请。'));
    const roadshow = roadshowFor(state, need);
    const packet = state.institutionMaterialPackages.find((item) => item.id === roadshow?.packageId);
    if (!roadshow || !packet) errors.push(fieldError(['needId'], '须先预约并制作资料包。'));
    else
      materialReasons(state, profile, packet.materialIds).forEach((reason) =>
        errors.push(fieldError(['needId'], reason))
      );
    return errors;
  }
  validateInvite(input: ServiceMutationInput): AwcpFieldError[] {
    return this.validateWrite(this.snapshot(), 'roadshow.invite', input, (state) => this.inviteErrors(state, input));
  }
  invite(input: ServiceMutationInput): ServiceResult {
    return this.write(
      'roadshow.invite',
      input,
      (state) => this.inviteErrors(state, input),
      (state, now) => {
        const need = requireNeed(state, input.needId);
        const roadshow = roadshowFor(state, need);
        if (!roadshow) throw businessError('action.roadshow-not-found', '路演不存在。');
        const id = nextId(
          'SINV',
          state.roadshowInvitations.map((item) => item.id)
        );
        state.roadshowInvitations.push({
          id,
          roadshowId: roadshow.id,
          meetingId: roadshow.meetingId,
          recipientLabel: '虚构机构联系人',
          status: 'simulated',
          createdBy: input.actorId,
          createdAt: now
        });
        roadshow.invitationId = id;
        const from = need.status;
        need.status = 'invited';
        need.businessVersion += 1;
        audit(state, need, 'roadshow.invite.simulated', input.actorId, from, now);
        return result(need);
      }
    );
  }
  private minutesErrors(state: DemoState, input: RoadshowMinutesInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
    const errors = [
      ...baseErrors(state, input, ['invited']),
      ...activeRole(state, input.actorId, ['event-organizer']),
      ...textErrors(input.agenda, 'agenda', 300)
    ];
    const need = needFor(state, input.needId);
    const profile = need ? profileForNeed(state, need) : undefined;
    if (profile && profile.organizerId !== input.actorId)
      errors.push(fieldError(['actorId'], '仅该机构会议组织者可登记纪要。'));
    if (!Array.isArray(input.decisions) || !input.decisions.length || input.decisions.length > 10)
      errors.push(fieldError(['decisions'], '须填写 1 到 10 条决定。'));
    else
      input.decisions.forEach((item, index) => {
        for (const error of textErrors(item, 'decisions', 200)) errors.push({ ...error, path: ['decisions', index] });
      });
    const roadshow = need ? roadshowFor(state, need) : undefined;
    const meeting = state.meetings.find((item) => item.id === roadshow?.meetingId);
    if (!meeting || !roadshow?.invitationId) errors.push(fieldError(['needId'], '须先有会议和模拟邀请。'));
    else if (Date.parse(meeting.endAt) > Date.parse(this.repository.clock.now()))
      errors.push(fieldError(['needId'], '会议尚未结束，请推进演示时钟。'));
    if (meeting && state.meetingMinutes.some((item) => item.meetingId === meeting.id))
      errors.push(fieldError(['needId'], '会议纪要已登记。'));
    return errors;
  }
  validateMinutes(input: RoadshowMinutesInput): AwcpFieldError[] {
    return this.validateWrite(this.snapshot(), 'roadshow.minutes', input, (state) => this.minutesErrors(state, input));
  }
  recordMinutes(input: RoadshowMinutesInput): ServiceResult {
    return this.write(
      'roadshow.minutes',
      input,
      (state) => this.minutesErrors(state, input),
      (state, now) => {
        const need = requireNeed(state, input.needId);
        const roadshow = roadshowFor(state, need);
        const meeting = state.meetings.find((item) => item.id === roadshow?.meetingId);
        if (!roadshow || !meeting) throw businessError('action.roadshow-not-found', '路演会议不存在。');
        const id = nextId(
          'MMIN',
          state.meetingMinutes.map((item) => item.id)
        );
        state.meetingMinutes.push({
          id,
          meetingId: meeting.id,
          authorId: input.actorId,
          attendeeIds: [...meeting.participantIds],
          agenda: input.agenda.trim(),
          decisions: input.decisions.map((item) => item.trim()),
          actionItemIds: [],
          templateLabel: '虚构会议纪要模板',
          meetingVersion: meeting.businessVersion,
          recordedAt: now
        });
        roadshow.minutesId = id;
        const from = need.status;
        need.status = 'minutes-recorded';
        need.businessVersion += 1;
        audit(state, need, 'roadshow.minutes.record', input.actorId, from, now);
        return result(need);
      }
    );
  }
  private followupErrors(state: DemoState, input: ServiceFollowupInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
    const errors = [
      ...baseErrors(state, input, ['minutes-recorded']),
      ...activeRole(state, input.actorId, ['institution-sales']),
      ...textErrors(input.note, 'note', 300)
    ];
    const need = needFor(state, input.needId);
    const profile = need ? profileForNeed(state, need) : undefined;
    if (profile && profile.salesId !== input.actorId)
      errors.push(fieldError(['actorId'], '仅该机构销售人员可登记回访。'));
    if (!['satisfied', 'needs-action'].includes(input.outcome)) errors.push(fieldError(['outcome'], '回访结果无效。'));
    const roadshow = need ? roadshowFor(state, need) : undefined;
    if (!roadshow?.minutesId || !state.meetingMinutes.some((item) => item.id === roadshow.minutesId))
      errors.push(fieldError(['needId'], '须先登记关联会议纪要。'));
    return errors;
  }
  validateFollowup(input: ServiceFollowupInput): AwcpFieldError[] {
    return this.validateWrite(this.snapshot(), 'service.followup', input, (state) => this.followupErrors(state, input));
  }
  followup(input: ServiceFollowupInput): ServiceResult {
    return this.write(
      'service.followup',
      input,
      (state) => this.followupErrors(state, input),
      (state, now) => {
        const need = requireNeed(state, input.needId);
        const roadshow = roadshowFor(state, need);
        if (!roadshow) throw businessError('action.roadshow-not-found', '路演不存在。');
        const id = nextId(
          'SFUP',
          state.institutionFollowups.map((item) => item.id)
        );
        state.institutionFollowups.push({
          id,
          needId: need.id,
          roadshowId: roadshow.id,
          actorId: input.actorId,
          note: input.note.trim(),
          outcome: input.outcome,
          recordedAt: now
        });
        roadshow.followupId = id;
        const from = need.status;
        need.status = 'completed';
        need.businessVersion += 1;
        audit(state, need, 'service.followup', input.actorId, from, now);
        return result(need);
      }
    );
  }
  summary(input: InstitutionQueryInput): JsonObject {
    ensure(this.validateQuery(input));
    const state = this.snapshot();
    const needs = state.institutionNeeds.filter((item) => item.institutionId === input.institutionId);
    return {
      institutionId: input.institutionId,
      policyVersion: state.institutionPolicy.version,
      totalNeeds: needs.length,
      completedNeeds: needs.filter((item) => item.status === 'completed').length,
      items: needs.map((need) => {
        const roadshow = roadshowFor(state, need);
        const meeting = state.meetings.find((item) => item.id === roadshow?.meetingId);
        return {
          needId: need.id,
          status: need.status,
          businessVersion: need.businessVersion,
          roadshowId: roadshow?.id ?? null,
          meetingId: meeting?.id ?? null,
          packageId: roadshow?.packageId ?? null,
          invitationId: roadshow?.invitationId ?? null,
          minutesId: roadshow?.minutesId ?? null,
          followupId: roadshow?.followupId ?? null,
          projectId: state.institutionProfiles.find((item) => item.id === need.institutionId)?.projectId ?? null
        };
      })
    };
  }
}
