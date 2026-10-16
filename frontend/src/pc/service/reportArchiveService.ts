import { workflowErrors } from './workflowAccess';
import type { AwcpFieldError, JsonObject } from '@app/awcp';

import { businessError, fieldError } from '../../common/awcp/contracts';
import type {
  DemoState,
  OfficeArchiveVersion,
  OfficeReportJob,
  OfficeReportRow,
  ReportOperationRecord
} from '../../common/fixtures/types';
import type { DemoRepository } from '../../common/store/repository';

export interface ReportGenerateInput extends JsonObject {
  actorId: string;
  departmentId: string;
  startDate: string;
  endDate: string;
  idempotencyKey: string;
}
export interface ReportReadInput extends JsonObject {
  actorId: string;
  jobId: string;
}
export interface ReportDetailsInput extends ReportReadInput {
  page: number;
  pageSize: number;
}
export interface ArchiveSearchInput extends JsonObject {
  actorId: string;
  archiveId: string;
  version: number;
}
export interface ArchiveSaveInput extends JsonObject {
  actorId: string;
  reportId: string;
  archiveId: string | null;
  expectedVersion: number | null;
  idempotencyKey: string;
}
export interface ArchiveSaveResult extends JsonObject {
  id: string;
  status: 'saved';
  businessVersion: number;
}
type WriteInput = ReportGenerateInput | ArchiveSaveInput;
type Operation = ReportOperationRecord['operation'];

function nextId(prefix: string, ids: string[]): string {
  const numbers = ids.map((id) => Number(new RegExp(`^${prefix}-([0-9]+)$`).exec(id)?.[1] ?? 0));
  return `${prefix}-${String(Math.max(0, ...numbers) + 1).padStart(3, '0')}`;
}
function fingerprint(input: WriteInput): string {
  const { idempotencyKey: _key, ...payload } = input;
  return JSON.stringify(Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b))));
}
function replay(
  state: DemoState,
  operation: Operation,
  input: WriteInput
): { record: ReportOperationRecord | null; errors: AwcpFieldError[] } {
  if (typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.idempotencyKey))
    return { record: null, errors: [fieldError(['idempotencyKey'], '业务幂等键格式无效。')] };
  const record = state.reportOperationRecords.find((item) => item.idempotencyKey === input.idempotencyKey);
  if (!record) return { record: null, errors: [] };
  return record.operation === operation && record.fingerprint === fingerprint(input)
    ? { record, errors: [] }
    : { record: null, errors: [fieldError(['idempotencyKey'], '业务幂等键已用于其他操作或参数。')] };
}
function ensure(errors: AwcpFieldError[]): void {
  if (errors.length)
    throw businessError(
      'action.invalid-report-request',
      errors.flatMap((item) => item.messages).join('；'),
      errors.map((item) => ({ path: item.path, messages: item.messages }))
    );
}
function reporter(state: DemoState, actorId: string, departmentId: string): AwcpFieldError[] {
  const employee = state.employees.find((item) => item.id === actorId && item.active);
  if (!employee) return [fieldError(['actorId'], '操作人不存在或已离职。')];
  if (state.workflowProfile === 'coarse-roles') return [];
  return employee.roles.includes('reviewer') ||
    (employee.roles.includes('manager') && employee.departmentId === departmentId)
    ? []
    : [fieldError(['actorId'], '仅复核员或本部门主管可查看和生成报表。')];
}
function validDate(value: string): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms : null;
}
function shanghaiDate(value: string): string {
  return new Date(Date.parse(value) + 8 * 3_600_000).toISOString().slice(0, 10);
}
function sourceRows(
  state: DemoState,
  departmentId: string,
  startDate: string,
  endDate: string,
  today: string
): OfficeReportRow[] {
  const rows: OfficeReportRow[] = [];
  for (const task of state.projectTasks) {
    const employee = state.employees.find((item) => item.id === task.assigneeId);
    if (employee?.departmentId !== departmentId || task.dueDate < startDate || task.dueDate > endDate) continue;
    rows.push({
      sourceType: 'project-task',
      sourceId: task.id,
      sourceVersion: task.businessVersion,
      departmentId,
      occurredOn: task.dueDate,
      title: task.title,
      sourceStatus: task.status,
      anomalyReason: task.status !== 'done' && task.dueDate < today ? '任务逾期' : null
    });
  }
  for (const request of state.purchaseRequests) {
    const employee = state.employees.find((item) => item.id === request.requesterId);
    const occurredOn = shanghaiDate(request.createdAt);
    if (employee?.departmentId !== departmentId || occurredOn < startDate || occurredOn > endDate) continue;
    rows.push({
      sourceType: 'purchase-request',
      sourceId: request.id,
      sourceVersion: request.businessVersion,
      departmentId,
      occurredOn,
      title: request.itemName,
      sourceStatus: request.status,
      anomalyReason: request.status === 'draft' ? '请购未完成比价' : null
    });
  }
  for (const ticket of state.itTickets) {
    const employee = state.employees.find((item) => item.id === ticket.requesterId);
    const occurredOn = shanghaiDate(ticket.createdAt);
    if (employee?.departmentId !== departmentId || occurredOn < startDate || occurredOn > endDate) continue;
    rows.push({
      sourceType: 'it-ticket',
      sourceId: ticket.id,
      sourceVersion: ticket.businessVersion,
      departmentId,
      occurredOn,
      title: ticket.title,
      sourceStatus: ticket.status,
      anomalyReason: ticket.status === 'new' || ticket.status === 'assigned' ? 'IT 工单未解决' : null
    });
  }
  return rows.sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.sourceId.localeCompare(b.sourceId));
}
function audit(
  state: DemoState,
  entityType: 'office-report' | 'office-archive',
  entityId: string,
  action: string,
  actorId: string,
  fromStatus: string | null,
  toStatus: string,
  version: number | null,
  at: string
): void {
  state.auditEntries.push({
    id: nextId(
      'AUD',
      state.auditEntries.map((item) => item.id)
    ),
    entityType,
    entityId,
    action,
    actorId,
    at,
    fromStatus,
    toStatus,
    businessVersion: version
  });
}
function jobFor(state: DemoState, jobId: string): OfficeReportJob | undefined {
  return state.officeReportJobs.find((item) => item.id === jobId);
}

