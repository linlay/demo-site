import { workflowErrors } from './workflowAccess';
import type { AwcpFieldError, JsonObject } from '@app/awcp';

import { businessError, fieldError } from '../../common/awcp/contracts';
import type {
  ClientCase,
  ClientReview,
  DemoState,
  SuitabilityAssessment,
  SuitabilityMatch,
  SuitabilityQuestionnaire
} from '../../common/fixtures/types';
import type { DemoRepository } from '../../common/store/repository';

export interface ClientReadInput extends JsonObject {
  clientId: string;
  actorId: string;
}

export interface ClientMutationInput extends ClientReadInput {
  expectedVersion: number;
  idempotencyKey: string;
}

export interface ClientPatchInput extends ClientMutationInput {
  identityDocumentNo: string;
  contactPhone: string;
  questionnaire: SuitabilityQuestionnaire;
}

export interface ClientMatchInput extends ClientMutationInput {
  productId: string;
}

export interface ClientDecisionInput extends ClientMutationInput {
  decision: 'approve' | 'return';
  reason: string;
}

export interface ClientCaseResult extends JsonObject {
  clientId: string;
  status: ClientCase['status'];
  businessVersion: number;
}

export interface AssessmentResult extends JsonObject {
  assessmentId: string;
  clientId: string;
  businessVersion: number;
  policyVersion: number;
  riskLevel: number;
}

export interface MatchResult extends JsonObject {
  matchId: string;
  clientId: string;
  businessVersion: number;
  productId: string;
  eligible: boolean;
  reason: string;
}

export interface ClientCaseView extends JsonObject {
  clientId: string;
  clientName: string;
  managerId: string;
  status: ClientCase['status'];
  businessVersion: number;
  identityDocumentNo: string | null;
  contactPhone: string | null;
  questionnaire: SuitabilityQuestionnaire | null;
  policyVersion: number;
  questionnaireMaxAgeDays: number;
  latestAssessment: AssessmentResult | null;
  matches: MatchResult[];
  reviews: Array<JsonObject>;
  history: Array<JsonObject>;
}

type Operation = 'patch' | 'evaluate' | 'match' | 'submit' | 'decide' | 'archive';

export class SuitabilityService {
  constructor(private readonly repository: DemoRepository) {}

  subscribe(listener: () => void): () => void {
    return this.repository.subscribe(listener);
  }

  list(): Array<{ clientId: string; name: string; status: ClientCase['status']; businessVersion: number }> {
    const state = this.repository.snapshot();
    return state.clientCases.flatMap((clientCase) => {
      const client = state.clients.find((item) => item.id === clientCase.clientId);
      return client
        ? [
            {
              clientId: client.id,
              name: client.name,
              status: clientCase.status,
              businessVersion: clientCase.businessVersion
            }
          ]
        : [];
    });
  }

  actors(clientId: string): Array<{ id: string; name: string }> {
    const state = this.repository.snapshot();
    const client = state.clients.find((item) => item.id === clientId);
    return state.employees
      .filter((item) => item.active && (item.id === client?.managerId || item.roles.includes('reviewer')))
      .map((item) => ({ id: item.id, name: item.name }));
  }

  products(): Array<{ id: string; name: string; riskLevel: number }> {
    return this.repository.snapshot().products.filter((item) => item.active);
  }

  validateRead(input: ClientReadInput): AwcpFieldError[] {
    return checkRead(this.repository.snapshot(), input);
  }

