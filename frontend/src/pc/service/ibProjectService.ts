import { workflowErrors } from './workflowAccess';
import type { AwcpFieldError, JsonObject } from '@app/awcp';

import { businessError, fieldError } from '../../common/awcp/contracts';
import type {
  DemoState,
  IbAssignment,
  IbFinding,
  IbProject,
  IbQualitySubmission,
  IbReview,
  IbWorkpaperKind,
  IbWorkpaperVersion
} from '../../common/fixtures/types';
import type { DemoRepository } from '../../common/store/repository';

export interface IbReadInput extends JsonObject {
  projectId: string;
  actorId: string;
}

export interface IbCreateInput extends JsonObject {
  issuerId: string;
  title: string;
  actorId: string;
  idempotencyKey: string;
}

export interface IbMutationInput extends IbReadInput {
  expectedVersion: number;
  idempotencyKey: string;
}

export interface IbAssignInput extends IbMutationInput {
  kind: IbWorkpaperKind;
  memberId: string;
}

export interface IbAttachInput extends IbMutationInput {
  kind: IbWorkpaperKind;
  assetId: string;
  summary: string;
}

export interface IbResolveInput extends IbMutationInput {
  findingId: string;
  resolution: string;
}

export interface IbReviewInput extends IbMutationInput {
  decision: 'approve' | 'return';
  reason: string;
}

export interface IbProjectResult extends JsonObject {
  projectId: string;
  status: IbProject['status'];
  businessVersion: number;
}

export interface IbAssignResult extends IbProjectResult {
  assignmentId: string;
  kind: IbWorkpaperKind;
  memberId: string;
}

export interface IbAttachResult extends IbProjectResult {
  workpaperId: string;
  kind: IbWorkpaperKind;
  workpaperVersion: number;
}

export interface IbResolveResult extends IbProjectResult {
  findingId: string;
  findingStatus: 'resolved';
}

export interface IbQualityResult extends IbProjectResult {
  submissionId: string;
  policyVersion: number;
}

export interface IbProjectView extends JsonObject {
  projectId: string;
  issuerId: string;
  issuerName: string;
  title: string;
  managerId: string;
  status: IbProject['status'];
  businessVersion: number;
  policyVersion: number;
  requiredWorkpaperKinds: IbWorkpaperKind[];
  assignments: JsonObject[];
  workpapers: JsonObject[];
  assets: JsonObject[];
  findings: JsonObject[];
  submissions: JsonObject[];
  reviews: JsonObject[];
  history: JsonObject[];
}

type Operation = 'submit' | 'assign' | 'attach' | 'resolve' | 'quality-submit' | 'review' | 'archive';

export class IbProjectService {
  constructor(private readonly repository: DemoRepository) {}

  subscribe(listener: () => void): () => void {
    return this.repository.subscribe(listener);
  }

  list(): Array<{
    projectId: string;
    title: string;
    status: IbProject['status'];
    businessVersion: number;
    managerId: string;
  }> {
    return this.repository.snapshot().ibProjects.map((item) => ({
      projectId: item.id,
      title: item.title,
      status: item.status,
      businessVersion: item.businessVersion,
      managerId: item.managerId
    }));
  }

  actors(): Array<{ id: string; name: string; roles: string[] }> {
    return this.repository
      .snapshot()
      .employees.filter(
        (item) =>
          item.active &&
          item.roles.some((role) => ['ib-manager', 'ib-member', 'ib-quality', 'ib-committee'].includes(role))
      )
      .map((item) => ({ id: item.id, name: item.name, roles: item.roles }));
  }

  issuers(): Array<{ id: string; name: string }> {
    return this.repository.snapshot().ibIssuers.map((item) => ({ id: item.id, name: item.name }));
  }

  assets(projectId: string): Array<{ assetId: string; filename: string; used: boolean }> {
    const state = this.repository.snapshot();
    return state.attachments
      .filter((item) => item.ownerId === projectId)
      .map((item) => ({
        assetId: item.assetId,
        filename: item.filename,
        used: state.ibWorkpapers.some((paper) => paper.projectId === projectId && paper.assetId === item.assetId)
      }));
  }

  validateRead(input: IbReadInput): AwcpFieldError[] {
    return checkRead(this.repository.snapshot(), input);
  }

