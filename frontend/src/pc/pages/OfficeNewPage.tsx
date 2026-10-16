import { useCurrentActor } from '../../app/currentUserContext';
import { useWorkflowAction as useAwcpAction } from '../../app/useWorkflowAction';
import type { AwcpActionRegistration, AwcpFieldError, JsonObject } from '@app/awcp';
import { useState, type ReactElement } from 'react';

import { completed, accepted } from '../../common/awcp/contracts';
import { DISCUSSION_CREATE_SCHEMA } from '../../common/awcp/communicationSchemas';
import { MEETING_AVAILABILITY_SCHEMA, MEETING_RESERVE_SCHEMA } from '../../common/awcp/meetingSchemas';
import { CONTRACT_REGISTER_SCHEMA } from '../../common/awcp/contractSchemas';
import { RESOURCE_RESERVE_SCHEMA } from '../../common/awcp/adminSchemas';
import { PROJECT_CREATE_SCHEMA } from '../../common/awcp/projectCollabSchemas';
import { ACCESS_REQUEST_SCHEMA } from '../../common/awcp/itSchemas';
import { REPORT_GENERATE_SCHEMA } from '../../common/awcp/reportSchemas';
import type { DemoRepository } from '../../common/store/repository';
import { CommunicationService, type DiscussionCreateInput } from '../service/communicationService';
import { MeetingService, type AvailabilityInput, type ReserveInput } from '../service/meetingService';
import { ContractService, type ContractRegisterInput } from '../service/contractService';
import { AdminService, type ResourceReserveInput } from '../service/adminService';
import { ProjectCollabService, type ProjectCreateInput } from '../service/projectCollabService';
import { ItService, type AccessRequestInput } from '../service/itService';
import { ReportArchiveService, type ReportGenerateInput } from '../service/reportArchiveService';
import styles from './BusinessScenePage.module.css';

type FormId = 'O04' | 'O05' | 'O12' | 'O13' | 'O14' | 'O15' | 'O16';
type Field = { key: string; label: string; kind?: 'date' | 'datetime-local' | 'number' | 'textarea' | 'multi'; options?: string[] };
type FormSpec = {
  title: string;
  action: string;
  schema: AwcpActionRegistration<JsonObject>['inputSchema'];
  fields: Field[];
  build(values: Record<string, string | string[]>): JsonObject;
  validate(repository: DemoRepository, args: JsonObject): AwcpFieldError[];
  invoke(repository: DemoRepository, args: JsonObject): ReturnType<AwcpActionRegistration<JsonObject>['invoke']>;
};

