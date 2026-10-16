import { useCurrentActor } from '../../app/currentUserContext';
import { Fragment, useCallback, useEffect, useId, useRef, useState, type ReactElement } from 'react';
import type {
  Approval,
  ApprovalCenterRecord,
  ApprovalTemplate,
  BusinessDetail,
  BusinessPage,
  BusinessResult
} from '@app/api';
import { usePreferences } from '../../common/preferences/context';
import { useRealtime } from '../../app/realtimeContext';
import { useDemoSession } from '../hooks/useDemoSession';
import { BusinessService } from '../service/businessService';
import { ServerBusinessActions } from '../components/ServerBusinessActions';
import { ServerBusinessForm } from '../components/ServerBusinessForm';
import styles from './ServerBusinessPage.module.css';

const statuses: Record<string, string> = {
  submitted: '待审批',
  approved: '已批准',
  returned: '已退回',
  withdrawn: '已撤回',
  draft: '草稿'
};
const extraTypes: ApprovalTemplate[] = [
  {
    id: 'travel',
    name: '差旅申请',
    category: '日常办公',
    description: '填写出差行程、同行人员与预算，提交差旅审批。',
    fields: []
  },
  {
    id: 'expense',
    name: '费用报销',
    category: '日常办公',
    description: '关联差旅与票据，核验费用后提交报销审批。',
    fields: []
  }
];
export default function ServerApprovalCenterPage({
  objectId,
  formType,
  navigate
}: {
  objectId?: string;
  formType?: string;
  navigate(path: string): void;
}): ReactElement {
  const demo = useDemoSession();
  const { t, locale } = usePreferences();
  const realtime = useRealtime();
  const observer = useId();
  const [service] = useState(() => (demo ? new BusinessService(demo.api) : undefined));
  const actorId = useCurrentActor(formType ? 'EMP-001' : 'EMP-002');
  const [view, setView] = useState(() => demo?.session.employees.find((employee) => employee.id === actorId)?.roles.includes('workflow-initiator') ? 'handling' : 'pending');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [keyword, setKeyword] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [templates, setTemplates] = useState<ApprovalTemplate[]>([]);
  const [materials, setMaterials] = useState<Array<{ id: string; name: string }>>([]);
  const [data, setData] = useState<BusinessPage<ApprovalCenterRecord>>();
  const [detail, setDetail] = useState<BusinessDetail<Approval>>();
  const [editing, setEditing] = useState(false);
  const [opinion, setOpinion] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const sequence = useRef(0);
  const controller = useRef<AbortController>();
  const attempts = useRef(new Map<string, string>());
  const actor = demo?.session.employees.find((e) => e.id === actorId && e.active);
  const employee = (id: string) => demo?.session.employees.find((e) => e.id === id)?.name ?? id;
  const allTypes = [...templates, ...extraTypes];
  const template = templates.find((item) => item.id === (detail?.item.templateId ?? formType));
  const time = (value: string) => new Date(value).toLocaleString(locale, { timeZone: 'Asia/Shanghai', hour12: false });
  const path = (suffix = '') => `/scenes/O08${suffix}`;
  useEffect(() => {
    if (!service) return;
    const request = new AbortController();
    void Promise.all([
      service.call<ApprovalTemplate[]>('approval_templates_list', {}, request.signal),
      service.call<Array<{ id: string; name: string }>>('approval_materials_list', {}, request.signal)
    ])
      .then(([types, options]) => {
        setTemplates(types);
        setMaterials(options);
      })
      .catch((failure: unknown) => {
        if (!request.signal.aborted) setError(failure instanceof Error ? failure.message : t('查询失败，请重试。'));
      });
    return () => request.abort();
  }, [service, t]);
  const refresh = useCallback(async (): Promise<number> => {
    if (!service) return 0;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const current = ++sequence.current;
    setLoading(true);
    setError('');
    try {
      const result = objectId
        ? await service.call<BusinessDetail<Approval>>('approval_read', { actorId, id: objectId }, request.signal)
        : await service.call<BusinessPage<ApprovalCenterRecord>>(
            'approval_center_query',
            { actorId, view, templateId: type, status, query: search, page, pageSize: 20 },
            request.signal
          );
      if (current !== sequence.current) return revision.current;
      if ('item' in result) setDetail(result);
      else setData(result);
      revision.current = result.revision;
      realtime?.acknowledge(observer, result.revision);
      return result.revision;
    } catch (failure) {
      if (!request.signal.aborted && current === sequence.current)
        setError(failure instanceof Error ? failure.message : t('查询失败，请重试。'));
      throw failure;
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [actorId, objectId, observer, page, realtime, search, service, status, t, type, view]);
  useEffect(() => {
    void refresh().catch(() => undefined);
    const active = controller.current;
    return () => active?.abort();
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
  async function decide(action: 'approve' | 'return' | 'withdraw'): Promise<void> {
    if (!service || !detail || busy) return;
    const input = { actorId, id: detail.item.id, expectedVersion: detail.item.businessVersion, opinion };
    const fingerprint = JSON.stringify([action, input]);
    let key = attempts.current.get(fingerprint);
    if (!key) {
      key = crypto.randomUUID();
      attempts.current.set(fingerprint, key);
    }
    setBusy(true);
    setError('');
    try {
      await service.call<BusinessResult>(`approval_${action}`, { ...input, idempotencyKey: key });
      attempts.current.delete(fingerprint);
      setOpinion('');
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('办理失败。'));
    } finally {
      setBusy(false);
    }
  }
  if (!demo || !service) return <p role="alert">{t('请连接演示服务。')}</p>;
  const item = detail?.item;
  const isPicker = formType === 'default';
  const isForm = formType && !isPicker;
  const chosen = allTypes.find((entry) => entry.id === formType);
  return (
    <section className={`${styles.page} ${!objectId && !formType ? styles.listPage : ''}`} aria-label={t('审批中心')}>
      <ServerBusinessActions scene="O08" service={service} refresh={refresh} />
      {(formType || objectId) && <nav className={styles.actions}><button type="button" disabled={busy} onClick={() => navigate(path())}>{t('返回审批中心')}</button></nav>}
      {error && (
        <p role="alert" className={styles.error}>
          {error}{' '}
          <button type="button" onClick={() => void refresh().catch(() => undefined)}>
            {t('重试')}
          </button>
        </p>
      )}
      {isPicker && (
        <section className={styles.templateList} aria-label={t('选择申请类型')}>
          <h2>{t('选择申请类型')}</h2>
          {allTypes.map((entry) => (
            <button key={entry.id} type="button" onClick={() => navigate(path(`/new/${entry.id}`))}>
              <span className={styles.typeIcon}>{t(entry.category).slice(0, 1)}</span>
              <span>
                <strong>{t(entry.name)}</strong>
                <small>{t(entry.description)}</small>
              </span>
              <span className={styles.typeCategory}>{t(entry.category)}</span>
              <span aria-hidden="true">→</span>
            </button>
          ))}
        </section>
      )}
      {isForm && chosen && actor && (
        <ServerBusinessForm
          key={`${chosen.id}:${actorId}`}
          kind={chosen.id === 'travel' ? 'travel' : chosen.id === 'expense' ? 'expense' : 'approval'}
          template={chosen.id === 'travel' || chosen.id === 'expense' ? undefined : chosen}
          actor={actor}
          service={service}
          onClose={() => navigate(path('/new'))}
          onSaved={(result) =>
            navigate(
              chosen.id === 'travel' || chosen.id === 'expense'
                ? `/scenes/O09/objects/${result.id}`
                : path(`/objects/${result.id}`)
            )
          }
        />
      )}
      {isForm && templates.length > 0 && !chosen && (
        <p role="alert">
          {t('申请类型不存在，请重新选择。')}{' '}
          <button type="button" onClick={() => navigate(path('/new'))}>
            {t('选择申请类型')}
          </button>
        </p>
      )}
      {!objectId && !formType && (
        <>
          <nav className={styles.tabs} aria-label={t('审批分类')}>
            {[
              ['pending', '待我审批'],
              ['reviewed', '我已审批'],
              ['handling', '待我办理'],
              ['initiated', '我发起的']
            ].filter(([key]) => actor?.roles.includes('workflow-initiator') ? ['handling', 'initiated'].includes(key) : actor?.roles.includes('workflow-approver') ? ['pending', 'reviewed'].includes(key) : key !== 'handling').map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={view === key}
                onClick={() => {
                  setView(key);
                  setStatus('');
                  setPage(1);
                }}
              >
                {t(label)}
              </button>
            ))}
          {(!actor?.roles.some((role) => role.startsWith('workflow-')) || actor.roles.includes('workflow-initiator')) && <button className={`${styles.primaryButton} ${styles.newApproval}`} type="button" onClick={() => navigate(path('/new'))}>＋ {t('新建审批')}</button>}</nav>
          <form
            className={styles.filters}
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(keyword);
              setPage(1);
            }}
          >
            <label>
              {t('搜索事项')}
              <input
                placeholder={t('输入标题或单号')}
                value={keyword}
                maxLength={120}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </label>
            <label>
              {t('申请类型')}
              <select
                value={type}
                onChange={(e) => {
                  setType(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">{t('全部类型')}</option>
                {allTypes.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {t(entry.name)}
                  </option>
                ))}
              </select>
            </label>
            {view !== 'pending' && (
              <label>
                {t('状态')}
                <select
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">{t('全部状态')}</option>
                  {Object.entries(statuses).map(([key, label]) => (
                    <option key={key} value={key}>
                      {t(label)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button disabled={loading}>{t('查询')}</button>
            <button type="button" disabled={loading} onClick={() => void refresh().catch(() => undefined)}>
              {t('刷新')}
            </button>
          </form>
          <div className={styles.table} aria-busy={loading}>
            <table>
              <caption>{t(view === 'pending' ? '待我审批' : view === 'reviewed' ? '我已审批' : view === 'handling' ? '待我办理' : '我发起的')}</caption>
              <thead>
                <tr>
                  <th>{t('申请事项')}</th>
                  <th>{t('申请类型')}</th>
                  <th>{t('申请人')}</th>
                  <th>{t('状态')}</th>
                  <th>{t('申请时间')}</th>
                  <th>{t('操作')}</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((row) => (
                  <tr key={`${row.kind}:${row.id}`}>
                    <td>
                      <strong>{row.title}</strong>
                      <small>{row.id}</small>
                    </td>
                    <td>
                      {t(
                        allTypes.find(
                          (entry) => entry.id === (row.kind === 'approval' ? (row.templateId ?? 'office') : row.kind)
                        )?.name ?? '综合事项申请'
                      )}
                    </td>
                    <td>{employee(row.applicantId)}</td>
                    <td>
                      <span className={styles.statusTag} data-status={row.status}>
                        {t(statuses[row.status] ?? row.status)}
                      </span>
                    </td>
                    <td>{time(row.createdAt)}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() =>
                          navigate(
                            row.kind === 'approval'
                              ? path(`/objects/${row.id}`)
                              : `/scenes/O09/objects/${row.id}`
                          )
                        }
                      >
                        {t(view === 'pending' ? '审批' : view === 'handling' ? '继续办理' : '查看详情')}
                      </button>
                    </td>
                  </tr>
                ))}
                {!data?.items.length && (
                  <tr>
                    <td colSpan={6} className={styles.empty}>
                      {t(loading ? '正在查询…' : view === 'pending' ? '当前没有待审批的申请' : '暂无数据')}
                    </td>
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
            <button
              type="button"
              disabled={loading || page * 20 >= (data?.total ?? 0)}
              onClick={() => setPage(page + 1)}
            >
              {t('下一页')}
            </button>
          </nav>
        </>
      )}
      {objectId && loading && !item && <p role="status">{t('正在查询…')}</p>}
      {objectId && item && !editing && (
        <section className={styles.detail}>
          <header>
            <div>
              <small>
                {t(template?.name ?? '综合事项申请')} · {item.id}
              </small>
              <h2>{item.title}</h2>
            </div>
            <span className={styles.statusTag} data-status={item.status}>
              {t(statuses[item.status])}
            </span>
          </header>
          <dl>
            <dt>{t('申请人')}</dt>
            <dd>{employee(item.applicantId)}</dd>
            <dt>{t('审批人')}</dt>
            <dd>{employee(item.reviewerId)}</dd>
            <dt>{t('申请时间')}</dt>
            <dd>{time(item.createdAt)}</dd>
            {template?.fields.map((field) => (
              <Fragment key={field.id}>
                <dt>{t(field.label)}</dt>
                <dd>{item.fields?.[field.id] ?? '—'}</dd>
              </Fragment>
            ))}
            <dt>{t('申请说明')}</dt>
            <dd>{item.description}</dd>
            <dt>{t('申请资料')}</dt>
            <dd>{item.materialIds.map((id) => materials.find((m) => m.id === id)?.name ?? id).join('、') || '—'}</dd>
          </dl>
          {item.status === 'submitted' && (item.reviewerId === actorId || item.applicantId === actorId) && (
            <div className={styles.reviewPanel}>
              <label>
                {t(item.reviewerId === actorId ? '审批意见' : '撤回原因')}
                <textarea
                  placeholder={t('请填写办理意见')}
                  value={opinion}
                  maxLength={200}
                  onChange={(e) => setOpinion(e.target.value)}
                />
              </label>
              <div className={styles.actions}>
                {item.reviewerId === actorId ? (
                  <>
                    <button
                      className={styles.primaryButton}
                      type="button"
                      disabled={busy || !opinion.trim()}
                      onClick={() => void decide('approve')}
                    >
                      {t('批准')}
                    </button>
                    <button type="button" disabled={busy || !opinion.trim()} onClick={() => void decide('return')}>
                      {t('退回补正')}
                    </button>
                  </>
                ) : (
                  <button type="button" disabled={busy || !opinion.trim()} onClick={() => void decide('withdraw')}>
                    {t('撤回')}
                  </button>
                )}
              </div>
            </div>
          )}
          {item.applicantId === actorId && ['returned', 'withdrawn'].includes(item.status) && (
            <button type="button" onClick={() => setEditing(true)}>
              {t('补正并重新提交')}
            </button>
          )}
          <h3>{t('办理历史')}</h3>
          <ol className={styles.history}>
            {detail.history[0]?.action !== 'submit' && (
              <li>
                <strong>{t('提交申请')}</strong>
                <span>
                  {employee(item.applicantId)} · {time(item.createdAt)}
                </span>
              </li>
            )}
            {detail.history.map((history, i) => (
              <li key={i}>
                <strong>
                  {t(
                    (
                      { submit: '提交申请', approve: '已批准', return: '已退回', withdraw: '已撤回' } as Record<
                        string,
                        string
                      >
                    )[history.action] ?? history.action
                  )}
                </strong>
                <span>
                  {employee(history.actorId)} · {time(history.at)}
                </span>
                {history.note && <p>{history.note}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}
      {objectId && item && editing && actor && (
        <ServerBusinessForm
          key={`${item.id}:${actorId}`}
          kind="approval"
          template={template}
          editing={item}
          actor={actor}
          service={service}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void refresh().catch(() => undefined);
          }}
        />
      )}
    </section>
  );
}
