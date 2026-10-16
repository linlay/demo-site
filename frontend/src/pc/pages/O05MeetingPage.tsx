import { useCurrentActor } from '../../app/currentUserContext';
import { useWorkflowAction as useAwcpAction } from '../../app/useWorkflowAction';
import type { AwcpActionRegistration } from '@app/awcp';
import { useEffect, useState, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import {
  MEETING_AVAILABILITY_SCHEMA,
  MEETING_MINUTES_SCHEMA,
  MEETING_READ_SCHEMA,
  MEETING_RESCHEDULE_SCHEMA
} from '../../common/awcp/meetingSchemas';
import type { DemoRepository } from '../../common/store/repository';
import {
  MeetingService,
  type AvailabilityInput,
  type MeetingReadInput,
  type MinutesInput,
  type RescheduleInput
} from '../service/meetingService';
import styles from './O05MeetingPage.module.css';

const AVAILABILITY: AvailabilityInput = {
  actorId: 'EMP-001',
  participantIds: ['EMP-001', 'EMP-002'],
  resourceId: 'ROOM-001',
  startAt: '2026-09-19T05:00:00.000Z',
  endAt: '2026-09-19T06:00:00.000Z'
};
const READ: MeetingReadInput = { actorId: 'EMP-001', meetingId: 'MTG-001' };
const RESCHEDULE: RescheduleInput = {
  ...READ,
  resourceId: 'ROOM-001',
  startAt: '2026-09-19T04:00:00.000Z',
  endAt: '2026-09-19T05:00:00.000Z',
  expectedVersion: 1,
  idempotencyKey: 'o05-reschedule-example'
};
const MINUTES: MinutesInput = {
  actorId: 'EMP-003',
  meetingId: 'MTG-003',
  expectedVersion: 1,
  attendeeIds: ['EMP-003', 'EMP-004'],
  agenda: '虚构晨会资料检查',
  decisions: ['按演示流程确认资料。'],
  actionItems: [{ title: '整理虚构晨会资料', assigneeId: 'EMP-004', dueAt: '2026-09-19T08:00:00.000Z' }],
  idempotencyKey: 'o05-minutes-example'
};

function guide(purpose: string, prerequisites: string, effects: string): string {
  return describeAction({
    purpose,
    prerequisites,
    parameters: '使用虚构人员、会议室、ISO 时段；写操作需稳定幂等键，改期和纪要需业务版本。',
    effects,
    result: '返回冲突对象、会议版本、模拟通知、纪要或行动项记录。',
    failures: '人员、容量、时段、角色、版本或状态不符时返回字段错误且不写入。'
  });
}
function key(): string {
  return `o05-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function O05MeetingPage({
  repository,
  objectId
}: {
  repository: DemoRepository;
  objectId?: string;
}): ReactElement {
  const [service] = useState(() => new MeetingService(repository));
  const actorId = useCurrentActor(() => repository.snapshot().meetings.find((item) => item.id === objectId)?.organizerId ?? 'EMP-001');
  const [selectedMeeting, setSelectedMeeting] = useState(objectId?.startsWith('MTG-') ? objectId : 'MTG-001');
  const [moveResourceId, setMoveResourceId] = useState('');
  const [moveStartAt, setMoveStartAt] = useState('');
  const [moveEndAt, setMoveEndAt] = useState('');
  const minutesActorId = useCurrentActor('EMP-003');
  const [selectedMinutesMeeting, setSelectedMinutesMeeting] = useState('MTG-003');
  const [attendeeIds, setAttendeeIds] = useState<string[]>([]);
  const [agenda, setAgenda] = useState('');
  const [decisions, setDecisions] = useState('');
  const [actionTitle, setActionTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [message, setMessage] = useState('');
  const [, setRevision] = useState(0);

  useEffect(() => service.subscribe(() => setRevision((value) => value + 1)), [service]);
  const meetings = service.list(actorId);
  const meetingId = meetings.some((item) => item.id === selectedMeeting) ? selectedMeeting : (meetings[0]?.id ?? '');
  const meeting = meetingId ? service.read({ actorId, meetingId }) : null;
  const minutesMeetings = service.list(minutesActorId);
  const minutesMeetingId = minutesMeetings.some((item) => item.id === selectedMinutesMeeting)
    ? selectedMinutesMeeting
    : (minutesMeetings[0]?.id ?? '');
  const minutesMeeting = minutesMeetingId
    ? service.read({ actorId: minutesActorId, meetingId: minutesMeetingId })
    : null;

  function run(action: () => string): void {
    try {
      setMessage(action());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败。');
    }
  }
  function toggle(id: string, values: string[], setValues: (value: string[]) => void): void {
    setValues(values.includes(id) ? values.filter((item) => item !== id) : [...values, id]);
  }

  const availabilityAction: AwcpActionRegistration<AvailabilityInput> = {
    action: 'office.meeting.availability',
    title: '查询会议时段空闲',
    description: guide(
      '同时核对多名参会人和会议室的同一时段。',
      '有效人员、会议室与未来时段。',
      '只读返回具体会议与冲突对象。'
    ),
    inputSchema: MEETING_AVAILABILITY_SCHEMA,
    examples: [AVAILABILITY],
    validate: (args) => service.validateAvailability(args),
    invoke: (args) => completed(service.availability(args))
  };
  useAwcpAction(availabilityAction);
  const readAction: AwcpActionRegistration<MeetingReadInput> = {
    action: 'office.meeting.read',
    title: '读取会议进度',
    description: guide('读取会议时段、改期通知、纪要与行动项。', '当前人员属于会议参会人。', '只读。'),
    inputSchema: MEETING_READ_SCHEMA,
    examples: [READ],
    validate: (args) => service.validateRead(args),
    invoke: (args) => completed(service.read(args))
  };
  useAwcpAction(readAction);
  const rescheduleAction: AwcpActionRegistration<RescheduleInput> = {
    action: 'office.meeting.reschedule',
    title: '会议改期',
    description: guide(
      '将现有会议移至无冲突时段。',
      '预约人、当前版本、无纪要且新时段空闲。',
      '更新版本并记录旧新时段与模拟通知。'
    ),
    inputSchema: MEETING_RESCHEDULE_SCHEMA,
    examples: [RESCHEDULE],
    validate: (args) => service.validateReschedulePreflight(args),
    invoke: (args) => completed(service.reschedule(args))
  };
  useAwcpAction(rescheduleAction);
  const minutesAction: AwcpActionRegistration<MinutesInput> = {
    action: 'office.meeting.minutes.save',
    title: '登记会议纪要与行动项',
    description: guide(
      '按虚构模板登记已结束会议的结构化纪要。',
      '预约人提供实际参会人、议题、决议及有效行动项。',
      '生成唯一纪要和来源为会议的待办。'
    ),
    inputSchema: MEETING_MINUTES_SCHEMA,
    examples: [MINUTES],
    validate: (args) => service.validateMinutes(args),
    invoke: (args) => completed(service.saveMinutes(args))
  };
  useAwcpAction(minutesAction);

  return (
    <section className={styles.page} aria-label="会议事项办理">
      <div className={styles.panel}>
        <h2>会议改期</h2>
        <div className={styles.grid}>
          <label htmlFor="o05-meeting">会议</label>
          <select id="o05-meeting" value={meetingId} onChange={(event) => setSelectedMeeting(event.target.value)}>
            {meetings.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} · {item.title}
              </option>
            ))}
          </select>
          <label htmlFor="o05-move-resource">新会议室</label>
          <select
            id="o05-move-resource"
            value={moveResourceId}
            onChange={(event) => setMoveResourceId(event.target.value)}
          >
            {service.resources().map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}（{item.id}）
              </option>
            ))}
          </select>
          <label htmlFor="o05-move-start">新开始时间 ISO</label>
          <input id="o05-move-start" value={moveStartAt} onChange={(event) => setMoveStartAt(event.target.value)} />
          <label htmlFor="o05-move-end">新结束时间 ISO</label>
          <input id="o05-move-end" value={moveEndAt} onChange={(event) => setMoveEndAt(event.target.value)} />
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            disabled={!meeting}
            onClick={() =>
              run(() => {
                const result = service.reschedule({
                  actorId,
                  meetingId,
                  resourceId: moveResourceId,
                  startAt: moveStartAt,
                  endAt: moveEndAt,
                  expectedVersion: Number(meeting?.businessVersion),
                  idempotencyKey: key()
                });
                return `${result.meetingId} 已改期，版本 ${result.businessVersion}。`;
              })
            }
          >
            会议改期
          </button>
        </div>
        {meeting && (
          <div className={styles.record} aria-label="会议记录">
            <strong>{String(meeting.title)}</strong>
            <p>
              {String(meeting.meetingId)} · {String(meeting.resourceId)} · {String(meeting.startAt)} 至{' '}
              {String(meeting.endAt)} · 版本 {String(meeting.businessVersion)}
            </p>
            <p>
              参会人：{(meeting.participantIds as string[]).join('、')}；改期模拟通知{' '}
              {(meeting.notifications as object[]).length} 条。
            </p>
            <ul>
              {(meeting.notifications as Array<Record<string, unknown>>).map((item) => (
                <li key={String(item.id)}>
                  {String(item.id)} · {String(item.previousStartAt)} → {String(item.startAt)} · {String(item.status)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className={styles.panel}>
        <h2>会议纪要</h2>
        <p>模板标识：虚构会议纪要模板。MTG-003 已结束，可用于立即登记。</p>
        <div className={styles.grid}>


          <label htmlFor="o05-minutes-meeting">会议</label>
          <select
            id="o05-minutes-meeting"
            value={minutesMeetingId}
            onChange={(event) => setSelectedMinutesMeeting(event.target.value)}
          >
            {minutesMeetings.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} · {item.title}
              </option>
            ))}
          </select>
          <label htmlFor="o05-agenda">议题</label>
          <textarea id="o05-agenda" rows={2} value={agenda} onChange={(event) => setAgenda(event.target.value)} />
          <label htmlFor="o05-decisions">决议（每行一条）</label>
          <textarea
            id="o05-decisions"
            rows={2}
            value={decisions}
            onChange={(event) => setDecisions(event.target.value)}
          />
          <label htmlFor="o05-action-title">行动项标题</label>
          <input id="o05-action-title" value={actionTitle} onChange={(event) => setActionTitle(event.target.value)} />
          <label htmlFor="o05-assignee">行动项处理人</label>
          <select id="o05-assignee" value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
            {service.actors().map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}（{item.id}）
              </option>
            ))}
          </select>
          <label htmlFor="o05-due">截止时间 ISO</label>
          <input id="o05-due" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
        </div>
        <fieldset className={styles.people}>
          <legend>实际参会人</legend>
          {((minutesMeeting?.participantIds as string[] | undefined) ?? []).map((id) => {
            const actor = service.actors().find((item) => item.id === id);
            return (
              <label key={id}>
                <input
                  type="checkbox"
                  checked={attendeeIds.includes(id)}
                  onChange={() => toggle(id, attendeeIds, setAttendeeIds)}
                />
                {actor?.name ?? id}（{id}）
              </label>
            );
          })}
        </fieldset>
        <div className={styles.actions}>
          <button
            type="button"
            disabled={!minutesMeeting || !!minutesMeeting.minutes}
            onClick={() =>
              run(() => {
                const result = service.saveMinutes({
                  actorId: minutesActorId,
                  meetingId: minutesMeetingId,
                  expectedVersion: Number(minutesMeeting?.businessVersion),
                  attendeeIds,
                  agenda,
                  decisions: decisions
                    .split('\n')
                    .map((item) => item.trim())
                    .filter(Boolean),
                  actionItems: [{ title: actionTitle, assigneeId, dueAt }],
                  idempotencyKey: key()
                });
                return `${result.meetingId} 已登记纪要与行动项。`;
              })
            }
          >
            登记纪要与行动项
          </button>
        </div>
        {minutesMeeting?.minutes && (
          <div className={styles.record} aria-label="纪要记录">
            <strong>{String((minutesMeeting.minutes as Record<string, unknown>).templateLabel)}</strong>
            <p>议题：{String((minutesMeeting.minutes as Record<string, unknown>).agenda)}</p>
            <ul>
              {((minutesMeeting.minutes as Record<string, unknown>).actionItems as Array<Record<string, unknown>>).map(
                (item) => (
                  <li key={String(item.todoId)}>
                    {String(item.todoId)} · {String(item.title)} · 来源 {String(item.sourceType)}:
                    {String(item.sourceId)}
                  </li>
                )
              )}
            </ul>
          </div>
        )}
      </div>
      <p role="status">{message}</p>
    </section>
  );
}