  read(input: ClientReadInput): ClientCaseView {
    const state = this.repository.snapshot();
    assertValid(checkRead(state, input));
    const client = state.clients.find((item) => item.id === input.clientId);
    const clientCase = state.clientCases.find((item) => item.clientId === input.clientId);
    if (!client || !clientCase) throw businessError('action.client-not-found', '客户档案不存在。');
    const assessment = [...state.suitabilityAssessments].reverse().find((item) => item.clientId === input.clientId);
    return {
      clientId: client.id,
      clientName: client.name,
      managerId: client.managerId,
      status: clientCase.status,
      businessVersion: clientCase.businessVersion,
      identityDocumentNo: clientCase.identityDocumentNo,
      contactPhone: clientCase.contactPhone,
      questionnaire: clientCase.questionnaire,
      policyVersion: state.suitabilityPolicy.version,
      questionnaireMaxAgeDays: state.suitabilityPolicy.questionnaireMaxAgeDays,
      latestAssessment: assessment ? assessmentResult(assessment) : null,
      matches: state.suitabilityMatches.filter((item) => item.clientId === client.id).map(matchResult),
      reviews: state.clientReviews
        .filter((item) => item.clientId === client.id)
        .map((item) => ({
          id: item.id,
          status: item.status,
          reviewerId: item.reviewerId,
          submittedVersion: item.submittedVersion,
          reason: item.reason,
          submittedAt: item.submittedAt,
          decidedAt: item.decidedAt
        })),
      history: state.auditEntries
        .filter((item) => item.entityType === 'client' && item.entityId === client.id)
        .map((item) => ({
          action: item.action,
          actorId: item.actorId,
          at: item.at,
          toStatus: item.toStatus,
          businessVersion: item.businessVersion,
          note: item.note ?? null
        }))
    };
  }

  validatePatch(input: ClientPatchInput): AwcpFieldError[] {
    return checkMutation(this.repository.snapshot(), this.repository.clock.now(), 'patch', input);
  }

  patch(input: ClientPatchInput): ClientCaseResult {
    return this.mutate('patch', input, (state, clientCase) => {
      const previousStatus = clientCase.status;
      clientCase.identityDocumentNo = input.identityDocumentNo.trim();
      clientCase.contactPhone = input.contactPhone.trim();
      clientCase.questionnaire = { ...input.questionnaire };
      clientCase.status = 'draft';
      clientCase.businessVersion += 1;
      audit(
        state,
        this.repository.clock.now(),
        input.clientId,
        'patch',
        input.actorId,
        previousStatus,
        clientCase,
        null
      );
      return caseResult(clientCase);
    });
  }

  validateEvaluate(input: ClientMutationInput): AwcpFieldError[] {
    return checkMutation(this.repository.snapshot(), this.repository.clock.now(), 'evaluate', input);
  }

  evaluate(input: ClientMutationInput): AssessmentResult {
    return this.mutate('evaluate', input, (state, clientCase) => {
      const existing = state.suitabilityAssessments.find(
        (item) =>
          item.clientId === input.clientId &&
          item.businessVersion === clientCase.businessVersion &&
          item.policyVersion === state.suitabilityPolicy.version
      );
      if (existing) return assessmentResult(existing);
      const questionnaire = clientCase.questionnaire;
      if (!questionnaire) throw businessError('action.questionnaire-required', '缺少风险问卷。');
      const assessment: SuitabilityAssessment = {
        id: nextId(
          'ASSESS',
          state.suitabilityAssessments.map((item) => item.id)
        ),
        clientId: input.clientId,
        businessVersion: clientCase.businessVersion,
        policyVersion: state.suitabilityPolicy.version,
        riskLevel: Math.min(questionnaire.riskTolerance, questionnaire.lossCapacity) as 1 | 2 | 3 | 4 | 5,
        evaluatedAt: this.repository.clock.now()
      };
      state.suitabilityAssessments.push(assessment);
      const client = state.clients.find((item) => item.id === input.clientId);
      if (client) client.riskLevel = assessment.riskLevel;
      audit(
        state,
        this.repository.clock.now(),
        input.clientId,
        'evaluate',
        input.actorId,
        clientCase.status,
        clientCase,
        `规则版本 ${assessment.policyVersion}`
      );
      return assessmentResult(assessment);
    });
  }

  validateMatch(input: ClientMatchInput): AwcpFieldError[] {
    return checkMutation(this.repository.snapshot(), this.repository.clock.now(), 'match', input);
  }

