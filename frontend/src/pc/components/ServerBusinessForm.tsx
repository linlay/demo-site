import { useEffect, useRef, useState, type ReactElement } from 'react';
import type {
  Approval,
  ApprovalTemplate,
  BusinessAsset,
  BusinessDetail,
  BusinessPage,
  BusinessResult,
  Expense,
  ExpenseLine,
  ExpenseReceipt,
  SessionEmployee,
  Travel
} from '@app/api';
import { usePreferences } from '../../common/preferences/context';
import { useDemoSession } from '../hooks/useDemoSession';
import type { BusinessService } from '../service/businessService';
import styles from '../pages/ServerBusinessPage.module.css';

type Kind = 'approval' | 'travel' | 'expense' | 'draft';
export function ServerBusinessForm({
  kind,
  actor,
  service,
  editing,
  template,
  onClose,
  onSaved
}: {
  kind: Kind;
  actor: SessionEmployee;
  service: BusinessService;
  editing?: Approval | Travel | Expense;
  template?: ApprovalTemplate;
  onClose(): void;
  onSaved(result: BusinessResult): void;
}): ReactElement {
  const { t } = usePreferences();
  const demo = useDemoSession();
  const [applicantId, setApplicant] = useState(editing?.applicantId ?? actor.id);
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [travelers, setTravelers] = useState<string[]>([actor.id]);
  const approval = editing && 'title' in editing ? editing : undefined;
  const expense = editing && 'receipts' in editing ? editing : undefined;
  const [materials, setMaterials] = useState<Array<{ id: string; name: string }>>([]);
  const [trips, setTrips] = useState<Travel[]>([]);
  const [assets, setAssets] = useState<BusinessAsset[]>([]);
  const [title, setTitle] = useState(approval?.title ?? '');
  const [description, setDescription] = useState(approval?.description ?? '');
  const [fields, setFields] = useState<Record<string, string>>(approval?.fields ?? {});
  const [reviewerId, setReviewer] = useState(
    approval?.reviewerId ??
      demo?.session.employees.find(
        (e) => e.active && e.id !== actor.id && e.departmentId === actor.departmentId && e.roles.includes('manager')
      )?.id ??
      demo?.session.employees.find((e) => e.active && e.id !== actor.id && e.roles.includes('manager'))?.id ??
      ''
  );
  const [materialIds, setMaterialIds] = useState(approval?.materialIds ?? []);
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [amount, setAmount] = useState(editing && 'amountCents' in editing ? String(editing.amountCents) : '');
  const [travelFormId, setTravel] = useState(expense?.travelFormId ?? '');
  const [receipts, setReceipts] = useState<ExpenseReceipt[]>(
    expense?.receipts ?? [{ invoiceNo: '', assetId: '', amountCents: 0 }]
  );
  const [lines, setLines] = useState<ExpenseLine[]>(
    expense?.lineItems ?? [{ category: 'transport', invoiceNo: '', amountCents: 0 }]
  );
  const [filename, setFilename] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempts = useRef(new Map<string, string>());
  const total = receipts.reduce((sum, r) => sum + r.amountCents, 0);
  useEffect(() => {
    const controller = new AbortController();
    if (kind === 'draft' && editing)
      void service
        .call<BusinessDetail<Travel>>('travel_read', { actorId: actor.id, id: editing.id }, controller.signal)
        .then((d) => {
          setAssets(d.assets ?? []);
          setSelectedAssets((d.assets ?? []).filter((a) => a.ownerId === editing.id).map((a) => a.id));
        })
        .catch((e: unknown) => {
          if (!controller.signal.aborted) setError(e instanceof Error ? e.message : t('查询失败，请重试。'));
        });
    if (kind === 'approval')
      void service
        .call<Array<{ id: string; name: string }>>('approval_materials_list', {}, controller.signal)
        .then(setMaterials)
        .catch((e: unknown) => {
          if (!controller.signal.aborted) setError(e instanceof Error ? e.message : t('查询失败，请重试。'));
        });
    if (kind === 'expense')
      void service
        .call<BusinessPage<Travel>>('travels_query', { actorId: actor.id, pageSize: 100 }, controller.signal)
        .then((p) => {
          const available = p.items.filter(
            (v) => v.applicantId === actor.id && (v.status === 'submitted' || v.status === 'approved')
          );
          setTrips(available);
          setTravel((current) => current || available[0]?.id || '');
        })
        .catch((e: unknown) => {
          if (!controller.signal.aborted) setError(e instanceof Error ? e.message : t('查询失败，请重试。'));
        });
    return () => controller.abort();
  }, [actor.id, editing, kind, service, t]);
  useEffect(() => {
    if (kind !== 'expense' || !travelFormId) return;
    const controller = new AbortController();
    void service
      .call<BusinessAsset[]>('travel_receipts_list', { actorId: actor.id, id: travelFormId }, controller.signal)
      .then(setAssets)
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : t('查询失败，请重试。'));
      });
    return () => controller.abort();
  }, [actor.id, kind, service, t, travelFormId]);
  function intent(input: object): string {
    const fp = JSON.stringify(input);
    let key = attempts.current.get(fp);
    if (!key) {
      key = crypto.randomUUID();
      attempts.current.set(fp, key);
    }
    return key;
  }
  async function save(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const common = { actorId: actor.id, expectedVersion: editing?.businessVersion ?? 0 };
      const input =
        kind === 'approval'
          ? {
              ...common,
              requestId: approval?.id ?? null,
              title,
              description,
              materialIds,
              templateId: template?.id ?? approval?.templateId ?? 'office',
              fields,
              reviewerId
            }
          : kind === 'travel'
            ? {
                ...common,
                departmentId: actor.departmentId,
                travelerIds: travelers,
                origin,
                destination,
                startAt: `${start}:00+08:00`,
                endAt: `${end}:00+08:00`,
                estimatedAmountCents: Number(amount)
              }
            : kind === 'draft'
              ? {
                  ...common,
                  formId: editing?.id,
                  applicantId,
                  departmentId: demo?.session.employees.find((e) => e.id === applicantId)?.departmentId ?? '',
                  amountCents: Number(amount),
                  assetIds: selectedAssets
                }
              : {
                  ...common,
                  travelFormId,
                  receipts,
                  lineItems: lines,
                  declaredTotalCents: total,
                  ...(expense ? { expenseFormId: expense.id } : {})
                };
      const op =
        kind === 'approval'
          ? 'approval_submit'
          : kind === 'travel'
            ? 'travel_submit'
            : kind === 'draft'
              ? 'travel_draft_save'
              : expense
                ? 'expense_correct'
                : 'expense_check';
      const result = await service.call<BusinessResult>(op, { ...input, idempotencyKey: intent(input) });
      onSaved(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('办理失败。'));
    } finally {
      setBusy(false);
    }
  }
  async function register(): Promise<void> {
    const trip = trips.find((v) => v.id === travelFormId);
    if (!trip || busy) return;
    setBusy(true);
    setError('');
    const input = { actorId: actor.id, travelFormId, filename, expectedVersion: trip.businessVersion };
    try {
      await service.call('travel_receipt_register', { ...input, idempotencyKey: intent(input) });
      setAssets(await service.call<BusinessAsset[]>('travel_receipts_list', { actorId: actor.id, id: travelFormId }));
      setFilename('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('办理失败。'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.editor}>
      <header>
        <h2>
          {template
            ? t(template.name)
            : t(
                kind === 'draft'
                  ? '编辑草稿'
                  : expense
                    ? '补正费用'
                    : approval
                      ? '重新提交申请'
                      : kind === 'approval'
                        ? '新建申请'
                        : kind === 'travel'
                          ? '提交差旅申请'
                          : '核验费用并创建草稿'
              )}
        </h2>
        <button type="button" disabled={busy} onClick={onClose}>
          {t('返回')}
        </button>
      </header>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {kind === 'approval' && (
          <div className={styles.formGrid}>
            {template?.fields.map((field) => (
              <label key={field.id}>
                {t(field.label)}
                {field.type === 'select' ? (
                  <select
                    required
                    value={fields[field.id] ?? ''}
                    onChange={(e) => setFields({ ...fields, [field.id]: e.target.value })}
                  >
                    <option value="">{t('请选择')}</option>
                    {field.options?.map((option) => (
                      <option key={option} value={option}>
                        {t(option)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    required
                    type={field.type}
                    min={field.type === 'number' ? '0.01' : undefined}
                    step={field.id === 'quantity' ? '1' : 'any'}
                    maxLength={300}
                    value={fields[field.id] ?? ''}
                    onChange={(e) => setFields({ ...fields, [field.id]: e.target.value })}
                  />
                )}
              </label>
            ))}
            <label>
              {t('审批人')}
              <select required value={reviewerId} onChange={(e) => setReviewer(e.target.value)}>
                <option value="">{t('请选择')}</option>
                {demo?.session.employees
                  .filter((e) => e.active && e.id !== actor.id && e.roles.includes('manager'))
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {t('标题')}
              <input required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label>
              {t('申请说明')}
              <textarea
                required
                maxLength={2000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <fieldset>
              <legend>{t('申请资料')}</legend>
              {materials.length > 0 && !materialIds.length && <p>{t('请选择相关申请资料')}</p>}
              {materials.map((m) => (
                <label className={styles.check} key={m.id}>
                  <input
                    type="checkbox"
                    checked={materialIds.includes(m.id)}
                    onChange={(e) =>
                      setMaterialIds(
                        e.target.checked ? [...materialIds, m.id] : materialIds.filter((id) => id !== m.id)
                      )
                    }
                  />
                  {m.name}
                </label>
              ))}
            </fieldset>
          </div>
        )}
        {kind === 'travel' && (
          <div className={styles.formGrid}>
            <label>
              {t('出发地')}
              <input required maxLength={80} value={origin} onChange={(e) => setOrigin(e.target.value)} />
            </label>
            <label>
              {t('目的地')}
              <input required maxLength={80} value={destination} onChange={(e) => setDestination(e.target.value)} />
            </label>
            <label>
              {t('开始时间（北京时间）')}
              <input required type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label>
              {t('结束时间（北京时间）')}
              <input required type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
            <label>
              {t('预计金额（分）')}
              <input
                required
                type="number"
                min="1"
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <fieldset>
              <legend>{t('同行人员')}</legend>
              {demo?.session.employees
                .filter((e) => e.active && e.departmentId === actor.departmentId)
                .map((e) => (
                  <label key={e.id} className={styles.check}>
                    <input
                      type="checkbox"
                      checked={travelers.includes(e.id)}
                      onChange={(event) =>
                        setTravelers(
                          event.target.checked ? [...travelers, e.id] : travelers.filter((id) => id !== e.id)
                        )
                      }
                    />
                    {e.name}
                  </label>
                ))}
            </fieldset>
          </div>
        )}
        {kind === 'draft' && (
          <div className={styles.formGrid}>
            <label>
              {t('申请人')}
              <select value={applicantId} onChange={(e) => setApplicant(e.target.value)}>
                {demo?.session.employees
                  .filter((e) => e.active && e.roles.includes('employee'))
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {t('预计金额（分）')}
              <input
                type="number"
                min="0"
                step="1"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <fieldset>
              <legend>{t('附件')}</legend>
              {assets.map((a) => (
                <label key={a.id} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={selectedAssets.includes(a.id)}
                    onChange={(e) =>
                      setSelectedAssets(
                        e.target.checked ? [...selectedAssets, a.id] : selectedAssets.filter((id) => id !== a.id)
                      )
                    }
                  />
                  {a.filename}
                </label>
              ))}
            </fieldset>
          </div>
        )}
        {kind === 'expense' && (
          <>
            <label>
              {t('关联差旅')}
              <select
                required
                value={travelFormId}
                disabled={!!expense}
                onChange={(e) => {
                  setTravel(e.target.value);
                  setAssets([]);
                  setReceipts([{ invoiceNo: '', assetId: '', amountCents: 0 }]);
                  setLines([{ category: 'transport', invoiceNo: '', amountCents: 0 }]);
                }}
              >
                <option value="">{t('请选择')}</option>
                {trips.map((trip) => (
                  <option key={trip.id} value={trip.id}>
                    {trip.id} · {trip.origin} → {trip.destination}
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>{t('登记虚构票据附件')}</legend>
              <div className={styles.actions}>
                <label>
                  {t('附件名称')}
                  <input maxLength={120} value={filename} onChange={(e) => setFilename(e.target.value)} />
                </label>
                <button type="button" disabled={busy || !filename.trim()} onClick={() => void register()}>
                  {t('登记票据')}
                </button>
              </div>
            </fieldset>
            <table>
              <caption>{t('票据')}</caption>
              <thead>
                <tr>
                  <th>{t('票据编号')}</th>
                  <th>{t('附件')}</th>
                  <th>{t('金额（分）')}</th>
                  <th>{t('操作')}</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((receipt, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        required
                        maxLength={64}
                        aria-label={`${t('票据编号')} ${i + 1}`}
                        value={receipt.invoiceNo}
                        onChange={(e) =>
                          setReceipts(receipts.map((r, n) => (n === i ? { ...r, invoiceNo: e.target.value } : r)))
                        }
                      />
                    </td>
                    <td>
                      <select
                        required
                        aria-label={`${t('附件')} ${i + 1}`}
                        value={receipt.assetId}
                        onChange={(e) =>
                          setReceipts(receipts.map((r, n) => (n === i ? { ...r, assetId: e.target.value } : r)))
                        }
                      >
                        <option value="">{t('请选择')}</option>
                        {assets.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.filename} · {a.id}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        required
                        type="number"
                        min="1"
                        step="1"
                        aria-label={`${t('金额（分）')} ${i + 1}`}
                        value={receipt.amountCents || ''}
                        onChange={(e) =>
                          setReceipts(
                            receipts.map((r, n) => (n === i ? { ...r, amountCents: Number(e.target.value) } : r))
                          )
                        }
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        disabled={receipts.length === 1}
                        onClick={() => setReceipts(receipts.filter((_, n) => n !== i))}
                      >
                        {t('删除')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              type="button"
              disabled={receipts.length >= 20}
              onClick={() => setReceipts([...receipts, { invoiceNo: '', assetId: '', amountCents: 0 }])}
            >
              {t('添加票据')}
            </button>
            <table>
              <caption>{t('费用明细')}</caption>
              <thead>
                <tr>
                  <th>{t('关联票据')}</th>
                  <th>{t('费用类别')}</th>
                  <th>{t('金额（分）')}</th>
                  <th>{t('操作')}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i}>
                    <td>
                      <select
                        required
                        aria-label={`${t('关联票据')} ${i + 1}`}
                        value={line.invoiceNo}
                        onChange={(e) =>
                          setLines(lines.map((l, n) => (n === i ? { ...l, invoiceNo: e.target.value } : l)))
                        }
                      >
                        <option value="">{t('请选择')}</option>
                        {receipts
                          .filter((r) => r.invoiceNo)
                          .map((r, n) => (
                            <option key={n} value={r.invoiceNo}>
                              {r.invoiceNo}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td>
                      <select
                        aria-label={`${t('费用类别')} ${i + 1}`}
                        value={line.category}
                        onChange={(e) =>
                          setLines(
                            lines.map((l, n) =>
                              n === i ? { ...l, category: e.target.value as ExpenseLine['category'] } : l
                            )
                          )
                        }
                      >
                        {Object.entries({ transport: '交通', hotel: '住宿', meal: '餐饮', other: '其他' }).map(
                          ([key, label]) => (
                            <option key={key} value={key}>
                              {t(label)}
                            </option>
                          )
                        )}
                      </select>
                    </td>
                    <td>
                      <input
                        required
                        type="number"
                        min="1"
                        step="1"
                        aria-label={`${t('明细金额')} ${i + 1}`}
                        value={line.amountCents || ''}
                        onChange={(e) =>
                          setLines(lines.map((l, n) => (n === i ? { ...l, amountCents: Number(e.target.value) } : l)))
                        }
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        disabled={lines.length === 1}
                        onClick={() => setLines(lines.filter((_, n) => n !== i))}
                      >
                        {t('删除')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              type="button"
              disabled={lines.length >= 40}
              onClick={() => setLines([...lines, { category: 'transport', invoiceNo: '', amountCents: 0 }])}
            >
              {t('添加明细')}
            </button>
            <p>
              {t('申报总额（分）')}：{total} · {t('明细合计（分）')}：{lines.reduce((sum, l) => sum + l.amountCents, 0)}
            </p>
          </>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || (kind === 'approval' && (!materialIds.length || !reviewerId))}>
          {t(busy ? '正在办理…' : kind === 'expense' ? '核验并保存' : kind === 'draft' ? '保存草稿' : '提交申请')}
        </button>
      </form>
    </section>
  );
}
