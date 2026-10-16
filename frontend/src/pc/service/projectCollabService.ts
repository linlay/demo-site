import { workflowErrors } from './workflowAccess';
import type { AwcpFieldError, JsonObject } from '@app/awcp';

import { businessError, fieldError } from '../../common/awcp/contracts';
import type { DemoState, ProjectMilestone, ProjectOperationRecord, ProjectTask } from '../../common/fixtures/types';
import type { DemoRepository } from '../../common/store/repository';

export interface ProjectReadInput extends JsonObject {
  actorId: string;
}
export interface ProjectCreateInput extends ProjectReadInput {
  title: string;
  memberIds: string[];
  dueDate: string;
  idempotencyKey: string;
}
export interface ProjectTaskCreateInput extends ProjectReadInput {
  projectId: string;
  title: string;
  assigneeId: string;
  dueDate: string;
  dependencyIds: string[];
  idempotencyKey: string;
}
export interface ProjectTaskUpdateInput extends ProjectReadInput {
  taskId: string;
  title: string;
  assigneeId: string;
  dueDate: string;
  dependencyIds: string[];
  status: 'open' | 'done';
  expectedVersion: number;
  idempotencyKey: string;
}
export interface MilestoneUpsertInput extends ProjectReadInput {
  projectId: string;
  milestoneId: string | null;
  expectedVersion: number | null;
  title: string;
  dueDate: string;
  taskIds: string[];
  idempotencyKey: string;
}
export interface WeeklyReportGenerateInput extends ProjectReadInput {
  projectId: string;
  idempotencyKey: string;
}
export interface ProjectResult extends JsonObject {
  id: string;
  status: string;
  businessVersion: number;
}
type Operation = ProjectOperationRecord['operation'];

