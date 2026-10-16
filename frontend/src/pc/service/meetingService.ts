import { workflowErrors } from './workflowAccess';
import type { AwcpFieldError, JsonObject } from '@app/awcp';

import { businessError, fieldError } from '../../common/awcp/contracts';
import type { DemoState, Meeting, MeetingMinutes, MeetingNotification, Todo } from '../../common/fixtures/types';
import type { DemoRepository } from '../../common/store/repository';

export interface AvailabilityInput extends JsonObject {
  actorId: string;
  participantIds: string[];
  resourceId: string;
  startAt: string;
  endAt: string;
}
export interface ReserveInput extends AvailabilityInput {
  title: string;
  idempotencyKey: string;
}
export interface MeetingReadInput extends JsonObject {
  actorId: string;
  meetingId: string;
}
export interface RescheduleInput extends MeetingReadInput {
  resourceId: string;
  startAt: string;
  endAt: string;
  expectedVersion: number;
  idempotencyKey: string;
}
export interface MinutesActionInput extends JsonObject {
  title: string;
  assigneeId: string;
  dueAt: string;
}
export interface MinutesInput extends MeetingReadInput {
  expectedVersion: number;
  attendeeIds: string[];
  agenda: string;
  decisions: string[];
  actionItems: MinutesActionInput[];
  idempotencyKey: string;
}
export interface MeetingConflict extends JsonObject {
  meetingId: string;
  objectType: 'resource' | 'participant';
  objectId: string;
}
export interface AvailabilityResult extends JsonObject {
  available: boolean;
  conflicts: MeetingConflict[];
}
export interface MeetingResult extends JsonObject {
  meetingId: string;
  businessVersion: number;
  status: 'reserved' | 'minutes-recorded';
}

type Operation = 'reserve' | 'reschedule' | 'minutes.save';

export class MeetingService {
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
  resources(): Array<{ id: string; name: string; capacity: number }> {
    return this.repository.snapshot().meetingResources.map((item) => ({ ...item }));
  }
  list(actorId: string): Array<{ id: string; title: string; businessVersion: number }> {
    return this.repository
      .snapshot()
      .meetings.filter((item) => item.participantIds.includes(actorId))
      .map((item) => ({ id: item.id, title: item.title, businessVersion: item.businessVersion }));
  }

  validateAvailability(input: AvailabilityInput): AwcpFieldError[] {
    return availabilityErrors(this.repository.snapshot(), input, this.repository.clock.now());
  }
  availability(input: AvailabilityInput): AvailabilityResult {
    const state = this.repository.snapshot();
    assertValid(availabilityErrors(state, input, this.repository.clock.now()));
    const conflicts = findConflicts(state, input);
    return { available: conflicts.length === 0, conflicts };
  }

  validateReserve(input: ReserveInput): AwcpFieldError[] {
    return reserveErrors(this.repository.snapshot(), input, this.repository.clock.now());
  }
  validateReservePreflight(input: ReserveInput): AwcpFieldError[] {
    return reserveErrors(this.repository.snapshot(), input, this.repository.clock.now(), false);
  }
  reserve(input: ReserveInput): MeetingResult {
    return this.repository.transact((state) => {
      const previous = replay(state, 'reserve', input);
      if (previous) return previous;
      assertValid(reserveErrors(state, input, this.repository.clock.now(), false));
      assertNoConflicts(findConflicts(state, input));
      const meeting: Meeting = {
        id: nextId(
          'MTG',
          state.meetings.map((item) => item.id)
        ),
        title: input.title.trim(),
        organizerId: input.actorId,
        participantIds: [...input.participantIds],
        resourceId: input.resourceId,
        startAt: input.startAt,
        endAt: input.endAt,
        businessVersion: 1,
        createdAt: this.repository.clock.now()
      };
      state.meetings.push(meeting);
      audit(state, meeting, 'reserve', input.actorId, this.repository.clock.now());
      return remember(state, 'reserve', input, meeting, 'reserved');
    });
  }

