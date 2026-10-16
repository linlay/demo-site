import { workflowErrors } from './workflowAccess';
import type { AwcpFieldError, JsonObject } from '@app/awcp';

import { businessError, fieldError } from '../../common/awcp/contracts';
import type {
  DemoState,
  ResearchCheck,
  ResearchDocumentVersion,
  ResearchPublication,
  ResearchReport,
  ResearchReview,
  ResearchTopic
} from '../../common/fixtures/types';
import type { DemoRepository } from '../../common/store/repository';

export interface ResearchReadInput extends JsonObject {
  reportId: string;
  actorId: string;
}

export interface ResearchCreateInput extends JsonObject {
  actorId: string;
  topicTitle: string;
  idempotencyKey: string;
}

export interface ResearchMutationInput extends ResearchReadInput {
  expectedVersion: number;
  idempotencyKey: string;
}

export interface ResearchPatchInput extends ResearchMutationInput {
  title: string;
  content: string;
  citations: string[];
  disclosures: string[];
}

export interface ResearchReviewInput extends ResearchMutationInput {
  decision: 'approve' | 'return';
  reason: string;
}

export interface ResearchPublishInput extends ResearchMutationInput {
  scope: 'internal' | 'clients';
}

export interface ResearchReportResult extends JsonObject {
  reportId: string;
  status: ResearchReport['status'];
  businessVersion: number;
  documentVersion: number;
}

export interface ResearchCheckResult extends JsonObject {
  checkId: string;
  reportId: string;
  businessVersion: number;
  documentVersion: number;
  policyVersion: number;
  passed: true;
}

export interface ResearchPublishResult extends ResearchReportResult {
  publicationId: string;
  scope: ResearchPublication['scope'];
}

export interface ResearchReportView extends JsonObject {
  reportId: string;
  topicId: string;
  topicTitle: string;
  authorId: string;
  status: ResearchReport['status'];
  businessVersion: number;
  documentVersion: number;
  title: string;
  content: string;
  citations: string[];
  disclosures: string[];
  policyVersion: number;
  minimumCitations: number;
  minimumDisclosures: number;
  checked: boolean;
  reviews: JsonObject[];
  publications: JsonObject[];
  history: JsonObject[];
}

type Mutation = 'patch' | 'check' | 'submit-review' | 'review' | 'publish' | 'archive';

export class ResearchService {
  constructor(private readonly repository: DemoRepository) {}

  subscribe(listener: () => void): () => void {
    return this.repository.subscribe(listener);
  }

  list(): Array<{
    reportId: string;
    topicTitle: string;
    authorId: string;
    status: ResearchReport['status'];
    businessVersion: number;
    documentVersion: number;
  }> {
    const state = this.repository.snapshot();
    return state.researchReports.flatMap((report) => {
      const topic = state.researchTopics.find((item) => item.id === report.topicId);
      return topic
        ? [
            {
              reportId: report.id,
              topicTitle: topic.title,
              authorId: report.authorId,
              status: report.status,
              businessVersion: report.businessVersion,
              documentVersion: report.documentVersion
            }
          ]
        : [];
    });
  }

  actors(): Array<{ id: string; name: string; roles: string[] }> {
    return this.repository
      .snapshot()
      .employees.filter(
        (item) =>
          item.active && item.roles.some((role) => ['analyst', 'quality', 'compliance', 'publisher'].includes(role))
      )
      .map((item) => ({ id: item.id, name: item.name, roles: item.roles }));
  }

  validateRead(input: ResearchReadInput): AwcpFieldError[] {
    return checkRead(this.repository.snapshot(), input);
  }