export class ReportArchiveService {
  constructor(
    private readonly repository: DemoRepository,
    private readonly schedule: (work: () => void) => void = (work) => {
      setTimeout(work, 20);
    }
  ) {}
  snapshot(): DemoState {
    return this.repository.snapshot();
  }
  subscribe(listener: () => void): () => void {
    return this.repository.subscribe(listener);
  }
  validateGenerate(input: ReportGenerateInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(this.repository.snapshot(), input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
    const state = this.snapshot();
    const key = replay(state, 'report.generate', input);
    if (key.record || key.errors.length) return key.errors;
    const errors: AwcpFieldError[] = [];
    if (!state.departments.some((item) => item.id === input.departmentId))
      errors.push(fieldError(['departmentId'], '部门不存在。'));
    errors.push(...reporter(state, input.actorId, input.departmentId));
    const start = validDate(input.startDate);
    const end = validDate(input.endDate);
    if (start === null) errors.push(fieldError(['startDate'], '开始日期无效。'));
    if (end === null || (start !== null && (end < start || end - start > 365 * 86_400_000)))
      errors.push(fieldError(['endDate'], '结束日期须不早于开始日期，期间最多 366 天。'));
    return errors;
  }
  generate(input: ReportGenerateInput): { status: 'accepted'; jobId: string } {
    ensure(this.validateGenerate(input));
    const { jobId, fresh } = this.repository.transact((state) => {
      const key = replay(state, 'report.generate', input);
      ensure(key.errors);
      if (key.record) return { jobId: key.record.resultId, fresh: false };
      const jobId = nextId(
        'RJOB',
        state.officeReportJobs.map((item) => item.id)
      );
      const now = this.repository.clock.now();
      state.officeReportJobs.push({
        id: jobId,
        actorId: input.actorId,
        departmentId: input.departmentId,
        startDate: input.startDate,
        endDate: input.endDate,
        status: 'accepted',
        unit: '件',
        totalCount: null,
        anomalyCount: null,
        rows: [],
        acceptedAt: now,
        completedAt: null
      });
      state.reportOperationRecords.push({
        idempotencyKey: input.idempotencyKey,
        operation: 'report.generate',
        fingerprint: fingerprint(input),
        resultId: jobId,
        resultVersion: null
      });
      audit(state, 'office-report', jobId, 'report.generate.accept', input.actorId, null, 'accepted', null, now);
      return { jobId, fresh: true };
    });
    if (fresh)
      this.schedule(() => {
        this.finishReport(jobId);
      });
    return { status: 'accepted', jobId };
  }
  finishReport(jobId: string): OfficeReportJob | null {
    const current = jobFor(this.snapshot(), jobId);
    if (!current) return null;
    if (current.status === 'completed') return current;
    return this.repository.transact((state) => {
      const job = jobFor(state, jobId);
      if (!job || job.status !== 'accepted') return null;
      const now = this.repository.clock.now();
      const rows = sourceRows(state, job.departmentId, job.startDate, job.endDate, shanghaiDate(now));
      job.rows = rows;
      job.totalCount = rows.length;
      job.anomalyCount = rows.filter((item) => item.anomalyReason !== null).length;
      job.status = 'completed';
      job.completedAt = now;
      audit(state, 'office-report', jobId, 'report.generate.complete', job.actorId, 'accepted', 'completed', null, now);
      return { ...job, rows: [...rows] };
    });
  }
  validateRead(input: ReportReadInput): AwcpFieldError[] {
    const state = this.snapshot();
    const job = jobFor(state, input.jobId);
    if (!job) return [fieldError(['jobId'], '报表任务不存在。')];
    return reporter(state, input.actorId, job.departmentId);
  }
  read(input: ReportReadInput): JsonObject {
    ensure(this.validateRead(input));
    const job = jobFor(this.snapshot(), input.jobId);
    if (!job) throw businessError('action.report-not-found', '报表任务不存在。');
    return {
      jobId: job.id,
      status: job.status,
      departmentId: job.departmentId,
      startDate: job.startDate,
      endDate: job.endDate,
      unit: job.unit,
      totalCount: job.totalCount,
      anomalyCount: job.anomalyCount,
      acceptedAt: job.acceptedAt,
      completedAt: job.completedAt
    };
  }
  validateDetails(input: ReportDetailsInput): AwcpFieldError[] {
    const errors = this.validateRead(input);
    const job = jobFor(this.snapshot(), input.jobId);
    if (job && job.status !== 'completed') errors.push(fieldError(['jobId'], '报表尚未完成。'));
    if (!Number.isSafeInteger(input.page) || input.page < 1) errors.push(fieldError(['page'], '页码须为正整数。'));
    if (!Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 20)
      errors.push(fieldError(['pageSize'], '每页须为 1 到 20 条。'));
    return errors;
  }
  details(input: ReportDetailsInput): JsonObject {
    ensure(this.validateDetails(input));
    const job = jobFor(this.snapshot(), input.jobId);
    if (!job) throw businessError('action.report-not-found', '报表任务不存在。');
    const anomalies = job.rows.filter((item) => item.anomalyReason !== null);
    return {
      jobId: job.id,
      unit: job.unit,
      totalCount: anomalies.length,
      page: input.page,
      pageSize: input.pageSize,
      rows: anomalies.slice((input.page - 1) * input.pageSize, input.page * input.pageSize).map((item) => ({ ...item }))
    };
  }
  validateSearch(input: ArchiveSearchInput): AwcpFieldError[] {
    const state = this.snapshot();
    const archive = state.officeArchives.find((item) => item.id === input.archiveId);
    if (!archive) return [fieldError(['archiveId'], '档案不存在。')];
    const errors: AwcpFieldError[] = [];
    if (!state.employees.some((item) => item.id === input.actorId && item.active && archive.ownerId === input.actorId))
      errors.push(fieldError(['actorId'], '仅档案所有者可读取。'));
    if (!Number.isSafeInteger(input.version) || !archive.versions.some((item) => item.version === input.version))
      errors.push(fieldError(['version'], '档案版本不存在。'));
    return errors;
  }
  search(input: ArchiveSearchInput): JsonObject {
    ensure(this.validateSearch(input));
    const state = this.snapshot();
    const archive = state.officeArchives.find((item) => item.id === input.archiveId);
    const version = archive?.versions.find((item) => item.version === input.version);
    if (!archive || !version) throw businessError('action.archive-not-found', '档案版本不存在。');
    return {
      archiveId: archive.id,
      ownerId: archive.ownerId,
      currentVersion: archive.currentVersion,
      version: { ...version, rows: version.rows.map((item) => ({ ...item })) },
      operations: state.officeArchiveOperations
        .filter((item) => item.archiveId === archive.id)
        .map((item) => ({ ...item }))
    };
  }
  validateSave(input: ArchiveSaveInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(this.repository.snapshot(), input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
    const state = this.snapshot();
    const key = replay(state, 'archive.save', input);
    if (key.record || key.errors.length) return key.errors;
    const errors: AwcpFieldError[] = [];
    const report = jobFor(state, input.reportId);
    if (!report || report.status !== 'completed') return [fieldError(['reportId'], '只能归档已完成报表。')];
    errors.push(...reporter(state, input.actorId, report.departmentId));
    if (input.archiveId === null) {
      if (input.expectedVersion !== null) errors.push(fieldError(['expectedVersion'], '创建档案时版本须为空。'));
    } else {
      const archive = state.officeArchives.find((item) => item.id === input.archiveId);
      if (!archive) errors.push(fieldError(['archiveId'], '档案不存在。'));
      else {
        if (archive.ownerId !== input.actorId) errors.push(fieldError(['actorId'], '仅档案所有者可保存新版本。'));
        if (archive.currentVersion !== input.expectedVersion)
          errors.push(fieldError(['expectedVersion'], `档案版本应为 ${archive.currentVersion}。`));
      }
    }
    return errors;
  }
  save(input: ArchiveSaveInput): ArchiveSaveResult {
    ensure(this.validateSave(input));
    return this.repository.transact((state) => {
      const key = replay(state, 'archive.save', input);
      ensure(key.errors);
      if (key.record)
        return { id: key.record.resultId, status: 'saved', businessVersion: key.record.resultVersion ?? 1 };
      const report = jobFor(state, input.reportId);
      if (!report || report.status !== 'completed' || report.totalCount === null || report.anomalyCount === null)
        throw businessError('action.report-not-ready', '报表尚未完成。');
      const now = this.repository.clock.now();
      const archive =
        input.archiveId === null ? null : state.officeArchives.find((item) => item.id === input.archiveId);
      const id =
        archive?.id ??
        nextId(
          'ARC',
          state.officeArchives.map((item) => item.id)
        );
      const version = (archive?.currentVersion ?? 0) + 1;
      const snapshot: OfficeArchiveVersion = {
        version,
        reportId: report.id,
        departmentId: report.departmentId,
        startDate: report.startDate,
        endDate: report.endDate,
        unit: '件',
        totalCount: report.totalCount,
        anomalyCount: report.anomalyCount,
        rows: report.rows.map((item) => ({ ...item })),
        savedAt: now
      };
      if (archive) {
        archive.currentVersion = version;
        archive.versions.push(snapshot);
      } else state.officeArchives.push({ id, ownerId: input.actorId, currentVersion: version, versions: [snapshot] });
      state.officeArchiveOperations.push({
        id: nextId(
          'AOP',
          state.officeArchiveOperations.map((item) => item.id)
        ),
        archiveId: id,
        actorId: input.actorId,
        action: 'save',
        version,
        reportId: report.id,
        at: now
      });
      state.reportOperationRecords.push({
        idempotencyKey: input.idempotencyKey,
        operation: 'archive.save',
        fingerprint: fingerprint(input),
        resultId: id,
        resultVersion: version
      });
      audit(
        state,
        'office-archive',
        id,
        'archive.save',
        input.actorId,
        archive ? String(version - 1) : null,
        String(version),
        version,
        now
      );
      return { id, status: 'saved', businessVersion: version };
    });
  }
}
