import { workflowErrors } from './workflowAccess';
import type { AwcpFieldError, JsonObject } from '@app/awcp';

import { businessError, fieldError } from '../../common/awcp/contracts';
import type { DemoState, HrOperationRecord, PersonnelChange, PersonnelProfile } from '../../common/fixtures/types';
import type { DemoRepository } from '../../common/store/repository';

export interface HrReadInput extends JsonObject {
  actorId: string;
  employeeId: string;
}
export interface LeaveSubmitInput extends HrReadInput {
  startDate: string;
  endDate: string;
  reason: string;
  idempotencyKey: string;
}
export interface AttendanceCorrectInput extends HrReadInput {
  date: string;
  checkIn: string;
  checkOut: string;
  reason: string;
  idempotencyKey: string;
}
export interface PersonnelProcessInput extends HrReadInput {
  kind: PersonnelChange['kind'];
  targetDepartmentId: string | null;
  targetPosition: string | null;
  materialIds: string[];
  expectedVersion: number;
  idempotencyKey: string;
}
export interface TrainingQueryInput extends HrReadInput {
  courseId: string | null;
}
export interface TrainingEnrollInput extends HrReadInput {
  courseId: string;
  idempotencyKey: string;
}
export interface TrainingCompleteInput extends TrainingEnrollInput {
  expectedVersion: number;
}
export interface HrResult extends JsonObject {
  id: string;
  employeeId: string;
  status: string;
  businessVersion: number;
}

type Operation = HrOperationRecord['operation'];

function nextId(prefix: string, ids: string[]): string {
  const next =
    Math.max(
      0,
      ...ids.map((item) => {
        const match = new RegExp(`^${prefix}-([0-9]+)$`).exec(item);
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
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([name, item]) => [name, ordered(item)])
      );
    return value;
  };
  return JSON.stringify(ordered(payload));
}

function idempotency(
  state: DemoState,
  operation: Operation,
  input: { idempotencyKey: string } & JsonObject
): { errors: AwcpFieldError[]; replay: HrOperationRecord | null } {
  if (typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.idempotencyKey))
    return { errors: [fieldError(['idempotencyKey'], '业务幂等键格式无效。')], replay: null };
  const record = state.hrOperationRecords.find((item) => item.idempotencyKey === input.idempotencyKey);
  if (!record) return { errors: [], replay: null };
  return record.operation === operation && record.fingerprint === fingerprint(input)
    ? { errors: [], replay: record }
    : { errors: [fieldError(['idempotencyKey'], '业务幂等键已用于其他操作或参数。')], replay: null };
}

function remember(state: DemoState, operation: Operation, input: JsonObject, result: HrResult): void {
  state.hrOperationRecords.push({
    idempotencyKey: String(input.idempotencyKey),
    operation,
    fingerprint: fingerprint(input),
    result: {
      id: result.id,
      employeeId: result.employeeId,
      status: result.status,
      businessVersion: result.businessVersion
    }
  });
}

function assertValid(errors: AwcpFieldError[]): void {
  if (errors.length)
    throw businessError(
      'action.invalid-hr-request',
      errors.flatMap((item) => item.messages).join('；'),
      errors.map((item) => ({ path: item.path, messages: item.messages }))
    );
}

function actorErrors(state: DemoState, actorId: string, employeeId: string, hrAllowed: boolean): AwcpFieldError[] {
  const errors: AwcpFieldError[] = [];
  const actor = state.employees.find((item) => item.id === actorId && item.active);
  const employee = state.employees.find((item) => item.id === employeeId);
  if (!actor) errors.push(fieldError(['actorId'], '操作人不存在或已离职。'));
  if (!employee) errors.push(fieldError(['employeeId'], '员工不存在。'));
  if (actor && employee && actor.id !== employee.id && !(hrAllowed && actor.roles.includes('hr')))
    errors.push(fieldError(['actorId'], '只能处理本人记录或由人事专员办理。'));
  return errors;
}

function dateValue(date: string): number | null {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const value = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === date ? value : null;
}
function shanghaiDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(iso));
}
function clockMinutes(value: string): number | null {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}
function profile(state: DemoState, employeeId: string): PersonnelProfile {
  return (
    state.personnelProfiles.find((item) => item.employeeId === employeeId) ?? {
      employeeId,
      position: '演示员工',
      businessVersion: 1
    }
  );
}
function audit(
  state: DemoState,
  entityType: 'leave' | 'attendance-correction' | 'personnel-change' | 'training-enrollment',
  entityId: string,
  action: string,
  actorId: string,
  toStatus: string,
  version: number,
  at: string,
  note?: string
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
    toStatus,
    businessVersion: version,
    ...(note ? { note } : {})
  });
}