  read(input: ResearchReadInput): ResearchReportView {
    const state = this.repository.snapshot();
    assertValid(checkRead(state, input));
    const report = state.researchReports.find((item) => item.id === input.reportId);
    if (!report) throw businessError('action.research-not-found', '研报不存在。');
    const topic = state.researchTopics.find((item) => item.id === report.topicId);
    const document = currentDocument(state, report);
    if (!topic || !document) throw businessError('action.research-data-missing', '研报课题或版本不存在。');
    return {
      reportId: report.id,
      topicId: topic.id,
      topicTitle: topic.title,
      authorId: report.authorId,
      status: report.status,
      businessVersion: report.businessVersion,
      documentVersion: report.documentVersion,
      title: document.title,
      content: document.content,
      citations: [...document.citations],
      disclosures: [...document.disclosures],
      policyVersion: state.researchPolicy.version,
      minimumCitations: state.researchPolicy.minimumCitations,
      minimumDisclosures: state.researchPolicy.minimumDisclosures,
      checked: !!currentCheck(state, report),
      reviews: state.researchReviews
        .filter((item) => item.reportId === report.id)
        .map((item) => ({
          stage: item.stage,
          decision: item.decision,
          documentVersion: item.documentVersion,
          policyVersion: item.policyVersion,
          reviewerId: item.reviewerId,
          reason: item.reason,
          reviewedAt: item.reviewedAt
        })),
      publications: state.researchPublications
        .filter((item) => item.reportId === report.id)
        .map((item) => ({
          id: item.id,
          documentVersion: item.documentVersion,
          policyVersion: item.policyVersion,
          scope: item.scope,
          publisherId: item.publisherId,
          publishedAt: item.publishedAt
        })),
      history: state.auditEntries
        .filter((item) => item.entityType === 'research' && item.entityId === report.id)
        .map((item) => ({
          action: item.action,
          actorId: item.actorId,
          at: item.at,
          fromStatus: item.fromStatus,
          toStatus: item.toStatus,
          businessVersion: item.businessVersion,
          note: item.note ?? null
        }))
    };
  }

  validateCreate(input: ResearchCreateInput): AwcpFieldError[] {
    const state = this.repository.snapshot();
    const record = state.idempotencyRecords.find((item) => item.key === input.idempotencyKey);
    if (record)
      return record.operation === 'research.create' && record.fingerprint === createFingerprint(input)
        ? []
        : [fieldError(['idempotencyKey'], '业务幂等键已用于其他操作或参数。')];
    return createErrors(state, input);
  }

  create(input: ResearchCreateInput): ResearchReportResult {
    return this.repository.transact((state) => {
      const record = state.idempotencyRecords.find((item) => item.key === input.idempotencyKey);
      if (record) {
        if (record.operation !== 'research.create' || record.fingerprint !== createFingerprint(input))
          throw businessError('action.idempotency-conflict', '业务幂等键已用于其他操作或参数。');
        return replayReport(record, state);
      }
      assertValid(createErrors(state, input));
      const topic: ResearchTopic = {
        id: nextId(
          'TOPIC',
          state.researchTopics.map((item) => item.id)
        ),
        title: input.topicTitle.trim(),
        analystId: input.actorId,
        createdAt: this.repository.clock.now()
      };
      const report: ResearchReport = {
        id: nextId(
          'REPORT',
          state.researchReports.map((item) => item.id)
        ),
        topicId: topic.id,
        authorId: input.actorId,
        status: 'draft',
        businessVersion: 1,
        documentVersion: 1,
        archivedAt: null
      };
      state.researchTopics.push(topic);
      state.researchReports.push(report);
      state.researchDocumentVersions.push({
        id: nextId(
          'RVER',
          state.researchDocumentVersions.map((item) => item.id)
        ),
        reportId: report.id,
        version: 1,
        title: '',
        content: '',
        citations: [],
        disclosures: [],
        authorId: input.actorId,
        createdAt: this.repository.clock.now()
      });
      audit(state, this.repository.clock.now(), report.id, 'create', input.actorId, null, report, topic.title);
      remember(state, input.idempotencyKey, 'create', createFingerprint(input), report.id, report);
      return resultFor(report);
    });
  }

  validatePatch(input: ResearchPatchInput): AwcpFieldError[] {
    return checkMutation(this.repository.snapshot(), 'patch', input);
  }

