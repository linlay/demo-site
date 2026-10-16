import { workflowErrors } from './workflowAccess';
import type { AwcpFieldError, JsonObject } from '@app/awcp';

import { businessError, fieldError } from '../../common/awcp/contracts';
import type { ContactGroup, DemoState, OfficeTeam } from '../../common/fixtures/types';
import type { DemoRepository } from '../../common/store/repository';

export interface DirectoryQueryInput extends JsonObject {
  actorId: string;
  departmentId: string;
  name: string;
}
export interface DirectoryQueryResult extends JsonObject {
  employees: JsonObject[];
}
export interface TeamReadInput extends JsonObject {
  teamId: string;
  actorId: string;
}
export interface GroupReadInput extends JsonObject {
  groupId: string;
  actorId: string;
}
export interface TeamReplaceInput extends TeamReadInput {
  expectedVersion: number;
  memberIds: string[];
  idempotencyKey: string;
}
export interface GroupSaveInput extends GroupReadInput {
  expectedVersion: number;
  memberIds: string[];
  idempotencyKey: string;
}
export interface MembershipView extends JsonObject {
  id: string;
  name: string;
  ownerId: string;
  projectId: string | null;
  memberIds: string[];
  businessVersion: number;
}
export interface MembershipResult extends JsonObject {
  id: string;
  businessVersion: number;
}

type Scope = 'team' | 'group';
type Mutation = TeamReplaceInput | GroupSaveInput;

export class DirectoryService {
  constructor(private readonly repository: DemoRepository) {}
  subscribe(listener: () => void): () => void {
    return this.repository.subscribe(listener);
  }

  actors(): Array<{ id: string; name: string }> {
    return this.repository
      .snapshot()
      .employees.filter((item) => item.active)
      .map((item) => ({ id: item.id, name: item.name }));
  }
  departments(): Array<{ id: string; name: string }> {
    return this.repository.snapshot().departments.map((item) => ({ id: item.id, name: item.name }));
  }

  validateQuery(input: DirectoryQueryInput): AwcpFieldError[] {
    return queryErrors(this.repository.snapshot(), input);
  }
  query(input: DirectoryQueryInput): DirectoryQueryResult {
    const state = this.repository.snapshot();
    assertValid(queryErrors(state, input));
    const name = input.name.trim().toLocaleLowerCase();
    return {
      employees: state.employees
        .filter(
          (item) =>
            item.active &&
            (!input.departmentId || item.departmentId === input.departmentId) &&
            (!name || item.name.toLocaleLowerCase().includes(name))
        )
        .map((item) => ({
          id: item.id,
          name: item.name,
          departmentId: item.departmentId,
          departmentName: state.departments.find((department) => department.id === item.departmentId)?.name ?? ''
        }))
    };
  }

  validateReadTeam(input: TeamReadInput): AwcpFieldError[] {
    return readErrors(this.repository.snapshot(), 'team', input.teamId, input.actorId);
  }
  readTeam(input: TeamReadInput): MembershipView {
    const state = this.repository.snapshot();
    assertValid(readErrors(state, 'team', input.teamId, input.actorId));
    const team = state.officeTeams.find((item) => item.id === input.teamId);
    if (!team) throw businessError('action.team-not-found', '协作组不存在。');
    return view(team);
  }
  validateReadGroup(input: GroupReadInput): AwcpFieldError[] {
    return readErrors(this.repository.snapshot(), 'group', input.groupId, input.actorId);
  }
  readGroup(input: GroupReadInput): MembershipView {
    const state = this.repository.snapshot();
    assertValid(readErrors(state, 'group', input.groupId, input.actorId));
    const group = state.contactGroups.find((item) => item.id === input.groupId);
    if (!group) throw businessError('action.group-not-found', '通讯分组不存在。');
    return view(group);
  }

  validateReplaceTeam(input: TeamReplaceInput): AwcpFieldError[] {
    return mutationErrors(this.repository.snapshot(), 'team', input);
  }
  replaceTeam(input: TeamReplaceInput): MembershipResult {
    return this.mutate('team', input);
  }
  validateSaveGroup(input: GroupSaveInput): AwcpFieldError[] {
    return mutationErrors(this.repository.snapshot(), 'group', input);
  }
  saveGroup(input: GroupSaveInput): MembershipResult {
    return this.mutate('group', input);
  }

  private mutate(scope: Scope, input: Mutation): MembershipResult {
    return this.repository.transact((state) => {
      const record = state.idempotencyRecords.find((item) => item.key === input.idempotencyKey);
      const id = objectId(scope, input);
      const fingerprint = JSON.stringify([id, input.actorId, input.expectedVersion, input.memberIds]);
      if (record) {
        if (
          record.operation !== operation(scope) ||
          record.fingerprint !== fingerprint ||
          record.resultVersion === null
        )
          throw businessError('action.idempotency-conflict', '业务幂等键已用于其他操作或参数。');
        return { id: record.resultId, businessVersion: record.resultVersion };
      }
      assertValid(mutationErrors(state, scope, input));
      const membership = collection(state, scope).find((item) => item.id === id);
      if (!membership) throw businessError('action.membership-not-found', '成员集合不存在。');
      membership.memberIds = [...input.memberIds];
      membership.businessVersion += 1;
      state.auditEntries.push({
        id: nextAuditId(state),
        entityType: scope === 'team' ? 'office-team' : 'contact-group',
        entityId: id,
        action: scope === 'team' ? 'replace-members' : 'save-members',
        actorId: input.actorId,
        at: this.repository.clock.now(),
        fromStatus: 'active',
        toStatus: 'active',
        businessVersion: membership.businessVersion,
        note: membership.memberIds.join('、')
      });
      state.idempotencyRecords.push({
        key: input.idempotencyKey,
        operation: operation(scope),
        fingerprint,
        resultId: id,
        resultVersion: membership.businessVersion,
        resultStatus: 'saved'
      });
      return { id, businessVersion: membership.businessVersion };
    });
  }
}

