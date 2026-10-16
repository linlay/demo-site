import { useCurrentActor } from '../../app/currentUserContext';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  EditOutlined,
  FileDoneOutlined,
  HistoryOutlined,
  RollbackOutlined,
  SendOutlined
} from '@ant-design/icons';
import { useWorkflowAction as useAwcpAction } from '../../app/useWorkflowAction';
import type { AwcpActionRegistration } from '@app/awcp';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import {
  APPROVAL_READ_SCHEMA,
  APPROVAL_REVIEW_SCHEMA,
  APPROVAL_SUBMIT_SCHEMA,
  APPROVAL_WITHDRAW_SCHEMA
} from '../../common/awcp/approvalSchemas';
import type { DemoRepository } from '../../common/store/repository';
import {
  ApprovalService,
  type ApprovalReadInput,
  type ApprovalReviewInput,
  type ApprovalSubmitInput,
  type ApprovalWithdrawInput
} from '../service/approvalService';
import styles from './O08ApprovalPage.module.css';

const READ: ApprovalReadInput = { requestId: 'APPR-001', actorId: 'EMP-001' };
const SUBMIT: ApprovalSubmitInput = {
  requestId: null,
  actorId: 'EMP-001',
  expectedVersion: null,
  title: '虚构办公新申请',
  description: '用于演示的办公申请说明。',
  materialIds: ['APMAT-001'],
  idempotencyKey: 'o08-submit-example'
};
const APPROVE: ApprovalReviewInput = {
  requestId: 'APPR-001',
  actorId: 'EMP-002',
  expectedVersion: 1,
  opinion: '资料齐全，同意。',
  idempotencyKey: 'o08-approve-example'
};
const RETURN: ApprovalReviewInput = {
  requestId: 'APPR-001',
  actorId: 'EMP-002',
  expectedVersion: 1,
  opinion: '请补充申请用途。',
  idempotencyKey: 'o08-return-example'
};
const WITHDRAW: ApprovalWithdrawInput = {
  requestId: 'APPR-001',
  actorId: 'EMP-001',
  expectedVersion: 1,
  reason: '需要调整申请内容。',
  idempotencyKey: 'o08-withdraw-example'
};

function guide(purpose: string, prerequisites: string, effects: string): string {
  return describeAction({
    purpose,
    prerequisites,
    parameters: '使用虚构申请、人员和资料 ID；写操作带业务版本、意见或原因，以及稳定幂等键。',
    effects,
    result: '返回申请状态、业务版本、当前审批任务或完整历史。',
    failures: '缺资料、越权、已处理任务、终态或旧版本被拒绝，失败不写入。'
  });
}

