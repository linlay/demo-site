import { useCurrentActor } from '../../app/currentUserContext';
import { useWorkflowAction as useAwcpAction } from '../../app/useWorkflowAction';
import type { AwcpActionRegistration } from '@app/awcp';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import {
  IB_ASSIGN_SCHEMA,
  IB_ATTACH_SCHEMA,
  IB_MUTATION_SCHEMA,
  IB_READ_SCHEMA,
  IB_RESOLVE_SCHEMA,
  IB_REVIEW_SCHEMA
} from '../../common/awcp/ibSchemas';
import type { IbWorkpaperKind } from '../../common/fixtures/types';
import type { DemoRepository } from '../../common/store/repository';
import {
  IbProjectService,
  type IbAssignInput,
  type IbAttachInput,
  type IbMutationInput,
  type IbReadInput,
  type IbResolveInput,
  type IbReviewInput
} from '../service/ibProjectService';
import styles from './S03IbProjectPage.module.css';

const READ: IbReadInput = { projectId: 'IBP-001', actorId: 'EMP-008' };
const SUBMIT: IbMutationInput = {
  projectId: 'IBP-004',
  actorId: 'EMP-008',
  expectedVersion: 1,
  idempotencyKey: 's03-submit-example'
};
const ASSIGN: IbAssignInput = {
  projectId: 'IBP-002',
  actorId: 'EMP-008',
  expectedVersion: 1,
  kind: 'legal',
  memberId: 'EMP-009',
  idempotencyKey: 's03-assign-example'
};
const ATTACH: IbAttachInput = {
  projectId: 'IBP-002',
  actorId: 'EMP-009',
  expectedVersion: 2,
  kind: 'legal',
  assetId: 'IBAST-004',
  summary: '补齐虚构法律底稿',
  idempotencyKey: 's03-attach-example'
};
const RESOLVE: IbResolveInput = {
  projectId: 'IBP-002',
  actorId: 'EMP-008',
  expectedVersion: 3,
  findingId: 'IBFIND-001',
  resolution: '已核对并补齐底稿',
  idempotencyKey: 's03-resolve-example'
};
const QUALITY: IbMutationInput = {
  projectId: 'IBP-001',
  actorId: 'EMP-008',
  expectedVersion: 1,
  idempotencyKey: 's03-quality-example'
};
const REVIEWS: IbReviewInput[] = [
  {
    projectId: 'IBP-001',
    actorId: 'EMP-010',
    expectedVersion: 2,
    decision: 'approve',
    reason: '',
    idempotencyKey: 's03-quality-approve-example'
  },
  {
    projectId: 'IBP-001',
    actorId: 'EMP-004',
    expectedVersion: 3,
    decision: 'approve',
    reason: '',
    idempotencyKey: 's03-committee-approve-example'
  },
  {
    projectId: 'IBP-003',
    actorId: 'EMP-010',
    expectedVersion: 2,
    decision: 'return',
    reason: '补充财务核查',
    idempotencyKey: 's03-return-example'
  }
];
const ARCHIVE: IbMutationInput = {
  projectId: 'IBP-001',
  actorId: 'EMP-008',
  expectedVersion: 4,
  idempotencyKey: 's03-archive-example'
};

function description(purpose: string, prerequisites: string, effects: string): string {
  return describeAction({
    purpose,
    prerequisites,
    parameters: '提供项目、当前操作人、业务版本和稳定业务幂等键；读取操作只需项目与操作人。',
    effects,
    result: '返回项目状态、业务版本或详细历史。',
    failures: '角色、状态、版本、规则或字段不符合要求时返回字段错误，不写入。'
  });
}