function leaveErrors(state: DemoState, input: LeaveSubmitInput, today: string): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const key = idempotency(state, 'leave.submit', input);
  if (key.replay || key.errors.length) return key.errors;
  const errors = actorErrors(state, input.actorId, input.employeeId, false);
  const employee = state.employees.find((item) => item.id === input.employeeId);
  if (employee && !employee.active) errors.push(fieldError(['employeeId'], '离职员工不能申请休假。'));
  const start = dateValue(input.startDate);
  const end = dateValue(input.endDate);
  if (start === null || start < (dateValue(today) ?? 0))
    errors.push(fieldError(['startDate'], '开始日期须为有效的今日或未来日期。'));
  if (end === null || (start !== null && end < start))
    errors.push(fieldError(['endDate'], '结束日期须不早于开始日期。'));
  if (start !== null && end !== null && end >= start) {
    const days = (end - start) / 86_400_000 + 1;
    if (days > 14) errors.push(fieldError(['endDate'], '单次休假最多 14 个自然日。'));
    const balance = state.leaveBalances.find((item) => item.employeeId === input.employeeId);
    const used = state.leaveRequests
      .filter((item) => item.employeeId === input.employeeId)
      .reduce((sum, item) => sum + item.days, 0);
    if (!balance || days > balance.totalDays - used)
      errors.push(fieldError(['endDate'], `休假余额不足，剩余 ${Math.max(0, (balance?.totalDays ?? 0) - used)} 天。`));
    if (
      state.leaveRequests.some(
        (item) =>
          item.employeeId === input.employeeId && input.startDate <= item.endDate && input.endDate >= item.startDate
      )
    )
      errors.push(fieldError(['startDate'], '申请期间与已有休假重叠。'));
  }
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.trim().length > 200)
    errors.push(fieldError(['reason'], '休假原因须为 1 到 200 字。'));
  return errors;
}

function attendanceErrors(state: DemoState, input: AttendanceCorrectInput, today: string): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const key = idempotency(state, 'attendance.correct', input);
  if (key.replay || key.errors.length) return key.errors;
  const errors = actorErrors(state, input.actorId, input.employeeId, false);
  const employee = state.employees.find((item) => item.id === input.employeeId);
  if (employee && !employee.active) errors.push(fieldError(['employeeId'], '离职员工不能补卡。'));
  const date = dateValue(input.date);
  const todayValue = dateValue(today) ?? 0;
  if (date === null || date > todayValue || date < todayValue - 30 * 86_400_000)
    errors.push(fieldError(['date'], '补卡日期须为近 30 天内的有效日期。'));
  const checkIn = clockMinutes(input.checkIn);
  const checkOut = clockMinutes(input.checkOut);
  if (checkIn === null) errors.push(fieldError(['checkIn'], '签到时间须为 HH:mm。'));
  if (
    checkOut === null ||
    (checkIn !== null && checkOut <= checkIn) ||
    (checkIn !== null && checkOut !== null && checkOut - checkIn > 16 * 60)
  )
    errors.push(fieldError(['checkOut'], '签退须晚于签到，且当日时长不超过 16 小时。'));
  if (state.attendanceCorrections.some((item) => item.employeeId === input.employeeId && item.date === input.date))
    errors.push(fieldError(['date'], '该日已有补卡申请。'));
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.trim().length > 200)
    errors.push(fieldError(['reason'], '补卡原因须为 1 到 200 字。'));
  return errors;
}

const REQUIRED_MATERIALS: Record<PersonnelChange['kind'], Array<DemoState['personnelMaterials'][number]['kind']>> = {
  onboard: ['identity', 'contract'],
  transfer: ['transfer-order'],
  'role-change': ['role-approval'],
  offboard: ['exit-checklist']
};