function key(): string {
  return `o08-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function O08ApprovalPage({
  repository,
  objectId
}: {
  repository: DemoRepository;
  objectId?: string;
}): ReactElement {
  const [service] = useState(() => new ApprovalService(repository));
  const actorId = useCurrentActor('EMP-001');
  const [selected, setSelected] = useState(objectId ?? 'APPR-001');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [materialIds, setMaterialIds] = useState<string[]>([]);
  const [opinion, setOpinion] = useState('');
  const [withdrawReason, setWithdrawReason] = useState('');
  const [message, setMessage] = useState('');
  const [, setRevision] = useState(0);
  const keys = useRef(new Map<string, string>());

  useEffect(() => service.subscribe(() => setRevision((value) => value + 1)), [service]);

  const items = service.list(actorId);
  const requestId =
    selected === '' ? '' : items.some((item) => item.requestId === selected) ? selected : (items[0]?.requestId ?? '');
  const view = requestId ? service.read({ requestId, actorId }) : null;
  const status = view?.status as string | undefined;
  const businessVersion = Number(view?.businessVersion ?? 0);
  const applicantId = String(view?.applicantId ?? '');
  const reviewerId = String(view?.reviewerId ?? '');
  const decisions =
    (view?.decisions as
      | Array<{ id: string; taskId: string; action: string; opinion: string; businessVersion: number }>
      | undefined) ?? [];
  const tasks = (view?.tasks as Array<{ taskId: string; assigneeId: string; status: string }> | undefined) ?? [];
  const viewTitle = String(view?.title ?? '');
  const viewDescription = String(view?.description ?? '');
  const sourceMaterials = view && Array.isArray(view.materialIds) ? (view.materialIds as string[]).join(',') : '';

  useEffect(() => {
    if (requestId) {
      setTitle(viewTitle);
      setDescription(viewDescription);
      setMaterialIds(sourceMaterials ? sourceMaterials.split(',') : []);
    }
  }, [requestId, businessVersion, viewTitle, viewDescription, sourceMaterials]);

  function intentKey(operation: string, payload: string): string {
    const intent = `${operation}:${actorId}:${requestId}:${businessVersion}:${payload}`;
    let value = keys.current.get(intent);
    if (!value) {
      value = key();
      keys.current.set(intent, value);
    }
    return value;
  }

  function run(action: () => string): void {
    try {
      setMessage(action());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败。');
    }
  }

  const readAction: AwcpActionRegistration<ApprovalReadInput> = {
    action: 'office.approval.read',
    title: '读取审批申请与历史',
    description: guide('读取申请、资料、当前及历史任务、意见和审计。', '申请人或指定审批主管。', '只读。'),
    inputSchema: APPROVAL_READ_SCHEMA,
    examples: [READ],
    validate: (args) => service.validateRead(args),
    invoke: (args) => completed(service.read(args))
  };
  useAwcpAction(readAction);

  const submitAction: AwcpActionRegistration<ApprovalSubmitInput> = {
    action: 'office.approval.submit',
    title: '提交或重提通用审批',
    description: guide(
      '新建并提交申请，或补正退回/撤回申请后重提。',
      '申请人有效，标题、说明和资料齐全；重提使用当前版本。',
      '原子保存申请并创建主管任务。'
    ),
    inputSchema: APPROVAL_SUBMIT_SCHEMA,
    examples: [SUBMIT],
    validate: (args) => service.validateSubmit(args),
    invoke: (args) => completed(service.submit(args))
  };
  useAwcpAction(submitAction);

  const approveAction: AwcpActionRegistration<ApprovalReviewInput> = {
    action: 'office.approval.approve',
    title: '通过通用审批',
    description: guide(
      '指定主管批准当前待审批申请。',
      '主管持有当前开放任务并填写意见。',
      '结束任务，记录批准意见与终态。'
    ),
    inputSchema: APPROVAL_REVIEW_SCHEMA,
    examples: [APPROVE],
    validate: (args) => service.validateApprove(args),
    invoke: (args) => completed(service.approve(args))
  };
  useAwcpAction(approveAction);

  const returnAction: AwcpActionRegistration<ApprovalReviewInput> = {
    action: 'office.approval.return',
    title: '退回通用审批补正',
    description: guide(
      '指定主管退回当前申请并留下补正意见。',
      '主管持有当前开放任务并填写意见。',
      '结束任务并保留退回历史，允许申请人修改重提。'
    ),
    inputSchema: APPROVAL_REVIEW_SCHEMA,
    examples: [RETURN],
    validate: (args) => service.validateReturn(args),
    invoke: (args) => completed(service.return(args))
  };
  useAwcpAction(returnAction);

  const withdrawAction: AwcpActionRegistration<ApprovalWithdrawInput> = {
    action: 'office.approval.withdraw',
    title: '撤回待审批申请',
    description: guide(
      '申请人在审批前撤回并说明原因。',
      '申请仍待审批且版本一致；已批准申请不可撤回。',
      '结束当前任务，保留历史并允许修改重提。'
    ),
    inputSchema: APPROVAL_WITHDRAW_SCHEMA,
    examples: [WITHDRAW],
    validate: (args) => service.validateWithdraw(args),
    invoke: (args) => completed(service.withdraw(args))
  };
  useAwcpAction(withdrawAction);

  return (
    <section className={styles.page} aria-label="通用审批事项办理">

      {/* Main Workstation Layout */}
      <div className={styles.layoutGrid}>
        {/* Left Column: Form & Application Editor */}
        <div className={styles.cardPanel}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>
              <EditOutlined /> 申请编制与发起
            </h2>
          </div>

          <div className={styles.formGrid}>
            <div className={styles.formGroup}>


            </div>

            <div className={styles.formGroup}>
              <label htmlFor="o08-request" className={styles.formLabel}>
                <FileDoneOutlined /> 选择审批单据
              </label>
              <select
                id="o08-request"
                className={styles.select}
                value={requestId}
                onChange={(event) => setSelected(event.target.value)}
              >
                {items.map((item) => (
                  <option key={item.requestId} value={item.requestId}>
                    {item.requestId} · {item.status} · v{item.businessVersion}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="o08-title-input" className={styles.formLabel}>
                申请标题
              </label>
              <input
                id="o08-title-input"
                className={styles.input}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="o08-description" className={styles.formLabel}>
                申请说明
              </label>
              <textarea
                id="o08-description"
                className={styles.textarea}
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>

          <fieldset className={styles.materialsFieldset}>
            <legend className={styles.materialsLegend}>附带申请材料清单</legend>
            <div className={styles.materialsList}>
              {service.materials().map((item) => (
                <label key={item.id} className={styles.materialLabel}>
                  <input
                    type="checkbox"
                    checked={materialIds.includes(item.id)}
                    onChange={(event) =>
                      setMaterialIds((current) =>
                        event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id)
                      )
                    }
                  />
                  {item.name}（{item.id}）
                </label>
              ))}
            </div>
          </fieldset>

          <div className={styles.actionGroup}>
            <button
              type="button"
              className={styles.btnSubmit}
              disabled={!requestId || !title.trim() || !description.trim() || !materialIds.length || actorId !== applicantId || (status !== 'returned' && status !== 'withdrawn')}
              onClick={() =>
                run(() => {
                  const payload: ApprovalSubmitInput = {
                    requestId: requestId || null,
                    actorId,
                    expectedVersion: requestId ? businessVersion : null,
                    title,
                    description,
                    materialIds,
                    idempotencyKey: intentKey('submit', JSON.stringify([title, description, materialIds]))
                  };
                  const submitted = service.submit(payload);
                  setSelected(submitted.requestId);
                  return `已提交 ${submitted.requestId}，审批任务 ${submitted.taskId}，版本 ${submitted.businessVersion}。`;
                })
              }
            >
              <SendOutlined /> 补正后重新提交
            </button>
          </div>
        </div>

        {/* Right Column: Approval History & Review Console */}
        {view && (
          <div className={styles.cardPanel}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>
                <HistoryOutlined /> 审批进度与历史
              </h2>
              <span
                className={`${styles.statusBadge} ${
                  status === 'approved'
                    ? styles.statusApproved
                    : status === 'returned'
                      ? styles.statusReturned
                      : status === 'withdrawn'
                        ? styles.statusWithdrawn
                        : styles.statusSubmitted
                }`}
              >
                {status}
              </span>
            </div>

            <div className={styles.timelineSection}>
              <div className={styles.metaRow}>
                <span>
                  <strong>单号：</strong>
                  <span style={{ fontFamily: 'monospace', color: '#93c5fd' }}>{requestId}</span> ·{' '}
                  {String(view.title)}
                </span>
                <span>
                  <strong>版本：</strong>v{businessVersion}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                {requestId} · {String(view.title)} · {status} · 业务版本 {businessVersion} · 当前任务{' '}
                {String(view.taskId ?? '无')}
              </p>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
                申请人 {applicantId}；审批人 {reviewerId}；资料 {sourceMaterials || '无'}
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)' }}>任务调度流转</span>
              <ol className={styles.orderedList}>
                {tasks.map((task) => (
                  <li key={task.taskId} className={styles.listItem}>
                    {task.taskId} · {task.assigneeId} · {task.status}
                  </li>
                ))}
              </ol>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)' }}>审批决策轨迹</span>
              <ol className={styles.orderedList}>
                {decisions.map((decision) => (
                  <li key={decision.id} className={styles.listItem}>
                    {decision.id} · {decision.action} · {decision.taskId} · v{decision.businessVersion} · {decision.opinion}
                  </li>
                ))}
              </ol>
            </div>

            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label htmlFor="o08-opinion" className={styles.formLabel}>
                  审批意见
                </label>
                <input
                  id="o08-opinion"
                  className={styles.input}
                  value={opinion}
                  onChange={(event) => setOpinion(event.target.value)}
                />
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="o08-withdraw-reason" className={styles.formLabel}>
                  撤回原因
                </label>
                <input
                  id="o08-withdraw-reason"
                  className={styles.input}
                  value={withdrawReason}
                  onChange={(event) => setWithdrawReason(event.target.value)}
                />
              </div>
            </div>

            <div className={styles.actionGroup}>
              <button
                type="button"
                className={styles.btnApprove}
                disabled={status !== 'submitted' || actorId !== reviewerId || !opinion.trim()}
                onClick={() =>
                  run(() => {
                    const reviewed = service.approve({
                      requestId,
                      actorId,
                      expectedVersion: businessVersion,
                      opinion,
                      idempotencyKey: intentKey('approve', opinion)
                    });
                    return `已批准 ${reviewed.requestId}，版本 ${reviewed.businessVersion}。`;
                  })
                }
              >
                <CheckCircleOutlined /> 通过
              </button>

              <button
                type="button"
                className={styles.btnReturn}
                disabled={status !== 'submitted' || actorId !== reviewerId || !opinion.trim()}
                onClick={() =>
                  run(() => {
                    const reviewed = service.return({
                      requestId,
                      actorId,
                      expectedVersion: businessVersion,
                      opinion,
                      idempotencyKey: intentKey('return', opinion)
                    });
                    return `已退回 ${reviewed.requestId}，版本 ${reviewed.businessVersion}。`;
                  })
                }
              >
                <RollbackOutlined /> 退回补正
              </button>

              <button
                type="button"
                className={styles.btnWithdraw}
                disabled={status !== 'submitted' || actorId !== applicantId || !withdrawReason.trim()}
                onClick={() =>
                  run(() => {
                    const withdrawn = service.withdraw({
                      requestId,
                      actorId,
                      expectedVersion: businessVersion,
                      reason: withdrawReason,
                      idempotencyKey: intentKey('withdraw', withdrawReason)
                    });
                    return `已撤回 ${withdrawn.requestId}，版本 ${withdrawn.businessVersion}。`;
                  })
                }
              >
                <CloseCircleOutlined /> 撤回
              </button>
            </div>
          </div>
        )}
      </div>

      {message && (
        <p role="status" className={styles.statusMessage}>
          {message}
        </p>
      )}
    </section>
  );
}
