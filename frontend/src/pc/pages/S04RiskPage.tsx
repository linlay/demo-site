import { useCurrentActor, useCurrentUser } from '../../app/currentUserContext';
import { Modal } from 'antd';
import { useWorkflowAction as useAwcpAction } from '../../app/useWorkflowAction';
import type { AwcpActionRegistration, AwcpFieldError } from '@app/awcp';
import { useEffect, useState, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import {
  RISK_ASSIGN_SCHEMA,
  RISK_CLOSE_SCHEMA,
  RISK_EVIDENCE_SCHEMA,
  RISK_INVESTIGATION_SCHEMA,
  RISK_QUERY_SCHEMA,
  RISK_READ_SCHEMA,
  RISK_REVIEW_SCHEMA
} from '../../common/awcp/riskSchemas';
import type { DemoRepository } from '../../common/store/repository';
import {
  RiskAlertService,
  type RiskAssignInput,
  type RiskCloseInput,
  type RiskEvidenceInput,
  type RiskInvestigationInput,
  type RiskQueryInput,
  type RiskReadInput,
  type RiskReviewInput
} from '../service/riskAlertService';
import { usePreferences } from '../../common/preferences/context';
import { emptyDossier, type RiskInvestigationDraft } from '../../common/risk/dossier';
import { RISK_SAVE_DRAFT_SCHEMA } from '../../common/awcp/riskDossierSchemas';
import type { RiskDraftInput } from '../service/riskAlertService';
import { RiskDossierEditor } from '../components/risk/RiskDossierEditor';
import { RiskDossierPreview } from '../components/risk/RiskDossierPreview';
import styles from '../components/risk/RiskForm.module.css';

const QUERY: RiskQueryInput = { actorId: 'EMP-006', status: 'all', ruleId: null, page: 1, pageSize: 10 };
const READ: RiskReadInput = { actorId: 'EMP-006', alertId: 'RALT-001' };
const ASSIGN: RiskAssignInput = {
  actorId: 'EMP-006',
  alertId: 'RALT-001',
  assigneeId: 'EMP-005',
  expectedVersion: 1,
  idempotencyKey: 's04-assign-example'
};
const ATTACH: RiskEvidenceInput = {
  actorId: 'EMP-006',
  alertId: 'RALT-002',
  evidenceId: 'REVD-004',
  expectedVersion: 1,
  idempotencyKey: 's04-attach-example'
};
const RECORD: RiskInvestigationInput = {
  actorId: 'EMP-005',
  alertId: 'RALT-003',
  evidenceIds: ['REVD-005', 'REVD-006'],
  analysis: '已补充核对虚构活动和身份来源，确认属于演示误报。',
  conclusion: 'false-positive',
  proposedDisposition: 'close',
  expectedVersion: 4,
  idempotencyKey: 's04-record-example'
};
const REVIEW: RiskReviewInput = {
  actorId: 'EMP-004',
  alertId: 'RALT-005',
  decision: 'approve',
  reason: '证据和分析齐全。',
  expectedVersion: 3,
  idempotencyKey: 's04-review-example'
};
const CLOSE: RiskCloseInput = {
  actorId: 'EMP-006',
  alertId: 'RALT-004',
  resolution: 'escalate',
  expectedVersion: 4,
  idempotencyKey: 's04-close-example'
};

function guide(purpose: string, prerequisites: string, effects: string): string {
  return describeAction({
    purpose,
    prerequisites,
    parameters: '提供虚构预警、人员、证据 ID；写入须提供当前 businessVersion 与稳定业务幂等键。',
    effects,
    result: '返回预警 ID、状态和新业务版本；只读返回带版本规则、证据、调查、复核与审计历史。',
    failures: '角色、证据、状态、规则版本或业务版本不符时返回字段错误，不写入。'
  });
}

function key(): string {
  return `s04-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function S04RiskPage({
  repository,
  objectId
}: {
  repository: DemoRepository;
  objectId?: string;
}): ReactElement {
  const { t, locale } = usePreferences();
  const [service] = useState(() => new RiskAlertService(repository));
  const [, setRevision] = useState(0);

  useEffect(() => service.subscribe(() => setRevision((value) => value + 1)), [service]);

  const actorId = useCurrentActor('EMP-006');
  const identity = useCurrentUser();
  const alertId = objectId ?? 'RALT-001';
  const initialAlert = service.snapshot().riskAlerts.find((r) => r.id === alertId);
  const initialInvestigation = service
    .snapshot()
    .riskInvestigations.find((r) => r.id === initialAlert?.latestInvestigationId);
  const initial: RiskInvestigationDraft = initialAlert?.investigationDraft ?? {
    analysis: initialInvestigation?.analysis ?? '',
    conclusion: initialInvestigation?.conclusion ?? '',
    proposedDisposition: initialInvestigation?.proposedDisposition ?? '',
    evidenceIds: initialInvestigation?.evidenceIds ?? [],
    dossier: initialInvestigation?.dossier ?? emptyDossier()
  };
  const [dossier, setDossier] = useState(() => structuredClone(initial.dossier));
  const [editVersion, setEditVersion] = useState(initialAlert?.businessVersion ?? 1);
  const [savedSignature, setSavedSignature] = useState(JSON.stringify(initial));
  const [errors, setErrors] = useState<AwcpFieldError[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [assigneeId, setAssigneeId] = useState('');
  const [evidenceId, setEvidenceId] = useState('');
  const [evidenceIds, setEvidenceIds] = useState(initial.evidenceIds.join(','));
  const [analysis, setAnalysis] = useState(initial.analysis);
  const [conclusion, setConclusion] = useState<'' | RiskInvestigationInput['conclusion']>(
    initial.conclusion as '' | RiskInvestigationInput['conclusion']
  );
  const [proposedDisposition, setProposedDisposition] = useState<'' | RiskInvestigationInput['proposedDisposition']>(
    initial.proposedDisposition as '' | RiskInvestigationInput['proposedDisposition']
  );
  const [decision, setDecision] = useState<'' | RiskReviewInput['decision']>('');
  const [reason, setReason] = useState('');
  const [resolution, setResolution] = useState<'' | RiskCloseInput['resolution']>('');
  const [message, setMessage] = useState('');

  const state = service.snapshot();
  const alert = state.riskAlerts.find((item) => item.id === alertId);
  const rule = state.riskRules.find((item) => item.id === alert?.ruleId && item.version === alert.ruleVersion);
  const linked = state.riskEvidence.filter((item) => item.alertId === alertId);
  const available = state.riskEvidence.filter(
    (item) => item.alertId === null && item.sourceType === alert?.sourceType && item.sourceId === alert.sourceId
  );
  const investigation = state.riskInvestigations.find((item) => item.id === alert?.latestInvestigationId);
  const history = state.auditEntries.filter((item) => item.entityType === 'risk-alert' && item.entityId === alertId);

  function run(task: () => { alertId: string; status: string; businessVersion: number }): boolean {
    try {
      const result = task();
      setEditVersion(result.businessVersion);
      setErrors([]);
      setMessage(
        `${result.alertId} · ${t(statusNames[result.status] ?? result.status)} · ${t('业务版本')} ${result.businessVersion}`
      );
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败。');
      return false;
    }
  }

  const queryAction: AwcpActionRegistration<RiskQueryInput> = {
    action: 'securities.alert.query',
    title: '筛选风险预警',
    description: guide('按状态与演示规则筛选预警。', '在职风险流程人员；合法分页。', '只读，不改变预警状态。'),
    inputSchema: RISK_QUERY_SCHEMA,
    examples: [QUERY],
    validate: (args) => service.validateQuery(args),
    invoke: (args) => completed(service.query(args))
  };
  useAwcpAction(queryAction);

  const readAction: AwcpActionRegistration<RiskReadInput> = {
    action: 'securities.alert.read',
    title: '读取规则、证据与历史',
    description: guide(
      '读取单张预警的指标、规则版本、证据、调查、复核和审计。',
      '在职风险流程人员，预警存在。',
      '只读。'
    ),
    inputSchema: RISK_READ_SCHEMA,
    examples: [READ],
    validate: (args) => service.validateRead(args),
    invoke: (args) => completed(service.read(args))
  };
  useAwcpAction(readAction);

  const assignAction: AwcpActionRegistration<RiskAssignInput> = {
    action: 'securities.alert.assign',
    title: '分派预警调查',
    description: guide(
      '将新预警分派给在职调查员，或由调查员领取本人处理。',
      '未领取的新预警及当前版本；风险监控人员可分派，调查人员仅可领取给自己。',
      '记录实际办理人与调查人，状态改为 investigating；保留版本和幂等检查。'
    ),
    inputSchema: RISK_ASSIGN_SCHEMA,
    examples: [ASSIGN],
    validate: (args) => service.validateAssign(args),
    invoke: (args) => completed(service.assign(args))
  };
  useAwcpAction(assignAction);

  const attachAction: AwcpActionRegistration<RiskEvidenceInput> = {
    action: 'securities.alert.evidence.attach',
    title: '补充核验证据',
    description: guide(
      '为预警关联同来源的已核验证据。',
      '监控员或指定调查员；证据尚未关联其他预警。',
      '保留证据 ID 和版本审计，不覆盖历史调查。'
    ),
    inputSchema: RISK_EVIDENCE_SCHEMA,
    examples: [ATTACH],
    validate: (args) => service.validateAttach(args),
    invoke: (args) => completed(service.attach(args))
  };
  useAwcpAction(attachAction);

  const recordAction: AwcpActionRegistration<RiskInvestigationInput> = {
    action: 'securities.investigation.record',
    title: '登记调查结论与处置建议',
    description: guide(
      '在分派或退回状态登记分析、结论、处置建议和证据快照。',
      '指定调查员、至少一份已关联核验证据及当前版本。',
      '生成新调查记录并转为 pending-review；旧调查和退回记录保留。'
    ),
    inputSchema: RISK_INVESTIGATION_SCHEMA,
    examples: [
      RECORD,
      {
        ...RECORD,
        idempotencyKey: 's04-complex-record-example',
        dossier: {
          ...emptyDossier(),
          periodStart: '2026-09-18',
          periodEnd: '2026-09-19',
          riskLevel: 'medium',
          methods: ['system', 'documents'],
          checks: [
            {
              id: 'demo-check-1',
              accountRef: 'DEMO-ACCOUNT-002',
              market: 'SZ',
              instrument: 'DEMO-SZ-001',
              tradeDate: '2026-09-18',
              direction: 'buy',
              amountCents: 125000,
              finding: 'normal',
              note: '虚构流水与演示材料一致。'
            }
          ]
        }
      }
    ],
    validate: (args) => service.validateRecord(args),
    invoke: (args) => completed(service.record(args))
  };
  useAwcpAction(recordAction);

  const draftAction: AwcpActionRegistration<RiskDraftInput> = {
    action: 'securities.investigation.draft.save',
    title: '保存复杂调查表单草稿',
    description: guide(
      '保存调查主表、核查明细、处置措施和选用证据。',
      '指定调查人、调查中或退回状态、当前业务版本。',
      '保存未完成草稿并更新业务版本；不转入复核。'
    ),
    inputSchema: RISK_SAVE_DRAFT_SCHEMA,
    examples: [
      {
        actorId: 'EMP-005',
        alertId: 'RALT-003',
        expectedVersion: 4,
        idempotencyKey: 's04-draft-example',
        draft: { analysis: '', conclusion: '', proposedDisposition: '', evidenceIds: [], dossier: emptyDossier() }
      }
    ],
    validate: (args) => service.validateDraft(args),
    invoke: (args) => completed(service.saveDraft(args))
  };
  useAwcpAction(draftAction);

  const reviewAction: AwcpActionRegistration<RiskReviewInput> = {
    action: 'securities.alert.review',
    title: '独立复核或退回',
    description: guide(
      '复核当前调查，批准或说明原因退回。',
      '独立复核员、pending-review；批准须满足该版本规则所需证据。',
      '写入复核历史，转 approved 或 returned。'
    ),
    inputSchema: RISK_REVIEW_SCHEMA,
    examples: [REVIEW],
    validate: (args) => service.validateReview(args),
    invoke: (args) => completed(service.review(args))
  };
  useAwcpAction(reviewAction);

  const closeAction: AwcpActionRegistration<RiskCloseInput> = {
    action: 'securities.alert.close',
    title: '关闭或升级预警',
    description: guide(
      '执行已获批的关闭或升级建议。',
      '风险监控员、当前调查已独立复核批准且证据齐全。',
      '保存最终 closed 或 escalated 状态、完成时间和审计。'
    ),
    inputSchema: RISK_CLOSE_SCHEMA,
    examples: [CLOSE],
    validate: (args) => service.validateClose(args),
    invoke: (args) => completed(service.close(args))
  };
  useAwcpAction(closeAction);

  const actor = state.employees.find((e) => e.id === actorId);
  const simpleWorkflow = state.workflowProfile === 'coarse-roles';
  const canAssign =
    actor?.active && actor.roles.includes('risk-monitor') && alert?.status === 'new' && !alert.assigneeId;
  const canClaim =
    actor?.active && actor.roles.includes('risk-investigator') && alert?.status === 'new' && !alert.assigneeId;
  const availablePeople = state.employees.filter(
    (employee) => employee.active && (!identity || identity.employees.some((item) => item.id === employee.id))
  );
  const investigators = availablePeople.filter((employee) => employee.roles.includes('risk-investigator'));
  const monitors = availablePeople.filter((employee) => employee.roles.includes('risk-monitor'));
  const reviewers = availablePeople.filter(
    (employee) => employee.roles.includes('risk-reviewer') && employee.id !== alert?.assigneeId
  );
  const assigned = availablePeople.find((employee) => employee.id === alert?.assigneeId);
  const canEdit =
    !!actor?.roles.includes('risk-investigator') &&
    (alert?.assigneeId === actorId || (simpleWorkflow && alert?.status === 'new' && !alert.assigneeId)) &&
    ['new', 'investigating', 'returned'].includes(alert?.status ?? '');
  const canReview =
    !!actor?.roles.includes('risk-reviewer') && alert?.assigneeId !== actorId && alert?.status === 'pending-review';
  const canClose = !!actor?.roles.includes('risk-monitor') && alert?.status === 'approved';
  const stale = !!alert && editVersion !== alert.businessVersion;
  const draft: RiskInvestigationDraft = {
    analysis,
    conclusion,
    proposedDisposition,
    evidenceIds: evidenceIds.split(',').filter(Boolean),
    dossier
  };
  const draftChanged = JSON.stringify(draft) !== savedSignature;
  const statusNames: Record<string, string> = {
    new: simpleWorkflow ? '待填写' : '待领取',
    investigating: '调查中',
    returned: '退回补正',
    'pending-review': '待复核',
    approved: '待执行',
    closed: '已关闭',
    escalated: '已升级'
  };
  const kindNames: Record<string, string> = {
    'activity-log': '活动流水',
    'identity-check': '身份核验',
    'project-metric': '项目指标',
    'review-note': '复核材料'
  };
  const source =
    alert?.sourceType === 'client'
      ? state.clients.find((c) => c.id === alert.sourceId)
      : state.ibProjects.find((p) => p.id === alert?.sourceId);
  const sourceName = source ? ('name' in source ? String(source.name) : String(source.title)) : '—';
  const stage = ['new', 'investigating', 'returned'].includes(alert?.status ?? '')
    ? 0
    : alert?.status === 'pending-review'
      ? 1
      : 2;

  function loadSaved() {
    const current = service.snapshot().riskAlerts.find((r) => r.id === alertId);
    const past = service.snapshot().riskInvestigations.find((r) => r.id === current?.latestInvestigationId);
    const value: RiskInvestigationDraft = current?.investigationDraft ?? {
      analysis: past?.analysis ?? '',
      conclusion: past?.conclusion ?? '',
      proposedDisposition: past?.proposedDisposition ?? '',
      evidenceIds: past?.evidenceIds ?? [],
      dossier: past?.dossier ?? emptyDossier()
    };
    setAnalysis(value.analysis);
    setConclusion(value.conclusion as typeof conclusion);
    setProposedDisposition(value.proposedDisposition as typeof proposedDisposition);
    setEvidenceIds(value.evidenceIds.join(','));
    setDossier(structuredClone(value.dossier));
    setEditVersion(current?.businessVersion ?? 1);
    setSavedSignature(JSON.stringify(value));
    setErrors([]);
  }
  function saveDraft() {
    const input: RiskDraftInput = { actorId, alertId, expectedVersion: editVersion, idempotencyKey: key(), draft };
    const invalid = service.validateDraft(input);
    setErrors(invalid);
    if (invalid.length) return;
    if (run(() => service.saveDraft(input))) setSavedSignature(JSON.stringify(draft));
  }
  function submitDossier() {
    const input: RiskInvestigationInput = {
      actorId,
      alertId,
      expectedVersion: editVersion,
      idempotencyKey: key(),
      analysis,
      conclusion: conclusion as RiskInvestigationInput['conclusion'],
      proposedDisposition: proposedDisposition as RiskInvestigationInput['proposedDisposition'],
      evidenceIds: draft.evidenceIds,
      dossier
    };
    const invalid = service.validateRecord(input);
    setErrors(invalid);
    if (invalid.length) return;
    if (run(() => service.record(input))) setSavedSignature(JSON.stringify(draft));
  }
  function download() {
    const file = new Blob(
      [
        JSON.stringify(
          { alertId, sourceId: alert?.sourceId, businessVersion: editVersion, submitted: false, draft },
          null,
          2
        )
      ],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${alertId}-investigation-preview.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className={styles.form}>
      <header className={styles.toolbar}>
        <div>
          <h2>{alert?.title}</h2>
          <p>
            {alertId} · {t('业务版本')} {alert?.businessVersion} ·{' '}
            <span className={styles.status}>{t(statusNames[alert?.status ?? 'new'])}</span>
          </p>
        </div>
      </header>
      <nav className={styles.flow} aria-label={t('办理进度')}>
        {['调查填报', '独立复核', '处置归档'].map((title, index) => (
          <div
            key={title}
            className={`${styles.flowStep} ${stage === index ? styles.flowCurrent : ''}`}
            aria-current={stage === index ? 'step' : undefined}
          >
            <span>{index + 1}</span>
            <span>{t(title)}</span>
          </div>
        ))}
      </nav>
      <section className={styles.nextStep} aria-label={t('当前办理人和下一步')}>
        <div className={styles.people}>
          <span>
            {t('调查填报')}：
            <strong>{(assigned?.name ?? investigators.map((employee) => employee.name).join('、')) || '—'}</strong>
          </span>
          <span>
            {t(simpleWorkflow ? '审批' : '独立复核')}：
            <strong>{reviewers.map((employee) => employee.name).join('、') || '—'}</strong>
          </span>
          {!simpleWorkflow && (
            <span>
              {t('风险监控')}：<strong>{monitors.map((employee) => employee.name).join('、') || '—'}</strong>
            </span>
          )}
        </div>
        {alert?.status === 'new' && !simpleWorkflow ? (
          <>
            <p>{t('调查人可直接领取并填写，无需先分派。')}</p>
            <div className={styles.actionRow}>
              {canClaim && (
                <button
                  className={styles.primary}
                  type="button"
                  onClick={() =>
                    run(() =>
                      service.assign({
                        actorId,
                        alertId,
                        assigneeId: actorId,
                        expectedVersion: alert.businessVersion,
                        idempotencyKey: key()
                      })
                    )
                  }
                >
                  {t('领取并填写')}
                </button>
              )}
              {!canClaim &&
                identity &&
                investigators.map((employee) => (
                  <button
                    key={employee.id}
                    className={styles.primary}
                    type="button"
                    onClick={() => identity.changeUser(employee.id)}
                  >
                    {t('切换为')} {employee.name} · {t('填写调查表')}
                  </button>
                ))}
            </div>
            {canAssign && (
              <details className={styles.optionalAssign}>
                <summary>{t('也可分派给调查人')}</summary>
                <div className={styles.actionRow}>
                  <label className={styles.field}>
                    {t('指派调查人')}
                    <select
                      aria-label={t('调查人')}
                      value={assigneeId}
                      onChange={(event) => setAssigneeId(event.target.value)}
                    >
                      <option value="">{t('请选择')}</option>
                      {investigators.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.name} · {t('风险调查')}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className={styles.secondary}
                    type="button"
                    disabled={!assigneeId}
                    onClick={() =>
                      run(() =>
                        service.assign({
                          actorId,
                          alertId,
                          assigneeId,
                          expectedVersion: alert.businessVersion,
                          idempotencyKey: key()
                        })
                      )
                    }
                  >
                    {t('分派调查')}
                  </button>
                </div>
              </details>
            )}
          </>
        ) : canEdit ? (
          <p>{t('你正在办理该事项，可直接填写并保存草稿。')}</p>
        ) : (
          <>
            <p>
              {t(
                alert?.status === 'new'
                  ? '办理人员可直接填写调查表，提交后交审核人员审批。'
                  : ['investigating', 'returned'].includes(alert?.status ?? '')
                    ? '由指定调查人继续填写，其他用户可查看已保存内容。'
                    : alert?.status === 'pending-review'
                      ? '调查已提交，等待独立复核。'
                      : alert?.status === 'approved'
                        ? '复核已通过，等待执行处置。'
                        : '此事项已完成，可查看调查和处理记录。'
              )}
            </p>
            <div className={styles.actionRow}>
              {identity && simpleWorkflow && alert?.status === 'new' && investigators.map((employee) => (
                <button key={employee.id} className={styles.primary} type="button" onClick={() => identity.changeUser(employee.id)}>
                  {t('切换为')} {employee.name} · {t('填写调查表')}
                </button>
              ))}
              {identity && ['investigating', 'returned'].includes(alert?.status ?? '') && assigned && (
                <button className={styles.primary} type="button" onClick={() => identity.changeUser(assigned.id)}>
                  {t('切换为')} {assigned.name} · {t('继续填写')}
                </button>
              )}
              {identity &&
                alert?.status === 'pending-review' &&
                !canReview &&
                reviewers.map((employee) => (
                  <button
                    key={employee.id}
                    className={styles.primary}
                    type="button"
                    onClick={() => identity.changeUser(employee.id)}
                  >
                    {t('切换为')} {employee.name} · {t('复核调查')}
                  </button>
                ))}
              {identity &&
                alert?.status === 'approved' &&
                !canClose &&
                monitors.map((employee) => (
                  <button
                    key={employee.id}
                    className={styles.primary}
                    type="button"
                    onClick={() => identity.changeUser(employee.id)}
                  >
                    {t('切换为')} {employee.name} · {t('执行处置')}
                  </button>
                ))}
            </div>
          </>
        )}
      </section>
      {stale && (
        <div className={styles.notice} role="alert">
          {t('事项版本已变化，请载入最新保存内容后继续。')}
          <button
            className={styles.secondary}
            type="button"
            onClick={() => {
              if (!draftChanged || window.confirm(t('载入保存内容将替换当前未保存的输入，是否继续？'))) loadSaved();
            }}
          >
            {t('载入已保存内容')}
          </button>
        </div>
      )}
      {errors.length > 0 && (
        <div className={styles.errors} role="alert">
          <strong>{t('请检查以下内容')}</strong>
          <ul>
            {errors.map((error, index) => (
              <li key={index}>
                {error.path.includes('checks')
                  ? `${t('核查明细')} ${typeof error.path[2] === 'number' ? error.path[2] + 1 : ''}：`
                  : error.path.includes('measures')
                    ? `${t('处置措施')} ${typeof error.path[2] === 'number' ? error.path[2] + 1 : ''}：`
                    : ''}
                {error.messages.map(t).join(' ')}
              </li>
            ))}
          </ul>
        </div>
      )}
      <details className={styles.section}>
        <summary>{t('预警与申请单位信息')}</summary>
        <div className={styles.sectionBody}>
          <div className={styles.fields}>
            {[
              ['预警编号', alertId],
              ['预警名称', alert?.title ?? ''],
              ['关联客户／项目', sourceName],
              ['来源业务编号', alert?.sourceId ?? ''],
              ['监控规则', rule?.name ?? ''],
              ['规则版本', String(rule?.version ?? '')],
              ['监测指标', `${alert?.observedValue ?? ''} ${rule?.unit ?? ''}`],
              ['预警阈值', `${rule?.threshold ?? ''} ${rule?.unit ?? ''}`],
              ['预警生成时间', alert?.createdAt ? new Date(alert.createdAt).toLocaleString(locale) : ''],
              ['指定调查人', state.employees.find((e) => e.id === alert?.assigneeId)?.name ?? t('未分派')]
            ].map(([title, value]) => (
              <label className={styles.field} key={title}>
                <span>{t(title)}</span>
                <input value={value} readOnly />
              </label>
            ))}
          </div>
        </div>
      </details>
      {(alert?.status !== 'new' || simpleWorkflow) && (
        <>
          <RiskDossierEditor
            value={dossier}
            onChange={setDossier}
            disabled={!canEdit || stale}
            employees={state.employees}
            errors={errors}
          />
          <details className={styles.section} open>
            <summary>{t('证据材料与核验清单')}</summary>
            <div className={styles.sectionBody}>
              <p>
                {t('规则要求证据')}：{rule?.requiredEvidenceKinds.map((k) => t(kindNames[k])).join('、')}
              </p>
              <div className={styles.tableScroll}>
                <table className={styles.readTable}>
                  <thead>
                    <tr>
                      {['选用', '证据编号', '材料类别', '材料摘要', '核验状态'].map((v) => (
                        <th key={v}>{t(v)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {linked.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`${t('选用证据')} ${e.id}`}
                            disabled={!canEdit || stale || !e.verified}
                            checked={draft.evidenceIds.includes(e.id)}
                            onChange={(event) =>
                              setEvidenceIds(
                                (event.target.checked
                                  ? [...draft.evidenceIds, e.id]
                                  : draft.evidenceIds.filter((id) => id !== e.id)
                                ).join(',')
                              )
                            }
                          />
                        </td>
                        <td>{e.id}</td>
                        <td>{t(kindNames[e.kind])}</td>
                        <td>{e.summary}</td>
                        <td>{t(e.verified ? '已核验' : '未核验')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={styles.actionRow}>
                <label className={styles.field}>
                  {t('可补充证据库')}
                  <select
                    aria-label={t('可补充证据')}
                    value={evidenceId}
                    onChange={(e) => setEvidenceId(e.target.value)}
                  >
                    <option value="">{t('请选择')}</option>
                    {available.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.id} · {t(kindNames[e.kind])} · {t(e.verified ? '已核验' : '未核验')}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className={styles.secondary}
                  type="button"
                  disabled={!evidenceId || !(actor?.roles.includes('risk-monitor') || canEdit)}
                  onClick={() =>
                    run(() =>
                      service.attach({
                        actorId,
                        alertId,
                        evidenceId,
                        expectedVersion: alert?.businessVersion ?? 0,
                        idempotencyKey: key()
                      })
                    )
                  }
                >
                  {t('补充证据')}
                </button>
              </div>
            </div>
          </details>
          <details className={styles.section} open>
            <summary>{t('调查结论与处置意见')}</summary>
            <div className={styles.sectionBody}>
              <label className={styles.field}>
                <span>
                  <b className={styles.required}>*</b>
                  {t('调查分析')}
                </span>
                <textarea
                  aria-label={t('调查分析')}
                  rows={5}
                  maxLength={500}
                  disabled={!canEdit || stale}
                  value={analysis}
                  onChange={(e) => setAnalysis(e.target.value)}
                />
                <small>{analysis.length}/500</small>
              </label>
              <div className={styles.fields}>
                <label className={styles.field}>
                  <span>
                    <b className={styles.required}>*</b>
                    {t('调查结论')}
                  </span>
                  <select
                    aria-label={t('调查结论')}
                    disabled={!canEdit || stale}
                    value={conclusion}
                    onChange={(e) => {
                      const next = e.target.value as typeof conclusion;
                      setConclusion(next);
                      if (next === 'false-positive') setProposedDisposition('close');
                    }}
                  >
                    <option value="">{t('请选择')}</option>
                    <option value="false-positive">{t('误报')}</option>
                    <option value="confirmed">{t('确认预警')}</option>
                  </select>
                </label>
                <label className={styles.field}>
                  <span>
                    <b className={styles.required}>*</b>
                    {t('处置建议')}
                  </span>
                  <select
                    aria-label={t('处置建议')}
                    disabled={!canEdit || stale}
                    value={proposedDisposition}
                    onChange={(e) => setProposedDisposition(e.target.value as typeof proposedDisposition)}
                  >
                    <option value="">{t('请选择')}</option>
                    <option value="close">{t('关闭')}</option>
                    <option value="escalate" disabled={conclusion === 'false-positive'}>
                      {t('升级')}
                    </option>
                  </select>
                </label>
              </div>
            </div>
          </details>
          {investigation && (
            <details className={styles.section}>
              <summary>
                {t('已提交调查快照')} · {investigation.id}
              </summary>
              <div className={styles.sectionBody}>
                {investigation.dossier ? (
                  <RiskDossierPreview
                    draft={{
                      analysis: investigation.analysis,
                      conclusion: investigation.conclusion,
                      proposedDisposition: investigation.proposedDisposition,
                      evidenceIds: investigation.evidenceIds,
                      dossier: investigation.dossier
                    }}
                    employees={state.employees}
                  />
                ) : (
                  <p>
                    {investigation.analysis} · {investigation.evidenceIds.join('、')}
                  </p>
                )}
              </div>
            </details>
          )}
          <details className={styles.section} open={canReview || canClose}>
            <summary>{t('独立复核与最终处置')}</summary>
            <div className={styles.sectionBody}>
              <div className={styles.fields}>
                <label className={styles.field}>
                  {t('复核决定')}
                  <select
                    aria-label={t('复核决定')}
                    disabled={!canReview}
                    value={decision}
                    onChange={(e) => setDecision(e.target.value as typeof decision)}
                  >
                    <option value="">{t('请选择')}</option>
                    <option value="approve">{t('批准')}</option>
                    <option value="return">{t('退回')}</option>
                  </select>
                </label>
                <label className={styles.field}>
                  {t('最终处置')}
                  <select
                    aria-label={t('最终处置')}
                    disabled={!canClose}
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value as typeof resolution)}
                  >
                    <option value="">{t('请选择')}</option>
                    <option value="close">{t('关闭')}</option>
                    <option value="escalate">{t('升级')}</option>
                  </select>
                </label>
              </div>
              <label className={styles.field}>
                {t('复核意见')}
                <textarea
                  aria-label={t('复核意见')}
                  rows={3}
                  maxLength={200}
                  disabled={!canReview}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <div className={styles.actionRow}>
                <button
                  className={styles.primary}
                  type="button"
                  disabled={!canReview || !decision || !reason.trim()}
                  onClick={() =>
                    run(() =>
                      service.review({
                        actorId,
                        alertId,
                        decision: decision as RiskReviewInput['decision'],
                        reason,
                        expectedVersion: alert?.businessVersion ?? 0,
                        idempotencyKey: key()
                      })
                    )
                  }
                >
                  {t('复核调查')}
                </button>
                <button
                  className={styles.secondary}
                  type="button"
                  disabled={!canClose || !resolution}
                  onClick={() =>
                    run(() =>
                      service.close({
                        actorId,
                        alertId,
                        resolution: resolution as RiskCloseInput['resolution'],
                        expectedVersion: alert?.businessVersion ?? 0,
                        idempotencyKey: key()
                      })
                    )
                  }
                >
                  {t('执行处置')}
                </button>
              </div>
            </div>
          </details>
          <details className={styles.section}>
            <summary>
              {t('复核记录与流程历史')} · {history.length}
            </summary>
            <div className={styles.sectionBody}>
              <ol className={styles.history}>
                {state.riskReviews
                  .filter((r) => r.alertId === alertId)
                  .map((r) => (
                    <li key={r.id}>
                      {r.id} · {t(r.decision === 'approve' ? '批准' : '退回')} · {r.reason}
                      <small>
                        {r.reviewerId} · {r.reviewedAt}
                      </small>
                    </li>
                  ))}
                {history.map((r) => (
                  <li key={r.id}>
                    {t(statusNames[r.fromStatus ?? 'new'] ?? r.fromStatus ?? '待分派')} →{' '}
                    {t(statusNames[r.toStatus] ?? r.toStatus)}
                    <small>
                      {r.action} · {r.actorId} · {r.at} · v{r.businessVersion}
                    </small>
                  </li>
                ))}
              </ol>
            </div>
          </details>
        </>
      )}
      {message && (
        <div className={styles.message} role="status">
          {message}
        </div>
      )}
      {(alert?.status !== 'new' || simpleWorkflow) && (
        <footer className={styles.stickyActions}>
          <span>
            {t(draftChanged ? '有未保存的修改' : '当前内容已载入')} · {t('核查明细')} {dossier.checks.length} ·{' '}
            {t('处置措施')} {dossier.measures.length}
          </span>
          <button type="button" className={styles.secondary} disabled={!canEdit || stale} onClick={saveDraft}>
            {t('保存草稿')}
          </button>
          <button type="button" className={styles.secondary} onClick={() => setPreviewing(true)}>
            {t('预览结果')}
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={!canEdit || stale || !analysis.trim() || !conclusion || !proposedDisposition}
            onClick={submitDossier}
          >
            {t('登记调查')}
          </button>
        </footer>
      )}
      <Modal
        title={t('调查申请预览')}
        open={previewing}
        width={1050}
        onCancel={() => setPreviewing(false)}
        footer={
          <>
            <button type="button" className={styles.secondary} onClick={() => setPreviewing(false)}>
              {t('继续填写')}
            </button>
            <button type="button" className={styles.primary} onClick={download}>
              {t('下载表单数据')}
            </button>
          </>
        }
      >
        <p>{t('预览不会提交或改变流程状态。')}</p>
        <RiskDossierPreview draft={draft} employees={state.employees} />
      </Modal>
    </div>
  );
}
