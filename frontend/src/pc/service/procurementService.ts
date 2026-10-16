import { workflowErrors } from './workflowAccess';
import type { AwcpFieldError, JsonObject } from '@app/awcp';

import { businessError, fieldError } from '../../common/awcp/contracts';
import type { DemoState, ProcurementOperationRecord } from '../../common/fixtures/types';
import type { DemoRepository } from '../../common/store/repository';

export interface PurchaseCreateInput extends JsonObject {
  actorId: string;
  itemName: string;
  quantity: number;
  idempotencyKey: string;
}
export interface PurchaseCompareInput extends JsonObject {
  actorId: string;
  requestId: string;
  quotes: Array<{ supplierId: string; unitPriceCents: number }>;
  expectedVersion: number;
  idempotencyKey: string;
}
export interface SupplierReviewInput extends JsonObject {
  actorId: string;
  supplierId: string;
  decision: 'approved' | 'rejected';
  proofIds: string[];
  note: string;
  expectedVersion: number;
  idempotencyKey: string;
}
export interface ReceiptAcceptInput extends JsonObject {
  actorId: string;
  requestId: string;
  quantity: number;
  idempotencyKey: string;
}
export interface ProcurementReadInput extends JsonObject {
  actorId: string;
}
export interface ProcurementResult extends JsonObject {
  id: string;
  status: string;
  businessVersion: number;
}

type Operation = ProcurementOperationRecord['operation'];