  patch(input: ResearchPatchInput): ResearchReportResult {
    return this.mutate('patch', input, (state, report) => {
      const before = report.status;
      report.documentVersion += 1;
      report.businessVersion += 1;
      report.status = 'draft';
      const document: ResearchDocumentVersion = {
        id: nextId(
          'RVER',
          state.researchDocumentVersions.map((item) => item.id)
        ),
        reportId: report.id,
        version: report.documentVersion,
        title: input.title.trim(),
        content: input.content.trim(),
        citations: input.citations.map((item) => item.trim()),
        disclosures: input.disclosures.map((item) => item.trim()),
        authorId: input.actorId,
        createdAt: this.repository.clock.now()
      };
      state.researchDocumentVersions.push(document);
      audit(state, this.repository.clock.now(), report.id, 'patch', input.actorId, before, report, document.id);
      return resultFor(report);
    });
  }

  validateCheck(input: ResearchMutationInput): AwcpFieldError[] {
    return checkMutation(this.repository.snapshot(), 'check', input);
  }

  check(input: ResearchMutationInput): ResearchCheckResult {
    return this.mutate('check', input, (state, report) => {
      const existing = currentCheck(state, report);
      if (existing) return checkResult(existing);
      const check: ResearchCheck = {
        id: nextId(
          'RCHECK',
          state.researchChecks.map((item) => item.id)
        ),
        reportId: report.id,
        documentVersion: report.documentVersion,
        businessVersion: report.businessVersion,
        policyVersion: state.researchPolicy.version,
        checkedBy: input.actorId,
        checkedAt: this.repository.clock.now()
      };
      state.researchChecks.push(check);
      audit(
        state,
        this.repository.clock.now(),
        report.id,
        'check',
        input.actorId,
        report.status,
        report,
        `规则版本 ${check.policyVersion}`
      );
      return checkResult(check);
    });
  }

  validateSubmitReview(input: ResearchMutationInput): AwcpFieldError[] {
    return checkMutation(this.repository.snapshot(), 'submit-review', input);
  }

  submitReview(input: ResearchMutationInput): ResearchReportResult {
    return this.mutate('submit-review', input, (state, report) => {
      const quality = state.employees.find((item) => item.active && item.roles.includes('quality'));
      if (!quality) throw businessError('action.quality-reviewer-missing', '没有可用质量审阅人员。');
      const before = report.status;
      report.status = 'quality-review';
      report.businessVersion += 1;
      addTodo(state, this.repository.clock.now(), report.id, quality.id, '质量审阅');
      audit(
        state,
        this.repository.clock.now(),
        report.id,
        'submit-review',
        input.actorId,
        before,
        report,
        `文档版本 ${report.documentVersion}`
      );
      return resultFor(report);
    });
  }

  validateReview(input: ResearchReviewInput): AwcpFieldError[] {
    return checkMutation(this.repository.snapshot(), 'review', input);
  }

  review(input: ResearchReviewInput): ResearchReportResult {
    return this.mutate('review', input, (state, report) => {
      const before = report.status;
      const stage = before === 'quality-review' ? 'quality' : 'compliance';
      const review: ResearchReview = {
        id: nextId(
          'RREVIEW',
          state.researchReviews.map((item) => item.id)
        ),
        reportId: report.id,
        documentVersion: report.documentVersion,
        policyVersion: state.researchPolicy.version,
        stage,
        decision: input.decision,
        reviewerId: input.actorId,
        reason: input.decision === 'return' ? input.reason.trim() : null,
        reviewedAt: this.repository.clock.now()
      };
      state.researchReviews.push(review);
      for (const todo of state.todos) {
        if (todo.sourceType === 'research' && todo.sourceId === report.id && todo.status === 'open') {
          todo.status = 'done';
          todo.completedAt = this.repository.clock.now();
        }
      }
      if (input.decision === 'return') report.status = 'returned';
      else if (stage === 'quality') {
        const compliance = state.employees.find((item) => item.active && item.roles.includes('compliance'));
        if (!compliance) throw businessError('action.compliance-reviewer-missing', '没有可用合规审阅人员。');
        report.status = 'compliance-review';
        addTodo(state, this.repository.clock.now(), report.id, compliance.id, '合规审阅');
      } else report.status = 'approved';
      report.businessVersion += 1;
      audit(
        state,
        this.repository.clock.now(),
        report.id,
        `${stage}-${input.decision}`,
        input.actorId,
        before,
        report,
        review.reason
      );
      return resultFor(report);
    });
  }