function queryErrors(state: DemoState, input: DirectoryQueryInput): AwcpFieldError[] {
  const errors = actorErrors(state, input.actorId);
  if (typeof input.departmentId !== 'string') errors.push(fieldError(['departmentId'], '部门筛选须为字符串。'));
  if (typeof input.name !== 'string' || input.name.length > 80)
    errors.push(fieldError(['name'], '姓名筛选不能超过 80 字。'));
  return errors;
}

function readErrors(state: DemoState, scope: Scope, id: string, actorId: string): AwcpFieldError[] {
  const errors = actorErrors(state, actorId);
  const membership = collection(state, scope).find((item) => item.id === id);
  if (!membership) errors.push(fieldError([scope === 'team' ? 'teamId' : 'groupId'], '成员集合不存在。'));
  else if (membership.ownerId !== actorId && !membership.memberIds.includes(actorId))
    errors.push(fieldError(['actorId'], '当前人员不可读取此成员集合。'));
  return errors;
}

function mutationErrors(state: DemoState, scope: Scope, input: Mutation): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const id = objectId(scope, input);
  const record = state.idempotencyRecords.find((item) => item.key === input.idempotencyKey);
  const fingerprint = JSON.stringify([id, input.actorId, input.expectedVersion, input.memberIds]);
  if (record)
    return record.operation === operation(scope) && record.fingerprint === fingerprint
      ? []
      : [fieldError(['idempotencyKey'], '业务幂等键已用于其他操作或参数。')];
  const errors = actorErrors(state, input.actorId);
  if (typeof input.idempotencyKey !== 'string' || !/^[\w.:-]{1,128}$/.test(input.idempotencyKey))
    errors.push(fieldError(['idempotencyKey'], '业务幂等键格式不正确。'));
  const membership = collection(state, scope).find((item) => item.id === id);
  if (!membership) errors.push(fieldError([scope === 'team' ? 'teamId' : 'groupId'], '成员集合不存在。'));
  if (membership && membership.ownerId !== input.actorId)
    errors.push(fieldError(['actorId'], '只有创建人可维护成员。'));
  if (membership && membership.businessVersion !== input.expectedVersion)
    errors.push(fieldError(['expectedVersion'], '成员版本已变化。'));
  if (!Array.isArray(input.memberIds) || input.memberIds.length > 20)
    return [...errors, fieldError(['memberIds'], '成员列表须为至多 20 人的数组。')];
  if (new Set(input.memberIds).size !== input.memberIds.length)
    errors.push(fieldError(['memberIds'], '成员 ID 不能重复。'));
  for (const memberId of input.memberIds) {
    if (typeof memberId !== 'string' || !state.employees.some((item) => item.id === memberId && item.active)) {
      errors.push(fieldError(['memberIds'], `成员 ${String(memberId)} 不存在或已离职。`));
      break;
    }
  }
  return errors;
}

function actorErrors(state: DemoState, actorId: string): AwcpFieldError[] {
  return state.employees.some((item) => item.id === actorId && item.active)
    ? []
    : [fieldError(['actorId'], '操作人不存在或已离职。')];
}
function collection(state: DemoState, scope: Scope): Array<OfficeTeam | ContactGroup> {
  return scope === 'team' ? state.officeTeams : state.contactGroups;
}
function objectId(scope: Scope, input: Mutation): string {
  return scope === 'team' ? (input as TeamReplaceInput).teamId : (input as GroupSaveInput).groupId;
}
function operation(scope: Scope): string {
  return scope === 'team' ? 'office.team.replace' : 'office.group.save';
}
function view(item: OfficeTeam | ContactGroup): MembershipView {
  return {
    id: item.id,
    name: item.name,
    ownerId: item.ownerId,
    projectId: 'projectId' in item ? item.projectId : null,
    memberIds: [...item.memberIds],
    businessVersion: item.businessVersion
  };
}
function nextAuditId(state: DemoState): string {
  const max = state.auditEntries.reduce(
    (value, item) => Math.max(value, Number(/^AUD-(\d+)$/.exec(item.id)?.[1] ?? 0)),
    0
  );
  return `AUD-${String(max + 1).padStart(3, '0')}`;
}
function assertValid(errors: AwcpFieldError[]): void {
  if (errors.length)
    throw businessError('action.invalid-directory', errors.flatMap((item) => item.messages).join('；'));
}