  validateRead(input: MeetingReadInput): AwcpFieldError[] {
    return readErrors(this.repository.snapshot(), input);
  }
  read(input: MeetingReadInput): JsonObject {
    const state = this.repository.snapshot();
    assertValid(readErrors(state, input));
    const meeting = state.meetings.find((item) => item.id === input.meetingId);
    if (!meeting) throw businessError('action.meeting-not-found', '会议不存在。');
    const minutes = state.meetingMinutes.find((item) => item.meetingId === meeting.id);
    return {
      meetingId: meeting.id,
      title: meeting.title,
      organizerId: meeting.organizerId,
      participantIds: [...meeting.participantIds],
      resourceId: meeting.resourceId,
      startAt: meeting.startAt,
      endAt: meeting.endAt,
      businessVersion: meeting.businessVersion,
      notifications: state.meetingNotifications
        .filter((item) => item.meetingId === meeting.id)
        .map((item) => ({
          id: item.id,
          previousResourceId: item.previousResourceId,
          previousStartAt: item.previousStartAt,
          previousEndAt: item.previousEndAt,
          resourceId: item.resourceId,
          startAt: item.startAt,
          endAt: item.endAt,
          recipientIds: [...item.recipientIds],
          status: item.status
        })),
      minutes: minutes
        ? {
            id: minutes.id,
            attendeeIds: [...minutes.attendeeIds],
            agenda: minutes.agenda,
            decisions: [...minutes.decisions],
            templateLabel: minutes.templateLabel,
            meetingVersion: minutes.meetingVersion,
            actionItems: minutes.actionItemIds.map((id) => {
              const todo = state.todos.find((item) => item.id === id);
              if (!todo) throw businessError('action.meeting-task-not-found', `纪要行动项 ${id} 不存在。`);
              return {
                todoId: todo.id,
                title: todo.title,
                assigneeId: todo.assigneeId,
                dueAt: todo.dueAt,
                sourceType: todo.sourceType,
                sourceId: todo.sourceId,
                status: todo.status
              };
            })
          }
        : null
    };
  }

  validateReschedule(input: RescheduleInput): AwcpFieldError[] {
    return rescheduleErrors(this.repository.snapshot(), input, this.repository.clock.now());
  }
  validateReschedulePreflight(input: RescheduleInput): AwcpFieldError[] {
    return rescheduleErrors(this.repository.snapshot(), input, this.repository.clock.now(), false);
  }
  reschedule(input: RescheduleInput): MeetingResult {
    return this.repository.transact((state) => {
      const previous = replay(state, 'reschedule', input);
      if (previous) return previous;
      assertValid(rescheduleErrors(state, input, this.repository.clock.now(), false));
      const meeting = state.meetings.find((item) => item.id === input.meetingId);
      if (!meeting) throw businessError('action.meeting-not-found', '会议不存在。');
      assertNoConflicts(findConflicts(state, { ...input, participantIds: meeting.participantIds }, meeting.id));
      const notification: MeetingNotification = {
        id: nextId(
          'MNOTICE',
          state.meetingNotifications.map((item) => item.id)
        ),
        meetingId: meeting.id,
        recipientIds: [...meeting.participantIds],
        previousResourceId: meeting.resourceId,
        previousStartAt: meeting.startAt,
        previousEndAt: meeting.endAt,
        resourceId: input.resourceId,
        startAt: input.startAt,
        endAt: input.endAt,
        status: 'simulated',
        createdAt: this.repository.clock.now()
      };
      state.meetingNotifications.push(notification);
      meeting.resourceId = input.resourceId;
      meeting.startAt = input.startAt;
      meeting.endAt = input.endAt;
      meeting.businessVersion += 1;
      audit(state, meeting, 'reschedule', input.actorId, this.repository.clock.now(), notification.id);
      return remember(state, 'reschedule', input, meeting, 'reserved');
    });
  }

