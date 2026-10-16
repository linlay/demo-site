import { useCurrentActor } from '../../app/currentUserContext';
import { useWorkflowAction as useAwcpAction } from '../../app/useWorkflowAction';
import type { AwcpActionRegistration } from '@app/awcp';
import { useEffect, useState, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import {
  HR_READ_SCHEMA,
  PERSONNEL_PROCESS_SCHEMA,
  TRAINING_COMPLETE_SCHEMA,
  TRAINING_ENROLL_SCHEMA,
  TRAINING_QUERY_SCHEMA
} from '../../common/awcp/hrSchemas';
import type { DemoRepository } from '../../common/store/repository';
import {
  HrService,
  type HrReadInput,
  type PersonnelProcessInput,
  type TrainingCompleteInput,
  type TrainingEnrollInput,
  type TrainingQueryInput
} from '../service/hrService';
import styles from './O10HrPage.module.css';

const READ: HrReadInput = { actorId: 'EMP-001', employeeId: 'EMP-001' };
const PERSONNEL: PersonnelProcessInput = {
  actorId: 'EMP-004',
  employeeId: 'EMP-003',
  kind: 'transfer',
  targetDepartmentId: 'DEP-001',
  targetPosition: null,
  materialIds: ['PMAT-003'],
  expectedVersion: 1,
  idempotencyKey: 'o10-personnel-example'
};
const TRAINING_QUERY: TrainingQueryInput = { ...READ, courseId: 'TRN-001' };
const TRAINING_ENROLL: TrainingEnrollInput = {
  ...READ,
  courseId: 'TRN-001',
  idempotencyKey: 'o10-training-enroll-example'
};
const TRAINING_COMPLETE: TrainingCompleteInput = {
  actorId: 'EMP-004',
  employeeId: 'EMP-003',
  courseId: 'TRN-002',
  expectedVersion: 1,
  idempotencyKey: 'o10-training-complete-example'
};

function guide(purpose: string, prerequisites: string, effects: string): string {
  return describeAction({
    purpose,
    prerequisites,
    parameters: '提供虚构员工 ID、日期或资料/课程 ID；写操作附稳定幂等键，人员办理和培训完成附业务版本。',
    effects,
    result: '返回记录 ID、员工、状态与版本，或员工档案及课程名额。',
    failures: '时间、余额、必需资料、权限、名额或版本不符时返回字段错误且不写入。'
  });
}
function key(): string {
  return `o10-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function O10HrPage({
  repository,
  objectId
}: {
  repository: DemoRepository;
  objectId?: string;
}): ReactElement {
  const [service] = useState(() => new HrService(repository));
  const actorId = useCurrentActor('EMP-001');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(() => {
    const state = repository.snapshot();
    return state.leaveRequests.find((item) => item.id === objectId)?.employeeId ??
      state.attendanceCorrections.find((item) => item.id === objectId)?.employeeId ?? objectId ?? 'EMP-001';
  });
  const [kind, setKind] = useState<PersonnelProcessInput['kind']>('transfer');
  const [targetDepartmentId, setTargetDepartmentId] = useState('DEP-002');
  const [targetPosition, setTargetPosition] = useState('虚构新岗位');
  const [materialIds, setMaterialIds] = useState<string[]>(['PMAT-003']);
  const [courseId, setCourseId] = useState('TRN-001');
  const [message, setMessage] = useState('');
  const [, setRevision] = useState(0);
  useEffect(() => service.subscribe(() => setRevision((value) => value + 1)), [service]);
  const actor = repository.snapshot().employees.find((item) => item.id === actorId);
  const isHr = !!actor?.roles.includes('hr');
  const employeeId = isHr ? selectedEmployeeId : actorId;
  const view = service.read({ actorId, employeeId });
  const personnelVersion = Number(view.personnelVersion);
  const training = service.queryTraining({ actorId, employeeId, courseId });
  const course = (
    training.courses as Array<{
      courseId: string;
      title: string;
      capacity: number;
      enrolledCount: number;
      available: number;
      enrollment: { id: string; status: string; businessVersion: number } | null;
    }>
  )[0];
  const personnelHistory = view.personnelHistory as Array<{ id: string; kind: string; businessVersion: number }>;

  function run(action: () => string): void {
    try {
      setMessage(action());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败。');
    }
  }
  function chooseKind(value: PersonnelProcessInput['kind']): void {
    setKind(value);
    setMaterialIds(
      value === 'onboard'
        ? ['PMAT-001', 'PMAT-002']
        : value === 'transfer'
          ? ['PMAT-003']
          : value === 'role-change'
            ? ['PMAT-004']
            : ['PMAT-005']
    );
  }

  const readAction: AwcpActionRegistration<HrReadInput> = {
    action: 'office.hr.read',
    title: '读取员工人事与考勤',
    description: guide('读取余额、休假与补卡记录、人员档案和归档变更。', '员工本人或人事专员。', '只读。'),
    inputSchema: HR_READ_SCHEMA,
    examples: [READ],
    validate: (args) => service.validateRead(args),
    invoke: (args) => completed(service.read(args))
  };
  useAwcpAction(readAction);
  const personnelAction: AwcpActionRegistration<PersonnelProcessInput> = {
    action: 'office.personnel.process',
    title: '办理人事资料',
    description: guide(
      '办理虚构入职、部门调动、岗位变更或离职。',
      '人事专员、当前档案版本及办理类型的必需资料。',
      '更新员工状态或部门并归档前后变更。'
    ),
    inputSchema: PERSONNEL_PROCESS_SCHEMA,
    examples: [PERSONNEL],
    validate: (args) => service.validatePersonnel(args),
    invoke: (args) => completed(service.processPersonnel(args))
  };
  useAwcpAction(personnelAction);
  const trainingQueryAction: AwcpActionRegistration<TrainingQueryInput> = {
    action: 'office.training.query',
    title: '查询培训名额与状态',
    description: guide('查看课程容量、已报名数和员工完成状态。', '员工本人或人事专员。', '只读。'),
    inputSchema: TRAINING_QUERY_SCHEMA,
    examples: [TRAINING_QUERY],
    validate: (args) => service.validateTrainingQuery(args),
    invoke: (args) => completed(service.queryTraining(args))
  };
  useAwcpAction(trainingQueryAction);
  const trainingEnrollAction: AwcpActionRegistration<TrainingEnrollInput> = {
    action: 'office.training.enroll',
    title: '报名培训课程',
    description: guide(
      '在课程有名额时为本人报名。',
      '在职员工本人；重复报名返回原记录。',
      '创建一条报名，不重复占位。'
    ),
    inputSchema: TRAINING_ENROLL_SCHEMA,
    examples: [TRAINING_ENROLL],
    validate: (args) => service.validateEnroll(args),
    invoke: (args) => completed(service.enroll(args))
  };
  useAwcpAction(trainingEnrollAction);
  const trainingCompleteAction: AwcpActionRegistration<TrainingCompleteInput> = {
    action: 'office.training.complete',
    title: '登记培训完成',
    description: guide(
      '人事专员登记已有报名的培训完成。',
      '报名仍未完成，版本一致。',
      '记录完成时间与办理人，保留占位历史。'
    ),
    inputSchema: TRAINING_COMPLETE_SCHEMA,
    examples: [TRAINING_COMPLETE],
    validate: (args) => service.validateComplete(args),
    invoke: (args) => completed(service.complete(args))
  };
  useAwcpAction(trainingCompleteAction);

  return (
    <section className={styles.page} aria-label="人事考勤事项办理">
      <div className={styles.panel}>
        <h2>员工档案</h2>
        <div className={styles.grid}>


          <label htmlFor="o10-employee">员工</label>
          <select
            id="o10-employee"
            value={employeeId}
            disabled={!isHr}
            onChange={(event) => setSelectedEmployeeId(event.target.value)}
          >
            {service.actors().map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}（{item.id}）{item.active ? '' : ' · 停用'}
              </option>
            ))}
          </select>
        </div>
        <p>
          {employeeId} · 部门 {String(view.departmentId)} · {view.active ? '在职' : '停用'} · 岗位{' '}
          {String(view.position)} · 档案版本 {personnelVersion}
        </p>
        <p>
          休假总额 {String(view.totalLeaveDays)} 天，剩余 {String(view.remainingLeaveDays)} 天。
        </p>
      </div>
      <div className={styles.panel}>
        <h2>人员资料办理</h2>
        <div className={styles.grid}>
          <label htmlFor="o10-kind">办理类型</label>
          <select
            id="o10-kind"
            value={kind}
            onChange={(event) => chooseKind(event.target.value as PersonnelProcessInput['kind'])}
          >
            <option value="onboard">入职</option>
            <option value="transfer">部门调动</option>
            <option value="role-change">岗位变更</option>
            <option value="offboard">离职</option>
          </select>
          <label htmlFor="o10-target-department">目标部门</label>
          <select
            id="o10-target-department"
            disabled={kind !== 'onboard' && kind !== 'transfer'}
            value={targetDepartmentId}
            onChange={(event) => setTargetDepartmentId(event.target.value)}
          >
            {service.departments().map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <label htmlFor="o10-target-position">新岗位</label>
          <input
            id="o10-target-position"
            disabled={kind !== 'role-change'}
            value={targetPosition}
            onChange={(event) => setTargetPosition(event.target.value)}
          />
        </div>
        <fieldset className={styles.materials}>
          <legend>办理资料</legend>
          {service.materials().map((item) => (
            <label key={item.id}>
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
        </fieldset>
        <div className={styles.actions}>
          <button
            type="button"
            disabled={!isHr}
            onClick={() =>
              run(() => {
                const value = service.processPersonnel({
                  actorId,
                  employeeId,
                  kind,
                  targetDepartmentId: kind === 'onboard' || kind === 'transfer' ? targetDepartmentId : null,
                  targetPosition: kind === 'role-change' ? targetPosition : null,
                  materialIds,
                  expectedVersion: personnelVersion,
                  idempotencyKey: key()
                });
                return `已归档人员变更 ${value.id}，版本 ${value.businessVersion}。`;
              })
            }
          >
            办理并归档
          </button>
        </div>
        <ul>
          {personnelHistory.map((item) => (
            <li key={item.id}>
              {item.id} · {item.kind} · 版本 {item.businessVersion}
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.panel}>
        <h2>培训报名与完成</h2>
        <div className={styles.grid}>
          <label htmlFor="o10-course">课程</label>
          <select id="o10-course" value={courseId} onChange={(event) => setCourseId(event.target.value)}>
            {(
              service.queryTraining({ actorId, employeeId, courseId: null }).courses as Array<{
                courseId: string;
                title: string;
              }>
            ).map((item) => (
              <option key={item.courseId} value={item.courseId}>
                {item.title}（{item.courseId}）
              </option>
            ))}
          </select>
        </div>
        <p>
          {course?.title} · 名额 {course?.capacity} · 已报名 {course?.enrolledCount} · 剩余 {course?.available} ·
          本员工状态 {course?.enrollment?.status ?? '未报名'}
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            disabled={actorId !== employeeId || !view.active}
            onClick={() =>
              run(() => {
                const value = service.enroll({ actorId, employeeId, courseId, idempotencyKey: key() });
                return `报名记录 ${value.id}，状态 ${value.status}。`;
              })
            }
          >
            报名培训
          </button>
          <button
            type="button"
            disabled={!isHr || course?.enrollment?.status !== 'enrolled'}
            onClick={() =>
              run(() => {
                const value = service.complete({
                  actorId,
                  employeeId,
                  courseId,
                  expectedVersion: course?.enrollment?.businessVersion ?? 0,
                  idempotencyKey: key()
                });
                return `已登记培训完成 ${value.id}。`;
              })
            }
          >
            登记完成
          </button>
        </div>
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