  match(input: ClientMatchInput): MatchResult {
    return this.mutate('match', input, (state, clientCase) => {
      const existing = state.suitabilityMatches.find(
        (item) =>
          item.clientId === input.clientId &&
          item.businessVersion === clientCase.businessVersion &&
          item.productId === input.productId &&
          item.policyVersion === state.suitabilityPolicy.version
      );
      if (existing) return matchResult(existing);
      const assessment = state.suitabilityAssessments.find(
        (item) =>
          item.clientId === input.clientId &&
          item.businessVersion === clientCase.businessVersion &&
          item.policyVersion === state.suitabilityPolicy.version
      );
      const product = state.products.find((item) => item.id === input.productId && item.active);
      if (!assessment || !product) throw businessError('action.match-prerequisite', '当前评估或产品不可用。');
      const eligible = product.riskLevel <= assessment.riskLevel;
      const match: SuitabilityMatch = {
        id: nextId(
          'MATCH',
          state.suitabilityMatches.map((item) => item.id)
        ),
        clientId: input.clientId,
        businessVersion: clientCase.businessVersion,
        policyVersion: assessment.policyVersion,
        productId: product.id,
        eligible,
        reason: eligible ? '演示规则允许匹配。' : '产品风险等级高于问卷评估等级。',
        matchedAt: this.repository.clock.now()
      };
      state.suitabilityMatches.push(match);
      audit(
        state,
        this.repository.clock.now(),
        input.clientId,
        'match',
        input.actorId,
        clientCase.status,
        clientCase,
        `${product.id}：${match.reason}`
      );
      return matchResult(match);
    });
  }

  validateSubmit(input: ClientMutationInput): AwcpFieldError[] {
    return checkMutation(this.repository.snapshot(), this.repository.clock.now(), 'submit', input);
  }

  submit(input: ClientMutationInput): ClientCaseResult {
    return this.mutate('submit', input, (state, clientCase) => {
      const previousStatus = clientCase.status;
      const reviewer = state.employees.find((item) => item.active && item.roles.includes('reviewer'));
      if (!reviewer) throw businessError('action.reviewer-not-found', '没有可用复核人员。');
      const review: ClientReview = {
        id: nextId(
          'REVIEW',
          state.clientReviews.map((item) => item.id)
        ),
        clientId: input.clientId,
        submittedVersion: clientCase.businessVersion,
        submitterId: input.actorId,
        reviewerId: reviewer.id,
        status: 'pending',
        reason: null,
        submittedAt: this.repository.clock.now(),
        decidedAt: null
      };
      state.clientReviews.push(review);
      state.todos.push({
        id: nextId(
          'TODO',
          state.todos.map((item) => item.id)
        ),
        title: `复核演示客户 ${input.clientId} 的适当性匹配`,
        assigneeId: reviewer.id,
        sourceType: 'client',
        sourceId: input.clientId,
        dueAt: new Date(Date.parse(this.repository.clock.now()) + 86400000).toISOString(),
        status: 'open'
      });
      clientCase.status = 'submitted';
      clientCase.businessVersion += 1;
      audit(
        state,
        this.repository.clock.now(),
        input.clientId,
        'review-submit',
        input.actorId,
        previousStatus,
        clientCase,
        review.id
      );
      return caseResult(clientCase);
    });
  }

  validateDecide(input: ClientDecisionInput): AwcpFieldError[] {
    return checkMutation(this.repository.snapshot(), this.repository.clock.now(), 'decide', input);
  }

  decide(input: ClientDecisionInput): ClientCaseResult {
    return this.mutate('decide', input, (state, clientCase) => {
      const previousStatus = clientCase.status;
      const review = pendingReview(state, input.clientId);
      if (!review) throw businessError('action.review-not-found', '当前客户没有待复核记录。');
      review.status = input.decision === 'approve' ? 'approved' : 'returned';
      review.reason = input.decision === 'return' ? input.reason.trim() : null;
      review.decidedAt = this.repository.clock.now();
      for (const todo of state.todos) {
        if (todo.sourceType === 'client' && todo.sourceId === input.clientId && todo.status === 'open') {
          todo.status = 'done';
          todo.completedAt = this.repository.clock.now();
        }
      }
      clientCase.status = review.status;
      clientCase.businessVersion += 1;
      audit(
        state,
        this.repository.clock.now(),
        input.clientId,
        input.decision,
        input.actorId,
        previousStatus,
        clientCase,
        review.reason
      );
      return caseResult(clientCase);
    });
  }

