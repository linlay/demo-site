import { usePreferences } from '../../common/preferences/context';
import { ApiError, type DemoApi, type DemoSession, type ReportFilter } from '@app/api';
import { AwcpActionError, useAwcpAction, type AwcpActionRegistration, type JsonObject } from '@app/awcp';
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import { useDemoSession } from '../hooks/useDemoSession';
import { useReportQuery } from '../hooks/useReportQuery';
import styles from './AnalysisPage.module.css';
import { AnalysisCharts } from '../components/AnalysisCharts';

const INITIAL: ReportFilter = { dataSource: 'business', from: '', to: '', departmentId: '', scenarioId: '', status: '', groupBy: 'month', page: 1, pageSize: 20 };
const SCENES: Record<string, string> = { O08: '通用审批', O09: '差旅报销', O11: '采购申请', O12: '合同用印', O15: 'IT 服务' };
const STATUSES: Record<string, string> = { pending: '待处理', approved: '已完成', returned: '已退回', withdrawn: '已撤回', draft: '草稿' };

export default function AnalysisPage(): ReactElement {
  const { t } = usePreferences();
  const demo = useDemoSession();
  return demo ? <AnalysisView api={demo.api} session={demo.session} /> : <p role="alert">{t("请连接演示服务后查看数据分析。")}</p>;
}