function nextId(prefix: string, ids: string[]): string {
  const next =
    Math.max(
      0,
      ...ids.map((id) => {
        const match = new RegExp(`^${prefix}-([0-9]+)$`).exec(id);
        return match ? Number(match[1]) : 0;
      })
    ) + 1;
  return `${prefix}-${String(next).padStart(3, '0')}`;
}
function fingerprint(input: JsonObject): string {
  const { idempotencyKey: _key, ...payload } = input;
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, sorted(v)])
      );
    return value;
  };
  return JSON.stringify(sorted(payload));
}
function replay(
  state: DemoState,
  operation: Operation,
  input: JsonObject & { idempotencyKey: string }
): {
  errors: AwcpFieldError[];
  record: ProcurementOperationRecord | null;
} {
  if (typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.idempotencyKey))
    return { errors: [fieldError(['idempotencyKey'], '业务幂等键格式无效。')], record: null };
  const record = state.procurementOperationRecords.find((item) => item.idempotencyKey === input.idempotencyKey);
  if (!record) return { errors: [], record: null };
  return record.operation === operation && record.fingerprint === fingerprint(input)
    ? { errors: [], record }
    : { errors: [fieldError(['idempotencyKey'], '业务幂等键已用于不同操作或参数。')], record: null };
}
function remember(
  state: DemoState,
  operation: Operation,
  input: JsonObject & { idempotencyKey: string },
  result: ProcurementResult
): void {
  state.procurementOperationRecords.push({
    idempotencyKey: input.idempotencyKey,
    operation,
    fingerprint: fingerprint(input),
    result: { id: result.id, status: result.status, businessVersion: result.businessVersion }
  });
}
function valid(errors: AwcpFieldError[]): void {
  if (errors.length)
    throw businessError(
      'action.invalid-procurement-request',
      errors.flatMap((item) => item.messages).join('；'),
      errors.map((item) => ({ path: item.path, messages: item.messages }))
    );
}
function actor(state: DemoState, actorId: string): AwcpFieldError[] {
  return state.employees.some((item) => item.id === actorId && item.active)
    ? []
    : [fieldError(['actorId'], '操作人不存在或已离职。')];
}
function audit(
  state: DemoState,
  entityType: 'purchase-request' | 'supplier' | 'purchase-receipt',
  entityId: string,
  action: string,
  actorId: string,
  status: string,
  version: number,
  at: string
): void {
  state.auditEntries.push({
    id: nextId(
      'AUD',
      state.auditEntries.map((item) => item.id)
    ),
    entityType,
    entityId,
    action,
    actorId,
    at,
    fromStatus: null,
    toStatus: status,
    businessVersion: version
  });
}
function createErrors(state: DemoState, input: PurchaseCreateInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const key = replay(state, 'create', input);
  if (key.record || key.errors.length) return key.errors;
  const errors = actor(state, input.actorId);
  if (typeof input.itemName !== 'string' || !input.itemName.trim() || input.itemName.trim().length > 80)
    errors.push(fieldError(['itemName'], '物品名称须为 1 到 80 字。'));
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 1000)
    errors.push(fieldError(['quantity'], '请购数量须为 1 到 1000 的整数。'));
  return errors;
}
function compareErrors(state: DemoState, input: PurchaseCompareInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const key = replay(state, 'compare', input);
  if (key.record || key.errors.length) return key.errors;
  const errors = actor(state, input.actorId);
  const request = state.purchaseRequests.find((item) => item.id === input.requestId);
  if (!request) return [...errors, fieldError(['requestId'], '请购单不存在。')];
  if (request.requesterId !== input.actorId) errors.push(fieldError(['actorId'], '仅申请人可完成比价。'));
  if (request.status !== 'draft') errors.push(fieldError(['requestId'], '请购单已完成比价。'));
  if (request.businessVersion !== input.expectedVersion)
    errors.push(fieldError(['expectedVersion'], `请购单版本应为 ${request.businessVersion}。`));
  if (
    !Array.isArray(input.quotes) ||
    input.quotes.length < 2 ||
    input.quotes.length > 5 ||
    new Set(input.quotes.map((item) => item.supplierId)).size !== input.quotes.length
  )
    return [...errors, fieldError(['quotes'], '须提供 2 到 5 家不同供应商的报价。')];
  input.quotes.forEach((quote, index) => {
    if (!state.procurementSuppliers.some((item) => item.id === quote.supplierId && item.status === 'approved'))
      errors.push(fieldError(['quotes', index, 'supplierId'], '报价供应商须已准入。'));
    if (
      !Number.isSafeInteger(quote.unitPriceCents) ||
      quote.unitPriceCents < 1 ||
      quote.unitPriceCents > 100_000_000 ||
      !Number.isSafeInteger(quote.unitPriceCents * request.quantity)
    )
      errors.push(fieldError(['quotes', index, 'unitPriceCents'], '单价须为有效正整数分，且总额可安全计算。'));
  });
  return errors;
}
function shanghaiDate(now: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(now));
}
function reviewErrors(state: DemoState, input: SupplierReviewInput, today: string): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'approve');
    if (workflowDenied.length) return workflowDenied;
  const key = replay(state, 'supplier.review', input);
  if (key.record || key.errors.length) return key.errors;
  const errors = actor(state, input.actorId);
  if (!state.employees.find((item) => item.id === input.actorId)?.roles.includes('reviewer'))
    errors.push(fieldError(['actorId'], '只有复核员可审核供应商。'));
  const supplier = state.procurementSuppliers.find((item) => item.id === input.supplierId);
  if (!supplier) return [...errors, fieldError(['supplierId'], '供应商不存在。')];
  if (supplier.status !== 'pending') errors.push(fieldError(['supplierId'], '供应商已审核。'));
  if (supplier.businessVersion !== input.expectedVersion)
    errors.push(fieldError(['expectedVersion'], `供应商版本应为 ${supplier.businessVersion}。`));
  if (input.decision !== 'approved' && input.decision !== 'rejected')
    errors.push(fieldError(['decision'], '审核决定无效。'));
  if (typeof input.note !== 'string' || !input.note.trim() || input.note.trim().length > 200)
    errors.push(fieldError(['note'], '审核意见须为 1 到 200 字。'));
  if (
    !Array.isArray(input.proofIds) ||
    new Set(input.proofIds).size !== input.proofIds.length ||
    input.proofIds.length > 10
  )
    return [...errors, fieldError(['proofIds'], '证明 ID 须不重复且最多十份。')];
  const proofs = input.proofIds
    .map((id, index) => {
      const proof = state.supplierProofs.find((item) => item.id === id && item.supplierId === input.supplierId);
      if (!proof) errors.push(fieldError(['proofIds', index], '证明不存在或不属于该供应商。'));
      return proof;
    })
    .filter((item): item is NonNullable<typeof item> => item !== undefined);
  if (input.decision === 'approved') {
    for (const kind of ['registration', 'tax'] as const) {
      const proof = proofs.find((item) => item.kind === kind);
      if (!proof) errors.push(fieldError(['proofIds'], `通过审核须有${kind}证明。`));
      else if (proof.expiresOn < today) errors.push(fieldError(['proofIds'], `${kind}证明已过期。`));
    }
  }
  return errors;
}
function receiptErrors(state: DemoState, input: ReceiptAcceptInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const key = replay(state, 'receipt.accept', input);
  if (key.record || key.errors.length) return key.errors;
  const errors = actor(state, input.actorId);
  const request = state.purchaseRequests.find((item) => item.id === input.requestId);
  if (!request) return [...errors, fieldError(['requestId'], '请购单不存在。')];
  if (request.requesterId !== input.actorId) errors.push(fieldError(['actorId'], '仅申请人可验收该采购单。'));
  if (request.status !== 'selected' || request.unitPriceCents === null)
    errors.push(fieldError(['requestId'], '请购单尚未完成比价。'));
  const received = state.purchaseReceipts
    .filter((item) => item.requestId === request.id)
    .reduce((sum, item) => sum + item.quantity, 0);
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > request.quantity - received)
    errors.push(fieldError(['quantity'], `验收数量须为 1 到剩余 ${Math.max(0, request.quantity - received)} 件。`));
  return errors;
}
export class ProcurementService {
  constructor(private readonly repository: DemoRepository) {}
  subscribe(listener: () => void): () => void {
    return this.repository.subscribe(listener);
  }
  snapshot(): DemoState {
    return this.repository.snapshot();
  }
  validateRead(input: ProcurementReadInput): AwcpFieldError[] {
    return actor(this.repository.snapshot(), input.actorId);
  }
  read(input: ProcurementReadInput): JsonObject {
    const state = this.repository.snapshot();
    valid(actor(state, input.actorId));
    const view = {
      suppliers: state.procurementSuppliers.map((item) => ({
        ...item,
        proofs: state.supplierProofs.filter((proof) => proof.supplierId === item.id)
      })),
      requests: state.purchaseRequests.map((item) => ({
        ...item,
        receivedQuantity: state.purchaseReceipts
          .filter((receipt) => receipt.requestId === item.id)
          .reduce((sum, receipt) => sum + receipt.quantity, 0),
        comparison: state.purchaseComparisons.find((comparison) => comparison.requestId === item.id) ?? null
      })),
      receipts: state.purchaseReceipts,
      inventory: state.inventoryEntries,
      reviews: state.supplierReviews
    };
    return JSON.parse(JSON.stringify(view)) as JsonObject;
  }
  validateCreate(input: PurchaseCreateInput): AwcpFieldError[] {
    return createErrors(this.repository.snapshot(), input);
  }
  create(input: PurchaseCreateInput): ProcurementResult {
    return this.repository.transact((state) => {
      const key = replay(state, 'create', input);
      valid(key.errors);
      if (key.record) return { ...key.record.result };
      valid(createErrors(state, input));
      const request = {
        id: nextId(
          'PREQ',
          state.purchaseRequests.map((item) => item.id)
        ),
        requesterId: input.actorId,
        itemName: input.itemName.trim(),
        quantity: input.quantity,
        status: 'draft' as const,
        selectedSupplierId: null,
        unitPriceCents: null,
        totalCents: null,
        businessVersion: 1,
        createdAt: this.repository.clock.now()
      };
      state.purchaseRequests.push(request);
      audit(state, 'purchase-request', request.id, 'create', input.actorId, request.status, 1, request.createdAt);
      const result = { id: request.id, status: request.status, businessVersion: 1 };
      remember(state, 'create', input, result);
      return result;
    });
  }
  validateCompare(input: PurchaseCompareInput): AwcpFieldError[] {
    return compareErrors(this.repository.snapshot(), input);
  }
  compare(input: PurchaseCompareInput): ProcurementResult {
    return this.repository.transact((state) => {
      const key = replay(state, 'compare', input);
      valid(key.errors);
      if (key.record) return { ...key.record.result };
      valid(compareErrors(state, input));
      const request = state.purchaseRequests.find((item) => item.id === input.requestId);
      if (!request) throw businessError('action.request-not-found', '请购单不存在。');
      const quotes = input.quotes.map((item) => ({ ...item, totalCents: item.unitPriceCents * request.quantity }));
      const selected = [...quotes].sort(
        (a, b) => a.totalCents - b.totalCents || a.supplierId.localeCompare(b.supplierId)
      )[0];
      const comparison = {
        id: nextId(
          'PCMP',
          state.purchaseComparisons.map((item) => item.id)
        ),
        requestId: request.id,
        quotes,
        selectedSupplierId: selected.supplierId,
        selectedTotalCents: selected.totalCents,
        comparedAt: this.repository.clock.now()
      };
      state.purchaseComparisons.push(comparison);
      request.status = 'selected';
      request.selectedSupplierId = selected.supplierId;
      request.unitPriceCents = selected.unitPriceCents;
      request.totalCents = selected.totalCents;
      request.businessVersion += 1;
      audit(
        state,
        'purchase-request',
        request.id,
        'compare',
        input.actorId,
        request.status,
        request.businessVersion,
        comparison.comparedAt
      );
      const result = { id: comparison.id, status: 'selected', businessVersion: request.businessVersion };
      remember(state, 'compare', input, result);
      return result;
    });
  }
  validateReview(input: SupplierReviewInput): AwcpFieldError[] {
    return reviewErrors(this.repository.snapshot(), input, shanghaiDate(this.repository.clock.now()));
  }
  review(input: SupplierReviewInput): ProcurementResult {
    return this.repository.transact((state) => {
      const key = replay(state, 'supplier.review', input);
      valid(key.errors);
      if (key.record) return { ...key.record.result };
      valid(reviewErrors(state, input, shanghaiDate(this.repository.clock.now())));
      const supplier = state.procurementSuppliers.find((item) => item.id === input.supplierId);
      if (!supplier) throw businessError('action.supplier-not-found', '供应商不存在。');
      supplier.status = input.decision;
      supplier.businessVersion += 1;
      const review = {
        id: nextId(
          'SREV',
          state.supplierReviews.map((item) => item.id)
        ),
        supplierId: supplier.id,
        reviewerId: input.actorId,
        decision: input.decision,
        proofIds: [...input.proofIds],
        note: input.note.trim(),
        businessVersion: supplier.businessVersion,
        reviewedAt: this.repository.clock.now()
      };
      state.supplierReviews.push(review);
      audit(
        state,
        'supplier',
        supplier.id,
        'review',
        input.actorId,
        supplier.status,
        supplier.businessVersion,
        review.reviewedAt
      );
      const result = { id: review.id, status: review.decision, businessVersion: review.businessVersion };
      remember(state, 'supplier.review', input, result);
      return result;
    });
  }
  validateReceipt(input: ReceiptAcceptInput): AwcpFieldError[] {
    return receiptErrors(this.repository.snapshot(), input);
  }
  accept(input: ReceiptAcceptInput): ProcurementResult {
    return this.repository.transact((state) => {
      const key = replay(state, 'receipt.accept', input);
      valid(key.errors);
      if (key.record) return { ...key.record.result };
      valid(receiptErrors(state, input));
      const request = state.purchaseRequests.find((item) => item.id === input.requestId);
      if (!request || request.unitPriceCents === null)
        throw businessError('action.request-not-found', '采购单不存在。');
      const receipt = {
        id: nextId(
          'PREC',
          state.purchaseReceipts.map((item) => item.id)
        ),
        requestId: request.id,
        actorId: input.actorId,
        quantity: input.quantity,
        acceptedAt: this.repository.clock.now()
      };
      state.purchaseReceipts.push(receipt);
      state.inventoryEntries.push({
        id: nextId(
          'INV',
          state.inventoryEntries.map((item) => item.id)
        ),
        receiptId: receipt.id,
        requestId: request.id,
        itemName: request.itemName,
        quantity: receipt.quantity,
        unitPriceCents: request.unitPriceCents,
        totalCents: receipt.quantity * request.unitPriceCents
      });
      audit(state, 'purchase-receipt', receipt.id, 'accept', input.actorId, 'accepted', 1, receipt.acceptedAt);
      const result = { id: receipt.id, status: 'accepted', businessVersion: 1 };
      remember(state, 'receipt.accept', input, result);
      return result;
    });
  }
}
