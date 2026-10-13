import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from 'react';
import type {
  Approval,
  BusinessDetail,
  BusinessPage,
  BusinessResult,
  BusinessTask,
  Expense,
  Travel,
  WorkbenchSummary,
  BusinessOperation
} from '@app/api';
import { usePreferences } from '../../common/preferences/context';
import { useRealtime } from '../../app/realtimeContext';
import { useDemoSession } from '../hooks/useDemoSession';
import { BusinessService } from '../service/businessService';
import { ServerBusinessActions } from '../components/ServerBusinessActions';
import { ServerBusinessForm } from '../components/ServerBusinessForm';
import styles from './ServerBusinessPage.module.css';

type Scene = 'O01' | 'O08' | 'O09';
type Row = Approval | Travel | Expense | BusinessTask;
type Item = Approval | Travel | Expense;
const statuses: Record<string, string> = {
  open: '待办',
  done: '已办',
  draft: '草稿',
  submitted: '待审批',
  approved: '已批准',
  returned: '已退回',
  withdrawn: '已撤回'
};
function title(row: Row): string {
  return 'title' in row ? row.title : 'origin' in row ? `${row.origin} → ${row.destination}` : row.travelFormId;
}
export default function ServerBusinessPage({
  scene,
  objectId,
  formType,
  navigate
}: {
  scene: Scene;
  objectId?: string;
  formType?: string;
  navigate(path: string): void;
}): ReactElement {
  const demo = useDemoSession();
  return demo ? (
    <BusinessView
      key={scene}
      scene={scene}
      objectId={objectId}
      formType={formType}
      navigate={navigate}
      service={new BusinessService(demo.api)}
    />
  ) : (
    <p role="alert">请连接演示服务。</p>
  );
}
function BusinessView({
  scene,
  objectId,
  formType,
  navigate,
  service: provided
}: {
  scene: Scene;
  objectId?: string;
  formType?: string;
  navigate(path: string): void;
  service: BusinessService;
}): ReactElement {
  const { t, locale } = usePreferences();
  const demo = useDemoSession();
  if (!demo) throw new Error('演示会话不可用。');
  const [service] = useState(() => provided); // API lifetime is the workspace lifetime.
  const realtime = useRealtime();
  const observer = useId();
  const [actorId, setActor] = useState(
    () => new URLSearchParams(window.location.search).get('actor') ?? (scene === 'O01' ? 'EMP-002' : 'EMP-001')
  );
  const actor = demo.session.employees.find((e) => e.id === actorId);
  const [tab, setTab] = useState(scene === 'O09' ? 'travel' : scene === 'O01' ? 'open' : 'approval');
  const [filter, setFilter] = useState('');
  const [keyword, setKeyword] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<BusinessPage<Row>>();
  const [summary, setSummary] = useState<WorkbenchSummary>();
  const [selected, setSelected] = useState(objectId ?? '');
  const [detail, setDetail] = useState<BusinessDetail<Item>>();
  const [form, setForm] = useState<'approval' | 'travel' | 'expense' | 'draft' | null>(
    formType ? (scene === 'O08' ? 'approval' : formType === 'expense' ? 'expense' : 'travel') : null
  );
  const [editing, setEditing] = useState<Item>();
  const [opinion, setOpinion] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const sequence = useRef(0);
  const revision = useRef(0);
  const controller = useRef<AbortController>();
  const attempts = useRef(new Map<string, string>());
  const operation: BusinessOperation =
    scene === 'O01'
      ? tab === 'done'
        ? 'done_query'
        : 'todos_query'
      : scene === 'O08'
        ? 'approvals_query'
        : tab === 'expense'
          ? 'expenses_query'
          : 'travels_query';
  const refresh = useCallback(async (): Promise<number> => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const current = ++sequence.current;
    setLoading(true);
    setError('');
    try {
      const next = await service.call<BusinessPage<Row>>(
        operation,
        { actorId, query: search, status: filter, page, pageSize: 20 },
        request.signal
      );
      if (sequence.current !== current) return revision.current;
      setData(next);
      revision.current = next.revision;
      realtime?.acknowledge(observer, next.revision);
      if (scene === 'O01') {
        const counts = await service.call<WorkbenchSummary>('workbench_summary', { actorId }, request.signal);
        if (sequence.current === current) setSummary(counts);
      }
      if (selected && scene !== 'O01') {
        const found = next.items.find((r) => r.id === selected);
        let kind: 'approval' | 'travel' | 'expense' =
          scene === 'O08'
            ? 'approval'
            : found && 'kind' in found
              ? found.kind
              : tab === 'expense'
                ? 'expense'
                : 'travel';
        if (scene === 'O09' && !found) {
          // Direct links can point to a form outside the current list/page.
          try {
            const read = await service.call<BusinessDetail<Travel>>(
              'travel_read',
              { actorId, id: selected },
              request.signal
            );
            if (sequence.current === current) setDetail(read);
            return next.revision;
          } catch (failure) {
            if (request.signal.aborted) throw failure;
            kind = 'expense';
          }
        }
        const read = await service.call<BusinessDetail<Item>>(
          `${kind}_read` as BusinessOperation,
          { actorId, id: selected },
          request.signal
        );
        if (sequence.current === current) setDetail(read);
      }
      return next.revision;
    } catch (failure) {
      if (!request.signal.aborted && sequence.current === current)
        setError(failure instanceof Error ? failure.message : t('查询失败，请重试。'));
      throw failure;
    } finally {
      if (sequence.current === current) setLoading(false);
    }
  }, [actorId, filter, observer, operation, page, realtime, scene, search, selected, service, tab, t]);
  useEffect(() => {
    void refresh().catch(() => undefined);
    const activeController = controller.current;
    return () => {
      activeController?.abort();
    };
  }, [refresh]);
  useEffect(
    () =>
      realtime?.observe(observer, {
        resources: ['todos', 'done', 'approval', 'travel', 'expense'],
        revision: revision.current,
        refresh
      }),
    [observer, realtime, refresh]
  );
  useEffect(() => {
    setSelected(objectId ?? '');
  }, [objectId]);
  const employee = (id: string | null) => demo.session.employees.find((e) => e.id === id)?.name ?? id ?? '—';
  const formatTime = (value: string | null) =>
    value ? new Date(value).toLocaleString(locale, { timeZone: 'Asia/Shanghai', hour12: false }) : '—';
  async function decide(action: 'approve' | 'return' | 'withdraw' | 'submit'): Promise<void> {
    if (!detail || busy) return;
    const item = detail.item;
    const kind = 'kind' in item ? item.kind : 'approval';
    const op =
      kind === 'travel' && action === 'submit' ? 'travel_resubmit' : (`${kind}_${action}` as BusinessOperation);
    const input = { actorId, id: item.id, expectedVersion: item.businessVersion, opinion };
    const intent = JSON.stringify([op, input]);
    let key = attempts.current.get(intent);
    if (!key) {
      key = crypto.randomUUID();
      attempts.current.set(intent, key);
    }
    setBusy(true);
    setError('');
    try {
      const result = await service.call<BusinessResult>(op, { ...input, idempotencyKey: key });
      setMessage(`${t('办理成功')} · ${result.id}`);
      attempts.current.delete(intent);
      setOpinion('');
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('办理失败。'));
    } finally {
      setBusy(false);
    }
  }
  const item = detail?.item;
  const applicant = item?.applicantId === actorId;
  const reviewer = item?.reviewerId === actorId;
  return (
    <section className={styles.page}>
      <ServerBusinessActions scene={scene} service={service} refresh={refresh} />
      <header className={styles.heading}>
        <div>
          <h1>{t(scene === 'O01' ? '工作台与待办' : scene === 'O08' ? '通用审批' : '差旅与费用')}</h1>
          <p>{t('使用虚构数据体验业务办理。')}</p>
        </div>
        <label>
          {t('当前操作人')}
          <select
            value={actorId}
            onChange={(e) => {
              setActor(e.target.value);
              setSelected('');
              setDetail(undefined);
              setForm(null);
              setEditing(undefined);
              setPage(1);
            }}
          >
            {demo.session.employees
              .filter((e) => e.active)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} · {e.id}
                </option>
              ))}
          </select>
        </label>
      </header>
      {summary && (
        <div className={styles.metrics}>
          <article>
            <span>{t('待办')}</span>
            <strong>{summary.pending}</strong>
          </article>
          <article>
            <span>{t('已办')}</span>
            <strong>{summary.done}</strong>
          </article>
          <article>
            <span>{t('逾期未办')}</span>
            <strong>{summary.overdue}</strong>
          </article>
        </div>
      )}
      <nav className={styles.tabs} aria-label={t('业务分类')}>
        {(scene === 'O01'
          ? [
              ['open', '待办'],
              ['done', '已办']
            ]
          : scene === 'O09'
            ? [
                ['travel', '差旅申请'],
                ['expense', '费用报销']
              ]
            : [['approval', '申请列表']]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key}
            onClick={() => {
              setTab(key);
              setSelected('');
              setDetail(undefined);
              setPage(1);
            }}
          >
            {t(label)}
          </button>
        ))}
        {scene !== 'O01' && (
          <button
            type="button"
            onClick={() => {
              setEditing(undefined);
              setForm(scene === 'O08' ? 'approval' : tab === 'travel' ? 'travel' : 'expense');
            }}
          >
            {t('新建申请')}
          </button>
        )}
        <button type="button" onClick={() => navigate('/analysis')}>
          {t('数据分析')}
        </button>
      </nav>
      <form
        className={styles.filters}
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(keyword);
          setPage(1);
        }}
      >
        <label>
          {t('搜索事项')}
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} maxLength={120} />
        </label>
        <label>
          {t('状态')}
          <select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('全部状态')}</option>
            {Object.entries(statuses)
              .filter(([key]) => key !== 'open' && key !== 'done')
              .map(([key, label]) => (
                <option key={key} value={key}>
                  {t(label)}
                </option>
              ))}
          </select>
        </label>
        <button disabled={loading}>{t('查询')}</button>
        <button type="button" disabled={loading} onClick={() => void refresh().catch(() => undefined)}>
          {t('刷新')}
        </button>
      </form>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {form && actor && (
        <ServerBusinessForm
          key={`${form}:${editing?.id ?? 'new'}:${actorId}`}
          kind={form}
          actor={actor}
          service={service}
          editing={editing}
          onClose={() => {
            setForm(null);
            setEditing(undefined);
          }}
          onSaved={(result) => {
            setForm(null);
            setEditing(undefined);
            setSelected(result.id);
            setMessage(`${t('办理成功')} · ${result.id}`);
            void refresh().catch(() => undefined);
          }}
        />
      )}
      <div className={styles.table} aria-busy={loading}>
        <table>
          <caption>
            {t(
              tab === 'done'
                ? '已办事项'
                : scene === 'O01'
                  ? '待办事项'
                  : tab === 'travel'
                    ? '差旅申请'
                    : tab === 'expense'
                      ? '费用报销'
                      : '申请列表'
            )}
          </caption>
          <thead>
            <tr>
              <th>{t('事项')}</th>
              <th>{t('状态')}</th>
              <th>{t('申请人／处理人')}</th>
              <th>{t('版本')}</th>
              <th>{t(tab === 'done' ? '办理时间' : '日期')}</th>
              <th>{t('操作')}</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{title(row)}</strong>
                  <small>{row.id}</small>
                </td>
                <td>{t(statuses['sourceStatus' in row ? row.sourceStatus : row.status] ?? row.status)}</td>
                <td>{employee('assigneeId' in row ? (row.completedBy ?? row.assigneeId) : row.applicantId)}</td>
                <td>{'sourceVersion' in row ? row.sourceVersion : row.businessVersion}</td>
                <td>{formatTime('dueAt' in row ? (row.completedAt ?? row.dueAt) : row.createdAt)}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => {
                      if ('sourceId' in row)
                        navigate(`/scenes/${row.scenarioId}/objects/${row.sourceId}?actor=${actorId}`);
                      else {
                        setSelected(row.id);
                        setDetail(undefined);
                      }
                    }}
                  >
                    {t('查看详情')}
                  </button>
                  {'outcome' in row && row.outcome && (
                    <small>
                      {t(row.outcome === 'approve' ? '已批准' : row.outcome === 'return' ? '已退回' : '已撤回')}
                    </small>
                  )}
                </td>
              </tr>
            ))}
            {!data?.items.length && (
              <tr>
                <td colSpan={6}>{t(loading ? '正在查询…' : '暂无数据')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <nav className={styles.pagination} aria-label={t('事项分页')}>
        <span>
          {t('共')} {data?.total ?? 0} {t('条记录')} · {page}
        </span>
        <button type="button" disabled={loading || page <= 1} onClick={() => setPage(page - 1)}>
          {t('上一页')}
        </button>
        <button type="button" disabled={loading || page * 20 >= (data?.total ?? 0)} onClick={() => setPage(page + 1)}>
          {t('下一页')}
        </button>
      </nav>
      {item && (
        <section className={styles.detail}>
          <header>
            <h2>{title(item)}</h2>
            <span>
              {t(statuses[item.status])} · {t('版本')} {item.businessVersion}
            </span>
          </header>
          <dl>
            <dt>{t('单据编号')}</dt>
            <dd>{item.id}</dd>
            <dt>{t('申请人')}</dt>
            <dd>{employee(item.applicantId)}</dd>
            <dt>{t('审批人')}</dt>
            <dd>{employee(item.reviewerId)}</dd>
            {'description' in item ? (
              <>
                <dt>{t('申请说明')}</dt>
                <dd>{item.description}</dd>
                <dt>{t('资料')}</dt>
                <dd>{item.materialIds.join('、')}</dd>
              </>
            ) : (
              <>
                <dt>{t('金额（元）')}</dt>
                <dd>{(item.amountCents / 100).toFixed(2)}</dd>
                {'startAt' in item && (
                  <>
                    <dt>{t('行程时间')}</dt>
                    <dd>
                      {formatTime(item.startAt)} — {formatTime(item.endAt)}
                    </dd>
                    <dt>{t('同行人员')}</dt>
                    <dd>{item.travelerIds.map(employee).join('、')}</dd>
                  </>
                )}
              </>
            )}
          </dl>
          {applicant && 'kind' in item && item.kind === 'travel' && item.status === 'draft' && (
            <button
              type="button"
              onClick={() => {
                setEditing(item);
                setForm('draft');
              }}
            >
              {t('编辑草稿')}
            </button>
          )}
          {'receipts' in item && (
            <table>
              <caption>{t('费用明细')}</caption>
              <thead>
                <tr>
                  <th>{t('票据编号')}</th>
                  <th>{t('费用类别')}</th>
                  <th>{t('金额（元）')}</th>
                </tr>
              </thead>
              <tbody>
                {item.lineItems.map((line, i) => (
                  <tr key={i}>
                    <td>{line.invoiceNo}</td>
                    <td>{t({ transport: '交通', hotel: '住宿', meal: '餐饮', other: '其他' }[line.category])}</td>
                    <td>{(line.amountCents / 100).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className={styles.actions}>
            {item.status === 'submitted' && (applicant || reviewer) && (
              <>
                <label>
                  {t('意见／原因')}
                  <input value={opinion} onChange={(e) => setOpinion(e.target.value)} maxLength={200} />
                </label>
                {reviewer && (
                  <>
                    <button type="button" disabled={busy || !opinion.trim()} onClick={() => void decide('approve')}>
                      {t('批准')}
                    </button>
                    <button type="button" disabled={busy || !opinion.trim()} onClick={() => void decide('return')}>
                      {t('退回')}
                    </button>
                  </>
                )}
                {applicant && !('kind' in item) && (
                  <button type="button" disabled={busy || !opinion.trim()} onClick={() => void decide('withdraw')}>
                    {t('撤回')}
                  </button>
                )}
              </>
            )}
            {applicant &&
              (item.status === 'returned' || item.status === 'withdrawn') &&
              !('kind' in item && item.kind === 'travel') && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(item);
                    setForm('kind' in item ? item.kind : 'approval');
                  }}
                >
                  {t('补正并重新提交')}
                </button>
              )}
            {applicant &&
              'kind' in item &&
              item.kind === 'expense' &&
              (item.status === 'draft' || item.status === 'returned') && (
                <button type="button" disabled={busy} onClick={() => void decide('submit')}>
                  {t('提交报销')}
                </button>
              )}
            {applicant && 'kind' in item && item.kind === 'travel' && item.status === 'returned' && (
              <button type="button" disabled={busy} onClick={() => void decide('submit')}>
                {t('重新提交')}
              </button>
            )}
          </div>
          <h3>{t('办理历史')}</h3>
          <ol className={styles.history}>
            {detail.history.map((entry, i) => (
              <li key={i}>
                <span>
                  {formatTime(entry.at)} · {employee(entry.actorId)}
                </span>
                <strong>
                  {t(
                    {
                      submit: '提交',
                      approve: '批准',
                      return: '退回',
                      withdraw: '撤回',
                      expense_check: '费用核验',
                      expense_correct: '费用补正',
                      'receipt-register': '票据登记'
                    }[entry.action] ?? entry.action
                  )}{' '}
                  · {t(statuses[entry.toStatus])}
                </strong>
                <span>{entry.note}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </section>
  );
}
