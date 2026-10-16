import { useCurrentActor } from '../../app/currentUserContext';
import { useWorkflowAction as useAwcpAction } from '../../app/useWorkflowAction';
import type { AwcpActionRegistration } from '@app/awcp';
import { useEffect, useState, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import {
  ENTITLEMENT_SCHEMA,
  INSTITUTION_QUERY_SCHEMA,
  MATERIAL_PACKAGE_SCHEMA,
  NEED_REVISE_SCHEMA,
  ROADSHOW_INVITE_SCHEMA,
  ROADSHOW_MINUTES_SCHEMA,
  ROADSHOW_RESERVE_SCHEMA,
  SERVICE_FOLLOWUP_SCHEMA
} from '../../common/awcp/institutionSchemas';
import type { DemoRepository } from '../../common/store/repository';
import {
  InstitutionService,
  type EntitlementInput,
  type InstitutionQueryInput,
  type MaterialPackageInput,
  type NeedReviseInput,
  type RoadshowMinutesInput,
  type RoadshowReserveInput,
  type ServiceFollowupInput,
  type ServiceMutationInput
} from '../service/institutionService';
import styles from './S05InstitutionPage.module.css';

const QUERY: InstitutionQueryInput = { actorId: 'EMP-001', institutionId: 'INST-001' };
const ENTITLEMENT: EntitlementInput = { actorId: 'EMP-001', needId: 'SNEED-001' };
const REVISE: NeedReviseInput = {
  actorId: 'EMP-001',
  needId: 'SNEED-003',
  materialIds: ['SMAT-001'],
  reason: '改用服务范围内已批准资料。',
  expectedVersion: 2,
  idempotencyKey: 's05-revise-example'
};
const RESERVE: RoadshowReserveInput = {
  actorId: 'EMP-002',
  needId: 'SNEED-001',
  resourceId: 'ROOM-001',
  startAt: '2026-09-20T04:00:00.000Z',
  endAt: '2026-09-20T05:00:00.000Z',
  expectedVersion: 1,
  idempotencyKey: 's05-reserve-example'
};
const PACKAGE: MaterialPackageInput = {
  actorId: 'EMP-003',
  needId: 'SNEED-001',
  materialIds: ['SMAT-001'],
  expectedVersion: 2,
  idempotencyKey: 's05-package-example'
};
const INVITE: ServiceMutationInput = {
  actorId: 'EMP-002',
  needId: 'SNEED-001',
  expectedVersion: 3,
  idempotencyKey: 's05-invite-example'
};
const MINUTES: RoadshowMinutesInput = {
  actorId: 'EMP-002',
  needId: 'SNEED-001',
  agenda: '虚构研究路演交流。',
  decisions: ['记录机构后续研究服务需求。'],
  expectedVersion: 4,
  idempotencyKey: 's05-minutes-example'
};
const FOLLOWUP: ServiceFollowupInput = {
  actorId: 'EMP-001',
  needId: 'SNEED-001',
  note: '虚构机构确认已收到演示资料。',
  outcome: 'satisfied',
  expectedVersion: 5,
  idempotencyKey: 's05-followup-example'
};
function guide(purpose: string, prerequisites: string, effects: string): string {
  return describeAction({
    purpose,
    prerequisites,
    parameters: '使用虚构机构、需求、资料、会议室和人员 ID；写操作带当前业务版本和稳定业务幂等键。',
    effects,
    result: '返回需求 ID、状态、版本和关联路演 ID；只读动作返回机构档案、服务范围、会议及业务汇总。',
    failures: '角色、范围、文档批准版本、时间、会议冲突或业务版本不符时返回字段错误且不写入。'
  });
}
function key(): string {
  return `s05-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function localInstant(value: string): string {
  return `${value}:00+08:00`;
}

export default function S05InstitutionPage({
  repository,
  objectId
}: {
  repository: DemoRepository;
  objectId?: string;
}): ReactElement {
  const [service] = useState(() => new InstitutionService(repository));
  const [, setRevision] = useState(0);
  useEffect(() => service.subscribe(() => setRevision((value) => value + 1)), [service]);
  const actorId = useCurrentActor('EMP-001');
  const needId = objectId ?? 'SNEED-001';
  const [materialIds, setMaterialIds] = useState('');
  const [revisionReason, setRevisionReason] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [agenda, setAgenda] = useState('');
  const [decisions, setDecisions] = useState('');
  const [followupNote, setFollowupNote] = useState('');
  const [outcome, setOutcome] = useState<'' | ServiceFollowupInput['outcome']>('');
  const [message, setMessage] = useState('');
  const state = service.snapshot();
  const need = state.institutionNeeds.find((item) => item.id === needId);
  const roadshow = state.roadshows.find((item) => item.id === need?.roadshowId);
  const meeting = state.meetings.find((item) => item.id === roadshow?.meetingId);
  const profile = state.institutionProfiles.find((item) => item.id === need?.institutionId);
  const entitlement = need ? service.entitlement({ actorId, needId: need.id }) : null;
  const savedMaterialIds = need?.requestedMaterialIds.join(',') ?? '';
  useEffect(() => setMaterialIds(savedMaterialIds), [needId, need?.businessVersion, savedMaterialIds]);
  function run(task: () => { needId: string; status: string; businessVersion: number }): void {
    try {
      const result = task();
      setMessage(`${result.needId}：${result.status}，版本 ${result.businessVersion}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败。');
    }
  }
  const queryAction: AwcpActionRegistration<InstitutionQueryInput> = {
    action: 'securities.institution.query',
    title: '读取机构档案与需求',
    description: guide(
      '查看机构客户、销售/研究/会议组织者、服务范围、资料目录和需求。',
      '在职机构服务团队人员。',
      '只读。'
    ),
    inputSchema: INSTITUTION_QUERY_SCHEMA,
    examples: [QUERY],
    validate: (args) => service.validateQuery(args),
    invoke: (args) => completed(service.query(args))
  };
  useAwcpAction(queryAction);
  const entitlementAction: AwcpActionRegistration<EntitlementInput> = {
    action: 'securities.service.entitlement-check',
    title: '核对服务与资料范围',
    description: guide(
      '按带版本演示规则检查机构需求的资料及文档批准版本。',
      '机构服务团队可读；需求存在。',
      '只读返回 eligible 与具体原因。'
    ),
    inputSchema: ENTITLEMENT_SCHEMA,
    examples: [ENTITLEMENT],
    validate: (args) => service.validateEntitlement(args),
    invoke: (args) => completed(service.entitlement(args))
  };
  useAwcpAction(entitlementAction);
  const reviseAction: AwcpActionRegistration<NeedReviseInput> = {
    action: 'securities.service.need.revise',
    title: '补正机构服务需求',
    description: guide(
      '把新建或退回需求改为服务范围内的已批准资料。',
      '该机构销售人员、当前版本与补正理由。',
      '保存资料选择，退回需求恢复为 new 并保留审计。'
    ),
    inputSchema: NEED_REVISE_SCHEMA,
    examples: [REVISE],
    validate: (args) => service.validateRevise(args),
    invoke: (args) => completed(service.revise(args))
  };
  useAwcpAction(reviseAction);
  const reserveAction: AwcpActionRegistration<RoadshowReserveInput> = {
    action: 'securities.roadshow.reserve',
    title: '预约机构路演',
    description: guide(
      '以共享会议室和机构团队人员创建路演会议。',
      '服务范围合格、组织者、未来合法时段和空闲人员及会议室。',
      '生成可在 O05 查询的会议与路演关联；冲突返回替代时段。'
    ),
    inputSchema: ROADSHOW_RESERVE_SCHEMA,
    examples: [RESERVE],
    validate: (args) => service.validateReserve(args),
    invoke: (args) => completed(service.reserve(args))
  };
  useAwcpAction(reserveAction);
  const packageAction: AwcpActionRegistration<MaterialPackageInput> = {
    action: 'securities.material-package.create',
    title: '制作路演资料包',
    description: guide(
      '将需求中已批准且在服务范围内的文档版本冻结到资料包。',
      '研究服务人员、已预约路演及与需求一致的资料 ID。',
      '记录 DOC-* 来源及版本，不纳入内部或未批准资料。'
    ),
    inputSchema: MATERIAL_PACKAGE_SCHEMA,
    examples: [PACKAGE],
    validate: (args) => service.validatePackage(args),
    invoke: (args) => completed(service.createPackage(args))
  };
  useAwcpAction(packageAction);
  const inviteAction: AwcpActionRegistration<ServiceMutationInput> = {
    action: 'securities.roadshow.invite',
    title: '模拟路演邀请',
    description: guide(
      '为已备资料的路演建立机构邀请记录。',
      '会议组织者、已完成且仍有效的资料包。',
      '只写本地 simulated 邀请，不向外部发送。'
    ),
    inputSchema: ROADSHOW_INVITE_SCHEMA,
    examples: [INVITE],
    validate: (args) => service.validateInvite(args),
    invoke: (args) => completed(service.invite(args))
  };
  useAwcpAction(inviteAction);
  const minutesAction: AwcpActionRegistration<RoadshowMinutesInput> = {
    action: 'securities.roadshow.minutes.record',
    title: '登记路演纪要',
    description: guide(
      '把已结束路演的议程和决定写入共享会议纪要。',
      '会议已结束、邀请已模拟记录、组织者和当前版本。',
      '生成可在 O05 查询的会议纪要并关联路演。'
    ),
    inputSchema: ROADSHOW_MINUTES_SCHEMA,
    examples: [MINUTES],
    validate: (args) => service.validateMinutes(args),
    invoke: (args) => completed(service.recordMinutes(args))
  };
  useAwcpAction(minutesAction);
  const followupAction: AwcpActionRegistration<ServiceFollowupInput> = {
    action: 'securities.service.followup',
    title: '登记机构回访',
    description: guide(
      '会议纪要后记录机构反馈与后续结果。',
      '该机构销售人员、已登记纪要及当前版本。',
      '生成回访记录，需求转 completed。'
    ),
    inputSchema: SERVICE_FOLLOWUP_SCHEMA,
    examples: [FOLLOWUP],
    validate: (args) => service.validateFollowup(args),
    invoke: (args) => completed(service.followup(args))
  };
  useAwcpAction(followupAction);
  const summaryAction: AwcpActionRegistration<InstitutionQueryInput> = {
    action: 'securities.service.summary',
    title: '汇总机构服务关联对象',
    description: guide(
      '汇总需求、会议、资料包、邀请、纪要和回访 ID。',
      '该机构服务团队人员。',
      '只读返回跨场景可追溯对象。'
    ),
    inputSchema: INSTITUTION_QUERY_SCHEMA,
    examples: [QUERY],
    validate: (args) => service.validateQuery(args),
    invoke: (args) => completed(service.summary(args))
  };
  useAwcpAction(summaryAction);
  return (
    <main className={styles.page}>

      <section>
        <h2>机构需求与服务范围</h2>
        <p>
          机构 {profile?.id} / 客户 <a href={`/scenes/S01/objects/${encodeURIComponent(profile?.clientId ?? '')}`}>{profile?.clientId}</a>；项目 <a href={`/scenes/${profile?.projectId.startsWith('IBP-') ? 'S03' : 'O14'}/objects/${encodeURIComponent(profile?.projectId ?? '')}`}>{profile?.projectId}</a>；通讯分组 <a href={`/scenes/O02/objects/${encodeURIComponent(profile?.contactGroupId ?? '')}`}>{profile?.contactGroupId}</a>
          ；演示规则版本 {state.institutionPolicy.version}。
        </p>
        <p>
          状态 {need?.status === 'new' ? '待办理' : need?.status === 'returned' ? '已退回' : need?.status === 'completed' ? '已完成' : need?.status}；版本 {need?.businessVersion}；服务范围核对 {entitlement?.eligible ? '通过' : '受阻'}；{need?.returnReason ? `退回原因：${need.returnReason}；` : ''}原因{' '}
          {entitlement && Array.isArray(entitlement.reasons) ? entitlement.reasons.join('；') || '无' : '无'}。
        </p>
        <ul>
          {state.institutionMaterials.map((item) => (
            <li key={item.id}>
              {item.id} {item.title} → <a href={`/scenes/O06/objects/${encodeURIComponent(item.documentId)}`}>{item.documentId}</a> v{item.documentVersion}（{item.scope}）
            </li>
          ))}
        </ul>
        <label>
          资料 ID（逗号分隔）{' '}
          <input aria-label="资料 ID" value={materialIds} onChange={(e) => setMaterialIds(e.target.value)} />
        </label>
        <label>补正理由 <input aria-label="补正理由" value={revisionReason} onChange={(e) => setRevisionReason(e.target.value)} /></label>
        <button
          disabled={!materialIds.trim() || !revisionReason.trim()}
          onClick={() =>
            run(() =>
              service.revise({
                actorId,
                needId,
                materialIds: materialIds
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean),
                reason: revisionReason,
                expectedVersion: need?.businessVersion ?? 0,
                idempotencyKey: key()
              })
            )
          }
        >
          补正需求
        </button>
      </section>
      <section>
        <h2>预约与资料包</h2>
        <label>
          会议室{' '}
          <select aria-label="会议室" value={resourceId} onChange={(e) => setResourceId(e.target.value)}>
            <option value="">请选择</option>
            {state.meetingResources.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          开始{' '}
          <input
            aria-label="路演开始"
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
          />
        </label>
        <label>
          结束{' '}
          <input aria-label="路演结束" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
        </label>
        <button
          disabled={!resourceId || !startAt || !endAt}
          onClick={() =>
            run(() =>
              service.reserve({
                actorId,
                needId,
                resourceId,
                startAt: localInstant(startAt),
                endAt: localInstant(endAt),
                expectedVersion: need?.businessVersion ?? 0,
                idempotencyKey: key()
              })
            )
          }
        >
          预约路演
        </button>
        <button
          disabled={!materialIds.trim()}
          onClick={() =>
            run(() =>
              service.createPackage({
                actorId,
                needId,
                materialIds: materialIds
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean),
                expectedVersion: need?.businessVersion ?? 0,
                idempotencyKey: key()
              })
            )
          }
        >
          制作资料包
        </button>
        <p>
          路演 {roadshow?.id ?? '无'}；共享会议 {meeting ? <a href={`/scenes/O05/objects/${encodeURIComponent(meeting.id)}`}>{meeting.id}</a> : '无'}；资料包 {roadshow?.packageId ?? '无'}。
        </p>
      </section>
      <section>
        <h2>模拟邀请、纪要与回访</h2>
        <button
          disabled={!roadshow?.packageId}
          onClick={() =>
            run(() =>
              service.invite({ actorId, needId, expectedVersion: need?.businessVersion ?? 0, idempotencyKey: key() })
            )
          }
        >
          模拟邀请
        </button>
        <p>邀请记录 {roadshow?.invitationId ?? '无'}；不会发送外部消息。</p>
        <button
          disabled={!meeting}
          onClick={() => {
            if (!meeting) {
              setMessage('请先预约路演。');
              return;
            }
            repository.clock.advanceBy(
              Math.max(0, Date.parse(meeting.endAt) - Date.parse(repository.clock.now()) + 60_000)
            );
            setRevision((value) => value + 1);
            setMessage('演示时钟已推进到会议结束后。');
          }}
        >
          推进演示时钟到会议结束
        </button>
        <label>
          议程 <input aria-label="议程" value={agenda} onChange={(e) => setAgenda(e.target.value)} />
        </label>
        <label>
          决定（逗号分隔） <input aria-label="决定" value={decisions} onChange={(e) => setDecisions(e.target.value)} />
        </label>
        <button
          disabled={!agenda.trim() || !decisions.trim()}
          onClick={() =>
            run(() =>
              service.recordMinutes({
                actorId,
                needId,
                agenda,
                decisions: decisions
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean),
                expectedVersion: need?.businessVersion ?? 0,
                idempotencyKey: key()
              })
            )
          }
        >
          登记纪要
        </button>
        <label>
          回访内容{' '}
          <input aria-label="回访内容" value={followupNote} onChange={(e) => setFollowupNote(e.target.value)} />
        </label>
        <label>
          回访结果{' '}
          <select
            aria-label="回访结果"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as ServiceFollowupInput['outcome'])}
          >
            <option value="">请选择</option>
            <option value="satisfied">已满足</option>
            <option value="needs-action">需后续行动</option>
          </select>
        </label>
        <button
          disabled={!followupNote.trim() || !outcome}
          onClick={() =>
            run(() =>
              service.followup({
                actorId,
                needId,
                note: followupNote,
                outcome: outcome as ServiceFollowupInput['outcome'],
                expectedVersion: need?.businessVersion ?? 0,
                idempotencyKey: key()
              })
            )
          }
        >
          登记回访
        </button>
        <p>
          纪要 {roadshow?.minutesId ?? '无'}；回访 {roadshow?.followupId ?? '无'}。
        </p>
      </section>
      <section>
        <h2>服务汇总</h2>
        <p>机构 {profile?.id}：共 {state.institutionNeeds.filter((item) => item.institutionId === profile?.id).length} 项需求，已完成 {state.institutionNeeds.filter((item) => item.institutionId === profile?.id && item.status === 'completed').length} 项。</p>
        <ul>{state.institutionNeeds.filter((item) => item.institutionId === profile?.id).map((item) => <li key={item.id}><a href={`/scenes/S05/objects/${encodeURIComponent(item.id)}`}>{item.title}</a>（{item.id}）· {item.status === 'new' ? '待办理' : item.status === 'returned' ? '已退回' : item.status === 'completed' ? '已完成' : item.status}{item.returnReason ? ` · 退回原因：${item.returnReason}` : ''}</li>)}</ul>
      </section>
      <p role="status">{message}</p>
    </main>
  );
}
