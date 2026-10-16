import { useCurrentActor } from '../../app/currentUserContext';
import { useAwcpAction, type AwcpActionRegistration } from '@app/awcp';
import { useState, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import { ATTENDANCE_CORRECT_SCHEMA, LEAVE_SUBMIT_SCHEMA } from '../../common/awcp/hrSchemas';
import type { DemoRepository } from '../../common/store/repository';
import { HrService, type AttendanceCorrectInput, type LeaveSubmitInput } from '../service/hrService';
import styles from './BusinessScenePage.module.css';

const LEAVE_EXAMPLE: LeaveSubmitInput = { actorId: 'EMP-001', employeeId: 'EMP-001', startDate: '2026-09-22', endDate: '2026-09-23', reason: '虚构休假安排。', idempotencyKey: 'o10-leave-example' };
const ATTENDANCE_EXAMPLE: AttendanceCorrectInput = { actorId: 'EMP-001', employeeId: 'EMP-001', date: '2026-09-18', checkIn: '09:00', checkOut: '18:00', reason: '虚构补卡说明。', idempotencyKey: 'o10-attendance-example' };

function LeaveForm({ repository }: { repository: DemoRepository }): ReactElement {
  const [service] = useState(() => new HrService(repository));
  const employeeId = useCurrentActor('EMP-001');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const action: AwcpActionRegistration<LeaveSubmitInput> = {
    action: 'office.leave.submit', title: '提交请休假申请',
    description: describeAction({ purpose: '按自然日期提交虚构休假。', prerequisites: '员工本人、未来期间和足够余额。', parameters: '员工、日期、原因和幂等键。', effects: '保存休假并占用余额。', result: '返回申请 ID 与状态。', failures: '余额、日期或角色不符时不写入。' }),
    inputSchema: LEAVE_SUBMIT_SCHEMA, examples: [LEAVE_EXAMPLE], validate: (args) => service.validateLeave(args), invoke: (args) => completed(service.submitLeave(args))
  };
  useAwcpAction(action);
  return <section className={styles.page} aria-label="休假申请表单">
    <label>开始日期 <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label>
    <label>结束日期 <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} required /></label>
    <label>休假原因 <input value={reason} onChange={(event) => setReason(event.target.value)} required /></label>
    <button type="button" disabled={!employeeId || !startDate || !endDate || !reason.trim()} onClick={() => { try { service.submitLeave({ actorId: employeeId, employeeId, startDate, endDate, reason, idempotencyKey: `o10-ui-${Date.now()}-${Math.random().toString(36).slice(2)}` }); } catch (error) { setMessage(error instanceof Error ? error.message : '提交失败。'); } }}>提交休假并查看详情</button>
    {message && <p role="alert">{message}</p>}
  </section>;
}

function AttendanceForm({ repository }: { repository: DemoRepository }): ReactElement {
  const [service] = useState(() => new HrService(repository));
  const employeeId = useCurrentActor('EMP-001');
  const [date, setDate] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const action: AwcpActionRegistration<AttendanceCorrectInput> = {
    action: 'office.attendance.correct', title: '提交补卡申请',
    description: describeAction({ purpose: '补录虚构签到签退记录。', prerequisites: '员工本人、近 30 天有效日期和时段。', parameters: '员工、日期、时段、原因和幂等键。', effects: '保存补卡申请。', result: '返回申请 ID 与版本。', failures: '日期、时段或角色不符时不写入。' }),
    inputSchema: ATTENDANCE_CORRECT_SCHEMA, examples: [ATTENDANCE_EXAMPLE], validate: (args) => service.validateAttendance(args), invoke: (args) => completed(service.correctAttendance(args))
  };
  useAwcpAction(action);
  return <section className={styles.page} aria-label="补卡申请表单">
    <label>补卡日期 <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
    <label>签到时间 <input type="time" value={checkIn} onChange={(event) => setCheckIn(event.target.value)} required /></label>
    <label>签退时间 <input type="time" value={checkOut} onChange={(event) => setCheckOut(event.target.value)} required /></label>
    <label>补卡原因 <input value={reason} onChange={(event) => setReason(event.target.value)} required /></label>
    <button type="button" disabled={!employeeId || !date || !checkIn || !checkOut || !reason.trim()} onClick={() => { try { service.correctAttendance({ actorId: employeeId, employeeId, date, checkIn, checkOut, reason, idempotencyKey: `o10-ui-${Date.now()}-${Math.random().toString(36).slice(2)}` }); } catch (error) { setMessage(error instanceof Error ? error.message : '提交失败。'); } }}>提交补卡并查看详情</button>
    {message && <p role="alert">{message}</p>}
  </section>;
}

export default function O10HrNewPage({ repository, formType }: { repository: DemoRepository; formType: string }): ReactElement {
  return formType === 'attendance' ? <AttendanceForm repository={repository} /> : <LeaveForm repository={repository} />;
}
