import { useCurrentActor } from '../../app/currentUserContext';
import { useWorkflowAction as useAwcpAction } from '../../app/useWorkflowAction';
import type { AwcpActionRegistration } from '@app/awcp';
import { useEffect, useState, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import {
  PROJECT_MILESTONE_UPSERT_SCHEMA,
  PROJECT_READ_SCHEMA,
  PROJECT_TASK_CREATE_SCHEMA,
  PROJECT_TASK_UPDATE_SCHEMA,
  WEEKLY_REPORT_GENERATE_SCHEMA
} from '../../common/awcp/projectCollabSchemas';
import type { DemoRepository } from '../../common/store/repository';
import {
  ProjectCollabService,
  type MilestoneUpsertInput,
  type ProjectReadInput,
  type ProjectTaskCreateInput,
  type ProjectTaskUpdateInput,
  type WeeklyReportGenerateInput
} from '../service/projectCollabService';
import styles from './O14ProjectPage.module.css';

const READ: ProjectReadInput = { actorId: 'EMP-001' };
const TASK_CREATE: ProjectTaskCreateInput = {
  actorId: 'EMP-001',
  projectId: 'PRJ-001',
  title: '准备虚构培训演示',
  assigneeId: 'EMP-003',
  dueDate: '2026-09-26',
  dependencyIds: ['PTASK-001'],
  idempotencyKey: 'o14-task-create-example'
};
const TASK_UPDATE: ProjectTaskUpdateInput = {
  actorId: 'EMP-003',
  taskId: 'PTASK-002',
  title: '完成虚构界面联调',
  assigneeId: 'EMP-003',
  dueDate: '2026-09-18',
  dependencyIds: ['PTASK-001'],
  status: 'done',
  expectedVersion: 1,
  idempotencyKey: 'o14-task-update-example'
};
const MILESTONE: MilestoneUpsertInput = {
  actorId: 'EMP-001',
  projectId: 'PRJ-001',
  milestoneId: 'PMS-002',
  expectedVersion: 1,
  title: '演示上线',
  dueDate: '2026-09-25',
  taskIds: ['PTASK-002', 'PTASK-003'],
  idempotencyKey: 'o14-milestone-example'
};
const REPORT: WeeklyReportGenerateInput = {
  actorId: 'EMP-001',
  projectId: 'PRJ-001',
  idempotencyKey: 'o14-report-example'
};
function guide(purpose: string, prerequisites: string, effects: string): string {
  return describeAction({
    purpose,
    prerequisites,
    parameters: '提供虚构项目、任务、成员和日期；写操作带稳定幂等键，更新带当前业务版本。',
    effects,
    result: '返回项目、任务、里程碑或周报 ID、状态和版本。',
    failures: '依赖不存在或成环、负责人无效、版本过期或权限不足时返回字段错误且不写入。'
  });
}
function key(): string {
  return `o14-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
export default function O14ProjectPage({
  repository,
  objectId
}: {
  repository: DemoRepository;
  objectId?: string;
}): ReactElement {
  const [service] = useState(() => new ProjectCollabService(repository));
  const [, setRevision] = useState(0);
  useEffect(() => service.subscribe(() => setRevision((value) => value + 1)), [service]);
  const actorId = useCurrentActor('EMP-001');
  const [projectId] = useState(() => objectId?.startsWith('PRJ-') ? objectId : repository.snapshot().projectTasks.find((item) => item.id === objectId)?.projectId ?? 'PRJ-001');
  const [taskId, setTaskId] = useState(() => objectId?.startsWith('PTASK-') ? objectId : 'PTASK-002');
  const [taskTitle, setTaskTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [dependencyIds, setDependencyIds] = useState<string[]>([]);
  const [taskStatus, setTaskStatus] = useState<ProjectTaskUpdateInput['status']>('open');
  const [milestoneId, setMilestoneId] = useState<string | null>('PMS-002');
  const [milestoneTitle, setMilestoneTitle] = useState('');
  const [milestoneDueDate, setMilestoneDueDate] = useState('');
  const [milestoneTaskIds, setMilestoneTaskIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const state = service.snapshot();
  const view = service.read({ actorId });
  const task = state.projectTasks.find((item) => item.id === taskId);
  const milestone = state.projectMilestones.find((item) => item.id === milestoneId);
  const projectTasks = state.projectTasks.filter((item) => item.projectId === projectId);
  const derivedMilestones = view.milestones as Array<{ id: string; projectId: string; status: string }>;
  useEffect(() => {
    const selected = repository.snapshot().projectTasks.find((item) => item.id === taskId);
    if (!selected) return;
    setTaskTitle(selected.title);
    setAssigneeId(selected.assigneeId);
    setTaskDueDate(selected.dueDate);
    setDependencyIds([...selected.dependencyIds]);
    setTaskStatus(selected.status);
  }, [repository, taskId]);
  useEffect(() => {
    const selected = repository.snapshot().projectMilestones.find((item) => item.id === milestoneId);
    if (!selected) return;
    setMilestoneTitle(selected.title);
    setMilestoneDueDate(selected.dueDate);
    setMilestoneTaskIds([...selected.taskIds]);
  }, [repository, milestoneId]);
  function run(action: () => string): void {
    try {
      setMessage(action());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败。');
    }
  }
  const readAction: AwcpActionRegistration<ProjectReadInput> = {
    action: 'office.project.read',
    title: '读取项目与周报',
    description: guide('查看项目、任务依赖、里程碑计算状态与历史周报。', '在职员工。', '只读。'),
    inputSchema: PROJECT_READ_SCHEMA,
    examples: [READ],
    validate: (args) => service.validateRead(args),
    invoke: (args) => completed(service.read(args))
  };
  useAwcpAction(readAction);
  const taskCreateAction: AwcpActionRegistration<ProjectTaskCreateInput> = {
    action: 'office.task.create',
    title: '拆解项目任务',
    description: guide(
      '在项目中创建负责人、期限与依赖完整的任务。',
      '项目成员、同项目已有依赖和有效负责人。',
      '保存任务及依赖 ID。'
    ),
    inputSchema: PROJECT_TASK_CREATE_SCHEMA,
    examples: [TASK_CREATE],
    validate: (args) => service.validateTaskCreate(args),
    invoke: (args) => completed(service.createTask(args))
  };
  useAwcpAction(taskCreateAction);
  const taskUpdateAction: AwcpActionRegistration<ProjectTaskUpdateInput> = {
    action: 'office.task.update',
    title: '维护任务依赖与进度',
    description: guide(
      '更新任务内容、负责人、期限、依赖和完成状态。',
      '项目负责人或任务负责人，当前版本；依赖不得形成环。',
      '保存新版本并影响里程碑计算状态。'
    ),
    inputSchema: PROJECT_TASK_UPDATE_SCHEMA,
    examples: [TASK_UPDATE],
    validate: (args) => service.validateTaskUpdate(args),
    invoke: (args) => completed(service.updateTask(args))
  };
  useAwcpAction(taskUpdateAction);
  const milestoneAction: AwcpActionRegistration<MilestoneUpsertInput> = {
    action: 'office.milestone.upsert',
    title: '维护项目里程碑',
    description: guide(
      '创建或更新里程碑与任务清单。',
      '项目负责人、同项目任务及当前版本。',
      '保存里程碑；状态从任务和时钟重算。'
    ),
    inputSchema: PROJECT_MILESTONE_UPSERT_SCHEMA,
    examples: [MILESTONE],
    validate: (args) => service.validateMilestone(args),
    invoke: (args) => completed(service.upsertMilestone(args))
  };
  useAwcpAction(milestoneAction);
  const reportAction: AwcpActionRegistration<WeeklyReportGenerateInput> = {
    action: 'office.weekly-report.generate',
    title: '生成项目周报',
    description: guide(
      '从当前项目事实生成当周快照与逾期清单。',
      '项目负责人。',
      '保存任务、里程碑状态与可追溯任务 ID；历史周报不改写。'
    ),
    inputSchema: WEEKLY_REPORT_GENERATE_SCHEMA,
    examples: [REPORT],
    validate: (args) => service.validateReport(args),
    invoke: (args) => completed(service.generateReport(args))
  };
  useAwcpAction(reportAction);

  return (
    <main className={styles.page}>

      <section>
        <h2>拆解与更新任务</h2>
        <label>
          任务{' '}
          <select
            id="o14-task"
            value={taskId}
            onChange={(e) => {
              const selected = state.projectTasks.find((item) => item.id === e.target.value);
              setTaskId(e.target.value);
              if (selected) {
                setTaskTitle(selected.title);
                setAssigneeId(selected.assigneeId);
                setTaskDueDate(selected.dueDate);
                setDependencyIds([...selected.dependencyIds]);
                setTaskStatus(selected.status);
              } else { setTaskTitle(''); setAssigneeId(''); setTaskDueDate(''); setDependencyIds([]); setTaskStatus('open'); }
            }}
          >
            <option value="">新任务</option>
            {projectTasks.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} {item.title}（{item.status}）
              </option>
            ))}
          </select>
        </label>
        <label>
          标题 <input aria-label="任务标题" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
        </label>
        <label>
          负责人{' '}
          <select aria-label="任务负责人" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">请选择</option>
            {state.employees
              .filter((item) => item.active)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id}
                </option>
              ))}
          </select>
        </label>
        <label>
          期限{' '}
          <input
            aria-label="任务期限"
            type="date"
            value={taskDueDate}
            onChange={(e) => setTaskDueDate(e.target.value)}
          />
        </label>
        <div>
          依赖：
          {projectTasks
            .filter((item) => item.id !== taskId)
            .map((item) => (
              <label key={item.id}>
                <input
                  type="checkbox"
                  checked={dependencyIds.includes(item.id)}
                  onChange={(e) =>
                    setDependencyIds(
                      e.target.checked ? [...dependencyIds, item.id] : dependencyIds.filter((id) => id !== item.id)
                    )
                  }
                />
                {item.id}
              </label>
            ))}
        </div>
        <label>
          状态{' '}
          <select
            aria-label="任务状态"
            value={taskStatus}
            onChange={(e) => setTaskStatus(e.target.value as ProjectTaskUpdateInput['status'])}
          >
            <option value="open">未完成</option>
            <option value="done">已完成</option>
          </select>
        </label>
        <button
          disabled={!!taskId || !taskTitle.trim() || !assigneeId || !taskDueDate}
          onClick={() =>
            run(() => {
              const result = service.createTask({
                actorId,
                projectId,
                title: taskTitle,
                assigneeId,
                dueDate: taskDueDate,
                dependencyIds,
                idempotencyKey: key()
              });
              setTaskId(result.id);
              return `已创建任务 ${result.id}`;
            })
          }
        >
          创建任务
        </button>
        <button
          disabled={!taskId || !taskTitle.trim() || !assigneeId || !taskDueDate}
          onClick={() =>
            run(() => {
              const result = service.updateTask({
                actorId,
                taskId,
                title: taskTitle,
                assigneeId,
                dueDate: taskDueDate,
                dependencyIds,
                status: taskStatus,
                expectedVersion: task?.businessVersion ?? 0,
                idempotencyKey: key()
              });
              return `已更新任务 ${result.id}`;
            })
          }
        >
          更新任务
        </button>
        {projectTasks.map((item) => (
          <p key={item.id}>
            {item.id} {item.title}，负责人 {item.assigneeId}， 期限 {item.dueDate}，依赖{' '}
            {item.dependencyIds.join('、') || '无'}，状态 {item.status}，v{item.businessVersion}
          </p>
        ))}
      </section>
      <section>
        <h2>里程碑</h2>
        <label>
          里程碑{' '}
          <select
            id="o14-milestone"
            value={milestoneId ?? ''}
            onChange={(e) => {
              const selected = state.projectMilestones.find((item) => item.id === e.target.value);
              setMilestoneId(e.target.value || null);
              if (selected) {
                setMilestoneTitle(selected.title);
                setMilestoneDueDate(selected.dueDate);
                setMilestoneTaskIds([...selected.taskIds]);
              } else { setMilestoneTitle(''); setMilestoneDueDate(''); setMilestoneTaskIds([]); }
            }}
          >
            <option value="">新里程碑</option>
            {state.projectMilestones
              .filter((item) => item.projectId === projectId)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id} {item.title}
                </option>
              ))}
          </select>
        </label>
        <label>
          标题{' '}
          <input aria-label="里程碑标题" value={milestoneTitle} onChange={(e) => setMilestoneTitle(e.target.value)} />
        </label>
        <label>
          期限{' '}
          <input
            aria-label="里程碑期限"
            type="date"
            value={milestoneDueDate}
            onChange={(e) => setMilestoneDueDate(e.target.value)}
          />
        </label>
        <div>
          关联任务：
          {projectTasks.map((item) => (
            <label key={item.id}>
              <input
                type="checkbox"
                checked={milestoneTaskIds.includes(item.id)}
                onChange={(e) =>
                  setMilestoneTaskIds(
                    e.target.checked ? [...milestoneTaskIds, item.id] : milestoneTaskIds.filter((id) => id !== item.id)
                  )
                }
              />
              {item.id}
            </label>
          ))}
        </div>
        <button
          disabled={!milestoneTitle.trim() || !milestoneDueDate || milestoneTaskIds.length === 0}
          onClick={() =>
            run(() => {
              const result = service.upsertMilestone({
                actorId,
                projectId,
                milestoneId,
                expectedVersion: milestone?.businessVersion ?? null,
                title: milestoneTitle,
                dueDate: milestoneDueDate,
                taskIds: milestoneTaskIds,
                idempotencyKey: key()
              });
              setMilestoneId(result.id);
              return `里程碑 ${result.id}：${result.status}`;
            })
          }
        >
          保存里程碑
        </button>
        {derivedMilestones
          .filter((item) => item.projectId === projectId)
          .map((item) => (
            <p key={item.id}>
              {item.id} 状态 {item.status}（从关联任务和演示时钟计算）
            </p>
          ))}
      </section>
      <section>
        <h2>周报与逾期清单</h2>
        <button
          onClick={() =>
            run(() => {
              const result = service.generateReport({ actorId, projectId, idempotencyKey: key() });
              return `已生成周报 ${result.id}`;
            })
          }
        >
          生成周报
        </button>
        {state.projectWeeklyReports
          .filter((item) => item.projectId === projectId)
          .map((item) => (
            <article key={item.id}>
              <h3>
                {item.id}（{item.weekStart}～{item.weekEnd}）
              </h3>
              <p>
                未完成：{item.incompleteTaskIds.join('、') || '无'}；逾期：{item.overdueTaskIds.join('、') || '无'}。
              </p>
              <p>
                任务来源：
                {item.taskFacts.map((fact) => `${fact.id} v${fact.businessVersion} ${fact.status}`).join('；')}。
              </p>
            </article>
          ))}
      </section>
      {message && <p role="status">{message}</p>}
    </main>
  );
}
