import { useCurrentActor } from '../../app/currentUserContext';
import {
  CheckCircleOutlined,
  CloudUploadOutlined,
  EditOutlined,
  FileSearchOutlined,
  FolderOutlined,
  RollbackOutlined,
  SafetyCertificateOutlined,
  SendOutlined
} from '@ant-design/icons';
import { useWorkflowAction as useAwcpAction } from '../../app/useWorkflowAction';
import type { AwcpActionRegistration } from '@app/awcp';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import {
  RESEARCH_MUTATION_SCHEMA,
  RESEARCH_PATCH_SCHEMA,
  RESEARCH_PUBLISH_SCHEMA,
  RESEARCH_READ_SCHEMA,
  RESEARCH_REVIEW_SCHEMA
} from '../../common/awcp/researchSchemas';
import type { DemoRepository } from '../../common/store/repository';
import {
  ResearchService,
  type ResearchMutationInput,
  type ResearchPatchInput,
  type ResearchPublishInput,
  type ResearchReadInput,
  type ResearchReviewInput
} from '../service/researchService';
import styles from './S02ResearchPage.module.css';

const READ_EXAMPLE: ResearchReadInput = { reportId: 'REPORT-001', actorId: 'EMP-003' };
const PATCH_EXAMPLE: ResearchPatchInput = {
  reportId: 'REPORT-002',
  actorId: 'EMP-003',
  expectedVersion: 1,
  title: '虚构公司跟踪报告第二版',
  content: '补充演示引用和披露后的虚构报告正文。',
  citations: ['DEMO-SOURCE-002'],
  disclosures: ['仅供虚构流程演示。'],
  idempotencyKey: 's02-patch-example-001'
};
const CHECK_EXAMPLE: ResearchMutationInput = {
  reportId: 'REPORT-001',
  actorId: 'EMP-003',
  expectedVersion: 1,
  idempotencyKey: 's02-check-example-001'
};
const SUBMIT_EXAMPLE: ResearchMutationInput = {
  reportId: 'REPORT-001',
  actorId: 'EMP-003',
  expectedVersion: 1,
  idempotencyKey: 's02-submit-example-001'
};
const REVIEW_EXAMPLES: ResearchReviewInput[] = [
  {
    reportId: 'REPORT-001',
    actorId: 'EMP-005',
    expectedVersion: 2,
    decision: 'approve',
    reason: '',
    idempotencyKey: 's02-quality-approve-example-001'
  },
  {
    reportId: 'REPORT-001',
    actorId: 'EMP-006',
    expectedVersion: 3,
    decision: 'approve',
    reason: '',
    idempotencyKey: 's02-compliance-approve-example-001'
  },
  {
    reportId: 'REPORT-003',
    actorId: 'EMP-005',
    expectedVersion: 2,
    decision: 'return',
    reason: '请补充分析依据',
    idempotencyKey: 's02-return-example-001'
  }
];
const PUBLISH_EXAMPLE: ResearchPublishInput = {
  reportId: 'REPORT-001',
  actorId: 'EMP-007',
  expectedVersion: 4,
  scope: 'clients',
  idempotencyKey: 's02-publish-example-001'
};
const ARCHIVE_EXAMPLE: ResearchMutationInput = {
  reportId: 'REPORT-001',
  actorId: 'EMP-007',
  expectedVersion: 5,
  idempotencyKey: 's02-archive-example-001'
};