  validatePublish(input: ResearchPublishInput): AwcpFieldError[] {
    return checkMutation(this.repository.snapshot(), 'publish', input);
  }

  publish(input: ResearchPublishInput): ResearchPublishResult {
    return this.mutate('publish', input, (state, report) => {
      const before = report.status;
      const publication: ResearchPublication = {
        id: nextId(
          'PUB',
          state.researchPublications.map((item) => item.id)
        ),
        reportId: report.id,
        documentVersion: report.documentVersion,
        policyVersion: state.researchPolicy.version,
        scope: input.scope,
        publisherId: input.actorId,
        publishedAt: this.repository.clock.now()
      };
      state.researchPublications.push(publication);
      report.status = 'published';
      report.businessVersion += 1;
      audit(
        state,
        this.repository.clock.now(),
        report.id,
        'publish',
        input.actorId,
        before,
        report,
        `${publication.id} · ${publication.scope}`
      );
      return { ...resultFor(report), publicationId: publication.id, scope: publication.scope };
    });
  }

  validateArchive(input: ResearchMutationInput): AwcpFieldError[] {
    return checkMutation(this.repository.snapshot(), 'archive', input);
  }

  archive(input: ResearchMutationInput): ResearchReportResult {
    return this.mutate('archive', input, (state, report) => {
      const before = report.status;
      report.status = 'archived';
      report.businessVersion += 1;
      report.archivedAt = this.repository.clock.now();
      audit(state, this.repository.clock.now(), report.id, 'archive', input.actorId, before, report, null);
      return resultFor(report);
    });
  }

  private mutate<Result extends JsonObject>(
    operation: Mutation,
    input: ResearchMutationInput,
    change: (state: DemoState, report: ResearchReport) => Result
  ): Result {
    return this.repository.transact((state) => {
      const fingerprint = mutationFingerprint(operation, input);
      const record = state.idempotencyRecords.find((item) => item.key === input.idempotencyKey);
      if (record) {
        if (record.operation !== `research.${operation}` || record.fingerprint !== fingerprint)
          throw businessError('action.idempotency-conflict', '业务幂等键已用于其他操作或参数。');
        return replayMutation(state, operation, record) as Result;
      }
      assertValid(checkMutation(state, operation, input));
      const report = state.researchReports.find((item) => item.id === input.reportId);
      if (!report) throw businessError('action.research-not-found', '研报不存在。');
      const result = change(state, report);
      const resultId =
        operation === 'check'
          ? String(result.checkId)
          : operation === 'publish'
            ? String(result.publicationId)
            : report.id;
      remember(state, input.idempotencyKey, operation, fingerprint, resultId, report);
      return result;
    });
  }
}

function checkRead(state: DemoState, input: ResearchReadInput): AwcpFieldError[] {
  const errors: AwcpFieldError[] = [];
  if (!state.researchReports.some((item) => item.id === input.reportId))
    errors.push(fieldError(['reportId'], '研报不存在。'));
  if (
    !state.employees.some(
      (item) =>
        item.id === input.actorId &&
        item.active &&
        item.roles.some((role) => ['analyst', 'quality', 'compliance', 'publisher'].includes(role))
    )
  )
    errors.push(fieldError(['actorId'], '只有研报流程参与人可以读取。'));
  return errors;
}

function createErrors(state: DemoState, input: ResearchCreateInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const errors = keyErrors(input.idempotencyKey);
  if (!state.employees.some((item) => item.id === input.actorId && item.active && item.roles.includes('analyst')))
    errors.push(fieldError(['actorId'], '只有分析师可以建立课题。'));
  if (typeof input.topicTitle !== 'string' || !input.topicTitle.trim() || input.topicTitle.trim().length > 120)
    errors.push(fieldError(['topicTitle'], '课题名称须为 1～120 字。'));
  return errors;
}