  read(input: IbReadInput): IbProjectView {
    const state = this.repository.snapshot();
    assertValid(checkRead(state, input));
    const project = state.ibProjects.find((item) => item.id === input.projectId);
    if (!project) throw businessError('action.ib-project-not-found', '投行项目不存在。');
    const issuer = state.ibIssuers.find((item) => item.id === project.issuerId);
    if (!issuer) throw businessError('action.ib-issuer-not-found', '发行人不存在。');
    return {
      projectId: project.id,
      issuerId: issuer.id,
      issuerName: issuer.name,
      title: project.title,
      managerId: project.managerId,
      status: project.status,
      businessVersion: project.businessVersion,
      policyVersion: state.ibPolicy.version,
      requiredWorkpaperKinds: [...state.ibPolicy.requiredWorkpaperKinds],
      assignments: state.ibAssignments
        .filter((item) => item.projectId === project.id)
        .map((item) => ({ id: item.id, kind: item.kind, memberId: item.memberId, assignedAt: item.assignedAt })),
      workpapers: state.ibWorkpapers
        .filter((item) => item.projectId === project.id)
        .map((item) => ({
          id: item.id,
          kind: item.kind,
          version: item.version,
          assetId: item.assetId,
          summary: item.summary,
          memberId: item.memberId,
          businessVersion: item.businessVersion
        })),
      assets: state.attachments
        .filter((item) => item.ownerId === project.id)
        .map((item) => ({
          assetId: item.assetId,
          filename: item.filename,
          used: state.ibWorkpapers.some((paper) => paper.projectId === project.id && paper.assetId === item.assetId)
        })),
      findings: state.ibFindings
        .filter((item) => item.projectId === project.id)
        .map((item) => ({
          id: item.id,
          severity: item.severity,
          description: item.description,
          status: item.status,
          resolution: item.resolution,
          resolvedBy: item.resolvedBy
        })),
      submissions: state.ibQualitySubmissions
        .filter((item) => item.projectId === project.id)
        .map((item) => ({
          id: item.id,
          policyVersion: item.policyVersion,
          businessVersion: item.businessVersion,
          workpaperVersions: item.workpaperVersions.map((paper) => ({ kind: paper.kind, version: paper.version }))
        })),
      reviews: state.ibReviews
        .filter((item) => item.projectId === project.id)
        .map((item) => ({
          id: item.id,
          submissionId: item.submissionId,
          stage: item.stage,
          decision: item.decision,
          reason: item.reason,
          reviewerId: item.reviewerId,
          policyVersion: item.policyVersion
        })),
      history: state.auditEntries
        .filter((item) => item.entityType === 'ib-project' && item.entityId === project.id)
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

  validateCreate(input: IbCreateInput): AwcpFieldError[] {
    const state = this.repository.snapshot();
    const record = state.idempotencyRecords.find((item) => item.key === input.idempotencyKey);
    if (record)
      return record.operation === 'ib.create' && record.fingerprint === createFingerprint(input)
        ? []
        : [fieldError(['idempotencyKey'], '业务幂等键已用于其他操作或参数。')];
    return createErrors(state, input);
  }

  create(input: IbCreateInput): IbProjectResult {
    return this.repository.transact((state) => {
      const record = state.idempotencyRecords.find((item) => item.key === input.idempotencyKey);
      if (record) {
        if (record.operation !== 'ib.create' || record.fingerprint !== createFingerprint(input))
          throw businessError('action.idempotency-conflict', '业务幂等键已用于其他操作或参数。');
        return replayProject(state, record);
      }
      assertValid(createErrors(state, input));
      const project: IbProject = {
        id: nextId(
          'IBP',
          state.ibProjects.map((item) => item.id)
        ),
        issuerId: input.issuerId,
        title: input.title.trim(),
        managerId: input.actorId,
        status: 'draft',
        businessVersion: 1,
        lastReturnVersion: null,
        createdAt: this.repository.clock.now(),
        archivedAt: null
      };
      state.ibProjects.push(project);
      allocateWorkpaperAssets(state, project.id, '待提交');
      audit(state, this.repository.clock.now(), project, 'create', input.actorId, null, project.issuerId);
      remember(state, input.idempotencyKey, 'create', createFingerprint(input), project.id, project);
      return resultFor(project);
    });
  }

  validateSubmit(input: IbMutationInput): AwcpFieldError[] {
    return checkMutation(this.repository.snapshot(), 'submit', input);
  }

  submit(input: IbMutationInput): IbProjectResult {
    return this.mutate('submit', input, (state, project) => {
      const before = project.status;
      project.status = 'initiated';
      project.businessVersion += 1;
      audit(state, this.repository.clock.now(), project, 'submit', input.actorId, before, null);
      return resultFor(project);
    });
  }

  validateAssign(input: IbAssignInput): AwcpFieldError[] {
    return checkMutation(this.repository.snapshot(), 'assign', input);
  }

  assign(input: IbAssignInput): IbAssignResult {
    return this.mutate('assign', input, (state, project) => {
      const before = project.status;
      const assignment: IbAssignment = {
        id: nextId(
          'IBASG',
          state.ibAssignments.map((item) => item.id)
        ),
        projectId: project.id,
        kind: input.kind,
        memberId: input.memberId,
        assignedBy: input.actorId,
        assignedAt: this.repository.clock.now()
      };
      state.ibAssignments.push(assignment);
      project.status = 'diligence';
      project.businessVersion += 1;
      audit(
        state,
        this.repository.clock.now(),
        project,
        'assign',
        input.actorId,
        before,
        `${assignment.kind} → ${assignment.memberId}`
      );
      return {
        ...resultFor(project),
        assignmentId: assignment.id,
        kind: assignment.kind,
        memberId: assignment.memberId
      };
    });
  }

  validateAttach(input: IbAttachInput): AwcpFieldError[] {
    return checkMutation(this.repository.snapshot(), 'attach', input);
  }

  attach(input: IbAttachInput): IbAttachResult {
    return this.mutate('attach', input, (state, project) => {
      const before = project.status;
      const version =
        state.ibWorkpapers
          .filter((item) => item.projectId === project.id && item.kind === input.kind)
          .reduce((max, item) => Math.max(max, item.version), 0) + 1;
      project.status = 'diligence';
      project.businessVersion += 1;
      const workpaper: IbWorkpaperVersion = {
        id: nextId(
          'IBWP',
          state.ibWorkpapers.map((item) => item.id)
        ),
        projectId: project.id,
        kind: input.kind,
        version,
        assetId: input.assetId,
        summary: input.summary.trim(),
        memberId: input.actorId,
        businessVersion: project.businessVersion,
        submittedAt: this.repository.clock.now()
      };
      state.ibWorkpapers.push(workpaper);
      audit(
        state,
        this.repository.clock.now(),
        project,
        'attach',
        input.actorId,
        before,
        `${workpaper.kind} v${workpaper.version} · ${workpaper.assetId}`
      );
      return { ...resultFor(project), workpaperId: workpaper.id, kind: workpaper.kind, workpaperVersion: version };
    });
  }

  validateResolve(input: IbResolveInput): AwcpFieldError[] {
    return checkMutation(this.repository.snapshot(), 'resolve', input);
  }

  resolve(input: IbResolveInput): IbResolveResult {
    return this.mutate('resolve', input, (state, project) => {
      const finding = state.ibFindings.find((item) => item.id === input.findingId && item.projectId === project.id);
      if (!finding) throw businessError('action.ib-finding-not-found', '问题单不存在。');
      const before = project.status;
      finding.status = 'resolved';
      finding.resolution = input.resolution.trim();
      finding.resolvedBy = input.actorId;
      finding.resolvedAt = this.repository.clock.now();
      project.status = 'diligence';
      project.businessVersion += 1;
      audit(
        state,
        this.repository.clock.now(),
        project,
        'finding-resolve',
        input.actorId,
        before,
        `${finding.id}：${finding.resolution}`
      );
      return { ...resultFor(project), findingId: finding.id, findingStatus: 'resolved' };
    });
  }

  validateQualitySubmit(input: IbMutationInput): AwcpFieldError[] {
    return checkMutation(this.repository.snapshot(), 'quality-submit', input);
  }

  qualitySubmit(input: IbMutationInput): IbQualityResult {
    return this.mutate('quality-submit', input, (state, project) => {
      const reviewer = state.employees.find((item) => item.active && item.roles.includes('ib-quality'));
      if (!reviewer) throw businessError('action.ib-quality-reviewer-missing', '没有可用质控人员。');
      const submission: IbQualitySubmission = {
        id: nextId(
          'IBSUB',
          state.ibQualitySubmissions.map((item) => item.id)
        ),
        projectId: project.id,
        policyVersion: state.ibPolicy.version,
        businessVersion: project.businessVersion,
        workpaperVersions: state.ibPolicy.requiredWorkpaperKinds.map((kind) => {
          const paper = latestWorkpaper(state, project.id, kind);
          if (!paper) throw businessError('action.ib-workpaper-missing', `缺少 ${kind} 底稿。`);
          return { kind, version: paper.version };
        }),
        submittedAt: this.repository.clock.now()
      };
      state.ibQualitySubmissions.push(submission);
      const before = project.status;
      project.status = 'quality-review';
      project.businessVersion += 1;
      addTodo(state, this.repository.clock.now(), project.id, reviewer.id, '投行项目质控');
      audit(
        state,
        this.repository.clock.now(),
        project,
        'quality-submit',
        input.actorId,
        before,
        `${submission.id} · 规则版本 ${submission.policyVersion}`
      );
      return { ...resultFor(project), submissionId: submission.id, policyVersion: submission.policyVersion };
    });
  }

  validateReview(input: IbReviewInput): AwcpFieldError[] {
    return checkMutation(this.repository.snapshot(), 'review', input);
  }

  review(input: IbReviewInput): IbProjectResult {
    return this.mutate('review', input, (state, project) => {
      const submission = latestSubmission(state, project.id);
      if (!submission) throw businessError('action.ib-submission-not-found', '质控提交记录不存在。');
      const before = project.status;
      const stage = before === 'quality-review' ? 'quality' : 'committee';
      const review: IbReview = {
        id: nextId(
          'IBREV',
          state.ibReviews.map((item) => item.id)
        ),
        projectId: project.id,
        submissionId: submission.id,
        policyVersion: submission.policyVersion,
        stage,
        decision: input.decision,
        reviewerId: input.actorId,
        reason: input.decision === 'return' ? input.reason.trim() : null,
        reviewedAt: this.repository.clock.now()
      };
      state.ibReviews.push(review);
      for (const todo of state.todos) {
        if (todo.sourceType === 'ib-project' && todo.sourceId === project.id && todo.status === 'open') {
          todo.status = 'done';
          todo.completedAt = this.repository.clock.now();
        }
      }
      if (input.decision === 'return') {
        project.status = 'returned';
        project.businessVersion += 1;
        project.lastReturnVersion = project.businessVersion;
        allocateWorkpaperAssets(state, project.id, '退回补正');
        const finding: IbFinding = {
          id: nextId(
            'IBFIND',
            state.ibFindings.map((item) => item.id)
          ),
          projectId: project.id,
          severity: 'blocking',
          description: `${stage === 'quality' ? '质控' : '内核'}退回：${review.reason}`,
          status: 'open',
          openedBy: input.actorId,
          openedAt: this.repository.clock.now(),
          resolution: null,
          resolvedBy: null,
          resolvedAt: null
        };
        state.ibFindings.push(finding);
      } else if (stage === 'quality') {
        const committee = state.employees.find((item) => item.active && item.roles.includes('ib-committee'));
        if (!committee) throw businessError('action.ib-committee-missing', '没有可用内核人员。');
        project.status = 'committee-review';
        project.businessVersion += 1;
        addTodo(state, this.repository.clock.now(), project.id, committee.id, '投行项目内核');
      } else {
        project.status = 'approved';
        project.businessVersion += 1;
      }
      audit(
        state,
        this.repository.clock.now(),
        project,
        `${stage}-${input.decision}`,
        input.actorId,
        before,
        review.reason
      );
      return resultFor(project);
    });
  }

  validateArchive(input: IbMutationInput): AwcpFieldError[] {
    return checkMutation(this.repository.snapshot(), 'archive', input);
  }

  archive(input: IbMutationInput): IbProjectResult {
    return this.mutate('archive', input, (state, project) => {
      const before = project.status;
      project.status = 'archived';
      project.businessVersion += 1;
      project.archivedAt = this.repository.clock.now();
      audit(state, this.repository.clock.now(), project, 'archive', input.actorId, before, null);
      return resultFor(project);
    });
  }

  private mutate<Result extends JsonObject>(
    operation: Operation,
    input: IbMutationInput,
    change: (state: DemoState, project: IbProject) => Result
  ): Result {
    return this.repository.transact((state) => {
      const fingerprint = mutationFingerprint(operation, input);
      const record = state.idempotencyRecords.find((item) => item.key === input.idempotencyKey);
      if (record) {
        if (record.operation !== `ib.${operation}` || record.fingerprint !== fingerprint)
          throw businessError('action.idempotency-conflict', '业务幂等键已用于其他操作或参数。');
        return replayMutation(state, operation, record) as Result;
      }
      assertValid(checkMutation(state, operation, input));
      const project = state.ibProjects.find((item) => item.id === input.projectId);
      if (!project) throw businessError('action.ib-project-not-found', '投行项目不存在。');
      const result = change(state, project);
      const resultId =
        operation === 'assign'
          ? String(result.assignmentId)
          : operation === 'attach'
            ? String(result.workpaperId)
            : operation === 'resolve'
              ? String(result.findingId)
              : operation === 'quality-submit'
                ? String(result.submissionId)
                : project.id;
      remember(state, input.idempotencyKey, operation, fingerprint, resultId, project);
      return result;
    });
  }
}

function createErrors(state: DemoState, input: IbCreateInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const errors = keyErrors(input.idempotencyKey);
  if (!state.employees.some((item) => item.id === input.actorId && item.active && item.roles.includes('ib-manager')))
    errors.push(fieldError(['actorId'], '只有投行项目经理可以创建项目。'));
  if (!state.ibIssuers.some((item) => item.id === input.issuerId))
    errors.push(fieldError(['issuerId'], '发行人不存在。'));
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 120)
    errors.push(fieldError(['title'], '项目名称须为 1～120 字。'));
  return errors;
}

function checkRead(state: DemoState, input: IbReadInput): AwcpFieldError[] {
  const errors: AwcpFieldError[] = [];
  if (!state.ibProjects.some((item) => item.id === input.projectId))
    errors.push(fieldError(['projectId'], '投行项目不存在。'));
  if (
    !state.employees.some(
      (item) =>
        item.id === input.actorId &&
        item.active &&
        item.roles.some((role) => ['ib-manager', 'ib-member', 'ib-quality', 'ib-committee'].includes(role))
    )
  )
    errors.push(fieldError(['actorId'], '只有项目参与人员可以读取。'));
  return errors;
}

function checkMutation(state: DemoState, operation: Operation, input: IbMutationInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, operation === 'review' ? 'approve' : 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const record = state.idempotencyRecords.find((item) => item.key === input.idempotencyKey);
  if (record)
    return record.operation === `ib.${operation}` && record.fingerprint === mutationFingerprint(operation, input)
      ? []
      : [fieldError(['idempotencyKey'], '业务幂等键已用于其他操作或参数。')];
  const errors = keyErrors(input.idempotencyKey);
  const project = state.ibProjects.find((item) => item.id === input.projectId);
  if (!project) return [...errors, fieldError(['projectId'], '投行项目不存在。')];
  if (project.businessVersion !== input.expectedVersion)
    errors.push(fieldError(['expectedVersion'], '业务版本已变化，请刷新后重试。'));
  const actor = state.employees.find((item) => item.id === input.actorId && item.active);
  const managerOperation =
    operation === 'submit' || operation === 'assign' || operation === 'quality-submit' || operation === 'archive';
  if (managerOperation && (actor?.id !== project.managerId || !actor.roles.includes('ib-manager')))
    errors.push(fieldError(['actorId'], '只有原项目经理可以执行此操作。'));

  if (operation === 'submit') {
    if (project.status !== 'draft') errors.push(fieldError(['projectId'], '只有草稿项目可立项。'));
    return errors;
  }
  if (operation === 'assign') {
    const assign = input as IbAssignInput;
    if (project.status !== 'initiated' && project.status !== 'diligence' && project.status !== 'returned')
      errors.push(fieldError(['projectId'], '当前状态不可分配尽调。'));
    if (!isWorkpaperKind(assign.kind)) errors.push(fieldError(['kind'], '底稿类型无效。'));
    if (!state.employees.some((item) => item.id === assign.memberId && item.active && item.roles.includes('ib-member')))
      errors.push(fieldError(['memberId'], '成员不存在或无尽调角色。'));
    if (state.ibAssignments.some((item) => item.projectId === project.id && item.kind === assign.kind))
      errors.push(fieldError(['kind'], '该类型已完成分工。'));
    return errors;
  }
  if (operation === 'attach') {
    const attach = input as IbAttachInput;
    if (project.status !== 'diligence' && project.status !== 'returned')
      errors.push(fieldError(['projectId'], '当前状态不可提交底稿。'));
    if (!isWorkpaperKind(attach.kind)) errors.push(fieldError(['kind'], '底稿类型无效。'));
    if (
      !state.ibAssignments.some(
        (item) => item.projectId === project.id && item.kind === attach.kind && item.memberId === input.actorId
      ) ||
      !actor?.roles.includes('ib-member')
    )
      errors.push(fieldError(['actorId'], '只有该底稿的分工成员可以提交。'));
    if (!state.attachments.some((item) => item.assetId === attach.assetId && item.ownerId === project.id))
      errors.push(fieldError(['assetId'], '附件未关联当前项目。'));
    if (state.ibWorkpapers.some((item) => item.projectId === project.id && item.assetId === attach.assetId))
      errors.push(fieldError(['assetId'], '该附件已作为底稿版本使用。'));
    if (typeof attach.summary !== 'string' || !attach.summary.trim() || attach.summary.trim().length > 500)
      errors.push(fieldError(['summary'], '底稿说明须为 1～500 字。'));
    return errors;
  }
  if (operation === 'resolve') {
    const resolve = input as IbResolveInput;
    if (project.status !== 'diligence' && project.status !== 'returned')
      errors.push(fieldError(['projectId'], '当前状态不可整改问题。'));
    const finding = state.ibFindings.find((item) => item.id === resolve.findingId && item.projectId === project.id);
    if (!finding || finding.status !== 'open') errors.push(fieldError(['findingId'], '待整改问题不存在。'));
    if (
      actor?.id !== project.managerId &&
      !state.ibAssignments.some(
        (item) => item.projectId === project.id && item.memberId === input.actorId && actor?.roles.includes('ib-member')
      )
    )
      errors.push(fieldError(['actorId'], '只有项目经理或分工成员可以整改。'));
    if (typeof resolve.resolution !== 'string' || !resolve.resolution.trim() || resolve.resolution.trim().length > 500)
      errors.push(fieldError(['resolution'], '整改说明须为 1～500 字。'));
    return errors;
  }
  if (operation === 'quality-submit') {
    if (project.status !== 'diligence') errors.push(fieldError(['projectId'], '只有尽调中的项目可提交质控。'));
    const missing = state.ibPolicy.requiredWorkpaperKinds.filter((kind) => !latestWorkpaper(state, project.id, kind));
    if (missing.length) errors.push(fieldError(['workpapers'], `缺少底稿：${missing.join('、')}。`));
    const blocking = state.ibFindings.filter(
      (item) =>
        item.projectId === project.id && item.severity === state.ibPolicy.blockingSeverity && item.status === 'open'
    );
    if (blocking.length)
      errors.push(fieldError(['findings'], `阻断问题未整改：${blocking.map((item) => item.id).join('、')}。`));
    if (
      project.lastReturnVersion !== null &&
      !state.ibWorkpapers.some(
        (item) => item.projectId === project.id && item.businessVersion > Number(project.lastReturnVersion)
      )
    )
      errors.push(fieldError(['workpapers'], '退回后须提交新版底稿。'));
    if (!state.employees.some((item) => item.active && item.roles.includes('ib-quality')))
      errors.push(fieldError(['projectId'], '没有可用质控人员。'));
    return errors;
  }
  if (operation === 'review') {
    const review = input as IbReviewInput;
    if (project.status !== 'quality-review' && project.status !== 'committee-review')
      errors.push(fieldError(['projectId'], '当前项目没有待审议阶段。'));
    if (review.decision !== 'approve' && review.decision !== 'return')
      errors.push(fieldError(['decision'], '审议决定无效。'));
    if (
      review.decision === 'return' &&
      (typeof review.reason !== 'string' || !review.reason.trim() || review.reason.trim().length > 200)
    )
      errors.push(fieldError(['reason'], '退回需填写 1～200 字原因。'));
    if (review.decision === 'approve' && review.reason?.trim())
      errors.push(fieldError(['reason'], '批准时请留空退回原因。'));
    const stage = project.status === 'quality-review' ? 'quality' : 'committee';
    const role = stage === 'quality' ? 'ib-quality' : 'ib-committee';
    if (!actor?.roles.includes(role)) errors.push(fieldError(['actorId'], '当前审议阶段与角色不匹配。'));
    if (
      !state.todos.some(
        (item) =>
          item.sourceType === 'ib-project' &&
          item.sourceId === project.id &&
          item.status === 'open' &&
          item.assigneeId === input.actorId
      )
    )
      errors.push(fieldError(['actorId'], '当前审议人员没有该项目的待办。'));
    const submission = latestSubmission(state, project.id);
    if (!submission) errors.push(fieldError(['projectId'], '质控提交记录不存在。'));
    if (review.decision === 'approve' && submission?.policyVersion !== state.ibPolicy.version)
      errors.push(fieldError(['projectId'], '规则版本已变化，需退回后重新提交。'));
    if (
      stage === 'committee' &&
      !state.ibReviews.some(
        (item) => item.submissionId === submission?.id && item.stage === 'quality' && item.decision === 'approve'
      )
    )
      errors.push(fieldError(['projectId'], '当前质控提交缺少质控批准。'));
    if (
      stage === 'quality' &&
      review.decision === 'approve' &&
      !state.employees.some((item) => item.active && item.roles.includes('ib-committee'))
    )
      errors.push(fieldError(['projectId'], '没有可用内核人员。'));
    return errors;
  }
  if (operation === 'archive') {
    if (project.status !== 'approved') errors.push(fieldError(['projectId'], '只有内核通过项目可归档。'));
    return errors;
  }
  return errors;
}

function isWorkpaperKind(value: string): value is IbWorkpaperKind {
  return value === 'financial' || value === 'legal';
}

function latestWorkpaper(state: DemoState, projectId: string, kind: IbWorkpaperKind): IbWorkpaperVersion | undefined {
  return state.ibWorkpapers
    .filter((item) => item.projectId === projectId && item.kind === kind)
    .reduce<
      IbWorkpaperVersion | undefined
    >((latest, item) => (!latest || item.version > latest.version ? item : latest), undefined);
}

function latestSubmission(state: DemoState, projectId: string): IbQualitySubmission | undefined {
  return [...state.ibQualitySubmissions].reverse().find((item) => item.projectId === projectId);
}

function mutationFingerprint(operation: Operation, input: IbMutationInput): string {
  const base = [input.projectId, input.actorId, input.expectedVersion];
  if (operation === 'assign') {
    const assign = input as IbAssignInput;
    return JSON.stringify([...base, assign.kind, assign.memberId]);
  }
  if (operation === 'attach') {
    const attach = input as IbAttachInput;
    return JSON.stringify([...base, attach.kind, attach.assetId, attach.summary?.trim()]);
  }
  if (operation === 'resolve') {
    const resolve = input as IbResolveInput;
    return JSON.stringify([...base, resolve.findingId, resolve.resolution?.trim()]);
  }
  if (operation === 'review') {
    const review = input as IbReviewInput;
    return JSON.stringify([...base, review.decision, review.reason?.trim()]);
  }
  return JSON.stringify(base);
}

function createFingerprint(input: IbCreateInput): string {
  return JSON.stringify([input.issuerId, input.title?.trim(), input.actorId]);
}

function keyErrors(value: string): AwcpFieldError[] {
  return typeof value === 'string' && /^[\w.:-]{1,128}$/.test(value)
    ? []
    : [fieldError(['idempotencyKey'], '业务幂等键格式不正确。')];
}

function replayMutation(
  state: DemoState,
  operation: Operation,
  record: DemoState['idempotencyRecords'][number]
): JsonObject {
  if (operation === 'assign') {
    const assignment = state.ibAssignments.find((item) => item.id === record.resultId);
    if (!assignment) throw new Error('Missing assignment replay result.');
    return {
      ...replayProjectById(record, assignment.projectId),
      assignmentId: assignment.id,
      kind: assignment.kind,
      memberId: assignment.memberId
    };
  }
  if (operation === 'attach') {
    const workpaper = state.ibWorkpapers.find((item) => item.id === record.resultId);
    if (!workpaper) throw new Error('Missing workpaper replay result.');
    return {
      ...replayProjectById(record, workpaper.projectId),
      workpaperId: workpaper.id,
      kind: workpaper.kind,
      workpaperVersion: workpaper.version
    };
  }
  if (operation === 'resolve') {
    const finding = state.ibFindings.find((item) => item.id === record.resultId);
    if (!finding) throw new Error('Missing finding replay result.');
    return { ...replayProjectById(record, finding.projectId), findingId: finding.id, findingStatus: 'resolved' };
  }
  if (operation === 'quality-submit') {
    const submission = state.ibQualitySubmissions.find((item) => item.id === record.resultId);
    if (!submission) throw new Error('Missing quality submission replay result.');
    return {
      ...replayProjectById(record, submission.projectId),
      submissionId: submission.id,
      policyVersion: submission.policyVersion
    };
  }
  return replayProject(state, record);
}

function replayProject(state: DemoState, record: DemoState['idempotencyRecords'][number]): IbProjectResult {
  const project = state.ibProjects.find((item) => item.id === record.resultId);
  if (!project) throw new Error('Missing project replay result.');
  return replayProjectById(record, project.id);
}

function replayProjectById(record: DemoState['idempotencyRecords'][number], projectId: string): IbProjectResult {
  if (record.resultVersion === null || !isProjectStatus(record.resultStatus))
    throw new Error('Invalid project replay result.');
  return { projectId, status: record.resultStatus, businessVersion: record.resultVersion };
}

function isProjectStatus(value: string): value is IbProject['status'] {
  return [
    'draft',
    'initiated',
    'diligence',
    'quality-review',
    'committee-review',
    'returned',
    'approved',
    'archived'
  ].includes(value);
}

function remember(
  state: DemoState,
  key: string,
  operation: string,
  fingerprint: string,
  resultId: string,
  project: IbProject
): void {
  state.idempotencyRecords.push({
    key,
    operation: `ib.${operation}`,
    fingerprint,
    resultId,
    resultVersion: project.businessVersion,
    resultStatus: project.status
  });
}

function resultFor(project: IbProject): IbProjectResult {
  return { projectId: project.id, status: project.status, businessVersion: project.businessVersion };
}

function audit(
  state: DemoState,
  at: string,
  project: IbProject,
  action: string,
  actorId: string,
  fromStatus: IbProject['status'] | null,
  note: string | null
): void {
  state.auditEntries.push({
    id: nextId(
      'AUD',
      state.auditEntries.map((item) => item.id)
    ),
    entityType: 'ib-project',
    entityId: project.id,
    action,
    actorId,
    at,
    fromStatus,
    toStatus: project.status,
    businessVersion: project.businessVersion,
    ...(note ? { note } : {})
  });
}

function addTodo(state: DemoState, now: string, projectId: string, assigneeId: string, title: string): void {
  state.todos.push({
    id: nextId(
      'TODO',
      state.todos.map((item) => item.id)
    ),
    title: `${title} ${projectId}`,
    assigneeId,
    sourceType: 'ib-project',
    sourceId: projectId,
    dueAt: new Date(Date.parse(now) + 86400000).toISOString(),
    status: 'open'
  });
}

function allocateWorkpaperAssets(state: DemoState, projectId: string, label: string): void {
  for (const kind of state.ibPolicy.requiredWorkpaperKinds) {
    state.attachments.push({
      assetId: nextId(
        'IBAST',
        state.attachments.map((item) => item.assetId)
      ),
      filename: `虚构${kind}底稿${label}.txt`,
      mimeType: 'text/plain',
      sizeBytes: 128,
      ownerId: projectId
    });
  }
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
    throw businessError('action.invalid-ib-project', errors.flatMap((item) => item.messages).join('；'));
}