function intentKey(): string {
  return `s02-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function S02ResearchPage({
  repository,
  objectId
}: {
  repository: DemoRepository;
  objectId?: string;
}): ReactElement {
  const [service] = useState(() => new ResearchService(repository));
  const [items, setItems] = useState(() => service.list());
  const actorId = useCurrentActor('EMP-003');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [citations, setCitations] = useState('');
  const [disclosures, setDisclosures] = useState('');
  const [reason, setReason] = useState('');
  const [scope, setScope] = useState<'internal' | 'clients'>('internal');
  const [message, setMessage] = useState('');
  const keys = useRef(new Map<string, string>());
  const reportId = items.some((item) => item.reportId === objectId) ? (objectId ?? '') : (items[0]?.reportId ?? '');
  const current = items.find((item) => item.reportId === reportId);
  const view = current ? service.read({ reportId, actorId }) : null;
  const citationsFromView = view?.citations.join('\n') ?? '';
  const disclosuresFromView = view?.disclosures.join('\n') ?? '';

  useEffect(() => service.subscribe(() => setItems(service.list())), [service]);
  useEffect(() => {
    setTitle(view?.title ?? '');
    setContent(view?.content ?? '');
    setCitations(citationsFromView);
    setDisclosures(disclosuresFromView);
  }, [reportId, view?.documentVersion, view?.title, view?.content, citationsFromView, disclosuresFromView]);

  function keyFor(operation: string, payload = ''): string {
    const key = `${operation}:${reportId}:${current?.businessVersion}:${actorId}:${payload}`;
    let value = keys.current.get(key);
    if (!value) {
      value = intentKey();
      keys.current.set(key, value);
    }
    return value;
  }

  const readAction: AwcpActionRegistration<ResearchReadInput> = {
    action: 'securities.research.read',
    title: '读取研报进度与版本',
    description: describeAction({
      purpose: '读取课题、当前文档、检查、审阅、发布与审计历史。',
      prerequisites: '研报流程参与人访问现有报告。',
      parameters: 'reportId 是研报 ID；actorId 是读取人。',
      effects: '只读，不改变记录。',
      result: '返回当前状态、版本、规则和历史。',
      failures: '不存在或无权时返回字段错误。'
    }),
    inputSchema: RESEARCH_READ_SCHEMA,
    examples: [READ_EXAMPLE],
    validate: (args) => service.validateRead(args),
    invoke: (args) => completed(service.read(args))
  };
  useAwcpAction(readAction);

  const patchAction: AwcpActionRegistration<ResearchPatchInput> = {
    action: 'securities.research.patch',
    title: '编辑研报文档',
    description: describeAction({
      purpose: '编辑标题、正文、引用和披露；保留旧文档版本。',
      prerequisites: '原分析师编辑草稿或退回报告；REPORT-002 样例补齐缺失内容。',
      parameters: '提供完整文档字段、当前业务版本和业务幂等键。',
      effects: '创建新文档版本，递增业务版本并重置为 draft。',
      result: '返回新业务版本与文档版本。',
      failures: '角色、状态、标题或正文无效时不写入。'
    }),
    inputSchema: RESEARCH_PATCH_SCHEMA,
    examples: [PATCH_EXAMPLE],
    validate: (args) => service.validatePatch(args),
    invoke: (args) => completed(service.patch(args))
  };
  useAwcpAction(patchAction);

  const checkAction: AwcpActionRegistration<ResearchMutationInput> = {
    action: 'securities.research.check',
    title: '检查引用与披露',
    description: describeAction({
      purpose: '按版本化演示规则检查当前文档的引用与披露。',
      prerequisites: '草稿有标题、正文和规则要求的引用、披露；REPORT-001 初始满足。',
      parameters: '提供报告、原分析师、当前业务版本及业务幂等键。',
      effects: '保存文档版本、业务版本和规则版本对应的检查记录。',
      result: '返回 checkId 和通过状态。',
      failures: '缺引用或披露返回具体字段且不写入。'
    }),
    inputSchema: RESEARCH_MUTATION_SCHEMA,
    examples: [CHECK_EXAMPLE],
    validate: (args) => service.validateCheck(args),
    invoke: (args) => completed(service.check(args))
  };
  useAwcpAction(checkAction);

  const submitAction: AwcpActionRegistration<ResearchMutationInput> = {
    action: 'securities.research.submit-review',
    title: '提交研报审阅',
    description: describeAction({
      purpose: '把已检查的当前文档提交质量审阅。',
      prerequisites: '先 check；退回编辑后按新文档版本重新检查。',
      parameters: '提供当前业务版本和稳定幂等键。',
      effects: '原子更新状态及版本，创建质量待办并记录审计。',
      result: '返回 quality-review 状态和新业务版本。',
      failures: '缺当前版本检查或无质审人员时不写入。'
    }),
    inputSchema: RESEARCH_MUTATION_SCHEMA,
    examples: [SUBMIT_EXAMPLE],
    validate: (args) => service.validateSubmitReview(args),
    invoke: (args) => completed(service.submitReview(args))
  };
  useAwcpAction(submitAction);

  const reviewAction: AwcpActionRegistration<ResearchReviewInput> = {
    action: 'securities.research.review',
    title: '质量或合规审阅',
    description: describeAction({
      purpose: '当前待办审阅人批准或退回对应文档版本。',
      prerequisites: '先 submit-review；质量批准后才轮到合规。退回样例另从 REPORT-003 走前置步骤。',
      parameters: 'decision 为 approve 或 return；退回填写 reason；expectedVersion 为当前业务版本。',
      effects: '保存审阅阶段、文档与规则版本、原因、待办及状态。',
      result: '返回下一阶段、returned 或 approved 状态。',
      failures: '角色、待办、版本、原因不符时不写入。'
    }),
    inputSchema: RESEARCH_REVIEW_SCHEMA,
    examples: REVIEW_EXAMPLES,
    validate: (args) => service.validateReview(args),
    invoke: (args) => completed(service.review(args))
  };
  useAwcpAction(reviewAction);

  const publishAction: AwcpActionRegistration<ResearchPublishInput> = {
    action: 'securities.research.publish',
    title: '模拟发布研报',
    description: describeAction({
      purpose: '把指定范围的当前已批准文档版本模拟发布。',
      prerequisites: '同一文档及规则版本已完成检查、质量与合规批准。',
      parameters: 'scope 为 internal 或 clients；发布人员提供当前业务版本与幂等键。',
      effects: '生成唯一发布记录，记录文档版本、范围和审计。',
      result: '返回 publicationId、published 状态及版本。',
      failures: '缺审核、规则变动或重复发布时不写入。'
    }),
    inputSchema: RESEARCH_PUBLISH_SCHEMA,
    examples: [PUBLISH_EXAMPLE],
    validate: (args) => service.validatePublish(args),
    invoke: (args) => completed(service.publish(args))
  };
  useAwcpAction(publishAction);

  const archiveAction: AwcpActionRegistration<ResearchMutationInput> = {
    action: 'securities.research.archive',
    title: '归档已发布研报',
    description: describeAction({
      purpose: '归档已发布的虚构研报。',
      prerequisites: '先完成两级审阅及 publish；由发布人员执行。',
      parameters: '提供报告、发布人、当前业务版本和幂等键。',
      effects: '记录归档时间、状态、版本和审计。',
      result: '返回 archived 状态和新版本。',
      failures: '尚未发布或旧版本时不写入。'
    }),
    inputSchema: RESEARCH_MUTATION_SCHEMA,
    examples: [ARCHIVE_EXAMPLE],
    validate: (args) => service.validateArchive(args),
    invoke: (args) => completed(service.archive(args))
  };
  useAwcpAction(archiveAction);

  function run(action: () => string): void {
    try {
      setMessage(action());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败。');
    }
  }

  function base(operation: string, payload = ''): ResearchMutationInput {
    return {
      reportId,
      actorId,
      expectedVersion: current?.businessVersion ?? 0,
      idempotencyKey: keyFor(operation, payload)
    };
  }

  function lines(value: string): string[] {
    return value
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return (
    <section className={styles.page} aria-label="研报事项办理">

      {/* Workstation Layout */}
      <div className={styles.layoutGrid}>
        {/* Left Column: Report Editor Form */}
        <div className={styles.cardPanel}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>
              <EditOutlined /> 研报文档编辑工作台
            </h2>
          </div>

          <div className={styles.formGrid}>

            <div className={styles.formGroup}>


            </div>

            <div className={styles.formGroupFull}>
              <label htmlFor="s02-title-field" className={styles.formLabel}>
                研报标题
              </label>
              <input
                id="s02-title-field"
                className={styles.input}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>

            <div className={styles.formGroupFull}>
              <label htmlFor="s02-content" className={styles.formLabel}>
                研报正文内容
              </label>
              <textarea
                id="s02-content"
                className={styles.textarea}
                rows={4}
                value={content}
                onChange={(event) => setContent(event.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="s02-citations" className={styles.formLabel}>
                数据引用来源（每行一条）
              </label>
              <textarea
                id="s02-citations"
                className={styles.textarea}
                rows={3}
                value={citations}
                onChange={(event) => setCitations(event.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="s02-disclosures" className={styles.formLabel}>
                合规披露声明（每行一条）
              </label>
              <textarea
                id="s02-disclosures"
                className={styles.textarea}
                rows={3}
                value={disclosures}
                onChange={(event) => setDisclosures(event.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="s02-reason" className={styles.formLabel}>
                审阅退回意见说明
              </label>
              <input
                id="s02-reason"
                className={styles.input}
                value={reason}
                maxLength={200}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="s02-scope" className={styles.formLabel}>
                发布受众范围
              </label>
              <select
                id="s02-scope"
                className={styles.select}
                value={scope}
                onChange={(event) => setScope(event.target.value as 'internal' | 'clients')}
              >
                <option value="internal">内部研阅</option>
                <option value="clients">演示机构客户</option>
              </select>
            </div>
          </div>
        </div>

        {/* Right Column: Research Progress & History */}
        {view && (
          <div className={styles.summary} aria-label="研报业务进度">
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>
                <FileSearchOutlined /> 研报审校与流转状态
              </h2>
            </div>

            <div className={styles.summaryStatusBanner}>
              {view.reportId} · {view.status} · 业务版本 {view.businessVersion} · 文档版本 {view.documentVersion}
            </div>

            <div className={styles.summaryMeta}>
              当前版本检查：{view.checked ? '通过' : '待检查'}；审阅记录 {view.reviews.length} 条；发布记录{' '}
              {view.publications.length} 条。
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)' }}>审校历史与审计追踪</span>
              <ol className={styles.historyList}>
                {view.history.map((item, index) => (
                  <li key={index} className={styles.historyItem}>
                    {String(item.action)} · {String(item.toStatus)} · {String(item.note ?? '')}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>

      {/* Action Toolbar */}
      <div className={styles.actionsRow}>
        <button
          type="button"
          className={styles.btnAction}
          disabled={!current || (current.status !== 'draft' && current.status !== 'returned')}
          onClick={() =>
            run(() => {
              const result = service.patch({
                ...base('patch', `${title}:${content}:${citations}:${disclosures}`),
                title,
                content,
                citations: lines(citations),
                disclosures: lines(disclosures)
              });
              return `已编辑文档版本 ${result.documentVersion}。`;
            })
          }
        >
          <EditOutlined /> 编辑并保存新版本
        </button>

        <button
          type="button"
          className={styles.btnAction}
          disabled={current?.status !== 'draft'}
          onClick={() => run(() => `检查通过：${service.check(base('check')).checkId}。`)}
        >
          <SafetyCertificateOutlined /> 检查引用与披露
        </button>

        <button
          type="button"
          className={styles.btnAction}
          disabled={current?.status !== 'draft'}
          onClick={() => run(() => `已提交质量审阅，版本 ${service.submitReview(base('submit')).businessVersion}。`)}
        >
          <SendOutlined /> 提交审阅
        </button>

        <button
          type="button"
          className={`${styles.btnAction} ${styles.btnActionSuccess}`}
          disabled={current?.status !== 'quality-review' && current?.status !== 'compliance-review'}
          onClick={() =>
            run(() => `审阅结果：${service.review({ ...base('approve'), decision: 'approve', reason: '' }).status}。`)
          }
        >
          <CheckCircleOutlined /> 审阅批准
        </button>

        <button
          type="button"
          className={`${styles.btnAction} ${styles.btnActionAmber}`}
          disabled={current?.status !== 'quality-review' && current?.status !== 'compliance-review'}
          onClick={() =>
            run(() => `审阅结果：${service.review({ ...base('return', reason), decision: 'return', reason }).status}。`)
          }
        >
          <RollbackOutlined /> 审阅退回
        </button>

        <button
          type="button"
          className={styles.btnAction}
          disabled={current?.status !== 'approved'}
          onClick={() =>
            run(() => `发布记录：${service.publish({ ...base('publish', scope), scope }).publicationId}。`)
          }
        >
          <CloudUploadOutlined /> 模拟发布
        </button>

        <button
          type="button"
          className={styles.btnAction}
          disabled={current?.status !== 'published'}
          onClick={() => run(() => `已归档，版本 ${service.archive(base('archive')).businessVersion}。`)}
        >
          <FolderOutlined /> 归档
        </button>

        <button
          type="button"
          className={styles.btnAction}
          disabled={!current}
          onClick={() => run(() => `当前状态：${service.read({ reportId, actorId }).status}。`)}
        >
          <FileSearchOutlined /> 查询进度
        </button>
      </div>

      {message && (
        <p role="status" className={styles.statusMessage}>
          {message}
        </p>
      )}
    </section>
  );
}