  validateArchive(input: ClientMutationInput): AwcpFieldError[] {
    return checkMutation(this.repository.snapshot(), this.repository.clock.now(), 'archive', input);
  }

  archive(input: ClientMutationInput): ClientCaseResult {
    return this.mutate('archive', input, (state, clientCase) => {
      const previousStatus = clientCase.status;
      clientCase.status = 'archived';
      clientCase.businessVersion += 1;
      clientCase.archivedAt = this.repository.clock.now();
      audit(
        state,
        this.repository.clock.now(),
        input.clientId,
        'archive',
        input.actorId,
        previousStatus,
        clientCase,
        null
      );
      return caseResult(clientCase);
    });
  }

  private mutate<Result extends JsonObject>(
    operation: Operation,
    input: ClientMutationInput,
    change: (state: DemoState, clientCase: ClientCase) => Result
  ): Result {
    return this.repository.transact((state) => {
      const fingerprint = mutationFingerprint(operation, input);
      const previous = state.idempotencyRecords.find((item) => item.key === input.idempotencyKey);
      if (previous) {
        if (previous.operation !== `client.${operation}` || previous.fingerprint !== fingerprint) {
          throw businessError('action.idempotency-conflict', '业务幂等键已用于其他操作或参数。');
        }
        return replayResult(state, operation, previous, input.clientId) as Result;
      }
      assertValid(checkMutation(state, this.repository.clock.now(), operation, input));
      const clientCase = state.clientCases.find((item) => item.clientId === input.clientId);
      if (!clientCase) throw businessError('action.client-not-found', '客户档案不存在。');
      const result = change(state, clientCase);
      state.idempotencyRecords.push({
        key: input.idempotencyKey,
        operation: `client.${operation}`,
        fingerprint,
        resultId:
          operation === 'evaluate'
            ? String(result.assessmentId)
            : operation === 'match'
              ? String(result.matchId)
              : input.clientId,
        resultVersion:
          operation === 'evaluate' || operation === 'match' ? input.expectedVersion : clientCase.businessVersion,
        resultStatus: clientCase.status
      });
      return result;
    });
  }
}

function checkRead(state: DemoState, input: ClientReadInput): AwcpFieldError[] {
  const errors: AwcpFieldError[] = [];
  const client = state.clients.find((item) => item.id === input.clientId);
  if (!client || !state.clientCases.some((item) => item.clientId === input.clientId))
    errors.push(fieldError(['clientId'], '客户档案不存在。'));
  const actor = state.employees.find((item) => item.id === input.actorId && item.active);
  if (!actor || (actor.id !== client?.managerId && !actor.roles.includes('reviewer')))
    errors.push(fieldError(['actorId'], '只有客户经理或复核人员可以读取。'));
  return errors;
}

