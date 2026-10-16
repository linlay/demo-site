import { workflowErrors } from './workflowAccess';
import type { RiskDossier, RiskInvestigationDraft } from '../../common/risk/dossier';
import { dossierErrors, validDraftShape } from './riskDossierValidation';
import type { AwcpFieldError, JsonObject } from '@app/awcp';

import { businessError, fieldError } from '../../common/awcp/contracts';
import type {
  DemoRole,
  DemoState,
  RiskAlert,
  RiskInvestigation,
  RiskOperationRecord,
  RiskRule
} from '../../common/fixtures/types';
import type { DemoRepository } from '../../common/store/repository';

export interface RiskQueryInput extends JsonObject {
  actorId: string;
  status: 'all' | RiskAlert['status'];
  ruleId: string | null;
  page: number;
  pageSize: number;
}
export interface RiskReadInput extends JsonObject {
  actorId: string;
  alertId: string;
}
export interface RiskMutationInput extends RiskReadInput {
  expectedVersion: number;
  idempotencyKey: string;
}
export interface RiskAssignInput extends RiskMutationInput {
  assigneeId: string;
}
export interface RiskEvidenceInput extends RiskMutationInput {
  evidenceId: string;
}
export type RiskInvestigationInput = RiskMutationInput & {
  dossier?: RiskDossier;
  evidenceIds: string[];
  analysis: string;
  conclusion: RiskInvestigation['conclusion'];
  proposedDisposition: RiskInvestigation['proposedDisposition'];
};
export interface RiskDraftInput extends RiskMutationInput { draft: RiskInvestigationDraft; }
export interface RiskReviewInput extends RiskMutationInput {
  decision: 'approve' | 'return';
  reason: string;
}
export interface RiskCloseInput extends RiskMutationInput {
  resolution: 'close' | 'escalate';
}
export interface RiskResult extends JsonObject {
  alertId: string;
  status: RiskAlert['status'];
  businessVersion: number;
}
type Operation = RiskOperationRecord['operation'];
type WriteInput = RiskDraftInput | RiskAssignInput | RiskEvidenceInput | RiskInvestigationInput | RiskReviewInput | RiskCloseInput;

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
): { record: RiskOperationRecord | null; errors: AwcpFieldError[] } {
  if (typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.idempotencyKey))
    return { record: null, errors: [fieldError(['idempotencyKey'], '业务幂等键格式无效。')] };
  const record = state.riskOperationRecords.find((item) => item.idempotencyKey === input.idempotencyKey);
  if (!record) return { record: null, errors: [] };
  return record.operation === operation && record.fingerprint === fingerprint(input)
    ? { record, errors: [] }
    : { record: null, errors: [fieldError(['idempotencyKey'], '业务幂等键已用于其他操作或参数。')] };
}
function ensure(errors: AwcpFieldError[]): void {
  if (errors.length)
    throw businessError(
      'action.invalid-risk-request',
      errors.flatMap((item) => item.messages).join('；'),
      errors.map((item) => ({ path: item.path, messages: item.messages }))
    );
}
function role(state: DemoState, actorId: string, allowed: DemoRole[]): AwcpFieldError[] {
  const employee = state.employees.find((item) => item.id === actorId && item.active);
  if (!employee) return [fieldError(['actorId'], '操作人不存在或已离职。')];
  return employee.roles.some((item) => allowed.includes(item))
    ? []
    : [fieldError(['actorId'], '操作人没有该风险流程角色。')];
}
const RISK_ROLES: DemoRole[] = ['risk-monitor', 'risk-investigator', 'risk-reviewer'];
function alertFor(state: DemoState, alertId: string): RiskAlert | undefined {
  return state.riskAlerts.find((item) => item.id === alertId);
}
function ruleFor(state: DemoState, alert: RiskAlert): RiskRule | undefined {
  return state.riskRules.find((item) => item.id === alert.ruleId && item.version === alert.ruleVersion);
}
function baseErrors(state: DemoState, input: RiskMutationInput, statuses: RiskAlert['status'][]): AwcpFieldError[] {
  const errors: AwcpFieldError[] = [];
  const alert = alertFor(state, input.alertId);
  if (!alert) return [fieldError(['alertId'], '风险预警不存在。')];
  if (!statuses.includes(alert.status))
    errors.push(fieldError(['alertId'], `预警状态 ${alert.status} 不允许当前操作。`));
  if (alert.businessVersion !== input.expectedVersion)
    errors.push(fieldError(['expectedVersion'], `预警版本应为 ${alert.businessVersion}。`));
  const rule = ruleFor(state, alert);
  if (!rule || alert.observedValue < rule.threshold)
    errors.push(fieldError(['alertId'], '演示规则版本不存在或指标未达到该版本阈值。'));
  return errors;
}
function textErrors(value: string, path: string, max: number): AwcpFieldError[] {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= max
    ? []
    : [fieldError([path], `内容须为 1 到 ${max} 字。`)];
}
function missingEvidence(state: DemoState, alert: RiskAlert, investigation: RiskInvestigation): string[] {
  const rule = ruleFor(state, alert);
  if (!rule || investigation.ruleVersion !== rule.version) return ['演示规则版本不一致'];
  return rule.requiredEvidenceKinds.filter(
    (kind) =>
      !investigation.evidenceIds.some((id) => {
        const evidence = state.riskEvidence.find((item) => item.id === id);
        return evidence?.alertId === alert.id && evidence.verified && evidence.kind === kind;
      })
  );
}
function audit(
  state: DemoState,
  alert: RiskAlert,
  action: string,
  actorId: string,
  fromStatus: RiskAlert['status'],
  now: string
): void {
  state.auditEntries.push({
    id: nextId(
      'AUD',
      state.auditEntries.map((item) => item.id)
    ),
    entityType: 'risk-alert',
    entityId: alert.id,
    action,
    actorId,
    at: now,
    fromStatus,
    toStatus: alert.status,
    businessVersion: alert.businessVersion
  });
}
function result(alert: RiskAlert): RiskResult {
  return { alertId: alert.id, status: alert.status, businessVersion: alert.businessVersion };
}
function requireAlert(state: DemoState, alertId: string): RiskAlert {
  const alert = alertFor(state, alertId);
  if (!alert) throw businessError('action.risk-alert-not-found', '风险预警不存在。');
  return alert;
}