function checkMutation(state: DemoState, operation: Mutation, input: ResearchMutationInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, operation === 'review' ? 'approve' : 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const record = state.idempotencyRecords.find((item) => item.key === input.idempotencyKey);
  if (record)
    return record.operation === `research.${operation}` && record.fingerprint === mutationFingerprint(operation, input)
      ? []
      : [fieldError(['idempotencyKey'], '业务幂等键已用于其他操作或参数。')];
  const errors = keyErrors(input.idempotencyKey);
  const report = state.researchReports.find((item) => item.id === input.reportId);
  if (!report) return [...errors, fieldError(['reportId'], '研报不存在。')];
  if (report.businessVersion !== input.expectedVersion)
    errors.push(fieldError(['expectedVersion'], '业务版本已变化，请刷新后重试。'));
  const actor = state.employees.find((item) => item.id === input.actorId && item.active);
  const authorOperation = operation === 'patch' || operation === 'check' || operation === 'submit-review';
  if (authorOperation && (actor?.id !== report.authorId || !actor.roles.includes('analyst')))
    errors.push(fieldError(['actorId'], '只有原分析师可以编辑、检查或提交。'));
  if ((operation === 'publish' || operation === 'archive') && !actor?.roles.includes('publisher'))
    errors.push(fieldError(['actorId'], '只有发布人员可以发布或归档。'));
  if (operation === 'patch') {
    if (report.status !== 'draft' && report.status !== 'returned')
      errors.push(fieldError(['reportId'], '当前状态不可编辑。'));
    const patch = input as ResearchPatchInput;
    if (typeof patch.title !== 'string' || !patch.title.trim() || patch.title.trim().length > 160)
      errors.push(fieldError(['title'], '报告标题须为 1～160 字。'));
    if (typeof patch.content !== 'string' || !patch.content.trim() || patch.content.trim().length > 20000)
      errors.push(fieldError(['content'], '报告正文须为 1～20000 字。'));
    if (!validTextList(patch.citations)) errors.push(fieldError(['citations'], '引用须为最多 20 条非空文本。'));
    if (!validTextList(patch.disclosures)) errors.push(fieldError(['disclosures'], '披露须为最多 20 条非空文本。'));
    return errors;
  }
  if (operation === 'review') {
    const review = input as ResearchReviewInput;
    if (report.status !== 'quality-review' && report.status !== 'compliance-review')
      errors.push(fieldError(['reportId'], '当前状态没有待审阅的研报。'));
    if (review.decision !== 'approve' && review.decision !== 'return')
      errors.push(fieldError(['decision'], '审阅决定无效。'));
    if (
      review.decision === 'return' &&
      (typeof review.reason !== 'string' || !review.reason.trim() || review.reason.trim().length > 200)
    )
      errors.push(fieldError(['reason'], '退回需填写 1～200 字原因。'));
    if (review.decision === 'approve' && review.reason?.trim())
      errors.push(fieldError(['reason'], '批准时请留空退回原因。'));
    if (!currentCheck(state, report)) errors.push(fieldError(['reportId'], '当前文档版本缺少有效引用与披露检查。'));
    const neededRole = report.status === 'quality-review' ? 'quality' : 'compliance';
    if (!actor?.roles.includes(neededRole)) errors.push(fieldError(['actorId'], '当前审阅阶段与角色不匹配。'));
    if (
      !state.todos.some(
        (item) =>
          item.sourceType === 'research' &&
          item.sourceId === report.id &&
          item.status === 'open' &&
          item.assigneeId === input.actorId
      )
    )
      errors.push(fieldError(['actorId'], '当前审阅人员没有该报告的待办。'));
    if (report.status === 'compliance-review' && !hasApproval(state, report, 'quality'))
      errors.push(fieldError(['reportId'], '当前文档版本缺少质量审阅批准。'));
    if (
      report.status === 'quality-review' &&
      review.decision === 'approve' &&
      !state.employees.some((item) => item.active && item.roles.includes('compliance'))
    )
      errors.push(fieldError(['reportId'], '没有可用合规审阅人员。'));
    return errors;
  }
  if (operation === 'archive') {
    if (report.status !== 'published') errors.push(fieldError(['reportId'], '只有已发布研报可归档。'));
    if (
      !state.researchPublications.some(
        (item) => item.reportId === report.id && item.documentVersion === report.documentVersion
      )
    )
      errors.push(fieldError(['reportId'], '当前文档版本没有发布记录。'));
    return errors;
  }
  if (operation === 'publish') {
    const publish = input as ResearchPublishInput;
    if (publish.scope !== 'internal' && publish.scope !== 'clients')
      errors.push(fieldError(['scope'], '发布范围无效。'));
    if (report.status !== 'approved') errors.push(fieldError(['reportId'], '只有两级审阅批准后可发布。'));
    if (!currentCheck(state, report)) errors.push(fieldError(['reportId'], '当前文档版本缺少引用与披露检查。'));
    if (!hasApproval(state, report, 'quality') || !hasApproval(state, report, 'compliance'))
      errors.push(fieldError(['reportId'], '当前文档版本缺少质量或合规审阅批准。'));
    if (state.researchPublications.some((item) => item.reportId === report.id))
      errors.push(fieldError(['reportId'], '该研报已经发布。'));
    return errors;
  }
  if (report.status !== 'draft') errors.push(fieldError(['reportId'], '当前状态不可检查或提交。'));
  const document = currentDocument(state, report);
  if (!document) return [...errors, fieldError(['reportId'], '当前文档版本不存在。')];
  if (operation === 'check') {
    if (!document.title.trim()) errors.push(fieldError(['title'], '缺少报告标题。'));
    if (!document.content.trim()) errors.push(fieldError(['content'], '缺少报告正文。'));
    if (document.citations.length < state.researchPolicy.minimumCitations || !validTextList(document.citations))
      errors.push(fieldError(['citations'], `至少需要 ${state.researchPolicy.minimumCitations} 条有效引用。`));
    if (document.disclosures.length < state.researchPolicy.minimumDisclosures || !validTextList(document.disclosures))
      errors.push(fieldError(['disclosures'], `至少需要 ${state.researchPolicy.minimumDisclosures} 条有效披露。`));
  }
  if (operation === 'submit-review') {
    if (!currentCheck(state, report))
      errors.push(fieldError(['reportId'], '请先按当前文档及规则版本完成引用与披露检查。'));
    if (!state.employees.some((item) => item.active && item.roles.includes('quality')))
      errors.push(fieldError(['reportId'], '没有可用质量审阅人员。'));
  }
  return errors;
}