function personnelErrors(state: DemoState, input: PersonnelProcessInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const key = idempotency(state, 'personnel.process', input);
  if (key.replay || key.errors.length) return key.errors;
  const errors = actorErrors(state, input.actorId, input.employeeId, true);
  const actor = state.employees.find((item) => item.id === input.actorId && item.active);
  if (!actor?.roles.includes('hr')) errors.push(fieldError(['actorId'], '只有人事专员可以办理。'));
  const employee = state.employees.find((item) => item.id === input.employeeId);
  if (!employee) return errors;
  if (!Object.prototype.hasOwnProperty.call(REQUIRED_MATERIALS, input.kind))
    return [...errors, fieldError(['kind'], '办理类型无效。')];
  if (profile(state, employee.id).businessVersion !== input.expectedVersion)
    errors.push(fieldError(['expectedVersion'], `人员档案版本应为 ${profile(state, employee.id).businessVersion}。`));
  if (input.kind === 'onboard' && employee.active)
    errors.push(fieldError(['employeeId'], '入职办理要求员工处于停用状态。'));
  if (input.kind !== 'onboard' && !employee.active)
    errors.push(fieldError(['employeeId'], '在职变更要求员工处于启用状态。'));
  if (input.kind === 'offboard' && input.employeeId === input.actorId)
    errors.push(fieldError(['actorId'], '人事专员不能办理自己的离职。'));
  if (input.kind === 'onboard' || input.kind === 'transfer') {
    if (!state.departments.some((item) => item.id === input.targetDepartmentId))
      errors.push(fieldError(['targetDepartmentId'], '目标部门不存在。'));
    if (input.kind === 'transfer' && input.targetDepartmentId === employee.departmentId)
      errors.push(fieldError(['targetDepartmentId'], '目标部门须不同于当前部门。'));
  } else if (input.targetDepartmentId !== null)
    errors.push(fieldError(['targetDepartmentId'], '此办理类型不需要目标部门。'));
  if (input.kind === 'role-change') {
    if (
      typeof input.targetPosition !== 'string' ||
      !input.targetPosition.trim() ||
      input.targetPosition.trim().length > 80 ||
      input.targetPosition.trim() === profile(state, employee.id).position
    )
      errors.push(fieldError(['targetPosition'], '新岗位须为不同的 1 到 80 字名称。'));
  } else if (input.targetPosition !== null) errors.push(fieldError(['targetPosition'], '此办理类型不需要新岗位。'));
  if (
    !Array.isArray(input.materialIds) ||
    input.materialIds.length > 10 ||
    new Set(input.materialIds).size !== input.materialIds.length
  ) {
    errors.push(fieldError(['materialIds'], '资料须为不重复的、最多十份 ID。'));
  } else {
    input.materialIds.forEach((materialId, index) => {
      if (!state.personnelMaterials.some((item) => item.id === materialId))
        errors.push(fieldError(['materialIds', index], '资料不存在。'));
    });
    for (const kind of REQUIRED_MATERIALS[input.kind]) {
      if (!input.materialIds.some((id) => state.personnelMaterials.find((item) => item.id === id)?.kind === kind))
        errors.push(fieldError(['materialIds'], `缺少${kind}类型资料，不能办结。`));
    }
  }
  return errors;
}

function trainingQueryErrors(state: DemoState, input: TrainingQueryInput): AwcpFieldError[] {
  const errors = actorErrors(state, input.actorId, input.employeeId, true);
  if (input.courseId !== null && !state.trainingCourses.some((item) => item.id === input.courseId))
    errors.push(fieldError(['courseId'], '培训课程不存在。'));
  return errors;
}
function trainingEnrollErrors(state: DemoState, input: TrainingEnrollInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const key = idempotency(state, 'training.enroll', input);
  if (key.replay || key.errors.length) return key.errors;
  const errors = actorErrors(state, input.actorId, input.employeeId, false);
  const employee = state.employees.find((item) => item.id === input.employeeId);
  if (employee && !employee.active) errors.push(fieldError(['employeeId'], '离职员工不能报名。'));
  const course = state.trainingCourses.find((item) => item.id === input.courseId);
  if (!course) errors.push(fieldError(['courseId'], '培训课程不存在。'));
  else if (
    !state.trainingEnrollments.some((item) => item.courseId === course.id && item.employeeId === input.employeeId) &&
    state.trainingEnrollments.filter((item) => item.courseId === course.id).length >= course.capacity
  )
    errors.push(fieldError(['courseId'], '课程名额已满。'));
  return errors;
}
function trainingCompleteErrors(state: DemoState, input: TrainingCompleteInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const key = idempotency(state, 'training.complete', input);
  if (key.replay || key.errors.length) return key.errors;
  const errors = actorErrors(state, input.actorId, input.employeeId, true);
  const actor = state.employees.find((item) => item.id === input.actorId && item.active);
  if (!actor?.roles.includes('hr')) errors.push(fieldError(['actorId'], '只有人事专员可登记完成。'));
  const enrollment = state.trainingEnrollments.find(
    (item) => item.courseId === input.courseId && item.employeeId === input.employeeId
  );
  if (!enrollment) errors.push(fieldError(['courseId'], '员工尚未报名该课程。'));
  else {
    if (enrollment.status !== 'enrolled') errors.push(fieldError(['courseId'], '培训已完成，不能重复登记。'));
    if (enrollment.businessVersion !== input.expectedVersion)
      errors.push(fieldError(['expectedVersion'], `报名版本应为 ${enrollment.businessVersion}。`));
  }
  return errors;
}

