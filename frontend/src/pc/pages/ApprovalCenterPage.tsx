import { useCurrentActor } from '../../app/currentUserContext';
import { useEffect, useState } from 'react';
import type { DemoRepository } from '../../common/store/repository';
import type { OfficeApprovalRequest } from '../../common/fixtures/types';
import { usePreferences } from '../../common/preferences/context';
import { ListPagination } from '../components/ListPagination';
import { AppLink } from '../components/AppShell';
import { useDemoSession } from '../hooks/useDemoSession';
import { ApprovalService } from '../service/approvalService';
import styles from './ApprovalCenterPage.module.css';

type Tab = 'pending' | 'done' | 'started' | 'all';
type Filter = { summary: string; applicant: string; department: string };
const empty: Filter = { summary: '', applicant: '', department: '' };
const tabs: Array<{ key: Tab; label: string }> = [
  { key: 'pending', label: '我的待办' },
  { key: 'done', label: '我的已办' },
  { key: 'started', label: '我发起的' },
  { key: 'all', label: '全部可见' }
];
const statuses = { submitted: '已提交', approved: '已批准', returned: '已退回', withdrawn: '已撤回' };

export default function ApprovalCenterPage({
  repository,
  navigate
}: {
  repository: DemoRepository;
  navigate(path: string): void;
}) {
  const { t, locale } = usePreferences();
  const demo = useDemoSession();
  const [service] = useState(() => new ApprovalService(repository));
  const actorId = useCurrentActor('EMP-002');
  const [tab, setTab] = useState<Tab>('pending');
  const [draft, setDraft] = useState<Filter>(empty);
  const [filter, setFilter] = useState<Filter>(empty);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [opinion, setOpinion] = useState('');
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState<Filter>();
  const [, setRevision] = useState(0);
  const storageKey = `awcp.approval-filter:${demo?.session.id ?? 'local'}:${demo?.session.generation ?? 'initial'}:${actorId}`;
  useEffect(() => repository.subscribe(() => setRevision((n) => n + 1)), [repository]);
  useEffect(() => {
    setSelected({});
    setPage(1);
    setMessage('');
    try {
      const data: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
      const candidate = data as Partial<Filter> | null;
      setSaved(
        candidate &&
          typeof candidate.summary === 'string' &&
          typeof candidate.applicant === 'string' &&
          typeof candidate.department === 'string'
          ? (candidate as Filter)
          : undefined
      );
    } catch {
      setSaved(undefined);
    }
  }, [storageKey]);
  const state = repository.snapshot();
  const visibleIds = new Set(service.list(actorId).map((item) => item.requestId));
  const all = state.officeApprovalRequests.filter((item) => visibleIds.has(item.id));
  function matchesTab(row: OfficeApprovalRequest, key: Tab): boolean {
    if (key === 'pending') return row.reviewerId === actorId && row.status === 'submitted';
    if (key === 'done')
      return state.officeApprovalDecisions.some(
        (d) => d.requestId === row.id && d.actorId === actorId && (d.action === 'approve' || d.action === 'return')
      );
    return key === 'started' ? row.applicantId === actorId : true;
  }
  const rows = all.filter(
    (row) =>
      matchesTab(row, tab) &&
      (!filter.summary ||
        `${row.title} ${row.description}`.toLocaleLowerCase().includes(filter.summary.toLocaleLowerCase())) &&
      (!filter.applicant || row.applicantId === filter.applicant) &&
      (!filter.department || row.departmentId === filter.department)
  );
  const currentPage = Math.min(page, Math.max(1, Math.ceil(rows.length / 20)));
  const pageRows = rows.slice((currentPage - 1) * 20, currentPage * 20);
  const selectable = pageRows.filter((r) => r.status === 'submitted' && r.reviewerId === actorId);
  const chosen = selectable.filter((r) => Object.hasOwn(selected, r.id));
  function choose(id: string, version: number, checked: boolean) {
    setSelected((value) => {
      const next = { ...value };
      if (checked) next[id] = version;
      else delete next[id];
      return next;
    });
  }
  function batchApprove() {
    const outcomes: string[] = [];
    for (const row of chosen) {
      try {
        service.approve({
          requestId: row.id,
          actorId,
          expectedVersion: selected[row.id],
          opinion,
          idempotencyKey: `center:${actorId}:${row.id}:${selected[row.id]}:${crypto.randomUUID()}`
        });
        outcomes.push(`${row.id}: ${t('已批准')}`);
      } catch (error) {
        outcomes.push(`${row.id}: ${error instanceof Error ? error.message : 'Error'}`);
      }
    }
    setSelected({});
    setPage(1);
    setMessage(outcomes.join(' · '));
  }
  function saveFilter() {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(filter));
      setSaved(filter);
      setMessage(t('保存成功'));
    } catch {
      setMessage(locale === 'zh-CN' ? '浏览器未允许保存筛选条件。' : 'Browser storage is unavailable.');
    }
  }
  const countText =
    locale === 'zh-CN' ? `已选中 ${chosen.length} 条（最多 20 条）` : `${chosen.length} selected (maximum 20)`;
  const person = (id: string) => state.employees.find((e) => e.id === id)?.name ?? id;
  const department = (id: string) => state.departments.find((d) => d.id === id)?.name ?? id;
  return (
    <section className={styles.page} aria-label={t('审批中心')}>
      <header className={styles.heading}>
        <h1>{t('审批中心')}</h1>
        <AppLink href="/scenes/O08/new/approval" navigate={navigate}>
          {t('新建申请')}
        </AppLink>
      </header>
      <div className={styles.tabs} role="tablist" aria-label={t('审批中心')}>
        {tabs.map((item) => (
          <button
            type="button"
            role="tab"
            id={`approval-tab-${item.key}`}
            aria-controls="approval-panel"
            aria-selected={tab === item.key}
            key={item.key}
            onClick={() => {
              setTab(item.key);
              setSelected({});
              setPage(1);
            }}
          >
            {t(item.label)} <span>{all.filter((r) => matchesTab(r, item.key)).length}</span>
          </button>
        ))}
      </div>
      <div id="approval-panel" role="tabpanel" aria-labelledby={`approval-tab-${tab}`}>
        <div className={styles.saved}>
          <span>{t('虚构演示数据')}</span>
          {saved && (
            <>
              <button
                type="button"
                onClick={() => {
                  setDraft(saved);
                  setFilter(saved);
                  setSelected({});
                  setPage(1);
                }}
              >
                {t('已保存筛选')}
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    sessionStorage.removeItem(storageKey);
                  } catch {
                    /* Current UI can still clear the filter. */
                  }
                  setSaved(undefined);
                }}
              >
                {t('清除已保存筛选')}
              </button>
            </>
          )}
          <button type="button" onClick={saveFilter}>
            {t('保存筛选条件')}
          </button>
        </div>
        <form
          className={styles.filters}
          onSubmit={(event) => {
            event.preventDefault();
            setFilter(draft);
            setSelected({});
            setPage(1);
          }}
        >

          <label>
            {t('摘要')}
            <input value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} />
          </label>
          <label>
            {t('起草人')}
            <select value={draft.applicant} onChange={(event) => setDraft({ ...draft, applicant: event.target.value })}>
              <option value="">{t('全部')}</option>
              {service.actors().map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('起草部门')}
            <select
              value={draft.department}
              onChange={(event) => setDraft({ ...draft, department: event.target.value })}
            >
              <option value="">{t('全部')}</option>
              {state.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.filterActions}>
            <button type="submit" className={styles.primary}>
              {t('查询')}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(empty);
                setFilter(empty);
                setSelected({});
                setPage(1);
              }}
            >
              {t('重置')}
            </button>
          </div>
        </form>
        <div className={styles.batch}>
          <span>{countText}</span>
          <label>
            {t('审批意见')}
            <input maxLength={200} value={opinion} onChange={(event) => setOpinion(event.target.value)} />
          </label>
          <button
            type="button"
            className={styles.primary}
            disabled={!chosen.length || !opinion.trim()}
            onClick={batchApprove}
          >
            {t('批量同意')}
          </button>
        </div>
        {message && (
          <p role="status" className={styles.message}>
            {message}
          </p>
        )}
        <div className={styles.tableScroll}>
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label={locale === 'zh-CN' ? '选择本页可办理事项' : 'Select actionable requests on this page'}
                    disabled={!selectable.length}
                    checked={!!selectable.length && selectable.slice(0, 20).every((r) => Object.hasOwn(selected, r.id))}
                    onChange={(event) =>
                      setSelected(
                        event.target.checked
                          ? Object.fromEntries(selectable.slice(0, 20).map((r) => [r.id, r.businessVersion]))
                          : {}
                      )
                    }
                  />
                </th>
                {['流程标题', '起草人', '起草时间', '摘要', '优先级', '当前环节', '起草部门', '流程编号', '操作'].map(
                  (s) => (
                    <th key={s}>{t(s)}</th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => {
                const path = `/scenes/O08/objects/${row.id}`;
                return (
                  <tr key={row.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${t('事项')} ${row.id}`}
                        checked={Object.hasOwn(selected, row.id)}
                        disabled={
                          row.status !== 'submitted' ||
                          row.reviewerId !== actorId ||
                          (chosen.length >= 20 && !Object.hasOwn(selected, row.id))
                        }
                        onChange={(event) => choose(row.id, row.businessVersion, event.target.checked)}
                      />
                    </td>
                    <td>
                      <AppLink href={path} navigate={navigate}>
                        {row.title}
                      </AppLink>
                      <small>{t('通用审批')}</small>
                    </td>
                    <td>{person(row.applicantId)}</td>
                    <td>
                      {new Date(row.createdAt).toLocaleString(locale, {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </td>
                    <td className={styles.summary} title={row.description}>
                      {row.description}
                    </td>
                    <td>{t('一般')}</td>
                    <td>
                      {t(
                        row.status === 'submitted' ? '主管审批' : row.status === 'returned' ? '申请人补正' : '流程结束'
                      )}
                      <small>{t(statuses[row.status])}</small>
                    </td>
                    <td>{department(row.departmentId)}</td>
                    <td>{row.id}</td>
                    <td>
                      <AppLink href={path} navigate={navigate}>
                        {t(row.status === 'submitted' && row.reviewerId === actorId ? '办理' : '详情')}
                      </AppLink>
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={10} className={styles.empty}>
                    {t('暂无匹配事项')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <ListPagination
          total={rows.length}
          page={currentPage}
          onChange={(next) => {
            setPage(next);
            setSelected({});
          }}
        />
      </div>
    </section>
  );
}