function AnalysisView({ api, session }: { api: DemoApi; session: DemoSession }): ReactElement {
  const { t, locale } = usePreferences();
  const money = (cents: number): string => (cents / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const [draft, setDraft] = useState(INITIAL);
  const { result, loading, error, query } = useReportQuery(api);
  useEffect(() => { void query(INITIAL).catch(() => undefined); }, [query]);
  const execute = (filter: ReportFilter) => { setDraft(filter); void query(filter).catch(() => undefined); };

  const queryAction: AwcpActionRegistration<JsonObject & ReportFilter> = {
    action: 'demo.analysis.query', title: '查询业务数据分析',
    description: describeAction({ purpose: '查询实时业务或虚构历史样本的汇总、分组和分页明细。', prerequisites: '已建立演示会话。', parameters: '日期、部门、场景、状态、分组和分页；空字符串表示不筛选。', effects: '只读查询，不修改业务记录。', result: '返回样本数量、金额、完成数、逾期数、平均耗时和明细。', failures: '无效条件、会话过期、重置冲突或网络错误。' }),
    inputSchema: {
      type: 'object', additionalProperties: false,
      required: ['from', 'to', 'departmentId', 'scenarioId', 'status', 'groupBy', 'page', 'pageSize'],
      properties: {
        dataSource: { type: 'string', enum: ['business', 'historical-fixtures'] },
        kind: { type: 'string', enum: ['', 'approval', 'travel', 'expense'] },
        from: { type: 'string', pattern: '^(|[0-9]{4}-[0-9]{2}-[0-9]{2})$' },
        to: { type: 'string', pattern: '^(|[0-9]{4}-[0-9]{2}-[0-9]{2})$' },
        departmentId: { type: 'string', pattern: '^(|DEP-[0-9]{3})$' },
        scenarioId: { type: 'string', enum: ['', 'O08', 'O09', 'O11', 'O12', 'O15'] },
        status: { type: 'string', enum: ['', 'pending', 'approved', 'returned', 'withdrawn', 'draft'] },
        groupBy: { type: 'string', enum: ['month', 'department', 'scenario', 'status'] },
        page: { type: 'integer', minimum: 1, maximum: 100000 }, pageSize: { type: 'integer', minimum: 1, maximum: 100 }
      }
    },
    examples: [{ ...INITIAL }],
    invoke: async (args, context) => {
      setDraft({ ...args });
      try {
        const next = await query(args, context.signal);
        return completed({ generation: next.generation, filter: { ...next.filter }, summary: { ...next.summary }, groups: next.groups.map((row) => ({ ...row })), items: next.items.map((row) => ({ ...row })) });
      } catch (error) {
        if (error instanceof ApiError) throw new AwcpActionError('action.analysis-query-failed', error.message, { apiCode: error.failure.code });
        throw error;
      }
    }
  };
  useAwcpAction(queryAction);

  function submit(event: FormEvent): void { event.preventDefault(); execute({ ...draft, page: 1 }); }
  function label(key: string): string {
    return t(SCENES[key] ?? STATUSES[key] ?? session.departments.find((department) => department.id === key)?.name ?? key);
  }
  function drill(key: string, groupBy = result?.filter.groupBy): void {
    if (!result) return;
    const filter = { ...result.filter, page: 1 };
    if (groupBy === 'month') {
      // Intersect the month with the existing date filter, do not broaden partial-month queries.
      const [year, month] = key.split('-').map(Number);
      const from = `${key}-01`;
      const to = `${key}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;
      filter.from = filter.from && filter.from > from ? filter.from : from;
      filter.to = filter.to && filter.to < to ? filter.to : to;
    } else if (groupBy === 'department') filter.departmentId = key;
    else if (groupBy === 'scenario') filter.scenarioId = key;
    else filter.status = key;
    execute(filter);
  }
  const max = Math.max(1, ...(result?.groups.map((group) => group.count) ?? []));

  return <section className={styles.page} aria-label={t("业务数据分析")}>
    <header className={styles.heading}><h1>{t('数据分析')}</h1><div className={styles.headingMeta}>
      <span>{t((result?.filter.dataSource ?? draft.dataSource) === 'business' ? '实时办理数据' : '历史演示样本')}</span><span className={styles.dataset}>{(result?.summary.count ?? 0).toLocaleString()} {t('条记录')}</span>
    </div></header>
    <form className={styles.filters} onSubmit={submit}>
      <label>{t("数据来源")}<select value={draft.dataSource} onChange={(event) => setDraft({ ...INITIAL, dataSource: event.target.value as ReportFilter['dataSource'] })}><option value="business">{t("实时办理数据")}</option><option value="historical-fixtures">{t("历史演示样本")}</option></select></label>
      {draft.dataSource==='business' && <label>{t("单据类型")}<select value={draft.kind ?? ''} onChange={(event)=>setDraft({...draft,kind:event.target.value as ReportFilter['kind']})}><option value="">{t("全部类型")}</option><option value="approval">{t("通用审批")}</option><option value="travel">{t("差旅预算")}</option><option value="expense">{t("费用报销")}</option></select></label>}
      <label>{t("开始日期")}<input type="date" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label>
      <label>{t("结束日期")}<input type="date" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label>
      <label>{t("部门")}<select value={draft.departmentId} onChange={(event) => setDraft({ ...draft, departmentId: event.target.value })}><option value="">{t("全部部门")}</option>{session.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <label>{t("业务类型")}<select value={draft.scenarioId} onChange={(event) => setDraft({ ...draft, scenarioId: event.target.value })}><option value="">{t("全部类型")}</option>{Object.entries(SCENES).filter(([key]) => draft.dataSource !== 'business' || key === 'O08' || key === 'O09').map(([key, value]) => <option key={key} value={key}>{t(value)}</option>)}</select></label>
      <label>{t("状态")}<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option value="">{t("全部状态")}</option>{Object.entries(STATUSES).filter(([key])=>draft.dataSource==='business'||key!=='draft').map(([key, value]) => <option key={key} value={key}>{t(value)}</option>)}</select></label>
      <label>{t("分组方式")}<select value={draft.groupBy} onChange={(event) => setDraft({ ...draft, groupBy: event.target.value as ReportFilter['groupBy'] })}><option value="month">{t("按月份")}</option><option value="department">{t("按部门")}</option><option value="scenario">{t("按业务")}</option><option value="status">{t("按状态")}</option></select></label>
      <div className={styles.buttons}><button type="submit" disabled={loading}>{t("查询分析")}</button><button type="button" disabled={loading} onClick={() => execute(INITIAL)}>{t("清空条件")}</button></div>
    </form>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {loading && <p role="status">{t("正在查询…")}</p>}
    {result && <div aria-busy={loading}>
      <div className={styles.metrics}>
        <article><span>{t("业务样本")}</span><strong>{result.summary.count.toLocaleString()}</strong></article>
        <article><span>{t("金额合计（元）")}</span><strong className={styles.amount}>{money(result.summary.amountCents)}</strong></article>
        <article><span>{t("完成率")}</span><strong>{result.summary.count ? `${(100 * result.summary.approved / result.summary.count).toFixed(1)}%` : '—'}</strong></article>
        <article><span>{t("平均完成耗时")}</span><strong>{result.summary.averageHours === null ? '—' : `${result.summary.averageHours.toFixed(1)} ${t('小时')}`}</strong></article>
        <article><span>{t("逾期未办")}</span><strong>{result.summary.overdue.toLocaleString()}</strong></article>
      </div>
      <p>{t(result.filter.dataSource==='business' ? '金额按单据统计，可按差旅预算或费用报销分别筛选。' : '历史演示样本')}</p>
      <AnalysisCharts api={api} result={result} disabled={loading} label={label} drill={drill} />
      <details className={styles.panel}><summary>{t("分组分布")}</summary><p>{t("点击分组查看对应明细。")}</p>
        {!result.groups.length && <p>{t("当前条件没有匹配的样本。")}</p>}
        <div className={styles.groups}>{result.groups.map((group) => <button key={group.key} type="button" disabled={loading} className={styles.group} onClick={() => drill(group.key)} aria-label={locale === 'zh-CN' ? `查看${label(group.key)}的 ${group.count} 条明细` : `View ${group.count} records for ${label(group.key)}`}>
          <span>{label(group.key)}</span><span className={styles.track}><span style={{ width: `${group.count / max * 100}%` }} /></span><strong>{group.count.toLocaleString()}</strong>
        </button>)}</div>
      </details>
      <section className={styles.panel}><h2>{t("业务明细")}</h2><div className={styles.tableScroll}><table><caption className={styles.srOnly}>{t("当前条件下的业务明细")}</caption><thead><tr><th>{t("事项")}</th><th>{t("部门")}</th><th>{t("状态")}</th><th>{t("金额（元）")}</th><th>{t("日期")}</th><th>{t("耗时（小时）")}</th></tr></thead><tbody>
        {result.items.map((row) => <tr key={row.id}><td><strong>{result.filter.dataSource === 'business' ? <a href={`/scenes/${row.scenarioId}/objects/${row.id}?actor=${row.ownerId}`}>{row.title}</a> : row.title}</strong><small>{row.id} · {row.ownerId}</small></td><td>{label(row.departmentId)}</td><td>{t(STATUSES[row.status])}{row.overdue ? ` · ${t('逾期')}` : ''}</td><td>{money(row.amountCents)}</td><td>{row.createdOn}</td><td>{row.durationHours ?? '—'}</td></tr>)}
        {!result.items.length && <tr><td colSpan={6}>{t("暂无数据")}</td></tr>}
      </tbody></table></div><nav className={styles.pagination} aria-label={t("分析明细分页")}>
        <span>{locale === 'zh-CN' ? `共 ${result.summary.count} 条 · 第 ${result.filter.page} 页` : `${result.summary.count} records · Page ${result.filter.page}`}</span>
        <button type="button" disabled={loading || result.filter.page <= 1} onClick={() => execute({ ...result.filter, page: result.filter.page - 1 })}>{t("上一页")}</button>
        <button type="button" disabled={loading || result.filter.page * result.filter.pageSize >= result.summary.count} onClick={() => execute({ ...result.filter, page: result.filter.page + 1 })}>{t("下一页")}</button>
      </nav></section>
    </div>}
  </section>;
}