function intentKey(): string {
  return `s03-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function S03IbProjectPage({
  repository,
  objectId
}: {
  repository: DemoRepository;
  objectId?: string;
}): ReactElement {
  const [service] = useState(() => new IbProjectService(repository));
  const [items, setItems] = useState(() => service.list());
  const actorId = useCurrentActor('EMP-008');
  const [kind, setKind] = useState<IbWorkpaperKind>('financial');
  const [memberId, setMemberId] = useState('EMP-009');
  const [assetId, setAssetId] = useState('');
  const [findingId, setFindingId] = useState('');
  const [summary, setSummary] = useState('');
  const [resolution, setResolution] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const keys = useRef(new Map<string, string>());
  const projectId = items.some((item) => item.projectId === objectId) ? (objectId ?? '') : (items[0]?.projectId ?? '');
  const current = items.find((item) => item.projectId === projectId);
  const view = current ? service.read({ projectId, actorId }) : null;
  const assets = service.assets(projectId).filter((item) => !item.used);
  const chosenAsset = assets.some((item) => item.assetId === assetId) ? assetId : (assets[0]?.assetId ?? '');
  const openFindings = (view?.findings ?? []).filter((item) => item.status === 'open');
  const chosenFinding = openFindings.some((item) => item.id === findingId)
    ? findingId
    : String(openFindings[0]?.id ?? '');

  useEffect(() => service.subscribe(() => setItems(service.list())), [service]);
  function keyFor(operation: string, payload = ''): string {
    const intent = `${operation}:${projectId}:${current?.businessVersion}:${actorId}:${payload}`;
    let key = keys.current.get(intent);
    if (!key) {
      key = intentKey();
      keys.current.set(intent, key);
    }
    return key;
  }
  function base(operation: string, payload = ''): IbMutationInput {
    return {
      projectId,
      actorId,
      expectedVersion: current?.businessVersion ?? 0,
      idempotencyKey: keyFor(operation, payload)
    };
  }
  function run(action: () => string): void {
    try {
      setMessage(action());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败。');
    }
  }

  const readAction: AwcpActionRegistration<IbReadInput> = {
    action: 'securities.ib-project.read',
    title: '读取投行项目',
    description: description('读取项目、底稿版本、问题、审议和审计。', '项目参与角色访问现有项目。', '只读。'),
    inputSchema: IB_READ_SCHEMA,
    examples: [READ],
    validate: (args) => service.validateRead(args),
    invoke: (args) => completed(service.read(args))
  };
  useAwcpAction(readAction);
  const submitAction: AwcpActionRegistration<IbMutationInput> = {
    action: 'securities.ib-project.submit',
    title: '提交项目立项',
    description: description('把草稿项目转入已立项。', '先创建项目。', '记录立项状态、版本和审计。'),
    inputSchema: IB_MUTATION_SCHEMA,
    examples: [SUBMIT],
    validate: (args) => service.validateSubmit(args),
    invoke: (args) => completed(service.submit(args))
  };
  useAwcpAction(submitAction);
  const assignAction: AwcpActionRegistration<IbAssignInput> = {
    action: 'securities.diligence.assign',
    title: '分配尽调底稿',
    description: description(
      '把财务或法律底稿交给项目成员。',
      '项目已立项或处于尽调；IBP-002 的法律底稿尚未分工。',
      '保存分工并进入尽调。'
    ),
    inputSchema: IB_ASSIGN_SCHEMA,
    examples: [ASSIGN],
    validate: (args) => service.validateAssign(args),
    invoke: (args) => completed(service.assign(args))
  };
  useAwcpAction(assignAction);
  const attachAction: AwcpActionRegistration<IbAttachInput> = {
    action: 'securities.diligence.attach',
    title: '提交底稿版本',
    description: description(
      '提交分工成员的项目附件为底稿新版本。',
      '先分工；附件必须属于当前项目且未使用。',
      '保留旧版本、递增业务版本并审计。'
    ),
    inputSchema: IB_ATTACH_SCHEMA,
    examples: [ATTACH],
    validate: (args) => service.validateAttach(args),
    invoke: (args) => completed(service.attach(args))
  };
  useAwcpAction(attachAction);
  const resolveAction: AwcpActionRegistration<IbResolveInput> = {
    action: 'securities.finding.resolve',
    title: '整改尽调问题',
    description: description(
      '记录阻断问题的整改结果。',
      '项目在尽调或退回状态；问题仍待整改。',
      '保留问题单及整改历史。'
    ),
    inputSchema: IB_RESOLVE_SCHEMA,
    examples: [RESOLVE],
    validate: (args) => service.validateResolve(args),
    invoke: (args) => completed(service.resolve(args))
  };
  useAwcpAction(resolveAction);
  const qualityAction: AwcpActionRegistration<IbMutationInput> = {
    action: 'securities.quality.submit',
    title: '提交质控',
    description: description(
      '按带版本的演示规则检查底稿与阻断问题。',
      '底稿齐全，阻断问题已整改；退回后有新版底稿。',
      '冻结底稿及规则版本，创建质控待办。'
    ),
    inputSchema: IB_MUTATION_SCHEMA,
    examples: [QUALITY],
    validate: (args) => service.validateQualitySubmit(args),
    invoke: (args) => completed(service.qualitySubmit(args))
  };
  useAwcpAction(qualityAction);
  const reviewAction: AwcpActionRegistration<IbReviewInput> = {
    action: 'securities.ib-project.review',
    title: '质控与内核审议',
    description: description(
      '当前待办人员批准或退回项目。',
      '质控通过后由内核审议；退回须说明原因。',
      '记录审议、待办、退回问题与业务版本。'
    ),
    inputSchema: IB_REVIEW_SCHEMA,
    examples: REVIEWS,
    validate: (args) => service.validateReview(args),
    invoke: (args) => completed(service.review(args))
  };
  useAwcpAction(reviewAction);
  const archiveAction: AwcpActionRegistration<IbMutationInput> = {
    action: 'securities.ib-project.archive',
    title: '归档投行项目',
    description: description('归档通过内核审议的虚构项目。', '质控和内核均批准。', '保存归档状态、时间和审计。'),
    inputSchema: IB_MUTATION_SCHEMA,
    examples: [ARCHIVE],
    validate: (args) => service.validateArchive(args),
    invoke: (args) => completed(service.archive(args))
  };
  useAwcpAction(archiveAction);

  return (
    <section className={styles.page} aria-label="投行项目办理">
      <div className={styles.grid}>


        <label htmlFor="s03-kind">底稿类型</label>
        <select id="s03-kind" value={kind} onChange={(event) => setKind(event.target.value as IbWorkpaperKind)}>
          <option value="financial">财务</option>
          <option value="legal">法律</option>
        </select>
        <label htmlFor="s03-member">分工成员</label>
        <select id="s03-member" value={memberId} onChange={(event) => setMemberId(event.target.value)}>
          {service
            .actors()
            .filter((item) => item.roles.includes('ib-member'))
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
        </select>
        <label htmlFor="s03-asset">未使用项目附件</label>
        <select id="s03-asset" value={chosenAsset} onChange={(event) => setAssetId(event.target.value)}>
          {assets.map((item) => (
            <option key={item.assetId} value={item.assetId}>
              {item.assetId} · {item.filename}
            </option>
          ))}
        </select>
        <label htmlFor="s03-summary">底稿说明</label>
        <input id="s03-summary" value={summary} onChange={(event) => setSummary(event.target.value)} />
        <label htmlFor="s03-finding">待整改问题</label>
        <select id="s03-finding" value={chosenFinding} onChange={(event) => setFindingId(event.target.value)}>
          {openFindings.map((item) => (
            <option key={String(item.id)} value={String(item.id)}>
              {String(item.id)} · {String(item.description)}
            </option>
          ))}
        </select>
        <label htmlFor="s03-resolution">整改说明</label>
        <input id="s03-resolution" value={resolution} onChange={(event) => setResolution(event.target.value)} />
        <label htmlFor="s03-reason">退回原因</label>
        <input id="s03-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={current?.status !== 'draft'}
          onClick={() => run(() => `已立项：${service.submit(base('submit')).status}。`)}
        >
          提交立项
        </button>
        <button
          type="button"
          disabled={!current || !['initiated', 'diligence', 'returned'].includes(current.status)}
          onClick={() =>
            run(
              () =>
                `已分工：${service.assign({ ...base('assign', `${kind}:${memberId}`), kind, memberId }).assignmentId}。`
            )
          }
        >
          分配尽调
        </button>
        <button
          type="button"
          disabled={!chosenAsset || !current || !['diligence', 'returned'].includes(current.status)}
          onClick={() =>
            run(
              () =>
                `底稿版本：${service.attach({ ...base('attach', `${kind}:${chosenAsset}:${summary}`), kind, assetId: chosenAsset, summary }).workpaperVersion}。`
            )
          }
        >
          提交底稿
        </button>
        <button
          type="button"
          disabled={!chosenFinding || !current || !['diligence', 'returned'].includes(current.status)}
          onClick={() =>
            run(
              () =>
                `已整改：${service.resolve({ ...base('resolve', `${chosenFinding}:${resolution}`), findingId: chosenFinding, resolution }).findingId}。`
            )
          }
        >
          整改问题
        </button>
        <button
          type="button"
          disabled={current?.status !== 'diligence'}
          onClick={() => run(() => `已提交质控：${service.qualitySubmit(base('quality')).submissionId}。`)}
        >
          提交质控
        </button>
        <button
          type="button"
          disabled={!current || !['quality-review', 'committee-review'].includes(current.status)}
          onClick={() =>
            run(() => `审议结果：${service.review({ ...base('approve'), decision: 'approve', reason: '' }).status}。`)
          }
        >
          审议批准
        </button>
        <button
          type="button"
          disabled={!current || !['quality-review', 'committee-review'].includes(current.status)}
          onClick={() =>
            run(() => `审议结果：${service.review({ ...base('return', reason), decision: 'return', reason }).status}。`)
          }
        >
          审议退回
        </button>
        <button
          type="button"
          disabled={current?.status !== 'approved'}
          onClick={() => run(() => `已归档，版本 ${service.archive(base('archive')).businessVersion}。`)}
        >
          归档
        </button>
        <button
          type="button"
          disabled={!current}
          onClick={() => run(() => `当前状态：${service.read({ projectId, actorId }).status}。`)}
        >
          查询进度
        </button>
      </div>
      <p role="status">{message}</p>
      {view && (
        <div className={styles.summary} aria-label="投行项目进度">
          <p>
            {view.projectId} · {view.status} · 业务版本 {view.businessVersion} · 规则版本 {view.policyVersion}
          </p>
          <p>
            底稿版本 {view.workpapers.length} 条；待整改问题 {openFindings.length} 条；质控提交{' '}
            {view.submissions.length} 次；审议 {view.reviews.length} 次。
          </p>
          <ol>
            {view.history.map((item, index) => (
              <li key={index}>
                {String(item.action)} · {String(item.toStatus)} · {String(item.note ?? '')}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