export class HrService {
  constructor(private readonly repository: DemoRepository) {}

  subscribe(listener: () => void): () => void {
    return this.repository.subscribe(listener);
  }
  actors(): Array<{ id: string; name: string; active: boolean }> {
    return this.repository.snapshot().employees.map(({ id, name, active }) => ({ id, name, active }));
  }
  departments(): Array<{ id: string; name: string }> {
    return this.repository.snapshot().departments.map(({ id, name }) => ({ id, name }));
  }
  materials(): Array<{ id: string; name: string; kind: string }> {
    return this.repository.snapshot().personnelMaterials.map(({ id, name, kind }) => ({ id, name, kind }));
  }
  validateRead(input: HrReadInput): AwcpFieldError[] {
    return actorErrors(this.repository.snapshot(), input.actorId, input.employeeId, true);
  }
  read(input: HrReadInput): JsonObject {
    const state = this.repository.snapshot();
    assertValid(actorErrors(state, input.actorId, input.employeeId, true));
    const employee = state.employees.find((item) => item.id === input.employeeId);
    if (!employee) throw businessError('action.employee-not-found', '员工不存在。');
    const balance = state.leaveBalances.find((item) => item.employeeId === employee.id)?.totalDays ?? 0;
    const used = state.leaveRequests
      .filter((item) => item.employeeId === employee.id)
      .reduce((sum, item) => sum + item.days, 0);
    const personnel = profile(state, employee.id);
    return {
      employeeId: employee.id,
      departmentId: employee.departmentId,
      active: employee.active,
      position: personnel.position,
      personnelVersion: personnel.businessVersion,
      totalLeaveDays: balance,
      remainingLeaveDays: balance - used,
      leaveRequests: state.leaveRequests
        .filter((item) => item.employeeId === employee.id)
        .map((item) => ({
          id: item.id,
          startDate: item.startDate,
          endDate: item.endDate,
          days: item.days,
          status: item.status
        })),
      attendanceCorrections: state.attendanceCorrections
        .filter((item) => item.employeeId === employee.id)
        .map((item) => ({
          id: item.id,
          date: item.date,
          checkIn: item.checkIn,
          checkOut: item.checkOut,
          status: item.status
        })),
      personnelHistory: state.personnelChanges
        .filter((item) => item.employeeId === employee.id)
        .map((item) => ({
          id: item.id,
          kind: item.kind,
          materialIds: [...item.materialIds],
          beforeDepartmentId: item.beforeDepartmentId,
          afterDepartmentId: item.afterDepartmentId,
          beforeActive: item.beforeActive,
          afterActive: item.afterActive,
          beforePosition: item.beforePosition,
          afterPosition: item.afterPosition,
          businessVersion: item.businessVersion,
          actorId: item.actorId,
          archivedAt: item.archivedAt
        }))
    };
  }