export class RiskAlertService {
  constructor(private readonly repository: DemoRepository) {}
  snapshot(): DemoState {
    return this.repository.snapshot();
  }
  subscribe(listener: () => void): () => void {
    return this.repository.subscribe(listener);
  }
  validateQuery(input: RiskQueryInput): AwcpFieldError[] {
    const state = this.snapshot();
    const errors = role(state, input.actorId, RISK_ROLES);
    const statuses = ['all', 'new', 'investigating', 'pending-review', 'returned', 'approved', 'closed', 'escalated'];
    if (!statuses.includes(input.status)) errors.push(fieldError(['status'], '预警状态筛选无效。'));
    if (input.ruleId !== null && !state.riskRules.some((item) => item.id === input.ruleId))
      errors.push(fieldError(['ruleId'], '规则 ID 不存在。'));
    if (!Number.isSafeInteger(input.page) || input.page < 1) errors.push(fieldError(['page'], '页码须为正整数。'));
    if (!Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 20)
      errors.push(fieldError(['pageSize'], '每页须为 1 到 20 条。'));
    return errors;
  }
  query(input: RiskQueryInput): JsonObject {
    ensure(this.validateQuery(input));
    const alerts = this.snapshot().riskAlerts.filter(
      (item) =>
        (input.status === 'all' || item.status === input.status) &&
        (input.ruleId === null || item.ruleId === input.ruleId)
    );
    return {
      totalCount: alerts.length,
      page: input.page,
      pageSize: input.pageSize,
      alerts: alerts.slice((input.page - 1) * input.pageSize, input.page * input.pageSize).map((item) => ({
        id: item.id,
        title: item.title,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        ruleId: item.ruleId,
        ruleVersion: item.ruleVersion,
        observedValue: item.observedValue,
        status: item.status,
        assigneeId: item.assigneeId,
        businessVersion: item.businessVersion
      }))
    };
  }
  validateRead(input: RiskReadInput): AwcpFieldError[] {
    const state = this.snapshot();
    const errors = role(state, input.actorId, RISK_ROLES);
    if (!alertFor(state, input.alertId)) errors.push(fieldError(['alertId'], '风险预警不存在。'));
    return errors;
  }
  read(input: RiskReadInput): JsonObject {
    ensure(this.validateRead(input));
    const state = this.snapshot();
    const alert = requireAlert(state, input.alertId);
    const rule = ruleFor(state, alert);
    return {
      alert: { ...alert },
      rule: rule ? { ...rule, requiredEvidenceKinds: [...rule.requiredEvidenceKinds] } : null,
      evidence: state.riskEvidence.filter((item) => item.alertId === alert.id).map((item) => ({ ...item })),
      availableEvidence: state.riskEvidence
        .filter(
          (item) => item.alertId === null && item.sourceType === alert.sourceType && item.sourceId === alert.sourceId
        )
        .map((item) => ({ ...item })),
      investigations: state.riskInvestigations
        .filter((item) => item.alertId === alert.id)
        .map((item) => ({ ...item, evidenceIds: [...item.evidenceIds] })),
      reviews: state.riskReviews.filter((item) => item.alertId === alert.id).map((item) => ({ ...item })),
      history: state.auditEntries
        .filter((item) => item.entityType === 'risk-alert' && item.entityId === alert.id)
        .map((item) => ({ ...item }))
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
    change: (state: DemoState, now: string) => RiskResult
  ): RiskResult {
    return this.repository.transact((state) => {
      const key = keyCheck(state, operation, input);
      ensure(key.errors);
      if (key.record) return { ...key.record.result };
      ensure(check(state));
      const value = change(state, this.repository.clock.now());
      state.riskOperationRecords.push({
        idempotencyKey: input.idempotencyKey,
        operation,
        fingerprint: fingerprint(input),
        result: { ...value }
      });
      return value;
    });
  }
  private assignErrors(state: DemoState, input: RiskAssignInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
    const errors = [...baseErrors(state, input, ['new']), ...role(state, input.actorId, ['risk-monitor', 'risk-investigator'])];
    const actor = state.employees.find((item) => item.id === input.actorId && item.active);
    if (actor && !actor.roles.includes('risk-monitor') && input.actorId !== input.assigneeId)
      errors.push(fieldError(['assigneeId'], '调查人员只能领取本人处理的预警。'));
    if (alertFor(state, input.alertId)?.assigneeId)
      errors.push(fieldError(['alertId'], '预警已有调查人，不能重复领取或分派。'));
    if (
      !state.employees.some(
        (item) => item.id === input.assigneeId && item.active && item.roles.includes('risk-investigator')
      )
    )
      errors.push(fieldError(['assigneeId'], '调查人须为在职风险调查员。'));
    return errors;
  }
  validateAssign(input: RiskAssignInput): AwcpFieldError[] {
    return this.validateWrite(this.snapshot(), 'alert.assign', input, (state) => this.assignErrors(state, input));
  }
  assign(input: RiskAssignInput): RiskResult {
    return this.write(
      'alert.assign',
      input,
      (state) => this.assignErrors(state, input),
      (state, now) => {
        const alert = requireAlert(state, input.alertId);
        const from = alert.status;
        alert.assigneeId = input.assigneeId;
        alert.status = 'investigating';
        alert.businessVersion += 1;
        audit(state, alert, 'alert.assign', input.actorId, from, now);
        return result(alert);
      }
    );
  }
  private attachErrors(state: DemoState, input: RiskEvidenceInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
    const errors = [
      ...baseErrors(state, input, ['new', 'investigating', 'returned']),
      ...role(state, input.actorId, ['risk-monitor', 'risk-investigator'])
    ];
    const alert = alertFor(state, input.alertId);
    if (
      alert &&
      !state.employees.find((item) => item.id === input.actorId)?.roles.includes('risk-monitor') &&
      alert.assigneeId !== input.actorId
    )
      errors.push(fieldError(['actorId'], '仅监控员或该预警的调查人可补充证据。'));
    const evidence = state.riskEvidence.find((item) => item.id === input.evidenceId);
    if (
      !alert ||
      !evidence ||
      evidence.alertId !== null ||
      !evidence.verified ||
      evidence.sourceType !== alert.sourceType ||
      evidence.sourceId !== alert.sourceId
    )
      errors.push(fieldError(['evidenceId'], '证据须为同来源、已核验且未关联其他预警的材料。'));
    return errors;
  }
  validateAttach(input: RiskEvidenceInput): AwcpFieldError[] {
    return this.validateWrite(this.snapshot(), 'alert.evidence.attach', input, (state) =>
      this.attachErrors(state, input)
    );
  }
  attach(input: RiskEvidenceInput): RiskResult {
    return this.write(
      'alert.evidence.attach',
      input,
      (state) => this.attachErrors(state, input),
      (state, now) => {
        const alert = requireAlert(state, input.alertId);
        const evidence = state.riskEvidence.find((item) => item.id === input.evidenceId);
        if (!evidence) throw businessError('action.risk-evidence-not-found', '证据不存在。');
        evidence.alertId = alert.id;
        alert.businessVersion += 1;
        audit(state, alert, 'alert.evidence.attach', input.actorId, alert.status, now);
        return result(alert);
      }
    );
  }
  private draftErrors(state: DemoState, input: RiskDraftInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
    const direct = state.workflowProfile === 'coarse-roles' && state.employees.some((employee) => employee.id === input.actorId && employee.active && employee.roles.includes('workflow-initiator'));
    const errors = [...baseErrors(state, input, direct ? ['new', 'investigating', 'returned'] : ['investigating', 'returned']), ...role(state, input.actorId, ['risk-investigator'])];
    const alert = alertFor(state, input.alertId);
    if (alert?.assigneeId !== input.actorId && !(direct && alert?.status === 'new' && !alert.assigneeId)) errors.push(fieldError(['actorId'], '仅指定调查人可保存草稿。'));
    if (!validDraftShape(input.draft)) return [...errors, fieldError(['draft'], '草稿格式无效。')];
    errors.push(...dossierErrors(input.draft.dossier, state, false));
    for (const id of input.draft.evidenceIds) if (!state.riskEvidence.some((e) => e.id === id && e.alertId === input.alertId && e.verified)) errors.push(fieldError(['draft','evidenceIds'], '仅可选择已关联且已核验的证据。'));
    return errors;
  }
  validateDraft(input: RiskDraftInput): AwcpFieldError[] {
    return this.validateWrite(this.snapshot(), 'investigation.draft.save', input, (state) => this.draftErrors(state,input));
  }
  saveDraft(input: RiskDraftInput): RiskResult {
    return this.write('investigation.draft.save', input, (state) => this.draftErrors(state,input), (state, now) => {
      const alert = requireAlert(state, input.alertId);
      alert.investigationDraft = structuredClone(input.draft);
      const from = alert.status;
      if (state.workflowProfile === 'coarse-roles' && alert.status === 'new') { alert.assigneeId = input.actorId; alert.status = 'investigating'; }
      alert.businessVersion += 1;
      audit(state, alert, 'investigation.draft.save', input.actorId, from, now);
      return result(alert);
    });
  }
  private recordErrors(state: DemoState, input: RiskInvestigationInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
    const errors = [
      ...baseErrors(state, input, state.workflowProfile === 'coarse-roles' ? ['new', 'investigating', 'returned'] : ['investigating', 'returned']),
      ...role(state, input.actorId, ['risk-investigator']),
      ...textErrors(input.analysis, 'analysis', 500),
      ...(input.dossier === undefined ? [] : dossierErrors(input.dossier, state, true, input.conclusion, input.proposedDisposition))
    ];
    const alert = alertFor(state, input.alertId);
    if (alert?.assigneeId !== input.actorId && !(state.workflowProfile === 'coarse-roles' && state.employees.some((employee) => employee.id === input.actorId && employee.active && employee.roles.includes('workflow-initiator')) && alert?.status === 'new' && !alert.assigneeId)) errors.push(fieldError(['actorId'], '仅指定调查人可登记结论。'));
    if (!['false-positive', 'confirmed'].includes(input.conclusion))
      errors.push(fieldError(['conclusion'], '结论无效。'));
    if (!['close', 'escalate'].includes(input.proposedDisposition))
      errors.push(fieldError(['proposedDisposition'], '处置建议无效。'));
    if (
      !Array.isArray(input.evidenceIds) ||
      !input.evidenceIds.length ||
      new Set(input.evidenceIds).size !== input.evidenceIds.length
    )
      errors.push(fieldError(['evidenceIds'], '须提供不重复的关联证据 ID。'));
    else
      input.evidenceIds.forEach((id, index) => {
        if (!state.riskEvidence.some((item) => item.id === id && item.alertId === alert?.id && item.verified))
          errors.push(fieldError(['evidenceIds', index], '证据不存在、未核验或未关联此预警。'));
      });
    return errors;
  }
  validateRecord(input: RiskInvestigationInput): AwcpFieldError[] {
    return this.validateWrite(this.snapshot(), 'investigation.record', input, (state) =>
      this.recordErrors(state, input)
    );
  }
  record(input: RiskInvestigationInput): RiskResult {
    return this.write(
      'investigation.record',
      input,
      (state) => this.recordErrors(state, input),
      (state, now) => {
        const alert = requireAlert(state, input.alertId);
        const from = alert.status;
        alert.status = 'pending-review';
        if (state.workflowProfile === 'coarse-roles') alert.assigneeId = input.actorId;
        alert.businessVersion += 1;
        const id = nextId(
          'RINV',
          state.riskInvestigations.map((item) => item.id)
        );
        state.riskInvestigations.push({
          id,
          alertId: alert.id,
          investigatorId: input.actorId,
          evidenceIds: [...input.evidenceIds],
          analysis: input.analysis.trim(),
          ...(input.dossier ? { dossier: structuredClone(input.dossier) } : {}),
          conclusion: input.conclusion,
          proposedDisposition: input.proposedDisposition,
          ruleVersion: alert.ruleVersion,
          alertVersion: alert.businessVersion,
          recordedAt: now
        });
        delete alert.investigationDraft;
        alert.latestInvestigationId = id;
        alert.latestReviewId = null;
        audit(state, alert, 'investigation.record', input.actorId, from, now);
        return result(alert);
      }
    );
  }
  private reviewErrors(state: DemoState, input: RiskReviewInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'approve');
    if (workflowDenied.length) return workflowDenied;
    const errors = [
      ...baseErrors(state, input, ['pending-review']),
      ...role(state, input.actorId, ['risk-reviewer']),
      ...textErrors(input.reason, 'reason', 200)
    ];
    if (!['approve', 'return'].includes(input.decision)) errors.push(fieldError(['decision'], '复核决定无效。'));
    const alert = alertFor(state, input.alertId);
    if (alert?.assigneeId === input.actorId) errors.push(fieldError(['actorId'], '调查人不能复核自己的结论。'));
    const investigation = state.riskInvestigations.find((item) => item.id === alert?.latestInvestigationId);
    if (!alert || !investigation || investigation.alertId !== alert.id)
      errors.push(fieldError(['alertId'], '缺少当前调查结论。'));
    else if (input.decision === 'approve') {
      const missing = missingEvidence(state, alert, investigation);
      if (missing.length) errors.push(fieldError(['alertId'], `证据不完整：${missing.join('、')}。`));
    }
    return errors;
  }
  validateReview(input: RiskReviewInput): AwcpFieldError[] {
    return this.validateWrite(this.snapshot(), 'alert.review', input, (state) => this.reviewErrors(state, input));
  }
  review(input: RiskReviewInput): RiskResult {
    return this.write(
      'alert.review',
      input,
      (state) => this.reviewErrors(state, input),
      (state, now) => {
        const alert = requireAlert(state, input.alertId);
        const from = alert.status;
        alert.status = input.decision === 'approve' ? 'approved' : 'returned';
        alert.businessVersion += 1;
        const id = nextId(
          'RREV',
          state.riskReviews.map((item) => item.id)
        );
        state.riskReviews.push({
          id,
          alertId: alert.id,
          investigationId: alert.latestInvestigationId ?? '',
          reviewerId: input.actorId,
          decision: input.decision,
          reason: input.reason.trim(),
          alertVersion: alert.businessVersion,
          reviewedAt: now
        });
        alert.latestReviewId = id;
        audit(state, alert, 'alert.review', input.actorId, from, now);
        return result(alert);
      }
    );
  }
  private closeErrors(state: DemoState, input: RiskCloseInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
    const errors = [...baseErrors(state, input, ['approved']), ...role(state, input.actorId, ['risk-monitor'])];
    const alert = alertFor(state, input.alertId);
    const investigation = state.riskInvestigations.find((item) => item.id === alert?.latestInvestigationId);
    const review = state.riskReviews.find((item) => item.id === alert?.latestReviewId);
    if (
      !alert ||
      !investigation ||
      !review ||
      review.decision !== 'approve' ||
      review.investigationId !== investigation.id
    )
      errors.push(fieldError(['alertId'], '须先完成当前调查的独立复核。'));
    else {
      const missing = missingEvidence(state, alert, investigation);
      if (missing.length) errors.push(fieldError(['alertId'], `证据不完整：${missing.join('、')}。`));
      if (investigation.proposedDisposition !== input.resolution)
        errors.push(fieldError(['resolution'], '最终处置须与获批的调查建议一致。'));
    }
    return errors;
  }
  validateClose(input: RiskCloseInput): AwcpFieldError[] {
    return this.validateWrite(this.snapshot(), 'alert.close', input, (state) => this.closeErrors(state, input));
  }
  close(input: RiskCloseInput): RiskResult {
    return this.write(
      'alert.close',
      input,
      (state) => this.closeErrors(state, input),
      (state, now) => {
        const alert = requireAlert(state, input.alertId);
        const from = alert.status;
        alert.status = input.resolution === 'close' ? 'closed' : 'escalated';
        alert.businessVersion += 1;
        alert.completedAt = now;
        audit(state, alert, 'alert.close', input.actorId, from, now);
        return result(alert);
      }
    );
  }
}