  validateMinutes(input: MinutesInput): AwcpFieldError[] {
    return minutesErrors(this.repository.snapshot(), input, this.repository.clock.now());
  }
  saveMinutes(input: MinutesInput): MeetingResult {
    return this.repository.transact((state) => {
      const previous = replay(state, 'minutes.save', input);
      if (previous) return previous;
      assertValid(minutesErrors(state, input, this.repository.clock.now()));
      const meeting = state.meetings.find((item) => item.id === input.meetingId);
      if (!meeting) throw businessError('action.meeting-not-found', '会议不存在。');
      const actionItemIds: string[] = [];
      for (const item of input.actionItems) {
        const todo: Todo = {
          id: nextId(
            'OTODO',
            state.todos.map((entry) => entry.id)
          ),
          title: item.title.trim(),
          assigneeId: item.assigneeId,
          sourceType: 'meeting',
          sourceId: meeting.id,
          dueAt: item.dueAt,
          status: 'open',
          completedAt: null
        };
        state.todos.push(todo);
        actionItemIds.push(todo.id);
      }
      meeting.businessVersion += 1;
      const minutes: MeetingMinutes = {
        id: nextId(
          'MINUTES',
          state.meetingMinutes.map((item) => item.id)
        ),
        meetingId: meeting.id,
        authorId: input.actorId,
        attendeeIds: [...input.attendeeIds],
        agenda: input.agenda.trim(),
        decisions: input.decisions.map((item) => item.trim()),
        actionItemIds,
        templateLabel: '虚构会议纪要模板',
        meetingVersion: meeting.businessVersion,
        recordedAt: this.repository.clock.now()
      };
      state.meetingMinutes.push(minutes);
      audit(state, meeting, 'minutes.save', input.actorId, this.repository.clock.now(), minutes.id);
      return remember(state, 'minutes.save', input, meeting, 'minutes-recorded');
    });
  }
}