const text = (values: Record<string, string | string[]>, name: string): string => String(values[name] ?? '').trim();
const many = (values: Record<string, string | string[]>, name: string): string[] => Array.isArray(values[name]) ? values[name] as string[] : [];
const timestamp = (value: string): string => value ? new Date(value).toISOString() : '';
const key = (): string => `office-new-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const FORMS: Record<FormId, FormSpec> = {
  O04: {
    title: '创建项目讨论', action: 'office.discussion.create', schema: DISCUSSION_CREATE_SCHEMA,
    fields: [{ key: 'actorId', label: '讨论发起人' }, { key: 'projectId', label: '关联项目' }, { key: 'title', label: '讨论标题' }, { key: 'body', label: '讨论正文', kind: 'textarea' }],
    build: (v) => ({ actorId: text(v, 'actorId'), projectId: text(v, 'projectId'), title: text(v, 'title'), body: text(v, 'body'), idempotencyKey: key() }),
    validate: (r, a) => new CommunicationService(r).validateDiscussionCreate(a as DiscussionCreateInput),
    invoke: (r, a) => completed(new CommunicationService(r).createDiscussion(a as DiscussionCreateInput))
  },
  O05: {
    title: '预约会议', action: 'office.meeting.reserve', schema: MEETING_RESERVE_SCHEMA,
    fields: [{ key: 'actorId', label: '预约人' }, { key: 'participantIds', label: '参会人', kind: 'multi' }, { key: 'resourceId', label: '会议室' }, { key: 'startAt', label: '开始时间', kind: 'datetime-local' }, { key: 'endAt', label: '结束时间', kind: 'datetime-local' }, { key: 'title', label: '会议标题' }],
    build: (v) => ({ actorId: text(v, 'actorId'), participantIds: many(v, 'participantIds'), resourceId: text(v, 'resourceId'), startAt: timestamp(text(v, 'startAt')), endAt: timestamp(text(v, 'endAt')), title: text(v, 'title'), idempotencyKey: key() }),
    validate: (r, a) => new MeetingService(r).validateReservePreflight(a as ReserveInput),
    invoke: (r, a) => completed(new MeetingService(r).reserve(a as ReserveInput))
  },
  O12: {
    title: '登记合同', action: 'office.contract.register', schema: CONTRACT_REGISTER_SCHEMA,
    fields: [{ key: 'actorId', label: '登记人' }, { key: 'companyId', label: '签约主体' }, { key: 'counterpartyName', label: '合同相对方' }, { key: 'startDate', label: '开始日期', kind: 'date' }, { key: 'endDate', label: '结束日期', kind: 'date' }, { key: 'amountCents', label: '合同金额（分）', kind: 'number' }, { key: 'materialIds', label: '合同材料', kind: 'multi' }],
    build: (v) => ({ actorId: text(v, 'actorId'), companyId: text(v, 'companyId'), counterpartyName: text(v, 'counterpartyName'), startDate: text(v, 'startDate'), endDate: text(v, 'endDate'), amountCents: Number(text(v, 'amountCents')), materialIds: many(v, 'materialIds'), idempotencyKey: key() }),
    validate: (r, a) => new ContractService(r).validateRegister(a as ContractRegisterInput),
    invoke: (r, a) => completed(new ContractService(r).register(a as ContractRegisterInput))
  },
  O13: {
    title: '预约行政资源', action: 'office.resource.reserve', schema: RESOURCE_RESERVE_SCHEMA,
    fields: [{ key: 'actorId', label: '预约人' }, { key: 'resourceId', label: '资源' }, { key: 'participantIds', label: '参与人', kind: 'multi' }, { key: 'driverId', label: '驾驶人（车辆必填）' }, { key: 'startAt', label: '开始时间', kind: 'datetime-local' }, { key: 'endAt', label: '结束时间', kind: 'datetime-local' }],
    build: (v) => ({ actorId: text(v, 'actorId'), resourceId: text(v, 'resourceId'), participantIds: many(v, 'participantIds'), driverId: text(v, 'driverId') || null, startAt: timestamp(text(v, 'startAt')), endAt: timestamp(text(v, 'endAt')), idempotencyKey: key() }),
    validate: (r, a) => new AdminService(r).validateReserve(a as ResourceReserveInput),
    invoke: (r, a) => completed(new AdminService(r).reserve(a as ResourceReserveInput))
  },
  O14: {
    title: '创建项目', action: 'office.project.create', schema: PROJECT_CREATE_SCHEMA,
    fields: [{ key: 'actorId', label: '负责人' }, { key: 'title', label: '项目名称' }, { key: 'dueDate', label: '截止日期', kind: 'date' }, { key: 'memberIds', label: '项目成员', kind: 'multi' }],
    build: (v) => ({ actorId: text(v, 'actorId'), title: text(v, 'title'), dueDate: text(v, 'dueDate'), memberIds: many(v, 'memberIds'), idempotencyKey: key() }),
    validate: (r, a) => new ProjectCollabService(r).validateProject(a as ProjectCreateInput),
    invoke: (r, a) => completed(new ProjectCollabService(r).createProject(a as ProjectCreateInput))
  },
  O15: {
    title: '提交系统权限申请', action: 'office.access.request', schema: ACCESS_REQUEST_SCHEMA,
    fields: [{ key: 'actorId', label: '申请人' }, { key: 'systemId', label: '系统' }, { key: 'permissionId', label: '权限' }, { key: 'materialIds', label: '申请材料', kind: 'multi' }, { key: 'reason', label: '申请理由', kind: 'textarea' }],
    build: (v) => ({ actorId: text(v, 'actorId'), systemId: text(v, 'systemId'), permissionId: text(v, 'permissionId'), materialIds: many(v, 'materialIds'), reason: text(v, 'reason'), idempotencyKey: key() }),
    validate: (r, a) => new ItService(r).validateRequest(a as AccessRequestInput),
    invoke: (r, a) => completed(new ItService(r).request(a as AccessRequestInput))
  },
  O16: {
    title: '生成部门报表', action: 'office.report.generate', schema: REPORT_GENERATE_SCHEMA,
    fields: [{ key: 'actorId', label: '生成人' }, { key: 'departmentId', label: '部门' }, { key: 'startDate', label: '开始日期', kind: 'date' }, { key: 'endDate', label: '结束日期', kind: 'date' }],
    build: (v) => ({ actorId: text(v, 'actorId'), departmentId: text(v, 'departmentId'), startDate: text(v, 'startDate'), endDate: text(v, 'endDate'), idempotencyKey: key() }),
    validate: (r, a) => new ReportArchiveService(r).validateGenerate(a as ReportGenerateInput),
    invoke: (r, a) => accepted(new ReportArchiveService(r).generate(a as ReportGenerateInput).jobId)
  }
};

function choices(repository: DemoRepository, scenarioId: FormId, field: string): Array<{ id: string; label: string }> {
  const state = repository.snapshot();
  const source: Array<{ id: string; name?: string; title?: string }> = field === 'actorId' || field === 'participantIds' || field === 'memberIds' || field === 'driverId' ? state.employees.filter((employee) => employee.active)
    : field === 'projectId' ? state.ibProjects
    : field === 'resourceId' ? scenarioId === 'O05' ? state.meetingResources : state.adminResources
    : field === 'companyId' ? [state.company]
    : field === 'materialIds' ? scenarioId === 'O12' ? state.contractMaterials : state.accessMaterials
    : field === 'systemId' ? state.itSystems
    : field === 'permissionId' ? state.itPermissions
    : field === 'departmentId' ? state.departments : [];
  return source.map((item) => ({ id: item.id, label: item.name ?? item.title ?? item.id }));
}

export default function OfficeNewPage({ repository, scenarioId }: { repository: DemoRepository; scenarioId: FormId }): ReactElement {
  const actorId = useCurrentActor('EMP-001');
  const spec = FORMS[scenarioId];
  const [values, setValues] = useState<Record<string, string | string[]>>({ actorId });
  const [message, setMessage] = useState('');
  const registration: AwcpActionRegistration<JsonObject> = {
    action: spec.action,
    title: spec.title,
    description: `在当前空白表单页办理${spec.title}，提交后进入新事项详情页。`,
    inputSchema: spec.schema,
    validate: (args) => spec.validate(repository, args),
    invoke: (args) => spec.invoke(repository, args)
  };
  useAwcpAction(registration);
  useAwcpAction(scenarioId === 'O05' ? {
    action: 'office.meeting.availability', title: '查询会议时段空闲',
    description: '核对所选参会人和会议室是否有时段冲突。',
    inputSchema: MEETING_AVAILABILITY_SCHEMA,
    validate: (args: AvailabilityInput) => new MeetingService(repository).validateAvailability(args),
    invoke: (args: AvailabilityInput) => completed(new MeetingService(repository).availability(args))
  } : null);
  const required = spec.fields.filter((field) => field.key !== 'driverId');
  const ready = required.every((field) => field.kind === 'multi' ? many(values, field.key).length > 0 : text(values, field.key).length > 0);

  function change(field: string, value: string | string[]): void { setValues((before) => ({ ...before, [field]: value })); }
  return <section className={styles.page} aria-label={spec.title}>
    <p>请逐项填写业务信息。发起人使用右上角的当前账户，提交后进入新事项详情。</p>
    {spec.fields.filter((field) => field.key !== 'actorId').map((field) => {
      const options = choices(repository, scenarioId, field.key);
      if (field.kind === 'multi') return <fieldset key={field.key}><legend>{field.label}（必选）</legend>{options.map((option) => <label key={option.id}><input type="checkbox" checked={many(values, field.key).includes(option.id)} onChange={() => change(field.key, many(values, field.key).includes(option.id) ? many(values, field.key).filter((id) => id !== option.id) : [...many(values, field.key), option.id])} /> {option.label}（{option.id}）</label>)}</fieldset>;
      return <label key={field.key}>{field.label}{options.length ? <select value={text(values, field.key)} onChange={(event) => change(field.key, event.target.value)}><option value="">请选择</option>{options.map((option) => <option key={option.id} value={option.id}>{option.label}（{option.id}）</option>)}</select>
        : field.kind === 'textarea' ? <textarea value={text(values, field.key)} onChange={(event) => change(field.key, event.target.value)} rows={3} />
          : <input type={field.kind ?? 'text'} value={text(values, field.key)} onChange={(event) => change(field.key, event.target.value)} />}</label>;
    })}
    {scenarioId === 'O05' && <button type="button" disabled={!['actorId', 'participantIds', 'resourceId', 'startAt', 'endAt'].every((field) => field === 'participantIds' ? many(values, field).length > 0 : !!text(values, field))} onClick={() => {
      try {
        const result = new MeetingService(repository).availability({ actorId: text(values, 'actorId'), participantIds: many(values, 'participantIds'), resourceId: text(values, 'resourceId'), startAt: timestamp(text(values, 'startAt')), endAt: timestamp(text(values, 'endAt')) });
        setMessage(result.available ? '所选时段可预约。' : '所选时段存在冲突，请调整。');
      } catch (error) { setMessage(error instanceof Error ? error.message : '查询失败。'); }
    }}>查询空闲</button>}
    <button type="button" disabled={!ready} onClick={() => { try { const args = spec.build(values); const errors = spec.validate(repository, args); if (errors.length) { setMessage(errors.flatMap((error) => error.messages).join('；')); return; } spec.invoke(repository, args); setMessage('已提交，正在打开事项详情。'); } catch (error) { setMessage(error instanceof Error ? error.message : '提交失败。'); } }}>提交</button>
    <p role="status">{message}</p>
  </section>;
}
