import { usePreferences } from '../../common/preferences/context';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import type { ScenarioDefinition } from '../../common/scenarios/catalog';
import type { DemoRepository } from '../../common/store/repository';
import { AppLink } from '../components/AppShell';
import { BUSINESS_SCENES, businessRecords, recordId, recordLabel } from './businessScene';
import styles from './BusinessScenePage.module.css';
import ApprovalCenterPage from './ApprovalCenterPage';
import { useCurrentActor, useCurrentUser } from '../../app/currentUserContext';
import { businessPageReadValidator } from '../service/businessPageAccess';
import { accountResponsibilities } from '../service/accountResponsibilities';
import { PageAccessNotice } from '../components/PageAccessNotice';

interface Props {
  scenario: ScenarioDefinition;
  repository: DemoRepository;
  navigate(path: string): void;
  objectId?: string;
  formType?: string;
  children?: ReactElement;
}

const FIELD_LABELS: Record<string, string> = {
  title: '标题', name: '名称', subject: '主题', description: '说明', body: '正文',
  itemName: '物品', counterpartyName: '相对方', reason: '原因', returnReason: '退回原因',
  analysis: '调查分析', resolution: '处理结果', origin: '出发地', destination: '目的地',
  startDate: '开始日期', endDate: '结束日期', dueDate: '截止日期', startAt: '开始时间', endAt: '结束时间',
  resourceId: '预约资源', systemId: '申请系统', permissionId: '申请权限', applicantId: '申请人',
  actorId: '经办人', organizerId: '组织人'
};
const RESET_SCOPE: Record<string, string> = {
  S01: '客户档案、问卷评估、产品匹配、复核及该事项处理记录',
  S02: '研报课题、文档版本、检查、审阅、发布及该事项处理记录',
  S03: '投行项目、分工、底稿、问题、质审及该事项处理记录',
  S04: '风险预警、关联证据、调查、复核及该事项处理记录',
  S05: '机构需求、路演、会议、资料包、邀请、纪要、回访及该事项处理记录'
};
const STATUS_LABELS: Record<string, string> = {
  new: '待办理', draft: '草稿', submitted: '已提交', returned: '已退回', approved: '已批准', rejected: '已驳回',
  archived: '已归档', published: '已发布', open: '待处理', closed: '已关闭', investigating: '调查中',
  'pending-review': '待复核', escalated: '已升级', completed: '已完成', pending: '待办理'
};
const statusLabel = (value: unknown): string => typeof value === 'string' ? (STATUS_LABELS[value] ?? value) : '办理中';

function relationPath(field: string, value: string, record: Record<string, unknown>): string | null {
  if (field === 'clientId') return `/scenes/S01/objects/${encodeURIComponent(value)}`;
  if (field === 'meetingId') return `/scenes/O05/objects/${encodeURIComponent(value)}`;
  if (field === 'documentId') return `/scenes/O06/objects/${encodeURIComponent(value)}`;
  if (field === 'contactGroupId') return `/scenes/O02/objects/${encodeURIComponent(value)}`;
  if (field === 'projectId') return `/scenes/${value.startsWith('IBP-') ? 'S03' : 'O14'}/objects/${encodeURIComponent(value)}`;
  if (field === 'sourceId' && record.sourceType === 'client') return `/scenes/S01/objects/${encodeURIComponent(value)}`;
  if (field === 'sourceId' && record.sourceType === 'ib-project') return `/scenes/S03/objects/${encodeURIComponent(value)}`;
  return null;
}