function availabilityErrors(state: DemoState, input: AvailabilityInput, now: string): AwcpFieldError[] {
  const errors = actorErrors(state, input.actorId);
  const resource = state.meetingResources.find((item) => item.id === input.resourceId);
  if (!resource) errors.push(fieldError(['resourceId'], '会议资源不存在。'));
  if (!Array.isArray(input.participantIds) || input.participantIds.length < 1 || input.participantIds.length > 20)
    errors.push(fieldError(['participantIds'], '参会人须为 1～20 人。'));
  else {
    if (new Set(input.participantIds).size !== input.participantIds.length)
      errors.push(fieldError(['participantIds'], '参会人不能重复。'));
    if (input.participantIds.some((id) => !active(state, id)))
      errors.push(fieldError(['participantIds'], '参会人不存在或已停用。'));
    if (resource && input.participantIds.length > resource.capacity)
      errors.push(fieldError(['participantIds'], '参会人数超过会议室容量。'));
  }
  const start = parseTime(input.startAt);
  const end = parseTime(input.endAt);
  if (start === null || end === null || start < Date.parse(now) || end <= start || end - start > 8 * 60 * 60 * 1000)
    errors.push(fieldError(['startAt'], '时段须为未来或当前开始、结束晚于开始且不超过 8 小时。'));
  return errors;
}
function reserveErrors(state: DemoState, input: ReserveInput, now: string, includeConflicts = true): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const errors = replayErrors(state, 'reserve', input);
  if (errors.length || hasReplay(state, input.idempotencyKey)) return errors;
  errors.push(...availabilityErrors(state, input, now));
  if (!Array.isArray(input.participantIds) || !input.participantIds.includes(input.actorId))
    errors.push(fieldError(['participantIds'], '预约人须列入参会人。'));
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 120)
    errors.push(fieldError(['title'], '会议标题须为 1～120 字。'));
  if (includeConflicts && !errors.length) errors.push(...conflictErrors(findConflicts(state, input)));
  return errors;
}
function readErrors(state: DemoState, input: MeetingReadInput): AwcpFieldError[] {
  const errors = actorErrors(state, input.actorId);
  const meeting = state.meetings.find((item) => item.id === input.meetingId);
  if (!meeting) errors.push(fieldError(['meetingId'], '会议不存在。'));
  else if (!meeting.participantIds.includes(input.actorId))
    errors.push(fieldError(['actorId'], '只有参会人可读取会议。'));
  return errors;
}
function rescheduleErrors(
  state: DemoState,
  input: RescheduleInput,
  now: string,
  includeConflicts = true
): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const errors = replayErrors(state, 'reschedule', input);
  if (errors.length || hasReplay(state, input.idempotencyKey)) return errors;
  errors.push(...readErrors(state, input));
  const meeting = state.meetings.find((item) => item.id === input.meetingId);
  if (!meeting) return errors;
  if (meeting.organizerId !== input.actorId) errors.push(fieldError(['actorId'], '只有预约人可以改期。'));
  if (meeting.businessVersion !== input.expectedVersion)
    errors.push(fieldError(['expectedVersion'], '会议业务版本已变化。'));
  if (state.meetingMinutes.some((item) => item.meetingId === meeting.id))
    errors.push(fieldError(['meetingId'], '已有纪要的会议不能改期。'));
  if (meeting.resourceId === input.resourceId && meeting.startAt === input.startAt && meeting.endAt === input.endAt)
    errors.push(fieldError(['startAt'], '新时段与原预约相同。'));
  errors.push(...availabilityErrors(state, { ...input, participantIds: meeting.participantIds }, now));
  if (includeConflicts && !errors.length)
    errors.push(
      ...conflictErrors(
        findConflicts(
          state,
          {
            ...input,
            participantIds: meeting.participantIds
          },
          meeting.id
        )
      )
    );
  return errors;
}
function minutesErrors(state: DemoState, input: MinutesInput, now: string): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const errors = replayErrors(state, 'minutes.save', input);
  if (errors.length || hasReplay(state, input.idempotencyKey)) return errors;
  errors.push(...readErrors(state, input));
  const meeting = state.meetings.find((item) => item.id === input.meetingId);
  if (!meeting) return errors;
  if (meeting.organizerId !== input.actorId) errors.push(fieldError(['actorId'], '只有预约人可以登记纪要。'));
  if (meeting.businessVersion !== input.expectedVersion)
    errors.push(fieldError(['expectedVersion'], '会议业务版本已变化。'));
  if (Date.parse(meeting.endAt) > Date.parse(now)) errors.push(fieldError(['meetingId'], '会议结束后才能登记纪要。'));
  if (state.meetingMinutes.some((item) => item.meetingId === meeting.id))
    errors.push(fieldError(['meetingId'], '此会议已有纪要。'));
  if (
    !Array.isArray(input.attendeeIds) ||
    input.attendeeIds.length < 1 ||
    input.attendeeIds.length > meeting.participantIds.length
  )
    errors.push(fieldError(['attendeeIds'], '实际参会人须为非空且不超过邀请人数。'));
  else {
    if (
      new Set(input.attendeeIds).size !== input.attendeeIds.length ||
      input.attendeeIds.some((id) => !meeting.participantIds.includes(id))
    )
      errors.push(fieldError(['attendeeIds'], '实际参会人必须属于原会议且不能重复。'));
  }
  if (typeof input.agenda !== 'string' || !input.agenda.trim() || input.agenda.trim().length > 2000)
    errors.push(fieldError(['agenda'], '纪要议题须为 1～2000 字。'));
  if (
    !Array.isArray(input.decisions) ||
    input.decisions.length < 1 ||
    input.decisions.length > 10 ||
    input.decisions.some((item) => typeof item !== 'string' || !item.trim() || item.trim().length > 500)
  )
    errors.push(fieldError(['decisions'], '决议须包含 1～10 条非空内容。'));
  if (!Array.isArray(input.actionItems) || input.actionItems.length < 1 || input.actionItems.length > 10)
    errors.push(fieldError(['actionItems'], '行动项须为 1～10 条。'));
  else
    input.actionItems.forEach((item, index) => {
      if (typeof item.title !== 'string' || !item.title.trim() || item.title.trim().length > 120)
        errors.push(fieldError(['actionItems', index, 'title'], '行动项标题须为 1～120 字。'));
      if (!meeting.participantIds.includes(item.assigneeId) || !active(state, item.assigneeId))
        errors.push(fieldError(['actionItems', index, 'assigneeId'], '处理人须为有效参会人。'));
      const due = parseTime(item.dueAt);
      if (due === null || due < Math.max(Date.parse(meeting.endAt), Date.parse(now)))
        errors.push(fieldError(['actionItems', index, 'dueAt'], '行动项截止时间须晚于会议与当前时间。'));
    });
  return errors;
}
function findConflicts(
  state: DemoState,
  input: Pick<AvailabilityInput, 'participantIds' | 'resourceId' | 'startAt' | 'endAt'>,
  excludeId?: string
): MeetingConflict[] {
  const start = Date.parse(input.startAt);
  const end = Date.parse(input.endAt);
  const conflicts: MeetingConflict[] = [];
  for (const meeting of state.meetings) {
    if (meeting.id === excludeId || start >= Date.parse(meeting.endAt) || end <= Date.parse(meeting.startAt)) continue;
    if (meeting.resourceId === input.resourceId)
      conflicts.push({ meetingId: meeting.id, objectType: 'resource', objectId: meeting.resourceId });
    for (const id of input.participantIds) {
      if (meeting.participantIds.includes(id))
        conflicts.push({ meetingId: meeting.id, objectType: 'participant', objectId: id });
    }
  }
  return conflicts;
}
function conflictErrors(conflicts: MeetingConflict[]): AwcpFieldError[] {
  if (!conflicts.length) return [];
  const preview = conflicts
    .slice(0, 3)
    .map((item) => `${item.meetingId}/${item.objectType}:${item.objectId}`)
    .join('、');
  return [
    fieldError(['startAt'], `时段冲突对象：${preview}${conflicts.length > 3 ? `等 ${conflicts.length} 项` : ''}。`)
  ];
}
function assertNoConflicts(conflicts: MeetingConflict[]): void {
  if (!conflicts.length) return;
  const summary = conflictErrors(conflicts)[0].messages[0];
  throw businessError('action.meeting-conflict', summary, { conflicts });
}
function parseTime(value: string): number | null {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
    ? Date.parse(value)
    : null;
}
function actorErrors(state: DemoState, actorId: string): AwcpFieldError[] {
  return active(state, actorId) ? [] : [fieldError(['actorId'], '操作人不存在或已停用。')];
}
function active(state: DemoState, id: string): boolean {
  return state.employees.some((item) => item.id === id && item.active);
}
function replayErrors(state: DemoState, operation: Operation, input: { idempotencyKey: string }): AwcpFieldError[] {
  const errors: AwcpFieldError[] = [];
  if (typeof input.idempotencyKey !== 'string' || !/^[\w.:-]{1,128}$/.test(input.idempotencyKey))
    errors.push(fieldError(['idempotencyKey'], '业务幂等键格式不正确。'));
  const record = state.idempotencyRecords.find((item) => item.key === input.idempotencyKey);
  if (record && (record.operation !== `meeting.${operation}` || record.fingerprint !== fingerprint(input)))
    errors.push(fieldError(['idempotencyKey'], '业务幂等键已用于其他操作或参数。'));
  return errors;
}
function hasReplay(state: DemoState, key: string): boolean {
  return state.idempotencyRecords.some((item) => item.key === key);
}
function fingerprint(input: object): string {
  const { idempotencyKey: _key, ...fields } = input as Record<string, unknown>;
  return JSON.stringify(fields);
}
function replay(state: DemoState, operation: Operation, input: { idempotencyKey: string }): MeetingResult | null {
  const record = state.idempotencyRecords.find((item) => item.key === input.idempotencyKey);
  if (!record) return null;
  if (record.operation !== `meeting.${operation}` || record.fingerprint !== fingerprint(input))
    throw businessError('action.idempotency-conflict', '业务幂等键已用于其他操作或参数。');
  if (
    record.resultVersion === null ||
    (record.resultStatus !== 'reserved' && record.resultStatus !== 'minutes-recorded')
  )
    throw new Error('Invalid meeting replay record.');
  return { meetingId: record.resultId, businessVersion: record.resultVersion, status: record.resultStatus };
}
function remember(
  state: DemoState,
  operation: Operation,
  input: { idempotencyKey: string },
  meeting: Meeting,
  status: MeetingResult['status']
): MeetingResult {
  state.idempotencyRecords.push({
    key: input.idempotencyKey,
    operation: `meeting.${operation}`,
    fingerprint: fingerprint(input),
    resultId: meeting.id,
    resultVersion: meeting.businessVersion,
    resultStatus: status
  });
  return { meetingId: meeting.id, businessVersion: meeting.businessVersion, status };
}
function audit(state: DemoState, meeting: Meeting, action: string, actorId: string, at: string, note?: string): void {
  state.auditEntries.push({
    id: nextId(
      'AUD',
      state.auditEntries.map((item) => item.id)
    ),
    entityType: 'meeting',
    entityId: meeting.id,
    action,
    actorId,
    at,
    fromStatus: null,
    toStatus: action,
    businessVersion: meeting.businessVersion,
    ...(note ? { note } : {})
  });
}
function nextId(prefix: string, ids: readonly string[]): string {
  const max = ids.reduce((current, id) => {
    const match = new RegExp(`^${prefix}-([0-9]+)$`).exec(id);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}
function assertValid(errors: AwcpFieldError[]): void {
  if (errors.length) throw businessError('action.invalid-meeting', errors.flatMap((item) => item.messages).join('；'));
}