function checkMutation(
  state: DemoState,
  now: string,
  operation: Operation,
  input: ClientMutationInput
): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, ['decide','archive'].includes(operation) ? 'approve' : 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const record = state.idempotencyRecords.find((item) => item.key === input.idempotencyKey);
  if (record) {
    return record.operation === `client.${operation}` && record.fingerprint === mutationFingerprint(operation, input)
      ? []
      : [fieldError(['idempotencyKey'], '业务幂等键已用于其他操作或参数。')];
  }
  const errors: AwcpFieldError[] = [];
  const client = state.clients.find((item) => item.id === input.clientId);
  const clientCase = state.clientCases.find((item) => item.clientId === input.clientId);
  if (!client || !clientCase) return [fieldError(['clientId'], '客户档案不存在。')];
  if (clientCase.businessVersion !== input.expectedVersion)
    errors.push(fieldError(['expectedVersion'], '业务版本已变化，请刷新后重试。'));
  if (typeof input.idempotencyKey !== 'string' || !/^[\w.:-]{1,128}$/.test(input.idempotencyKey))
    errors.push(fieldError(['idempotencyKey'], '业务幂等键格式不正确。'));
  const actor = state.employees.find((item) => item.id === input.actorId && item.active);
  const needsReviewer = operation === 'decide' || operation === 'archive';
  if (needsReviewer ? !actor?.roles.includes('reviewer') : actor?.id !== client.managerId)
    errors.push(fieldError(['actorId'], needsReviewer ? '只有复核人员可以处理。' : '只有客户经理可以处理。'));

  if (operation === 'patch') {
    if (clientCase.status !== 'draft' && clientCase.status !== 'returned')
      errors.push(fieldError(['clientId'], '当前状态不可补资料。'));
    const patch = input as ClientPatchInput;
    if (typeof patch.identityDocumentNo !== 'string' || !/^DEMO-[A-Z0-9-]{3,40}$/.test(patch.identityDocumentNo.trim()))
      errors.push(fieldError(['identityDocumentNo'], '演示证件编号须以 DEMO- 开头。'));
    if (typeof patch.contactPhone !== 'string' || !/^1\d{10}$/.test(patch.contactPhone.trim()))
      errors.push(fieldError(['contactPhone'], '联系电话须为 11 位数字。'));
    if (!validQuestionnaire(patch.questionnaire)) errors.push(fieldError(['questionnaire'], '问卷等级或日期无效。'));
    return errors;
  }

  if (operation === 'decide') {
    const decision = input as ClientDecisionInput;
    if (clientCase.status !== 'submitted') errors.push(fieldError(['clientId'], '只有已提交档案可复核。'));
    if (decision.decision !== 'approve' && decision.decision !== 'return')
      errors.push(fieldError(['decision'], '复核决定无效。'));
    if (
      decision.decision === 'return' &&
      (typeof decision.reason !== 'string' || !decision.reason.trim() || decision.reason.length > 200)
    )
      errors.push(fieldError(['reason'], '退回需填写 1～200 字原因。'));
    if (decision.decision === 'approve' && decision.reason?.trim())
      errors.push(fieldError(['reason'], '批准时请留空退回原因。'));
    const review = pendingReview(state, input.clientId);
    if (
      !review ||
      review.reviewerId !== input.actorId ||
      !state.todos.some(
        (item) =>
          item.sourceType === 'client' &&
          item.sourceId === input.clientId &&
          item.status === 'open' &&
          item.assigneeId === input.actorId
      )
    )
      errors.push(fieldError(['actorId'], '当前复核人员没有该客户的待办。'));
    return errors;
  }

  if (operation === 'archive') {
    if (clientCase.status !== 'approved') errors.push(fieldError(['clientId'], '只有已批准档案可归档。'));
    return errors;
  }

  if (clientCase.status !== 'draft') errors.push(fieldError(['clientId'], '当前状态不可评估、匹配或提交。'));
  if (!clientCase.identityDocumentNo) errors.push(fieldError(['identityDocumentNo'], '缺少演示证件编号。'));
  if (!clientCase.contactPhone) errors.push(fieldError(['contactPhone'], '缺少联系电话。'));
  const questionnaire = clientCase.questionnaire;
  if (!questionnaire) errors.push(fieldError(['questionnaire'], '缺少风险问卷。'));
  else if (!validQuestionnaire(questionnaire) || !freshQuestionnaire(state, now, questionnaire.answeredAt))
    errors.push(fieldError(['questionnaire', 'answeredAt'], '风险问卷已过期或日期无效。'));
  if (operation === 'evaluate') return errors;
  const assessment = state.suitabilityAssessments.find(
    (item) =>
      item.clientId === input.clientId &&
      item.businessVersion === clientCase.businessVersion &&
      item.policyVersion === state.suitabilityPolicy.version
  );
  if (!assessment) errors.push(fieldError(['clientId'], '请先按当前版本完成风险评估。'));
  if (operation === 'match') {
    const product = state.products.find((item) => item.id === (input as ClientMatchInput).productId && item.active);
    if (!product) errors.push(fieldError(['productId'], '产品不存在或已停用。'));
  }
  if (
    operation === 'submit' &&
    !state.suitabilityMatches.some(
      (item) =>
        item.clientId === input.clientId &&
        item.businessVersion === clientCase.businessVersion &&
        item.policyVersion === state.suitabilityPolicy.version &&
        item.eligible
    )
  )
    errors.push(fieldError(['clientId'], '当前版本没有符合演示规则的产品匹配。'));
  if (operation === 'submit' && !state.employees.some((item) => item.active && item.roles.includes('reviewer')))
    errors.push(fieldError(['clientId'], '没有可用复核人员。'));
  return errors;
}