export default function BusinessScenePage({ scenario, repository, navigate, objectId, formType, children }: Props): ReactElement {
  const { t } = usePreferences();
  const actorId = useCurrentActor();
  const identity = useCurrentUser();
  const [, setRevision] = useState(0);
  const [resetMessage, setResetMessage] = useState('');
  useEffect(() => repository.subscribe(() => setRevision((value) => value + 1)), [repository]);
  const config = BUSINESS_SCENES[scenario.id];
  const state = repository.snapshot();
  const records = businessRecords(state, scenario.id);
  const initialIds = useRef(new Set(records.map((item) => config ? recordId(item, config) : '')));
  useEffect(() => {
    if (!formType || !config) return;
    return repository.subscribe(() => {
      const created = businessRecords(repository.snapshot(), scenario.id)
        .find((item) => !initialIds.current.has(recordId(item, config)));
      if (created) navigate(`/scenes/${scenario.id}/objects/${encodeURIComponent(recordId(created, config))}`);
    });
  }, [config, formType, navigate, repository, scenario.id]);
  const current = objectId && config ? records.find((item) => recordId(item, config) === objectId) : undefined;
  const history = objectId ? state.auditEntries.filter((item) => item.entityId === objectId) : [];
  const base = `/scenes/${scenario.id}`;
  const label = (item: Record<string, unknown>): string => scenario.id === 'S01'
    ? (state.clients.find((client) => client.id === item.clientId)?.name ?? recordId(item, config))
    : recordLabel(item, config);
  const client = scenario.id === 'S01' ? state.clients.find((item) => item.id === objectId) : undefined;

  function resetSelected(): void {
    if (!objectId || !config || !RESET_SCOPE[scenario.id]) return;
    if (!window.confirm(`${t('复位所选样例')} ${objectId}？${t('将恢复该事项的虚构初始记录。')}`)) return;
    repository.resetSecuritiesExample(scenario.id, objectId);
    setResetMessage(`${objectId} ${t('已恢复初始演示记录。')}`);
    if (!businessRecords(repository.snapshot(), scenario.id).some((item) => recordId(item, config) === objectId)) navigate(base);
  }

  if (!config) return <>{children}</>;
  if (formType && state.workflowProfile === 'coarse-roles' && !state.employees.find((employee) => employee.id === actorId)?.roles.includes('workflow-initiator')) {
    const users = (identity?.employees ?? state.employees).filter((employee) => employee.roles.includes('workflow-initiator')).map((employee) => ({ ...employee, responsibilities: ['发起与办理各类业务'] }));
    return <PageAccessNotice message={t('请切换到发起与办理账户。')} users={users} navigate={navigate} />;
  }

  if (objectId && !current) {
    return <section className={styles.page}><h1>未找到事项 {objectId}</h1><AppLink href={base} navigate={navigate}>返回{scenario.title}列表</AppLink></section>;
  }

  if (scenario.id === 'O08' && !objectId && !formType) return <ApprovalCenterPage repository={repository} navigate={navigate} />;

  if (!objectId && !formType) {
    return (
      <section className={styles.page} aria-label={`${scenario.title}事项列表`}>
        {!!config.forms?.length && (state.workflowProfile !== 'coarse-roles' || state.employees.find((employee) => employee.id === actorId)?.roles.includes('workflow-initiator')) && <div className={styles.formLinks}>
          {config.forms?.map((form) => <AppLink key={form.type} href={`${base}/new/${form.type}`} navigate={navigate} className={styles.primaryLink}>{form.label}</AppLink>)}
        </div>}
        <h2>已有事项</h2>
        <ul className={styles.list}>
          {records.map((item) => {
            const id = recordId(item, config);
            return <li key={id}><AppLink href={`${base}/objects/${encodeURIComponent(id)}`} navigate={navigate}><strong>{label(item)}</strong><span>{id} · {statusLabel(item.status)}</span></AppLink></li>;
          })}
        </ul>
        {records.length === 0 && <p>暂无事项。{config.forms?.length ? '请从上方发起。' : ''}</p>}
      </section>
    );
  }

  if (formType && !config.forms?.some((form) => form.type === formType)) {
    return <section className={styles.page}><h1>此场景没有该发起表单</h1><AppLink href={base} navigate={navigate}>返回事项列表</AppLink></section>;
  }

  const validateRead = objectId && !formType ? businessPageReadValidator(repository, scenario.id, objectId) : undefined;
  const readErrors = validateRead?.(actorId) ?? [];
  if (readErrors.length && validateRead) {
    const users = (identity?.employees ?? state.employees)
      .filter((employee) => employee.active && validateRead(employee.id).length === 0)
      .map((employee) => ({ ...employee, responsibilities: accountResponsibilities(employee, state, scenario.id) }));
    return <PageAccessNotice message={readErrors.flatMap((error) => error.messages).join(' ')} users={users} navigate={navigate} />;
  }

  return (
    <div className={styles.page}>
      <nav aria-label={t('事项导航')} className={styles.detailNav}><AppLink href={base} navigate={navigate}>← {t(scenario.title)} · {t('事项列表')}</AppLink>{scenario.id === 'S04' && <button type="button" onClick={resetSelected}>{t('复位所选样例')}</button>}</nav>
      {scenario.id === 'S04' && resetMessage && <p role="status">{resetMessage}</p>}
      {scenario.id !== 'S04' && <header className={styles.detailHeader}>
        <h1>{formType ? config.forms?.find((form) => form.type === formType)?.label : label(current ?? {})}</h1>
        {current && <p>编号 {objectId} · 当前状态 {statusLabel(current.status)} · 业务版本 {typeof current.businessVersion === 'number' ? current.businessVersion : '—'}</p>}
        {objectId && RESET_SCOPE[scenario.id] && <div className={styles.resetBox}>
          <span>可按需复位 {objectId}：恢复{RESET_SCOPE[scenario.id]}的虚构初始记录，不影响其他事项。</span>
          <button type="button" onClick={resetSelected}>{t('复位所选样例')}</button>
        </div>}
        {resetMessage && <p role="status">{resetMessage}</p>}
      </header>}
      {current && scenario.id !== 'S04' && <section className={styles.businessContent} aria-label="业务内容与处理记录">
        <h2>业务内容</h2>
        {client && <><p>客户：{client.name}（{client.id}）</p><p>客户类型：{client.kind === 'institution' ? '机构客户' : '个人客户'}；客户经理：{client.managerId}</p><p>证件资料：{current.identityDocumentNo ? '已登记' : '待补充'}；联系方式：{current.contactPhone ? '已登记' : '待补充'}；风险问卷：{current.questionnaire ? '已填写' : '待填写'}</p></>}
        {Object.entries(FIELD_LABELS).filter(([field]) => typeof current[field] === 'string' && current[field]).map(([field, label]) => <p key={field}>{label}：{String(current[field])}</p>)}
        {Object.entries(current).filter(([field, value]) => /^(clientId|meetingId|documentId|projectId|contactGroupId|sourceId)$/.test(field) && typeof value === 'string' && value && value !== objectId).map(([field, value]) => {
          const path = relationPath(field, String(value), current);
          return <p key={field}>{field}：{path ? <AppLink href={path} navigate={navigate}>{String(value)}</AppLink> : String(value)}</p>;
        })}
        <h2>处理记录</h2>
        {history.length ? <ol>{history.map((entry) => <li key={entry.id}>{entry.at} · {entry.action} · {statusLabel(entry.fromStatus) === '办理中' ? '发起' : statusLabel(entry.fromStatus)} → {statusLabel(entry.toStatus)}</li>)}</ol> : <p>暂无处理记录。</p>}
      </section>}
      {children}
    </div>
  );
}
