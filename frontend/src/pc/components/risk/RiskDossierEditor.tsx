import { useEffect, useState, type ReactNode } from 'react';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import type { AwcpFieldError } from '@app/awcp';
import type { Employee } from '../../../common/fixtures/types';
import { DEMO_MARKETS, type RiskDossier } from '../../../common/risk/dossier';
import { usePreferences } from '../../../common/preferences/context';
import styles from './RiskForm.module.css';

const fieldNames: Record<string, string> = {
  accountRef: '账户编号',
  market: '市场',
  instrument: '证券品种',
  tradeDate: '业务日期',
  direction: '方向',
  amountCents: '金额（元）',
  finding: '核查结果',
  note: '核查说明',
  kind: '措施类型',
  ownerId: '责任人',
  dueDate: '完成期限',
  description: '措施内容'
};
const labels: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  system: '系统流水核对',
  documents: '材料核验',
  contact: '客户沟通',
  phone: '电话',
  email: '邮件',
  meeting: '面谈',
  buy: '买入',
  sell: '卖出',
  transfer: '划转',
  normal: '正常',
  abnormal: '异常',
  unconfirmed: '待确认',
  monitor: '持续监控',
  'request-material': '补充材料',
  escalate: '升级报告'
};
type FormPatch<T> = Partial<{ [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K] }>;
interface Props {
  value: RiskDossier;
  onChange(value: RiskDossier): void;
  disabled: boolean;
  employees: Employee[];
  errors: AwcpFieldError[];
}
function Field({
  title,
  required,
  error,
  children
}: {
  title: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className={styles.field}>
      <span>
        {required && <b className={styles.required}>*</b>}
        {title}
      </span>
      {children}
      {error && <small className={styles.fieldError}>{error}</small>}
    </label>
  );
}
export function RiskDossierEditor({ value: d, onChange, disabled, employees, errors }: Props) {
  const { t, locale } = usePreferences();
  const [tab, setTab] = useState<'checks' | 'measures'>('checks');
  useEffect(() => {
    const section = errors.find((e) => e.path[0] === 'dossier' && ['checks', 'measures'].includes(String(e.path[1])))
      ?.path[1];
    if (section === 'checks' || section === 'measures') setTab(section);
  }, [errors]);
  const update = (patch: FormPatch<RiskDossier>) => onChange({ ...d, ...patch });
  const errorFor = (path: string) =>
    errors
      .filter((e) => e.path.join('.') === `dossier.${path}`)
      .flatMap((e) => e.messages)
      .map(t)
      .join(' ');
  const attrs = (path: string) => ({
    id: `risk-dossier-${path.replaceAll('.', '-')}`,
    'aria-invalid': !!errorFor(path)
  });
  const enumOptions = (values: string[]) => (
    <>
      <option value="">{t('请选择')}</option>
      {values.map((v) => (
        <option key={v} value={v}>
          {t(labels[v])}
        </option>
      ))}
    </>
  );
  const total = d.checks.reduce((sum, r) => sum + r.amountCents, 0);
  return (
    <>
      <details className={styles.section} open>
        <summary>{t('调查范围与沟通记录')}</summary>
        <div className={styles.sectionBody}>
          <div className={styles.fields}>
            <Field title={t('核查开始日期')} required error={errorFor('periodStart')}>
              <input
                {...attrs('periodStart')}
                type="date"
                value={d.periodStart}
                disabled={disabled}
                onChange={(e) => update({ periodStart: e.target.value })}
              />
            </Field>
            <Field title={t('核查结束日期')} required error={errorFor('periodEnd')}>
              <input
                {...attrs('periodEnd')}
                type="date"
                value={d.periodEnd}
                disabled={disabled}
                onChange={(e) => update({ periodEnd: e.target.value })}
              />
            </Field>
            <Field title={t('风险等级')} required error={errorFor('riskLevel')}>
              <select
                {...attrs('riskLevel')}
                value={d.riskLevel}
                disabled={disabled}
                onChange={(e) => update({ riskLevel: e.target.value })}
              >
                {enumOptions(['low', 'medium', 'high'])}
              </select>
            </Field>
            <Field title={t('是否需要客户联系')}>
              <select
                value={String(d.contactRequired)}
                disabled={disabled}
                onChange={(e) => update({ contactRequired: e.target.value === 'true', ...(e.target.value === 'false' ? { methods: d.methods.filter((v) => v !== 'contact') } : {}) })}
              >
                <option value="false">{t('否')}</option>
                <option value="true">{t('是')}</option>
              </select>
            </Field>
          </div>
          <fieldset className={styles.checkGroup} id="risk-dossier-methods">
            <legend>
              <b className={styles.required}>*</b>
              {t('核查方式')}
            </legend>
            {['system', 'documents', 'contact'].map((method) => (
              <label key={method}>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={d.methods.includes(method)}
                  onChange={(e) =>
                    update({
                      methods: e.target.checked ? [...d.methods, method] : d.methods.filter((v) => v !== method),
                      ...(method === 'contact' && e.target.checked ? { contactRequired: true } : {})
                    })
                  }
                />
                {t(labels[method])}
              </label>
            ))}
            {errorFor('methods') && <p className={styles.fieldError}>{errorFor('methods')}</p>}
          </fieldset>
          {(d.contactRequired || d.methods.includes('contact')) && (
            <div className={styles.contactFields}>
              <div className={styles.fields}>
                <Field title={t('联系日期')} required error={errorFor('contactOn')}>
                  <input
                    {...attrs('contactOn')}
                    type="date"
                    disabled={disabled}
                    value={d.contactOn}
                    onChange={(e) => update({ contactOn: e.target.value })}
                  />
                </Field>
                <Field title={t('联系渠道')} required error={errorFor('contactMethod')}>
                  <select
                    {...attrs('contactMethod')}
                    disabled={disabled}
                    value={d.contactMethod}
                    onChange={(e) => update({ contactMethod: e.target.value })}
                  >
                    {enumOptions(['phone', 'email', 'meeting'])}
                  </select>
                </Field>
              </div>
              <Field title={t('沟通记录')} required error={errorFor('contactSummary')}>
                <textarea
                  {...attrs('contactSummary')}
                  rows={3}
                  maxLength={500}
                  disabled={disabled}
                  value={d.contactSummary}
                  onChange={(e) => update({ contactSummary: e.target.value })}
                />
              </Field>
            </div>
          )}
        </div>
      </details>
      <section className={styles.section}>
        <div className={styles.tabs} role="tablist" aria-label={t('业务明细')}>
          {(['checks', 'measures'] as const).map((key) => (
            <button
              type="button"
              role="tab"
              id={`risk-tab-${key}`}
              aria-controls={`risk-panel-${key}`}
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              key={key}
            >
              {t(key === 'checks' ? '交易与账户核查明细' : '处置措施计划')} <span>{d[key].length}</span>
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id={`risk-panel-${tab}`}
          aria-labelledby={`risk-tab-${tab}`}
          className={styles.sectionBody}
        >
          <div className={styles.tableToolbar}>
            <div>
              <h3>{t(tab === 'checks' ? '核查明细表' : '措施明细表')}</h3>
              <p>{t('最多 20 行，带星号的字段为提交必填。')}</p>
            </div>
            <button
              type="button"
              className={styles.secondary}
              disabled={disabled || d[tab].length >= 20}
              onClick={() =>
                tab === 'checks'
                  ? update({
                      checks: [
                        ...d.checks,
                        {
                          id: crypto.randomUUID(),
                          accountRef: '',
                          market: '',
                          instrument: '',
                          tradeDate: '',
                          direction: '',
                          amountCents: 0,
                          finding: '',
                          note: ''
                        }
                      ]
                    })
                  : update({
                      measures: [
                        ...d.measures,
                        { id: crypto.randomUUID(), kind: '', ownerId: '', dueDate: '', description: '' }
                      ]
                    })
              }
            >
              <PlusOutlined /> {t(tab === 'checks' ? '新增核查明细' : '新增处置措施')}
            </button>
          </div>
          {errorFor(tab) && <p className={styles.fieldError}>{errorFor(tab)}</p>}
          <div className={styles.tableScroll}>
            <table className={styles.editTable}>
              <thead>
                <tr>
                  {(tab === 'checks'
                    ? [
                        '序号',
                        '账户编号 *',
                        '市场 *',
                        '证券品种 *',
                        '业务日期 *',
                        '方向 *',
                        '金额（元） *',
                        '核查结果 *',
                        '核查说明',
                        '操作'
                      ]
                    : ['序号', '措施类型 *', '责任人 *', '完成期限 *', '措施内容 *', '操作']
                  ).map((name) => (
                    <th key={name}>{t(name)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tab === 'checks'
                  ? d.checks.map((r, index) => {
                      const change = (patch: FormPatch<typeof r>) =>
                        update({ checks: d.checks.map((row) => (row.id === r.id ? { ...row, ...patch } : row)) });
                      const input = (name: string) => ({
                        ...attrs(`checks.${index}.${name}`),
                        'aria-label': `${t('核查明细')} ${index + 1} ${t(fieldNames[name] ?? name)}`,
                        disabled,
                        title: errorFor(`checks.${index}.${name}`) || undefined
                      });
                      const rowErrors = errors
                        .filter((e) => e.path.slice(0, 3).join('.') === `dossier.checks.${index}`)
                        .flatMap((e) => e.messages);
                      return (
                        <tr key={r.id}>
                          <td>{index + 1}</td>
                          <td>
                            <input
                              {...input('accountRef')}
                              placeholder="DEMO-ACCOUNT-001"
                              maxLength={40}
                              value={r.accountRef}
                              onChange={(e) => change({ accountRef: e.target.value })}
                            />
                          </td>
                          <td>
                            <select
                              {...input('market')}
                              value={r.market}
                              onChange={(e) => change({ market: e.target.value, instrument: '' })}
                            >
                              <option value="">{t('请选择')}</option>
                              {DEMO_MARKETS.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {t(m.label)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select
                              {...input('instrument')}
                              disabled={disabled || !r.market}
                              value={r.instrument}
                              onChange={(e) => change({ instrument: e.target.value })}
                            >
                              <option value="">{t('请选择')}</option>
                              {DEMO_MARKETS.find((m) => m.id === r.market)?.instruments.map((code) => (
                                <option key={code}>{code}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              {...input('tradeDate')}
                              type="date"
                              value={r.tradeDate}
                              onChange={(e) => change({ tradeDate: e.target.value })}
                            />
                          </td>
                          <td>
                            <select
                              {...input('direction')}
                              value={r.direction}
                              onChange={(e) => change({ direction: e.target.value })}
                            >
                              {enumOptions(['buy', 'sell', 'transfer'])}
                            </select>
                          </td>
                          <td>
                            <input
                              {...input('amountCents')}
                              type="number"
                              min="0"
                              max="1000000000"
                              step="0.01"
                              value={r.amountCents / 100}
                              onChange={(e) => {
                                const v = e.target.valueAsNumber;
                                change({ amountCents: Number.isFinite(v) ? Math.round(v * 100) : 0 });
                              }}
                            />
                          </td>
                          <td>
                            <select
                              {...input('finding')}
                              value={r.finding}
                              onChange={(e) => change({ finding: e.target.value })}
                            >
                              {enumOptions(['normal', 'abnormal', 'unconfirmed'])}
                            </select>
                          </td>
                          <td>
                            <textarea
                              {...input('note')}
                              rows={2}
                              maxLength={300}
                              value={r.note}
                              onChange={(e) => change({ note: e.target.value })}
                            />
                            {rowErrors.length > 0 && (
                              <small className={styles.fieldError}>{[...new Set(rowErrors)].map(t).join(' ')}</small>
                            )}
                          </td>
                          <td>
                            <button
                              type="button"
                              className={styles.iconButton}
                              disabled={disabled}
                              aria-label={`${t('删除核查明细')} ${index + 1}`}
                              onClick={() => update({ checks: d.checks.filter((row) => row.id !== r.id) })}
                            >
                              <DeleteOutlined />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  : d.measures.map((r, index) => {
                      const change = (patch: FormPatch<typeof r>) =>
                        update({ measures: d.measures.map((row) => (row.id === r.id ? { ...row, ...patch } : row)) });
                      const input = (name: string) => ({
                        ...attrs(`measures.${index}.${name}`),
                        'aria-label': `${t('处置措施')} ${index + 1} ${t(fieldNames[name] ?? name)}`,
                        disabled,
                        title: errorFor(`measures.${index}.${name}`) || undefined
                      });
                      const rowErrors = errors
                        .filter((e) => e.path.slice(0, 3).join('.') === `dossier.measures.${index}`)
                        .flatMap((e) => e.messages);
                      return (
                        <tr key={r.id}>
                          <td>{index + 1}</td>
                          <td>
                            <select
                              {...input('kind')}
                              value={r.kind}
                              onChange={(e) => change({ kind: e.target.value })}
                            >
                              {enumOptions(['monitor', 'request-material', 'escalate'])}
                            </select>
                          </td>
                          <td>
                            <select
                              {...input('ownerId')}
                              value={r.ownerId}
                              onChange={(e) => change({ ownerId: e.target.value })}
                            >
                              <option value="">{t('请选择')}</option>
                              {employees
                                .filter((e) => e.active)
                                .map((e) => (
                                  <option key={e.id} value={e.id}>
                                    {e.name}
                                  </option>
                                ))}
                            </select>
                          </td>
                          <td>
                            <input
                              {...input('dueDate')}
                              type="date"
                              value={r.dueDate}
                              onChange={(e) => change({ dueDate: e.target.value })}
                            />
                          </td>
                          <td>
                            <textarea
                              {...input('description')}
                              maxLength={300}
                              rows={2}
                              value={r.description}
                              onChange={(e) => change({ description: e.target.value })}
                            />
                            {rowErrors.length > 0 && (
                              <small className={styles.fieldError}>{[...new Set(rowErrors)].map(t).join(' ')}</small>
                            )}
                          </td>
                          <td>
                            <button
                              type="button"
                              className={styles.iconButton}
                              disabled={disabled}
                              aria-label={`${t('删除处置措施')} ${index + 1}`}
                              onClick={() => update({ measures: d.measures.filter((row) => row.id !== r.id) })}
                            >
                              <DeleteOutlined />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
            {!d[tab].length && (
              <div className={styles.empty}>
                {t(tab === 'checks' ? '尚无核查明细，请新增后填写。' : '尚无处置措施，确认或升级预警时须填写。')}
              </div>
            )}
          </div>
          <div className={styles.tableFooter}>
            <span>
              {t('共')} {d[tab].length} {t('条')}
            </span>
            {tab === 'checks' && (
              <strong>
                {t('核查金额合计')}：¥{' '}
                {(total / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </strong>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
