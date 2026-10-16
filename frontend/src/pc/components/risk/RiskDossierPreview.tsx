import type { RiskInvestigationDraft } from '../../../common/risk/dossier';
import type { Employee } from '../../../common/fixtures/types';
import { usePreferences } from '../../../common/preferences/context';
import styles from './RiskForm.module.css';

export function RiskDossierPreview({ draft, employees }: { draft: RiskInvestigationDraft; employees: Employee[] }) {
  const { t, locale } = usePreferences();
  const d = draft.dossier;
  const labels: Record<string, string> = {
    low: '低',
    medium: '中',
    high: '高',
    normal: '正常',
    abnormal: '异常',
    unconfirmed: '待确认',
    'false-positive': '误报',
    confirmed: '确认预警',
    close: '关闭',
    escalate: '升级',
    monitor: '持续监控',
    'request-material': '补充材料',
    buy: '买入',
    sell: '卖出',
    transfer: '划转',
    system: '系统流水核对',
    documents: '材料核验',
    contact: '客户沟通',
    phone: '电话',
    email: '邮件',
    meeting: '面谈'
  };
  const label = (v: string) => t(labels[v] ?? v) || '—';
  return (
    <div className={styles.preview}>
      <dl>
        <dt>{t('核查期间')}</dt>
        <dd>
          {d.periodStart || '—'} → {d.periodEnd || '—'}
        </dd>
        <dt>{t('风险等级')}</dt>
        <dd>{label(d.riskLevel)}</dd>
        <dt>{t('核查方式')}</dt>
        <dd>{d.methods.map(label).join(' / ') || '—'}</dd>
        <dt>{t('调查结论')}</dt>
        <dd>
          {label(draft.conclusion)} · {label(draft.proposedDisposition)}
        </dd>
        <dt>{t('调查分析')}</dt>
        <dd>{draft.analysis || '—'}</dd>
        <dt>{t('关联证据')}</dt>
        <dd>{draft.evidenceIds.join(', ') || '—'}</dd>
      </dl>
      {(d.contactRequired || d.methods.includes('contact')) && (
        <>
          <h3>{t('客户沟通')}</h3>
          <p>
            {d.contactOn || '—'} · {label(d.contactMethod)}
          </p>
          <p>{d.contactSummary || '—'}</p>
        </>
      )}
      <h3>{t('交易与账户核查明细')}</h3>
      <div className={styles.tableScroll}>
        <table className={styles.readTable}>
          <thead>
            <tr>
              {['账户编号', '市场', '证券品种', '业务日期', '方向', '金额（元）', '核查结果', '核查说明'].map((v) => (
                <th key={v}>{t(v)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.checks.map((r) => (
              <tr key={r.id}>
                <td>{r.accountRef || '—'}</td>
                <td>{r.market || '—'}</td>
                <td>{r.instrument || '—'}</td>
                <td>{r.tradeDate || '—'}</td>
                <td>{label(r.direction)}</td>
                <td>
                  {(r.amountCents / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td>{label(r.finding)}</td>
                <td>{r.note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <strong>
        {t('核查金额合计')}：¥{' '}
        {(d.checks.reduce((sum, r) => sum + r.amountCents, 0) / 100).toLocaleString(locale, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })}
      </strong>
      <h3>{t('处置措施计划')}</h3>
      <div className={styles.tableScroll}>
        <table className={styles.readTable}>
          <thead>
            <tr>
              {['措施类型', '责任人', '完成期限', '措施内容'].map((v) => (
                <th key={v}>{t(v)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.measures.map((r) => (
              <tr key={r.id}>
                <td>{label(r.kind)}</td>
                <td>{employees.find((e) => e.id === r.ownerId)?.name ?? r.ownerId}</td>
                <td>{r.dueDate || '—'}</td>
                <td>{r.description || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
