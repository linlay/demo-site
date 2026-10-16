import { useCurrentActor } from '../../app/currentUserContext';
import { useWorkflowAction as useAwcpAction } from '../../app/useWorkflowAction';
import type { AwcpActionRegistration } from '@app/awcp';
import { useEffect, useState, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import {
  PROCUREMENT_READ_SCHEMA,
  PURCHASE_COMPARE_SCHEMA,
  RECEIPT_ACCEPT_SCHEMA,
  SUPPLIER_REVIEW_SCHEMA
} from '../../common/awcp/procurementSchemas';
import type { DemoRepository } from '../../common/store/repository';
import {
  ProcurementService,
  type ProcurementReadInput,
  type PurchaseCompareInput,
  type ReceiptAcceptInput,
  type SupplierReviewInput
} from '../service/procurementService';
import styles from './O11ProcurementPage.module.css';

const READ: ProcurementReadInput = { actorId: 'EMP-001' };
const COMPARE: PurchaseCompareInput = {
  actorId: 'EMP-001',
  requestId: 'PREQ-001',
  quotes: [
    { supplierId: 'SUP-001', unitPriceCents: 800 },
    { supplierId: 'SUP-002', unitPriceCents: 900 }
  ],
  expectedVersion: 1,
  idempotencyKey: 'o11-compare-example'
};
const REVIEW: SupplierReviewInput = {
  actorId: 'EMP-004',
  supplierId: 'SUP-003',
  decision: 'approved',
  proofIds: ['SPRF-005', 'SPRF-006'],
  note: '虚构证明齐全且在有效期内。',
  expectedVersion: 1,
  idempotencyKey: 'o11-review-example'
};
const RECEIPT: ReceiptAcceptInput = {
  actorId: 'EMP-001',
  requestId: 'PREQ-002',
  quantity: 2,
  idempotencyKey: 'o11-receipt-example'
};
function guide(purpose: string, prerequisites: string, effects: string): string {
  return describeAction({
    purpose,
    prerequisites,
    parameters: '使用虚构员工、请购单、供应商及证明 ID；写操作提供稳定幂等键。',
    effects,
    result: '返回业务记录 ID、状态和版本；查询返回采购、供应商及库存快照。',
    failures: '权限、数量、报价、证明有效期、版本或剩余可收数量不符时返回字段错误，记录不写入。'
  });
}
function key(): string {
  return `o11-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function O11ProcurementPage({
  repository,
  objectId
}: {
  repository: DemoRepository;
  objectId?: string;
}): ReactElement {
  const [service] = useState(() => new ProcurementService(repository));
  const [, setRevision] = useState(0);
  useEffect(() => service.subscribe(() => setRevision((value) => value + 1)), [service]);
  const actorId = useCurrentActor('EMP-001');
  const [requestId, setRequestId] = useState(objectId ?? 'PREQ-001');
  const [firstSupplierId, setFirstSupplierId] = useState('');
  const [secondSupplierId, setSecondSupplierId] = useState('');
  const [firstPrice, setFirstPrice] = useState('');
  const [secondPrice, setSecondPrice] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [decision, setDecision] = useState<SupplierReviewInput['decision'] | ''>('');
  const [proofIds, setProofIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [receiptQuantity, setReceiptQuantity] = useState('');
  const [message, setMessage] = useState('');
  const state = service.snapshot();
  const request = state.purchaseRequests.find((item) => item.id === requestId);
  const supplier = state.procurementSuppliers.find((item) => item.id === supplierId);
  const proofs = state.supplierProofs.filter((item) => item.supplierId === supplierId);
  const receivedQuantity = state.purchaseReceipts
    .filter((item) => item.requestId === requestId)
    .reduce((sum, item) => sum + item.quantity, 0);
  function run(action: () => string): void {
    try {
      setMessage(action());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败。');
    }
  }
  const readAction: AwcpActionRegistration<ProcurementReadInput> = {
    action: 'office.procurement.read',
    title: '读取采购与供应商',
    description: guide('查看请购、比价、供应商证明和库存。', '在职员工。', '只读。'),
    inputSchema: PROCUREMENT_READ_SCHEMA,
    examples: [READ],
    validate: (args) => service.validateRead(args),
    invoke: (args) => completed(service.read(args))
  };
  useAwcpAction(readAction);
  const compareAction: AwcpActionRegistration<PurchaseCompareInput> = {
    action: 'office.procurement.compare',
    title: '采购比价',
    description: guide(
      '计算两家以上供应商的单价和总额，选择最低总价。',
      '请购人、待比价单据、已准入供应商及当前版本。',
      '归档报价与选定供应商。'
    ),
    inputSchema: PURCHASE_COMPARE_SCHEMA,
    examples: [COMPARE],
    validate: (args) => service.validateCompare(args),
    invoke: (args) => completed(service.compare(args))
  };
  useAwcpAction(compareAction);
  const reviewAction: AwcpActionRegistration<SupplierReviewInput> = {
    action: 'office.supplier.review',
    title: '审核供应商准入',
    description: guide(
      '审查供应商证明并批准或驳回。',
      '复核员、待审供应商及当前版本；通过须有有效登记和税务证明。',
      '保存审核意见与供应商状态。'
    ),
    inputSchema: SUPPLIER_REVIEW_SCHEMA,
    examples: [REVIEW],
    validate: (args) => service.validateReview(args),
    invoke: (args) => completed(service.review(args))
  };
  useAwcpAction(reviewAction);
  const receiptAction: AwcpActionRegistration<ReceiptAcceptInput> = {
    action: 'office.receipt.accept',
    title: '采购到货验收',
    description: guide(
      '按采购单验收部分或全部到货。',
      '请购人、已完成比价的单据与剩余数量。',
      '同步保存验收记录与库存入账。'
    ),
    inputSchema: RECEIPT_ACCEPT_SCHEMA,
    examples: [RECEIPT],
    validate: (args) => service.validateReceipt(args),
    invoke: (args) => completed(service.accept(args))
  };
  useAwcpAction(receiptAction);

  return (
    <main className={styles.page}>

      <section>
        <h2>报价与比价</h2>
        <label>
          请购单{' '}
          <select id="o11-request" value={requestId} onChange={(e) => setRequestId(e.target.value)}>
            <option value="">请选择请购单</option>
            {state.purchaseRequests.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} {item.itemName}（{item.status}）
              </option>
            ))}
          </select>
        </label>
        {[0, 1].map((index) => (
          <div key={index} className={styles.row}>
            <label>
              供应商{' '}
              <select
                aria-label={`报价供应商${index + 1}`}
                value={index ? secondSupplierId : firstSupplierId}
                onChange={(e) => (index ? setSecondSupplierId(e.target.value) : setFirstSupplierId(e.target.value))}
              >
                <option value="">请选择供应商</option>
                {state.procurementSuppliers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.id} {item.name}（{item.status}）
                  </option>
                ))}
              </select>
            </label>
            <label>
              单价（分）{' '}
              <input
                aria-label={`报价单价${index + 1}`}
                type="number"
                min="1"
                value={index ? secondPrice : firstPrice}
                onChange={(e) => (index ? setSecondPrice(e.target.value) : setFirstPrice(e.target.value))}
              />
            </label>
          </div>
        ))}
        <p>
          当前单据：{request?.status ?? '无'}；数量 {request?.quantity ?? 0}；已选总额 {request?.totalCents ?? '待比价'}{' '}
          分。
        </p>
        <button
          disabled={
            !request ||
            !firstSupplierId ||
            !secondSupplierId ||
            firstSupplierId === secondSupplierId ||
            Number(firstPrice) <= 0 ||
            Number(secondPrice) <= 0
          }
          onClick={() =>
            run(() => {
              const result = service.compare({
                actorId,
                requestId,
                quotes: [
                  { supplierId: firstSupplierId, unitPriceCents: Number(firstPrice) },
                  { supplierId: secondSupplierId, unitPriceCents: Number(secondPrice) }
                ],
                expectedVersion: request?.businessVersion ?? 0,
                idempotencyKey: key()
              });
              return `比价完成 ${result.id}`;
            })
          }
        >
          完成比价
        </button>
        {state.purchaseComparisons
          .filter((item) => item.requestId === requestId)
          .map((item) => (
            <p key={item.id}>
              {item.id} 选定 {item.selectedSupplierId}，总额 {item.selectedTotalCents} 分；
              {item.quotes
                .map(
                  (quote) => `${quote.supplierId} ${quote.unitPriceCents} × ${request?.quantity} = ${quote.totalCents}`
                )
                .join('；')}
            </p>
          ))}
      </section>
      <section>
        <h2>供应商准入</h2>
        <label>
          供应商{' '}
          <select
            id="o11-supplier"
            value={supplierId}
            onChange={(e) => {
              setSupplierId(e.target.value);
              setProofIds(
                state.supplierProofs.filter((item) => item.supplierId === e.target.value).map((item) => item.id)
              );
            }}
          >
            <option value="">请选择供应商</option>
            {state.procurementSuppliers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} {item.name}（{item.status}）
              </option>
            ))}
          </select>
        </label>
        <label>
          决定{' '}
          <select
            aria-label="审核决定"
            value={decision}
            onChange={(e) => setDecision(e.target.value as SupplierReviewInput['decision'])}
          >
            <option value="">请选择决定</option>
            <option value="approved">通过</option>
            <option value="rejected">驳回</option>
          </select>
        </label>
        <div>
          {proofs.map((item) => (
            <label key={item.id}>
              <input
                type="checkbox"
                checked={proofIds.includes(item.id)}
                onChange={(e) =>
                  setProofIds(e.target.checked ? [...proofIds, item.id] : proofIds.filter((id) => id !== item.id))
                }
              />
              {item.id} {item.kind}（有效期 {item.expiresOn}）
            </label>
          ))}
        </div>
        <label>
          意见 <input aria-label="审核意见" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button
          disabled={!supplier || !decision || !note.trim() || (decision === 'approved' && proofIds.length === 0)}
          onClick={() =>
            run(() => {
              const result = service.review({
                actorId,
                supplierId,
                decision: decision as SupplierReviewInput['decision'],
                proofIds,
                note,
                expectedVersion: supplier?.businessVersion ?? 0,
                idempotencyKey: key()
              });
              return `已审核 ${result.id}`;
            })
          }
        >
          审核供应商
        </button>
        {state.supplierReviews.map((item) => (
          <p key={item.id}>
            {item.id} {item.supplierId} {item.decision}，{item.note}
          </p>
        ))}
      </section>
      <section>
        <h2>采购到货验收</h2>
        <p>
          {requestId} 采购 {request?.quantity ?? 0} 件，已验收 {receivedQuantity} 件，剩余{' '}
          {Math.max(0, (request?.quantity ?? 0) - receivedQuantity)} 件。
        </p>
        <label>
          本次验收数量{' '}
          <input
            aria-label="验收数量"
            type="number"
            min="1"
            value={receiptQuantity}
            onChange={(e) => setReceiptQuantity(e.target.value)}
          />
        </label>
        <button
          disabled={!request || Number(receiptQuantity) <= 0}
          onClick={() =>
            run(() => {
              const result = service.accept({ actorId, requestId, quantity: Number(receiptQuantity), idempotencyKey: key() });
              return `已验收 ${result.id}`;
            })
          }
        >
          验收并入库
        </button>
        {state.inventoryEntries
          .filter((item) => item.requestId === requestId)
          .map((item) => (
            <p key={item.id}>
              {item.id} 对应 {item.receiptId}：{item.quantity} 件 × {item.unitPriceCents} 分 = {item.totalCents} 分
            </p>
          ))}
      </section>
      {message && <p role="status">{message}</p>}
    </main>
  );
}
