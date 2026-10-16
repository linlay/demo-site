import { useCurrentActor } from '../../app/currentUserContext';
import { useWorkflowAction as useAwcpAction } from '../../app/useWorkflowAction';
import type { AwcpActionRegistration } from '@app/awcp';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import {
  EXPENSE_CORRECT_SCHEMA,
  EXPENSE_READ_SCHEMA,
  EXPENSE_REVIEW_SCHEMA,
  EXPENSE_SUBMIT_SCHEMA
} from '../../common/awcp/expenseSchemas';
import type {
  ExpenseCorrectInput,
  ExpenseFlowService,
  ExpenseMutationInput,
  ExpenseProgress,
  ExpenseReadInput,
  ExpenseReviewInput
} from '../service/expenseFlowService';
import styles from './TravelSubmitForm.module.css';

const SUBMIT_EXAMPLE: ExpenseMutationInput = {
  expenseFormId: 'FORM-003',
  actorId: 'EMP-001',
  expectedVersion: 1,
  idempotencyKey: 'o09-expense-submit-example-001'
};
const REVIEW_EXAMPLES: ExpenseReviewInput[] = [
  {
    expenseFormId: 'FORM-003',
    actorId: 'EMP-002',
    expectedVersion: 2,
    decision: 'approve',
    reason: '',
    idempotencyKey: 'o09-expense-approve-example-001'
  },
  {
    expenseFormId: 'FORM-003',
    actorId: 'EMP-002',
    expectedVersion: 2,
    decision: 'return',
    reason: '请补正票据金额',
    idempotencyKey: 'o09-expense-return-example-001'
  }
];
const CORRECT_EXAMPLE: ExpenseCorrectInput = {
  expenseFormId: 'FORM-003',
  expectedVersion: 3,
  actorId: 'EMP-001',
  travelFormId: 'FORM-001',
  receipts: [{ invoiceNo: 'DEMO-HOTEL-002', assetId: 'AST-004', amountCents: 51000 }],
  lineItems: [{ category: 'hotel', invoiceNo: 'DEMO-HOTEL-002', amountCents: 51000 }],
  declaredTotalCents: 51000,
  idempotencyKey: 'o09-expense-correct-example-001'
};
const READ_EXAMPLE: ExpenseReadInput = { expenseFormId: 'FORM-003', actorId: 'EMP-001' };