function validQuestionnaire(value: unknown): value is SuitabilityQuestionnaire {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<SuitabilityQuestionnaire>;
  return (
    Number.isSafeInteger(item.riskTolerance) &&
    Number(item.riskTolerance) >= 1 &&
    Number(item.riskTolerance) <= 5 &&
    Number.isSafeInteger(item.lossCapacity) &&
    Number(item.lossCapacity) >= 1 &&
    Number(item.lossCapacity) <= 5 &&
    typeof item.answeredAt === 'string' &&
    Number.isFinite(Date.parse(item.answeredAt))
  );
}

function freshQuestionnaire(state: DemoState, now: string, answeredAt: string): boolean {
  const age = Date.parse(now) - Date.parse(answeredAt);
  return Number.isFinite(age) && age >= 0 && age <= state.suitabilityPolicy.questionnaireMaxAgeDays * 86400000;
}

function pendingReview(state: DemoState, clientId: string): ClientReview | undefined {
  return [...state.clientReviews].reverse().find((item) => item.clientId === clientId && item.status === 'pending');
}

function mutationFingerprint(operation: Operation, input: ClientMutationInput): string {
  const base = [input.clientId, input.actorId, input.expectedVersion];
  if (operation === 'patch') {
    const patch = input as ClientPatchInput;
    return JSON.stringify([...base, patch.identityDocumentNo, patch.contactPhone, patch.questionnaire]);
  }
  if (operation === 'match') return JSON.stringify([...base, (input as ClientMatchInput).productId]);
  if (operation === 'decide') {
    const decision = input as ClientDecisionInput;
    return JSON.stringify([...base, decision.decision, decision.reason?.trim()]);
  }
  return JSON.stringify(base);
}

function replayResult(
  state: DemoState,
  operation: Operation,
  record: DemoState['idempotencyRecords'][number],
  clientId: string
): JsonObject {
  if (operation === 'evaluate') {
    const assessment = state.suitabilityAssessments.find((item) => item.id === record.resultId);
    if (!assessment) throw new Error('Missing assessment replay result.');
    return assessmentResult(assessment);
  }
  if (operation === 'match') {
    const match = state.suitabilityMatches.find((item) => item.id === record.resultId);
    if (!match) throw new Error('Missing match replay result.');
    return matchResult(match);
  }
  if (record.resultVersion === null || !isCaseStatus(record.resultStatus))
    throw new Error('Invalid client replay result.');
  return { clientId, status: record.resultStatus, businessVersion: record.resultVersion };
}

function isCaseStatus(value: string): value is ClientCase['status'] {
  return (
    value === 'draft' || value === 'submitted' || value === 'returned' || value === 'approved' || value === 'archived'
  );
}

function assessmentResult(item: SuitabilityAssessment): AssessmentResult {
  return {
    assessmentId: item.id,
    clientId: item.clientId,
    businessVersion: item.businessVersion,
    policyVersion: item.policyVersion,
    riskLevel: item.riskLevel
  };
}

function matchResult(item: SuitabilityMatch): MatchResult {
  return {
    matchId: item.id,
    clientId: item.clientId,
    businessVersion: item.businessVersion,
    productId: item.productId,
    eligible: item.eligible,
    reason: item.reason
  };
}

function caseResult(item: ClientCase): ClientCaseResult {
  return { clientId: item.clientId, status: item.status, businessVersion: item.businessVersion };
}

function audit(
  state: DemoState,
  at: string,
  clientId: string,
  action: string,
  actorId: string,
  fromStatus: ClientCase['status'],
  clientCase: ClientCase,
  note: string | null
): void {
  state.auditEntries.push({
    id: nextId(
      'AUD',
      state.auditEntries.map((item) => item.id)
    ),
    entityType: 'client',
    entityId: clientId,
    action,
    actorId,
    at,
    fromStatus,
    toStatus: clientCase.status,
    businessVersion: clientCase.businessVersion,
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
  if (errors.length)
    throw businessError('action.invalid-client-case', errors.flatMap((item) => item.messages).join('；'));
}
