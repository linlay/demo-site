import { useCurrentActor } from '../../app/currentUserContext';
import {
  ArrowRightOutlined,
  AuditOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  ShoppingCartOutlined,
  SendOutlined
} from '@ant-design/icons';
import { usePreferences } from '../../common/preferences/context';
import { useAwcpAction, type AwcpActionRegistration } from '@app/awcp';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import { TODO_COMPLETE_SCHEMA, TODO_QUERY_SCHEMA, TODO_SUMMARY_SCHEMA } from '../../common/awcp/todoSchemas';
import type { Todo } from '../../common/fixtures/types';
import type { DemoRepository } from '../../common/store/repository';
import { ListPagination } from '../components/ListPagination';
import { AppLink } from '../components/AppShell';
import {
  TodoService,
  type TodoCompleteInput,
  type TodoQueryInput,
  type TodoSummaryInput
} from '../service/todoService';
import styles from './O01TodoPage.module.css';

const QUERY: TodoQueryInput = { actorId: 'EMP-002' };
const COMPLETE: TodoCompleteInput = {
  actorId: 'EMP-002',
  todoId: 'OTODO-002',
  expectedVersion: 1,
  idempotencyKey: 'o01-complete-example'
};
const SUMMARY: TodoSummaryInput = { actorId: 'EMP-002', date: '2026-09-19' };

function sourcePath(todo: Todo, repository: DemoRepository): string | null {
  const source = encodeURIComponent(todo.sourceId);
  if (todo.sourceType === 'form') return `/scenes/O09/objects/${source}`;
  if (todo.sourceType === 'document') return `/scenes/O06/objects/${source}`;
  if (todo.sourceType === 'client') return `/scenes/S01/objects/${source}`;
  if (todo.sourceType === 'research') return `/scenes/S02/objects/${source}`;
  if (todo.sourceType === 'ib-project') return `/scenes/S03/objects/${source}`;
  if (todo.sourceType === 'meeting') return `/scenes/O05/objects/${source}`;
  if (todo.sourceType === 'approval') return `/scenes/O08/objects/${source}`;
  if (todo.sourceType === 'discussion') {
    const discussion = repository.snapshot().officeDiscussions.find((item) => item.id === todo.sourceId);
    return discussion ? `/scenes/O04/objects/${encodeURIComponent(discussion.id)}` : null;
  }
  return null;
}