function newIntentKey(): string {
  return `expense-flow-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ExpenseFlowPanel({ service, objectId }: { service: ExpenseFlowService; objectId?: string }): ReactElement {
  const [items, setItems] = useState(() => service.list());
  const [selected, setSelected] = useState(objectId ?? '');
  const actorId = useCurrentActor('EMP-001');
  const [reason, setReason] = useState('');
  const [correctionInvoiceNo, setCorrectionInvoiceNo] = useState('');
  const [correctedAmountCents, setCorrectedAmountCents] = useState(0);
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState<ExpenseProgress | null>(null);
  const intentKeys = useRef(new Map<string, string>());
  const expenseFormId = selected || items[0]?.formId || '';
  const current = items.find((item) => item.formId === expenseFormId);
  const claim = expenseFormId ? service.claim(expenseFormId) : null;

  useEffect(() => service.subscribe(() => setItems(service.list())), [service]);
  useEffect(() => {
    if (current?.status !== 'returned' || !expenseFormId) return;
    const first = service.claim(expenseFormId)?.receipts[0];
    setCorrectionInvoiceNo(first?.invoiceNo ?? '');
    setCorrectedAmountCents(first?.amountCents ?? 0);
  }, [current?.status, expenseFormId, service]);

  function keyFor(intent: string): string {
    let key = intentKeys.current.get(intent);
    if (!key) {
      key = newIntentKey();
      intentKeys.current.set(intent, key);
    }
    return key;
  }

  const submitAction: AwcpActionRegistration<ExpenseMutationInput> = {
    action: 'office.expense.submit',
    title: '提交报销申请',
    description: describeAction({
      purpose: '提交已校验的费用草稿或补正后的退回单。',
      prerequisites: '先用 office.expense.check 建立费用草稿；退回后需用 office.expense.correct 补正并重新校验。',
      parameters:
        'expenseFormId 是费用单 ID；actorId 为申请人；expectedVersion 是当前业务版本；idempotencyKey 为稳定业务键。',
      effects: '原子更新状态和版本，创建主管待办并写入审计。',
      result: '返回 completed、单据 ID、submitted 状态和新版本。',
      failures: '旧版本、未校验或无权提交不会写入；刷新进度后处理。'
    }),
    inputSchema: EXPENSE_SUBMIT_SCHEMA,
    examples: [SUBMIT_EXAMPLE],
    validate: (args) => service.validateSubmit(args),
    invoke: (args) => completed(service.submit(args))
  };
  useAwcpAction(submitAction);

  const reviewAction: AwcpActionRegistration<ExpenseReviewInput> = {
    action: 'office.expense.review',
    title: '审批或退回报销',
    description: describeAction({
      purpose: '由当前主管批准或退回已提交的费用单。',
      prerequisites: '先提交费用单；actorId 为同部门待办主管。样例 approve 和 return 各需独立复位流程。',
      parameters: 'decision 为 approve 或 return；退回必须提供 1～200 字 reason；金额不在此方法修改。',
      effects: '原子更新状态和版本、关闭当前待办并记录原因与审计。',
      result: '返回 completed、approved 或 returned 状态及版本。',
      failures: '角色、待办、状态或版本不符时不写入；重新读取进度。'
    }),
    inputSchema: EXPENSE_REVIEW_SCHEMA,
    examples: REVIEW_EXAMPLES,
    validate: (args) => service.validateReview(args),
    invoke: (args) => completed(service.review(args))
  };
  useAwcpAction(reviewAction);

  const correctAction: AwcpActionRegistration<ExpenseCorrectInput> = {
    action: 'office.expense.correct',
    title: '补正退回费用单',
    description: describeAction({
      purpose: '申请人修订退回费用单的票据与明细，并按新业务版本重新校验。',
      prerequisites: '先用 office.expense.review 退回已提交的费用单；例子基于 FORM-003 退回后的版本 3。',
      parameters: '保留关联出差单；票据和明细以整数分表达且金额一致；expectedVersion 为退回后的版本。',
      effects: '原子更新费用数据、业务版本、校验版本与审计；状态仍为 returned，需再次 submit。',
      result: '返回 completed、费用单 ID、新版本与金额。',
      failures: '非申请人、非退回状态、重复票据或金额不一致不写入。'
    }),
    inputSchema: EXPENSE_CORRECT_SCHEMA,
    examples: [CORRECT_EXAMPLE],
    validate: (args) => service.validateCorrect(args),
    invoke: (args) => completed(service.correct(args))
  };
  useAwcpAction(correctAction);

  const readAction: AwcpActionRegistration<ExpenseReadInput> = {
    action: 'office.expense.read',
    title: '查询报销进度',
    description: describeAction({
      purpose: '读取费用单状态、版本、待办主管及关联审计历史。',
      prerequisites: '先用 office.expense.check 建立费用单；申请人或同部门主管可读取。',
      parameters: 'expenseFormId 是费用单 ID；actorId 是查询人。',
      effects: '只读，不改变业务状态。',
      result: '返回 completed、当前状态、金额、版本和历史。',
      failures: '不存在或越权读取返回字段错误。'
    }),
    inputSchema: EXPENSE_READ_SCHEMA,
    examples: [READ_EXAMPLE],
    validate: (args) => service.validateRead(args),
    invoke: (args) => completed(service.read(args))
  };
  useAwcpAction(readAction);

  function run(action: () => string): void {
    try {
      setMessage(action());
      if (expenseFormId && current) setProgress(service.read({ expenseFormId, actorId }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败。');
    }
  }

  function submit(): void {
    if (!current) return;
    const input: ExpenseMutationInput = {
      expenseFormId,
      actorId,
      expectedVersion: current.businessVersion,
      idempotencyKey: keyFor(`submit:${expenseFormId}:${current.businessVersion}:${actorId}`)
    };
    run(() => `已提交 ${service.submit(input).formId}。`);
  }

  function review(decision: 'approve' | 'return'): void {
    if (!current) return;
    const reviewReason = decision === 'return' ? reason : '';
    const input: ExpenseReviewInput = {
      expenseFormId,
      actorId,
      expectedVersion: current.businessVersion,
      decision,
      reason: reviewReason,
      idempotencyKey: keyFor(
        `review:${decision}:${expenseFormId}:${current.businessVersion}:${actorId}:${reviewReason}`
      )
    };
    run(() => `审批结果：${service.review(input).status}。`);
  }

  function correct(): void {
    if (!current || !claim?.receipts[0]) return;
    const first = claim.receipts[0];
    const delta = correctedAmountCents - first.amountCents;
    const lineIndex = claim.lineItems.findIndex((item) => item.invoiceNo === first.invoiceNo);
    if (lineIndex < 0) {
      setMessage('关联费用明细不存在。');
      return;
    }
    const input: ExpenseCorrectInput = {
      expenseFormId,
      actorId,
      expectedVersion: current.businessVersion,
      travelFormId: claim.travelFormId,
      receipts: claim.receipts.map((item, index) =>
        index === 0 ? { ...item, invoiceNo: correctionInvoiceNo, amountCents: correctedAmountCents } : item
      ),
      lineItems: claim.lineItems.map((item, index) =>
        index === lineIndex ? { ...item, invoiceNo: correctionInvoiceNo, amountCents: item.amountCents + delta } : item
      ),
      declaredTotalCents: claim.declaredTotalCents + delta,
      idempotencyKey: keyFor(
        `correct:${expenseFormId}:${current.businessVersion}:${actorId}:${correctionInvoiceNo}:${correctedAmountCents}`
      )
    };
    run(() => `已补正 ${service.correct(input).expenseFormId}，可重新提交。`);
  }

  function read(): void {
    if (!expenseFormId) return;
    try {
      const result = service.read({ expenseFormId, actorId });
      setProgress(result);
      setMessage(`当前状态：${result.status}，业务版本 ${result.businessVersion}。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '查询失败。');
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="expense-flow-title">
      <h2 id="expense-flow-title">O09-03 报销提交、审批与进度</h2>
      <p>先核验票据，再以申请人提交；主管可批准或退回，退回后补正并重提。</p>
      <div className={styles.form}>
        <label htmlFor="expense-flow-form">费用单据</label>
        <select
          id="expense-flow-form"
          value={expenseFormId}
          onChange={(event) => {
            setSelected(event.target.value);
            setProgress(null);
          }}
        >
          {!items.length && <option value="">请先校验费用</option>}
          {items.map((item) => (
            <option key={item.formId} value={item.formId}>
              {item.formId} · {item.status} · 版本 {item.businessVersion}
            </option>
          ))}
        </select>


        <label htmlFor="expense-flow-reason">退回原因</label>
        <input
          id="expense-flow-reason"
          value={reason}
          maxLength={200}
          onChange={(event) => setReason(event.target.value)}
        />
        <div className={styles.actions}>
          <button
            type="button"
            onClick={submit}
            disabled={!current || (current.status !== 'draft' && current.status !== 'returned')}
          >
            提交 / 重新提交
          </button>
          <button type="button" onClick={() => review('approve')} disabled={current?.status !== 'submitted'}>
            主管批准
          </button>
          <button type="button" onClick={() => review('return')} disabled={current?.status !== 'submitted'}>
            主管退回
          </button>
          <button type="button" onClick={read} disabled={!current}>
            查询进度
          </button>
        </div>
        {current?.status === 'returned' && (
          <>
            <label htmlFor="expense-flow-correction-invoice">补正首张票据编号</label>
            <input
              id="expense-flow-correction-invoice"
              value={correctionInvoiceNo}
              onChange={(event) => setCorrectionInvoiceNo(event.target.value)}
            />
            <label htmlFor="expense-flow-correction-amount">补正首张票据金额（分）</label>
            <input
              id="expense-flow-correction-amount"
              type="number"
              min="1"
              step="1"
              value={correctedAmountCents}
              onChange={(event) => setCorrectedAmountCents(Number(event.target.value))}
            />
            <button type="button" onClick={correct} disabled={!claim?.receipts.length}>
              补正并重新校验
            </button>
          </>
        )}
        <p role="status">{message}</p>
      </div>
      {progress && (
        <div className={styles.progress} aria-label="报销进度">
          <p>
            {progress.expenseFormId} · {progress.status} · 版本 {progress.businessVersion} ·{' '}
            {progress.declaredTotalCents} 分
          </p>
          <p>
            关联出差单：{progress.travelFormId}；当前主管：{progress.reviewerId ?? '无待办'}
          </p>
          <ol>
            {progress.history.map((item, index) => (
              <li key={`${item.action}-${index}`}>
                {item.action} · {item.actorId} · {item.toStatus}
                {item.note ? ` · ${item.note}` : ''}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