function validTextList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 20 &&
    value.every((item) => typeof item === 'string' && !!item.trim() && item.trim().length <= 300)
  );
}

function currentDocument(state: DemoState, report: ResearchReport): ResearchDocumentVersion | undefined {
  return state.researchDocumentVersions.find(
    (item) => item.reportId === report.id && item.version === report.documentVersion
  );
}

function currentCheck(state: DemoState, report: ResearchReport): ResearchCheck | undefined {
  return state.researchChecks.find(
    (item) =>
      item.reportId === report.id &&
      item.documentVersion === report.documentVersion &&
      item.policyVersion === state.researchPolicy.version &&
      item.businessVersion <= report.businessVersion
  );
}

function hasApproval(state: DemoState, report: ResearchReport, stage: ResearchReview['stage']): boolean {
  return state.researchReviews.some(
    (item) =>
      item.reportId === report.id &&
      item.documentVersion === report.documentVersion &&
      item.policyVersion === state.researchPolicy.version &&
      item.stage === stage &&
      item.decision === 'approve'
  );
}

function addTodo(state: DemoState, now: string, reportId: string, assigneeId: string, title: string): void {
  state.todos.push({
    id: nextId(
      'TODO',
      state.todos.map((item) => item.id)
    ),
    title: `${title} ${reportId}`,
    assigneeId,
    sourceType: 'research',
    sourceId: reportId,
    dueAt: new Date(Date.parse(now) + 86400000).toISOString(),
    status: 'open'
  });
}

