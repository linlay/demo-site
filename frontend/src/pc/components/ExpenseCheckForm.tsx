import { useCurrentActor } from '../../app/currentUserContext';
import { useWorkflowAction as useAwcpAction } from '../../app/useWorkflowAction';
import type { AwcpActionRegistration } from '@app/awcp';
import { useState, type FormEvent, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import { EXPENSE_CHECK_SCHEMA } from '../../common/awcp/expenseSchemas';
import type { ExpenseCheckInput, ExpenseService } from '../service/expenseService';
import styles from './TravelSubmitForm.module.css';

const EXAMPLE: ExpenseCheckInput = {
  actorId: 'EMP-001',
  travelFormId: 'FORM-001',
  receipts: [{ invoiceNo: 'DEMO-HOTEL-002', assetId: 'AST-004', amountCents: 50000 }],
  lineItems: [{ category: 'hotel', invoiceNo: 'DEMO-HOTEL-002', amountCents: 50000 }],
  declaredTotalCents: 50000,
  idempotencyKey: 'o09-expense-check-example-001'
};

function newIntentKey(): string {
  return `expense-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ExpenseCheckForm({ service }: { service: ExpenseService }): ReactElement {
  const actorId = useCurrentActor('EMP-001');
  const [travelFormId, setTravelFormId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [category, setCategory] = useState<'' | 'transport' | 'hotel' | 'meal' | 'other'>('');
  const [amountCents, setAmountCents] = useState<number | ''>('');
  const [declaredTotalCents, setDeclaredTotalCents] = useState<number | ''>('');
  const [intentKey, setIntentKey] = useState(newIntentKey);
  const [message, setMessage] = useState('');
  const trips = service.eligibleTrips().filter((trip) => trip.applicantId === actorId);
  const trip = trips.find((item) => item.formId === travelFormId);
  const assets = travelFormId ? service.availableReceipts(travelFormId) : [];

  const registration: AwcpActionRegistration<ExpenseCheckInput> = {
    action: 'office.expense.check',
    title: '校验票据和费用明细',
    description: describeAction({
      purpose: '核验虚构差旅行程关联的票据和费用明细并建立报销草稿。',
      prerequisites: '出差申请已提交；actorId 为申请人；assetId 来源于该申请的附件清单且未被其他报销使用。',
      parameters: '金额均为整数分；票据编号不重复；每张票据与对应明细金额以及申报总额一致。',
      effects: '成功时原子建立费用草稿、关联票据与明细、审计及业务幂等记录。',
      result: '返回 completed、费用单据 ID、checked 状态、业务版本和总额。',
      failures: '重复票据、附件无效和总额不符返回具体字段；失败不写入，修正后使用新业务键提交。'
    }),
    inputSchema: EXPENSE_CHECK_SCHEMA,
    examples: [EXAMPLE],
    validate: (args) => service.validate(args),
    invoke: (args) => completed(service.check(args))
  };
  useAwcpAction(registration);

  function check(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const input: ExpenseCheckInput = {
      actorId,
      travelFormId,
      receipts: [{ invoiceNo, assetId, amountCents: Number(amountCents) }],
      lineItems: [{ category: category as 'transport' | 'hotel' | 'meal' | 'other', invoiceNo, amountCents: Number(amountCents) }],
      declaredTotalCents: Number(declaredTotalCents),
      idempotencyKey: intentKey
    };
    try {
      const result = service.check(input);
      setMessage(`已校验费用草稿 ${result.expenseFormId}，金额 ${result.declaredTotalCents} 分。`);
      setIntentKey(newIntentKey());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '校验失败。');
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="expense-check-title">
      <h2 id="expense-check-title">O09-02 校验票据和费用明细</h2>
      <p>票据为虚构附件；此步骤建立已校验的报销草稿，不提交审批。</p>
      <form className={styles.form} aria-label="校验费用明细" onSubmit={check}>
        <label htmlFor="expense-travel">出差申请</label>
        <select
          id="expense-travel"
          value={travelFormId}
          onChange={(event) => {
            setTravelFormId(event.target.value);
            setAssetId('');
          }}
        >
          <option value="">请选择</option>
          {trips.map((item) => (
            <option key={item.formId} value={item.formId}>
              {item.formId}（申请人 {item.applicantId}）
            </option>
          ))}
        </select>
        <label htmlFor="expense-asset">票据附件 assetId</label>
        <select id="expense-asset" value={assetId} onChange={(event) => setAssetId(event.target.value)}>
          <option value="">请选择</option>
          {assets.map((asset) => (
            <option key={asset.assetId} value={asset.assetId}>
              {asset.filename}（{asset.assetId}）
            </option>
          ))}
        </select>
        <label htmlFor="expense-invoice">票据编号</label>
        <input
          id="expense-invoice"
          value={invoiceNo}
          maxLength={64}
          onChange={(event) => setInvoiceNo(event.target.value)}
          required
        />
        <label htmlFor="expense-category">费用类别</label>
        <select
          id="expense-category"
          value={category}
          onChange={(event) => setCategory(event.target.value as typeof category)}
        >
          <option value="">请选择</option>
          <option value="transport">交通</option>
          <option value="hotel">住宿</option>
          <option value="meal">餐饮</option>
          <option value="other">其他</option>
        </select>
        <label htmlFor="expense-amount">票据与明细金额（分）</label>
        <input
          id="expense-amount"
          type="number"
          min="1"
          step="1"
          value={amountCents}
          onChange={(event) => setAmountCents(event.target.value ? Number(event.target.value) : '')}
          required
        />
        <label htmlFor="expense-total">申报总额（分）</label>
        <input
          id="expense-total"
          type="number"
          min="1"
          step="1"
          value={declaredTotalCents}
          onChange={(event) => setDeclaredTotalCents(event.target.value ? Number(event.target.value) : '')}
          required
        />
        <button type="submit" disabled={!trip || !assetId || !invoiceNo.trim() || !category || !amountCents || !declaredTotalCents}>
          校验并保存草稿
        </button>
        <p role="status">{message}</p>
      </form>
    </section>
  );
}