export default function O01TodoPage({
  repository,
  navigate,
  objectId
}: {
  repository: DemoRepository;
  navigate(path: string): void;
  objectId?: string;
}): ReactElement {
  const { t, locale } = usePreferences();
  const [service] = useState(() => new TodoService(repository));
  const actorId = useCurrentActor('EMP-002');
  const [date, setDate] = useState(() => service.query(QUERY).date);
  const [tab, setTab] = useState<'pending' | 'done'>('pending');
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [historyDate, setHistoryDate] = useState('');
  const [message, setMessage] = useState('');
  const [, setRevision] = useState(0);
  const keys = useRef(new Map<string, string>());
  useEffect(() => service.subscribe(() => setRevision((value) => value + 1)), [service]);

  const state = repository.snapshot();
  const visible = service.query({ actorId }).items;
  const history = service.history({ actorId });
  const current = objectId
    ? state.todos.find(
        (todo) =>
          todo.id === objectId &&
          (visible.some((row) => row.todoId === todo.id) || history.some((row) => row.id === todo.id))
      )
    : undefined;
  const rows =
    tab === 'pending'
      ? visible.map((row) => ({ ...row, completedAt: null as string | null }))
      : history.map((row) => ({
          todoId: row.id,
          title: row.title,
          assigneeId: row.assigneeId,
          sourceId: row.sourceId,
          sourceType: row.sourceType,
          dueAt: row.dueAt,
          completedAt: row.completedAt ?? null,
          priority: 'today' as const,
          canComplete: false,
          sourceVersion: null
        }));
  const filtered = rows.filter(
    (row) =>
      `${row.title} ${row.todoId} ${row.sourceId}`.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase()) &&
      (tab !== 'done' ||
        !historyDate ||
        new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(
          new Date(row.completedAt ?? row.dueAt)
        ) === historyDate)
  );
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / 20)));
  const pageRows = filtered.slice((currentPage - 1) * 20, currentPage * 20);
  const summary = /^\d{4}-\d{2}-\d{2}$/.test(date) ? service.summarize({ actorId, date }) : null;

  const queryAction: AwcpActionRegistration<TodoQueryInput> = {
    action: 'office.todo.query',
    title: '查询今日待办',
    description: describeAction({
      purpose: '查询今天到期和逾期的可见待办。',
      prerequisites: '现有启用人员；主管可查看本部门待办。',
      parameters: 'actorId 为操作人。',
      effects: '只读。',
      result: '返回来源、优先级和处理状态。',
      failures: '人员无效时返回字段错误。'
    }),
    inputSchema: TODO_QUERY_SCHEMA,
    examples: [QUERY],
    validate: (args) => service.validateQuery(args),
    invoke: (args) => completed(service.query(args))
  };
  useAwcpAction(queryAction);
  const completeAction: AwcpActionRegistration<TodoCompleteInput> = {
    action: 'office.todo.complete',
    title: '处理单据待办',
    description: describeAction({
      purpose: '处理本人名下的已提交差旅或通用单据待办。',
      prerequisites: '其他来源到对应业务详情办理。',
      parameters: 'todoId、actorId、来源版本和幂等键。',
      effects: '批准来源单据并关闭待办。',
      result: '返回单据状态和版本。',
      failures: '非处理人、旧版本或不支持来源返回字段错误。'
    }),
    inputSchema: TODO_COMPLETE_SCHEMA,
    examples: [COMPLETE],
    validate: (args) => service.validateComplete(args),
    invoke: (args) => completed(service.complete(args))
  };
  useAwcpAction(completeAction);
  const summaryAction: AwcpActionRegistration<TodoSummaryInput> = {
    action: 'office.todo.summarize',
    title: '汇总待办日报',
    description: describeAction({
      purpose: '按日期统计已办、待办和逾期。',
      prerequisites: '有效日期和操作人。',
      parameters: 'actorId 与 YYYY-MM-DD 日期。',
      effects: '只读。',
      result: '返回计数和明细。',
      failures: '人员或日期无效时返回字段错误。'
    }),
    inputSchema: TODO_SUMMARY_SCHEMA,
    examples: [SUMMARY],
    validate: (args) => service.validateSummarize(args),
    invoke: (args) => completed(service.summarize(args))
  };
  useAwcpAction(summaryAction);

  function complete(row: (typeof visible)[number]): void {
    const key = `${row.todoId}:${row.sourceVersion}:${actorId}`;
    if (!keys.current.has(key)) keys.current.set(key, `o01-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      const result = service.complete({
        todoId: row.todoId,
        actorId,
        expectedVersion: row.sourceVersion ?? 0,
        idempotencyKey: keys.current.get(key) ?? ''
      });
      setMessage(`${row.title}已处理；来源单据状态 ${result.sourceStatus}，版本 ${result.businessVersion}。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '处理失败。');
    }
  }

  const shortcuts = [
    {
      href: '/scenes/O08/new/approval',
      title: '发起通用审批',
      description: '办公事项，一次发起',
      icon: <AuditOutlined />,
      tone: styles.blue
    },
    {
      href: '/scenes/O09/new/travel',
      title: '发起出差申请',
      description: '行程安排与费用申请',
      icon: <SendOutlined />,
      tone: styles.teal
    },
    {
      href: '/scenes/O11/new/purchase',
      title: '创建请购单',
      description: '采购需求与物品申领',
      icon: <ShoppingCartOutlined />,
      tone: styles.purple
    },
    {
      href: '/scenes/O10/new/leave',
      title: '提交休假申请',
      description: '休假计划与考勤办理',
      icon: <CalendarOutlined />,
      tone: styles.amber
    }
  ];
  const formatDate = (value: string): string =>
    new Date(value).toLocaleString(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

  return (
    <section className={styles.page} aria-label={t('工作台与待办')}>
      {current && <h2>{current.title}</h2>}
      {!current && (
        <>
          <div className={styles.metrics}>
            <article>
              <span className={`${styles.metricIcon} ${styles.blue}`}>
                <FileTextOutlined />
              </span>
              <div>
                <p>{t('当前待办')}</p>
                <strong>{visible.length}</strong>
                <small>{t('今天到期及此前未办事项')}</small>
              </div>
            </article>
            <article>
              <span className={`${styles.metricIcon} ${styles.amber}`}>
                <ClockCircleOutlined />
              </span>
              <div>
                <p>{t('逾期待办')}</p>
                <strong>{visible.filter((row) => row.priority === 'overdue').length}</strong>
                <small>{t('优先关注，及时处理')}</small>
              </div>
            </article>
            <article>
              <span className={`${styles.metricIcon} ${styles.teal}`}>
                <CheckCircleOutlined />
              </span>
              <div>
                <p>{t('我的已办')}</p>
                <strong>{history.length}</strong>
                <small>{t('全部演示历史')}</small>
              </div>
            </article>
          </div>
          <section className={styles.quickSection} aria-label={t('发起业务流程')}>
            <div className={styles.sectionHeading}>
              <h2>{t('业务快捷入口')}</h2>
            </div>
            <nav className={styles.launch}>
              {shortcuts.map((item) => (
                <AppLink key={item.href} href={item.href} navigate={navigate} className={styles.shortcut}>
                  <span className={`${styles.shortcutIcon} ${item.tone}`}>{item.icon}</span>
                  <span className={styles.shortcutText}>
                    <strong>{t(item.title)}</strong>
                    <small>{t(item.description)}</small>
                  </span>
                  <ArrowRightOutlined className={styles.shortcutArrow} />
                </AppLink>
              ))}
            </nav>
          </section>
        </>
      )}

      {current ? (
        <article className={styles.detail}>
          <div className={styles.detailMeta}>
            <span className={styles.statusPill}>{t(current.status === 'open' ? '待处理' : '已办结')}</span>
            <span>{current.id}</span>
            <span>
              {t('到期时间')} {formatDate(current.dueAt)}
            </span>
          </div>
          <p>
            {t('来源')}：{current.sourceType} · {current.sourceId} · {t('负责人')} {current.assigneeId}
          </p>
          <div className={styles.detailActions}>
            {sourcePath(current, repository) && (
              <AppLink
                href={sourcePath(current, repository) ?? ''}
                navigate={navigate}
                className={styles.secondaryButton}
              >
                {t('查看来源业务详情')} <ArrowRightOutlined />
              </AppLink>
            )}
            {visible
              .filter((row) => row.todoId === current.id && row.canComplete)
              .map((row) => (
                <button className={styles.primaryButton} key={row.todoId} type="button" onClick={() => complete(row)}>
                  {t('处理待办')}
                </button>
              ))}
            <AppLink href="/scenes/O01" navigate={navigate} className={styles.textLink}>
              {t('返回待办列表')}
            </AppLink>
          </div>
        </article>
      ) : (
        <section className={styles.todoPanel}>
          <div className={styles.panelHeading}>
            <div className={styles.tabs} role="tablist" aria-label={t('工作台事项')}>
              {(['pending', 'done'] as const).map((key) => (
                <button
                  key={key}
                  id={`todo-tab-${key}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  aria-controls="todo-panel"
                  onClick={() => {
                    setTab(key);
                    setPage(1);
                  }}
                >
                  {t(key === 'pending' ? '我的待办' : '我的已办')}{' '}
                  <span className={styles.count}>{key === 'pending' ? visible.length : history.length}</span>
                </button>
              ))}
            </div>
            <span className={styles.demoDate}>
              {t('演示日期')} {service.query({ actorId }).date}
            </span>
          </div>
          <div id="todo-panel" role="tabpanel" aria-labelledby={`todo-tab-${tab}`}>
            <div className={styles.listFilters}>
              <label>
                {t('搜索事项')}{' '}
                <input
                  type="search"
                  value={keyword}
                  placeholder={t('标题或编号')}
                  onChange={(event) => {
                    setKeyword(event.target.value);
                    setPage(1);
                  }}
                />
              </label>
              {tab === 'done' && (
                <label>
                  {t('办理日期')}{' '}
                  <input
                    type="date"
                    value={historyDate}
                    onChange={(event) => {
                      setHistoryDate(event.target.value);
                      setPage(1);
                    }}
                  />
                </label>
              )}
              {(keyword || historyDate) && (
                <button
                  type="button"
                  onClick={() => {
                    setKeyword('');
                    setHistoryDate('');
                    setPage(1);
                  }}
                >
                  {t('清空条件')}
                </button>
              )}
            </div>
            <div className={styles.tableScroll}>
              <table className={styles.todoTable}>
                <thead>
                  <tr>
                    <th>{t('事项')}</th>
                    <th>{t(tab === 'done' ? '办理时间' : '到期时间')}</th>
                    <th>{t('状态')}</th>
                    <th>{t('操作')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => (
                    <tr key={row.todoId}>
                      <td>
                        <div className={styles.todoSubject}>
                          <span className={styles.documentIcon}>
                            <FileTextOutlined />
                          </span>
                          <div>
                            <AppLink href={`/scenes/O01/objects/${encodeURIComponent(row.todoId)}`} navigate={navigate}>
                              {row.title}
                            </AppLink>
                            <small>
                              {row.todoId} · {row.sourceId}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td className={styles.dueDate}>{formatDate(row.completedAt ?? row.dueAt)}</td>
                      <td>
                        <span
                          className={`${styles.statusPill} ${tab === 'pending' && row.priority === 'overdue' ? styles.overdue : styles.today}`}
                        >
                          {t(tab === 'done' ? '已办结' : row.priority === 'overdue' ? '逾期' : '今日待办')}
                        </span>
                      </td>
                      <td>
                        {row.canComplete ? (
                          <button className={styles.processButton} type="button" onClick={() => complete(row)}>
                            {t('处理待办')} <ArrowRightOutlined />
                          </button>
                        ) : (
                          <AppLink
                            href={`/scenes/O01/objects/${encodeURIComponent(row.todoId)}`}
                            navigate={navigate}
                            className={styles.textLink}
                          >
                            {t('查看详情')} <ArrowRightOutlined />
                          </AppLink>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!filtered.length && (
              <div className={styles.empty}>
                <CheckCircleOutlined />
                <h3>{t('暂无匹配事项')}</h3>
              </div>
            )}
            <ListPagination total={filtered.length} page={currentPage} onChange={setPage} />
          </div>
          <footer className={styles.daily}>
            <label>
              <CalendarOutlined /> {t('日报日期')}{' '}
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            {summary && (
              <p>
                {locale === 'zh-CN'
                  ? `已办 ${summary.done} · 待办 ${summary.pending} · 逾期 ${summary.overdue}`
                  : `Completed ${summary.done} · Pending ${summary.pending} · Overdue ${summary.overdue}`}
              </p>
            )}
          </footer>
        </section>
      )}
      {message && (
        <p role="status" className={styles.message}>
          {message}
        </p>
      )}
    </section>
  );
}