function keyErrors(value: string): AwcpFieldError[] {
  return typeof value === 'string' && /^[\w.:-]{1,128}$/.test(value)
    ? []
    : [fieldError(['idempotencyKey'], '业务幂等键格式不正确。')];
}

function createFingerprint(input: ResearchCreateInput): string {
  return JSON.stringify([input.actorId, input.topicTitle?.trim()]);
}

function mutationFingerprint(operation: Mutation, input: ResearchMutationInput): string {
  const base = [input.reportId, input.actorId, input.expectedVersion];
  if (operation === 'patch') {
    const patch = input as ResearchPatchInput;
    return JSON.stringify([...base, patch.title?.trim(), patch.content?.trim(), patch.citations, patch.disclosures]);
  }
  if (operation === 'review') {
    const review = input as ResearchReviewInput;
    return JSON.stringify([...base, review.decision, review.reason?.trim()]);
  }
  if (operation === 'publish') return JSON.stringify([...base, (input as ResearchPublishInput).scope]);
  return JSON.stringify(base);
}

function replayMutation(
  state: DemoState,
  operation: Mutation,
  record: DemoState['idempotencyRecords'][number]
): JsonObject {
  if (operation === 'check') {
    const check = state.researchChecks.find((item) => item.id === record.resultId);
    if (!check) throw new Error('Missing research check replay result.');
    return checkResult(check);
  }
  if (operation === 'publish') {
    const publication = state.researchPublications.find((item) => item.id === record.resultId);
    if (!publication || record.resultVersion === null) throw new Error('Missing publication replay result.');
    return {
      reportId: publication.reportId,
      status: 'published',
      businessVersion: record.resultVersion,
      documentVersion: publication.documentVersion,
      publicationId: publication.id,
      scope: publication.scope
    };
  }
  return replayReport(record, state);
}

function replayReport(record: DemoState['idempotencyRecords'][number], state: DemoState): ResearchReportResult {
  const report = state.researchReports.find((item) => item.id === record.resultId);
  if (!report || record.resultVersion === null || !isStatus(record.resultStatus))
    throw new Error('Invalid research report replay result.');
  return {
    reportId: report.id,
    status: record.resultStatus,
    businessVersion: record.resultVersion,
    documentVersion: record.resultDocumentVersion ?? report.documentVersion
  };
}

function isStatus(value: string): value is ResearchReport['status'] {
  return (
    value === 'draft' ||
    value === 'quality-review' ||
    value === 'compliance-review' ||
    value === 'returned' ||
    value === 'approved' ||
    value === 'published' ||
    value === 'archived'
  );
}

function remember(
  state: DemoState,
  key: string,
  operation: string,
  fingerprint: string,
  resultId: string,
  report: ResearchReport
): void {
  state.idempotencyRecords.push({
    key,
    operation: `research.${operation}`,
    fingerprint,
    resultId,
    resultVersion: report.businessVersion,
    resultStatus: report.status,
    resultDocumentVersion: report.documentVersion
  });
}

function resultFor(report: ResearchReport): ResearchReportResult {
  return {
    reportId: report.id,
    status: report.status,
    businessVersion: report.businessVersion,
    documentVersion: report.documentVersion
  };
}

function checkResult(check: ResearchCheck): ResearchCheckResult {
  return {
    checkId: check.id,
    reportId: check.reportId,
    businessVersion: check.businessVersion,
    documentVersion: check.documentVersion,
    policyVersion: check.policyVersion,
    passed: true
  };
}

function audit(
  state: DemoState,
  at: string,
  reportId: string,
  action: string,
  actorId: string,
  fromStatus: ResearchReport['status'] | null,
  report: ResearchReport,
  note: string | null
): void {
  state.auditEntries.push({
    id: nextId(
      'AUD',
      state.auditEntries.map((item) => item.id)
    ),
    entityType: 'research',
    entityId: reportId,
    action,
    actorId,
    at,
    fromStatus,
    toStatus: report.status,
    businessVersion: report.businessVersion,
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
  if (errors.length) throw businessError('action.invalid-research', errors.flatMap((item) => item.messages).join('；'));
}