function nextId(prefix: string, ids: string[]): string {
  const next =
    Math.max(
      0,
      ...ids.map((id) => {
        const match = new RegExp(`^${prefix}-([0-9]+)$`).exec(id);
        return match ? Number(match[1]) : 0;
      })
    ) + 1;
  return `${prefix}-${String(next).padStart(3, '0')}`;
}
function fingerprint(input: JsonObject): string {
  const { idempotencyKey: _key, ...payload } = input;
  const ordered = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(ordered);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, ordered(v)])
      );
    return value;
  };
  return JSON.stringify(ordered(payload));
}
function replay(
  state: DemoState,
  operation: Operation,
  input: JsonObject & { idempotencyKey: string }
): {
  errors: AwcpFieldError[];
  record: ProjectOperationRecord | null;
} {
  if (typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.idempotencyKey))
    return { errors: [fieldError(['idempotencyKey'], '业务幂等键格式无效。')], record: null };
  const record = state.projectOperationRecords.find((item) => item.idempotencyKey === input.idempotencyKey);
  if (!record) return { errors: [], record: null };
  return record.operation === operation && record.fingerprint === fingerprint(input)
    ? { errors: [], record }
    : { errors: [fieldError(['idempotencyKey'], '业务幂等键已用于其他操作或参数。')], record: null };
}
function remember(
  state: DemoState,
  operation: Operation,
  input: JsonObject & { idempotencyKey: string },
  result: ProjectResult
): void {
  state.projectOperationRecords.push({
    idempotencyKey: input.idempotencyKey,
    operation,
    fingerprint: fingerprint(input),
    result: { id: result.id, status: result.status, businessVersion: result.businessVersion }
  });
}
function valid(errors: AwcpFieldError[]): void {
  if (errors.length)
    throw businessError(
      'action.invalid-project-request',
      errors.flatMap((item) => item.messages).join('；'),
      errors.map((item) => ({ path: item.path, messages: item.messages }))
    );
}
function date(value: string): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null;
}
function today(now: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(now));
}
function actor(state: DemoState, actorId: string): AwcpFieldError[] {
  return state.employees.some((item) => item.id === actorId && item.active)
    ? []
    : [fieldError(['actorId'], '操作人不存在或已离职。')];
}
function titleErrors(title: string): AwcpFieldError[] {
  return typeof title === 'string' && title.trim().length >= 1 && title.trim().length <= 100
    ? []
    : [fieldError(['title'], '名称须为 1 到 100 字。')];
}
function projectErrors(state: DemoState, input: ProjectCreateInput, currentDay: string): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const key = replay(state, 'project.create', input);
  if (key.record || key.errors.length) return key.errors;
  const errors = [...actor(state, input.actorId), ...titleErrors(input.title)];
  if (date(input.dueDate) === null || input.dueDate < currentDay)
    errors.push(fieldError(['dueDate'], '项目截止日期须为有效的今日或未来日期。'));
  if (
    !Array.isArray(input.memberIds) ||
    !input.memberIds.includes(input.actorId) ||
    input.memberIds.length < 1 ||
    input.memberIds.length > 20 ||
    new Set(input.memberIds).size !== input.memberIds.length
  )
    errors.push(fieldError(['memberIds'], '成员须包含负责人，且为不重复的 1 到 20 位员工。'));
  else
    input.memberIds.forEach((id, index) => {
      if (!state.employees.some((item) => item.id === id && item.active))
        errors.push(fieldError(['memberIds', index], '成员不存在或已离职。'));
    });
  return errors;
}
function taskFields(
  state: DemoState,
  projectId: string,
  title: string,
  assigneeId: string,
  dueDate: string,
  dependencyIds: string[],
  excludedTaskId: string | null
): AwcpFieldError[] {
  const project = state.officeProjects.find((item) => item.id === projectId);
  if (!project) return [fieldError(['projectId'], '项目不存在。')];
  const errors = titleErrors(title);
  if (!project.memberIds.includes(assigneeId) || !state.employees.some((item) => item.id === assigneeId && item.active))
    errors.push(fieldError(['assigneeId'], '负责人须为在职项目成员。'));
  if (date(dueDate) === null || dueDate > project.dueDate)
    errors.push(fieldError(['dueDate'], '任务期限须为有效日期且不晚于项目期限。'));
  if (
    !Array.isArray(dependencyIds) ||
    dependencyIds.length > 20 ||
    new Set(dependencyIds).size !== dependencyIds.length
  )
    return [...errors, fieldError(['dependencyIds'], '依赖须为不重复的、最多 20 个任务 ID。')];
  dependencyIds.forEach((id, index) => {
    if (id === excludedTaskId || !state.projectTasks.some((item) => item.id === id && item.projectId === project.id))
      errors.push(fieldError(['dependencyIds', index], '依赖必须是同项目其他已有任务。'));
  });
  return errors;
}
function createTaskErrors(state: DemoState, input: ProjectTaskCreateInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const key = replay(state, 'task.create', input);
  if (key.record || key.errors.length) return key.errors;
  const errors = actor(state, input.actorId);
  const project = state.officeProjects.find((item) => item.id === input.projectId);
  if (!project) return [...errors, fieldError(['projectId'], '项目不存在。')];
  if (!project.memberIds.includes(input.actorId)) errors.push(fieldError(['actorId'], '仅项目成员可创建任务。'));
  return [
    ...errors,
    ...taskFields(state, project.id, input.title, input.assigneeId, input.dueDate, input.dependencyIds, null)
  ];
}
function hasCycle(tasks: ProjectTask[]): boolean {
  const lookup = new Map(tasks.map((item) => [item.id, item]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependencyId of lookup.get(id)?.dependencyIds ?? []) {
      if (lookup.has(dependencyId) && visit(dependencyId)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return tasks.some((item) => visit(item.id));
}
function updateTaskErrors(state: DemoState, input: ProjectTaskUpdateInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const key = replay(state, 'task.update', input);
  if (key.record || key.errors.length) return key.errors;
  const errors = actor(state, input.actorId);
  const task = state.projectTasks.find((item) => item.id === input.taskId);
  if (!task) return [...errors, fieldError(['taskId'], '任务不存在。')];
  const project = state.officeProjects.find((item) => item.id === task.projectId);
  if (project?.ownerId !== input.actorId && task.assigneeId !== input.actorId)
    errors.push(fieldError(['actorId'], '仅项目负责人或当前任务负责人可更新。'));
  if (task.businessVersion !== input.expectedVersion)
    errors.push(fieldError(['expectedVersion'], `任务版本应为 ${task.businessVersion}。`));
  errors.push(
    ...taskFields(state, task.projectId, input.title, input.assigneeId, input.dueDate, input.dependencyIds, task.id)
  );
  if (input.status !== 'open' && input.status !== 'done') errors.push(fieldError(['status'], '任务状态无效。'));
  if (Array.isArray(input.dependencyIds) && !errors.some((item) => item.path[0] === 'dependencyIds')) {
    const proposed = state.projectTasks
      .filter((item) => item.projectId === task.projectId)
      .map((item) => (item.id === task.id ? { ...item, dependencyIds: input.dependencyIds } : item));
    if (hasCycle(proposed)) errors.push(fieldError(['dependencyIds'], '任务依赖形成循环。'));
    if (
      input.status === 'done' &&
      input.dependencyIds.some((id) => state.projectTasks.find((item) => item.id === id)?.status !== 'done')
    )
      errors.push(fieldError(['status'], '依赖任务未全部完成，不能标记完成。'));
  }
  return errors;
}
function milestoneErrors(state: DemoState, input: MilestoneUpsertInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const key = replay(state, 'milestone.upsert', input);
  if (key.record || key.errors.length) return key.errors;
  const errors = actor(state, input.actorId);
  const project = state.officeProjects.find((item) => item.id === input.projectId);
  if (!project) return [...errors, fieldError(['projectId'], '项目不存在。')];
  if (project.ownerId !== input.actorId) errors.push(fieldError(['actorId'], '仅项目负责人可维护里程碑。'));
  errors.push(...titleErrors(input.title));
  if (date(input.dueDate) === null || input.dueDate > project.dueDate)
    errors.push(fieldError(['dueDate'], '里程碑期限须为有效日期且不晚于项目期限。'));
  if (
    !Array.isArray(input.taskIds) ||
    input.taskIds.length < 1 ||
    input.taskIds.length > 20 ||
    new Set(input.taskIds).size !== input.taskIds.length
  )
    errors.push(fieldError(['taskIds'], '里程碑须关联 1 到 20 个不重复任务。'));
  else
    input.taskIds.forEach((id, index) => {
      if (!state.projectTasks.some((item) => item.id === id && item.projectId === project.id))
        errors.push(fieldError(['taskIds', index], '里程碑任务须属于当前项目。'));
    });
  if (input.milestoneId === null) {
    if (input.expectedVersion !== null) errors.push(fieldError(['expectedVersion'], '新建里程碑版本须为空。'));
  } else {
    const milestone = state.projectMilestones.find((item) => item.id === input.milestoneId);
    if (!milestone || milestone.projectId !== project.id)
      errors.push(fieldError(['milestoneId'], '里程碑不存在或不属于项目。'));
    else if (milestone.businessVersion !== input.expectedVersion)
      errors.push(fieldError(['expectedVersion'], `里程碑版本应为 ${milestone.businessVersion}。`));
  }
  return errors;
}
function reportErrors(state: DemoState, input: WeeklyReportGenerateInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const key = replay(state, 'weekly-report.generate', input);
  if (key.record || key.errors.length) return key.errors;
  const errors = actor(state, input.actorId);
  const project = state.officeProjects.find((item) => item.id === input.projectId);
  if (!project) return [...errors, fieldError(['projectId'], '项目不存在。')];
  if (project.ownerId !== input.actorId) errors.push(fieldError(['actorId'], '仅项目负责人可生成周报。'));
  return errors;
}
function milestoneStatus(
  state: DemoState,
  milestone: ProjectMilestone,
  currentDay: string
): 'pending' | 'in-progress' | 'overdue' | 'completed' {
  const tasks = milestone.taskIds
    .map((id) => state.projectTasks.find((item) => item.id === id))
    .filter((item): item is ProjectTask => item !== undefined);
  if (tasks.length && tasks.every((item) => item.status === 'done')) return 'completed';
  if (milestone.dueDate < currentDay || tasks.some((item) => item.status === 'open' && item.dueDate < currentDay))
    return 'overdue';
  if (tasks.some((item) => item.status === 'done')) return 'in-progress';
  return 'pending';
}
function weekRange(currentDay: string): { weekStart: string; weekEnd: string } {
  const timestamp = date(currentDay) ?? 0;
  const dayOfWeek = new Date(timestamp).getUTCDay();
  const monday = timestamp - ((dayOfWeek + 6) % 7) * 86_400_000;
  return {
    weekStart: new Date(monday).toISOString().slice(0, 10),
    weekEnd: new Date(monday + 6 * 86_400_000).toISOString().slice(0, 10)
  };
}
function audit(
  state: DemoState,
  entityType: 'office-project' | 'project-task' | 'project-milestone' | 'project-weekly-report',
  entityId: string,
  action: string,
  actorId: string,
  status: string,
  version: number,
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
    fromStatus: null,
    toStatus: status,
    businessVersion: version
  });
}
export class ProjectCollabService {
  constructor(private readonly repository: DemoRepository) {}
  subscribe(listener: () => void): () => void {
    return this.repository.subscribe(listener);
  }
  snapshot(): DemoState {
    return this.repository.snapshot();
  }
  validateRead(input: ProjectReadInput): AwcpFieldError[] {
    return actor(this.repository.snapshot(), input.actorId);
  }
  read(input: ProjectReadInput): JsonObject {
    const state = this.repository.snapshot();
    valid(actor(state, input.actorId));
    const currentDay = today(this.repository.clock.now());
    return JSON.parse(
      JSON.stringify({
        today: currentDay,
        projects: state.officeProjects,
        tasks: state.projectTasks,
        milestones: state.projectMilestones.map((item) => ({
          ...item,
          status: milestoneStatus(state, item, currentDay)
        })),
        reports: state.projectWeeklyReports
      })
    ) as JsonObject;
  }
  validateProject(input: ProjectCreateInput): AwcpFieldError[] {
    return projectErrors(this.repository.snapshot(), input, today(this.repository.clock.now()));
  }
  createProject(input: ProjectCreateInput): ProjectResult {
    return this.repository.transact((state) => {
      const key = replay(state, 'project.create', input);
      valid(key.errors);
      if (key.record) return { ...key.record.result };
      const at = this.repository.clock.now();
      valid(projectErrors(state, input, today(at)));
      const project = {
        id: nextId(
          'PRJ',
          state.officeProjects.map((item) => item.id)
        ),
        title: input.title.trim(),
        ownerId: input.actorId,
        memberIds: [...input.memberIds],
        dueDate: input.dueDate,
        businessVersion: 1,
        createdAt: at
      };
      state.officeProjects.push(project);
      audit(state, 'office-project', project.id, 'create', input.actorId, 'active', 1, at);
      const result = { id: project.id, status: 'active', businessVersion: 1 };
      remember(state, 'project.create', input, result);
      return result;
    });
  }
  validateTaskCreate(input: ProjectTaskCreateInput): AwcpFieldError[] {
    return createTaskErrors(this.repository.snapshot(), input);
  }
  createTask(input: ProjectTaskCreateInput): ProjectResult {
    return this.repository.transact((state) => {
      const key = replay(state, 'task.create', input);
      valid(key.errors);
      if (key.record) return { ...key.record.result };
      valid(createTaskErrors(state, input));
      const at = this.repository.clock.now();
      const task: ProjectTask = {
        id: nextId(
          'PTASK',
          state.projectTasks.map((item) => item.id)
        ),
        projectId: input.projectId,
        title: input.title.trim(),
        assigneeId: input.assigneeId,
        dueDate: input.dueDate,
        dependencyIds: [...input.dependencyIds],
        status: 'open',
        businessVersion: 1,
        createdAt: at,
        completedAt: null
      };
      state.projectTasks.push(task);
      audit(state, 'project-task', task.id, 'create', input.actorId, task.status, 1, at);
      const result = { id: task.id, status: task.status, businessVersion: 1 };
      remember(state, 'task.create', input, result);
      return result;
    });
  }
  validateTaskUpdate(input: ProjectTaskUpdateInput): AwcpFieldError[] {
    return updateTaskErrors(this.repository.snapshot(), input);
  }
  updateTask(input: ProjectTaskUpdateInput): ProjectResult {
    return this.repository.transact((state) => {
      const key = replay(state, 'task.update', input);
      valid(key.errors);
      if (key.record) return { ...key.record.result };
      valid(updateTaskErrors(state, input));
      const task = state.projectTasks.find((item) => item.id === input.taskId);
      if (!task) throw businessError('action.task-not-found', '任务不存在。');
      const at = this.repository.clock.now();
      task.title = input.title.trim();
      task.assigneeId = input.assigneeId;
      task.dueDate = input.dueDate;
      task.dependencyIds = [...input.dependencyIds];
      if (task.status !== input.status) task.completedAt = input.status === 'done' ? at : null;
      task.status = input.status;
      task.businessVersion += 1;
      audit(state, 'project-task', task.id, 'update', input.actorId, task.status, task.businessVersion, at);
      const result = { id: task.id, status: task.status, businessVersion: task.businessVersion };
      remember(state, 'task.update', input, result);
      return result;
    });
  }
  validateMilestone(input: MilestoneUpsertInput): AwcpFieldError[] {
    return milestoneErrors(this.repository.snapshot(), input);
  }
  upsertMilestone(input: MilestoneUpsertInput): ProjectResult {
    return this.repository.transact((state) => {
      const key = replay(state, 'milestone.upsert', input);
      valid(key.errors);
      if (key.record) return { ...key.record.result };
      valid(milestoneErrors(state, input));
      let milestone = state.projectMilestones.find((item) => item.id === input.milestoneId);
      if (!milestone) {
        milestone = {
          id: nextId(
            'PMS',
            state.projectMilestones.map((item) => item.id)
          ),
          projectId: input.projectId,
          title: input.title.trim(),
          dueDate: input.dueDate,
          taskIds: [...input.taskIds],
          businessVersion: 1
        };
        state.projectMilestones.push(milestone);
      } else {
        milestone.title = input.title.trim();
        milestone.dueDate = input.dueDate;
        milestone.taskIds = [...input.taskIds];
        milestone.businessVersion += 1;
      }
      const at = this.repository.clock.now();
      const status = milestoneStatus(state, milestone, today(at));
      audit(state, 'project-milestone', milestone.id, 'upsert', input.actorId, status, milestone.businessVersion, at);
      const result = { id: milestone.id, status, businessVersion: milestone.businessVersion };
      remember(state, 'milestone.upsert', input, result);
      return result;
    });
  }
  validateReport(input: WeeklyReportGenerateInput): AwcpFieldError[] {
    return reportErrors(this.repository.snapshot(), input);
  }
  generateReport(input: WeeklyReportGenerateInput): ProjectResult {
    return this.repository.transact((state) => {
      const key = replay(state, 'weekly-report.generate', input);
      valid(key.errors);
      if (key.record) return { ...key.record.result };
      valid(reportErrors(state, input));
      const at = this.repository.clock.now();
      const currentDay = today(at);
      const { weekStart, weekEnd } = weekRange(currentDay);
      const tasks = state.projectTasks.filter((item) => item.projectId === input.projectId);
      const report = {
        id: nextId(
          'PWREP',
          state.projectWeeklyReports.map((item) => item.id)
        ),
        projectId: input.projectId,
        generatedBy: input.actorId,
        generatedAt: at,
        weekStart,
        weekEnd,
        taskFacts: tasks.map((item) => ({
          id: item.id,
          status: item.status,
          assigneeId: item.assigneeId,
          dueDate: item.dueDate,
          businessVersion: item.businessVersion,
          dependencyIds: [...item.dependencyIds]
        })),
        incompleteTaskIds: tasks.filter((item) => item.status === 'open').map((item) => item.id),
        overdueTaskIds: tasks
          .filter((item) => item.status === 'open' && item.dueDate < currentDay)
          .map((item) => item.id),
        milestoneFacts: state.projectMilestones
          .filter((item) => item.projectId === input.projectId)
          .map((item) => ({ id: item.id, status: milestoneStatus(state, item, currentDay) }))
      };
      state.projectWeeklyReports.push(report);
      audit(state, 'project-weekly-report', report.id, 'generate', input.actorId, 'generated', 1, at);
      const result = { id: report.id, status: 'generated', businessVersion: 1 };
      remember(state, 'weekly-report.generate', input, result);
      return result;
    });
  }
}