  validateLeave(input: LeaveSubmitInput): AwcpFieldError[] {
    return leaveErrors(this.repository.snapshot(), input, shanghaiDate(this.repository.clock.now()));
  }
  submitLeave(input: LeaveSubmitInput): HrResult {
    return this.repository.transact((state) => {
      const key = idempotency(state, 'leave.submit', input);
      assertValid(key.errors);
      if (key.replay) return { ...key.replay.result };
      const at = this.repository.clock.now();
      assertValid(leaveErrors(state, input, shanghaiDate(at)));
      const days = ((dateValue(input.endDate) ?? 0) - (dateValue(input.startDate) ?? 0)) / 86_400_000 + 1;
      const request = {
        id: nextId(
          'LREQ',
          state.leaveRequests.map((item) => item.id)
        ),
        employeeId: input.employeeId,
        startDate: input.startDate,
        endDate: input.endDate,
        days,
        reason: input.reason.trim(),
        status: 'submitted' as const,
        businessVersion: 1,
        submittedAt: at
      };
      state.leaveRequests.push(request);
      audit(
        state,
        'leave',
        request.id,
        'submit',
        input.actorId,
        request.status,
        1,
        at,
        `${request.startDate}～${request.endDate}`
      );
      const value = { id: request.id, employeeId: request.employeeId, status: request.status, businessVersion: 1 };
      remember(state, 'leave.submit', input, value);
      return value;
    });
  }

  validateAttendance(input: AttendanceCorrectInput): AwcpFieldError[] {
    return attendanceErrors(this.repository.snapshot(), input, shanghaiDate(this.repository.clock.now()));
  }
  correctAttendance(input: AttendanceCorrectInput): HrResult {
    return this.repository.transact((state) => {
      const key = idempotency(state, 'attendance.correct', input);
      assertValid(key.errors);
      if (key.replay) return { ...key.replay.result };
      const at = this.repository.clock.now();
      assertValid(attendanceErrors(state, input, shanghaiDate(at)));
      const correction = {
        id: nextId(
          'ATCOR',
          state.attendanceCorrections.map((item) => item.id)
        ),
        employeeId: input.employeeId,
        date: input.date,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        reason: input.reason.trim(),
        status: 'submitted' as const,
        businessVersion: 1,
        submittedAt: at
      };
      state.attendanceCorrections.push(correction);
      audit(
        state,
        'attendance-correction',
        correction.id,
        'correct',
        input.actorId,
        correction.status,
        1,
        at,
        correction.date
      );
      const value = {
        id: correction.id,
        employeeId: correction.employeeId,
        status: correction.status,
        businessVersion: 1
      };
      remember(state, 'attendance.correct', input, value);
      return value;
    });
  }

  validatePersonnel(input: PersonnelProcessInput): AwcpFieldError[] {
    return personnelErrors(this.repository.snapshot(), input);
  }
  processPersonnel(input: PersonnelProcessInput): HrResult {
    return this.repository.transact((state) => {
      const key = idempotency(state, 'personnel.process', input);
      assertValid(key.errors);
      if (key.replay) return { ...key.replay.result };
      assertValid(personnelErrors(state, input));
      const employee = state.employees.find((item) => item.id === input.employeeId);
      if (!employee) throw businessError('action.employee-not-found', '员工不存在。');
      const current = state.personnelProfiles.find((item) => item.employeeId === employee.id);
      const personnel = current ?? { ...profile(state, employee.id) };
      const beforeDepartmentId = employee.departmentId;
      const beforeActive = employee.active;
      const beforePosition = personnel.position;
      if (input.kind === 'onboard' || input.kind === 'transfer')
        employee.departmentId = input.targetDepartmentId ?? employee.departmentId;
      if (input.kind === 'onboard') employee.active = true;
      if (input.kind === 'offboard') employee.active = false;
      if (input.kind === 'role-change') personnel.position = input.targetPosition?.trim() ?? personnel.position;
      personnel.businessVersion += 1;
      if (!current) state.personnelProfiles.push(personnel);
      const at = this.repository.clock.now();
      const change: PersonnelChange = {
        id: nextId(
          'PCASE',
          state.personnelChanges.map((item) => item.id)
        ),
        employeeId: employee.id,
        kind: input.kind,
        actorId: input.actorId,
        materialIds: [...input.materialIds],
        beforeDepartmentId,
        afterDepartmentId: employee.departmentId,
        beforeActive,
        afterActive: employee.active,
        beforePosition,
        afterPosition: personnel.position,
        businessVersion: personnel.businessVersion,
        archivedAt: at
      };
      state.personnelChanges.push(change);
      audit(
        state,
        'personnel-change',
        change.id,
        input.kind,
        input.actorId,
        'archived',
        change.businessVersion,
        at,
        `${beforeDepartmentId}/${beforePosition} → ${employee.departmentId}/${personnel.position}`
      );
      const value = {
        id: change.id,
        employeeId: employee.id,
        status: 'archived',
        businessVersion: personnel.businessVersion
      };
      remember(state, 'personnel.process', input, value);
      return value;
    });
  }

  validateTrainingQuery(input: TrainingQueryInput): AwcpFieldError[] {
    return trainingQueryErrors(this.repository.snapshot(), input);
  }
  queryTraining(input: TrainingQueryInput): JsonObject {
    const state = this.repository.snapshot();
    assertValid(trainingQueryErrors(state, input));
    return {
      employeeId: input.employeeId,
      courses: state.trainingCourses
        .filter((item) => input.courseId === null || item.id === input.courseId)
        .map((course) => {
          const enrolledCount = state.trainingEnrollments.filter((item) => item.courseId === course.id).length;
          const enrollment = state.trainingEnrollments.find(
            (item) => item.courseId === course.id && item.employeeId === input.employeeId
          );
          return {
            courseId: course.id,
            title: course.title,
            capacity: course.capacity,
            enrolledCount,
            available: Math.max(0, course.capacity - enrolledCount),
            enrollment: enrollment
              ? {
                  id: enrollment.id,
                  status: enrollment.status,
                  businessVersion: enrollment.businessVersion,
                  completedAt: enrollment.completedAt,
                  completedBy: enrollment.completedBy
                }
              : null
          };
        })
    };
  }

  validateEnroll(input: TrainingEnrollInput): AwcpFieldError[] {
    return trainingEnrollErrors(this.repository.snapshot(), input);
  }
  enroll(input: TrainingEnrollInput): HrResult {
    return this.repository.transact((state) => {
      const key = idempotency(state, 'training.enroll', input);
      assertValid(key.errors);
      if (key.replay) return { ...key.replay.result };
      assertValid(trainingEnrollErrors(state, input));
      const existing = state.trainingEnrollments.find(
        (item) => item.courseId === input.courseId && item.employeeId === input.employeeId
      );
      if (existing) {
        const value = {
          id: existing.id,
          employeeId: existing.employeeId,
          status: existing.status,
          businessVersion: existing.businessVersion
        };
        remember(state, 'training.enroll', input, value);
        return value;
      }
      const at = this.repository.clock.now();
      const enrollment = {
        id: nextId(
          'ENR',
          state.trainingEnrollments.map((item) => item.id)
        ),
        courseId: input.courseId,
        employeeId: input.employeeId,
        status: 'enrolled' as const,
        businessVersion: 1,
        enrolledAt: at,
        completedAt: null,
        completedBy: null
      };
      state.trainingEnrollments.push(enrollment);
      audit(state, 'training-enrollment', enrollment.id, 'enroll', input.actorId, 'enrolled', 1, at, input.courseId);
      const value = {
        id: enrollment.id,
        employeeId: enrollment.employeeId,
        status: enrollment.status,
        businessVersion: 1
      };
      remember(state, 'training.enroll', input, value);
      return value;
    });
  }

  validateComplete(input: TrainingCompleteInput): AwcpFieldError[] {
    return trainingCompleteErrors(this.repository.snapshot(), input);
  }
  complete(input: TrainingCompleteInput): HrResult {
    return this.repository.transact((state) => {
      const key = idempotency(state, 'training.complete', input);
      assertValid(key.errors);
      if (key.replay) return { ...key.replay.result };
      assertValid(trainingCompleteErrors(state, input));
      const enrollment = state.trainingEnrollments.find(
        (item) => item.courseId === input.courseId && item.employeeId === input.employeeId
      );
      if (!enrollment) throw businessError('action.enrollment-not-found', '培训报名记录不存在。');
      const at = this.repository.clock.now();
      enrollment.status = 'completed';
      enrollment.businessVersion += 1;
      enrollment.completedAt = at;
      enrollment.completedBy = input.actorId;
      audit(
        state,
        'training-enrollment',
        enrollment.id,
        'complete',
        input.actorId,
        'completed',
        enrollment.businessVersion,
        at,
        input.courseId
      );
      const value = {
        id: enrollment.id,
        employeeId: enrollment.employeeId,
        status: enrollment.status,
        businessVersion: enrollment.businessVersion
      };
      remember(state, 'training.complete', input, value);
      return value;
    });
  }
}
