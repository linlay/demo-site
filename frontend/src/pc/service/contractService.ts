import { workflowErrors } from './workflowAccess';
import type { AwcpFieldError, JsonObject } from '@app/awcp';

import { businessError, fieldError } from '../../common/awcp/contracts';
import type { ContractOperationRecord, DemoState, OfficeContract, SealRequest } from '../../common/fixtures/types';
import type { DemoRepository } from '../../common/store/repository';

export interface ContractReadInput extends JsonObject {
  actorId: string;
}
export interface ContractRegisterInput extends ContractReadInput {
  companyId: string;
  counterpartyName: string;
  startDate: string;
  endDate: string;
  amountCents: number;
  materialIds: string[];
  idempotencyKey: string;
}
export interface SealSubmitInput extends ContractReadInput {
  contractId: string;
  contractVersion: number;
  purpose: string;
  materialIds: string[];
  idempotencyKey: string;
}
export interface SealReviewInput extends ContractReadInput {
  sealId: string;
  decision: 'approved' | 'rejected';
  note: string;
  expectedVersion: number;
  idempotencyKey: string;
}
export interface SealExecuteInput extends ContractReadInput {
  sealId: string;
  expectedVersion: number;
  idempotencyKey: string;
}
export interface RenewalCreateInput extends ContractReadInput {
  sourceContractId: string;
  sourceVersion: number;
  startDate: string;
  endDate: string;
  amountCents: number;
  materialIds: string[];
  idempotencyKey: string;
}
export interface ContractResult extends JsonObject {
  id: string;
  status: string;
  businessVersion: number;
}
type Operation = ContractOperationRecord['operation'];

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
  const ordered = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(ordered);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, ordered(v)])
      );
    return value;
  };
  return JSON.stringify(ordered(payload));
}
function replay(
  state: DemoState,
  operation: Operation,
  input: JsonObject & { idempotencyKey: string }
): {
  errors: AwcpFieldError[];
  record: ContractOperationRecord | null;
} {
  if (typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.idempotencyKey))
    return { errors: [fieldError(['idempotencyKey'], '业务幂等键格式无效。')], record: null };
  const record = state.contractOperationRecords.find((item) => item.idempotencyKey === input.idempotencyKey);
  if (!record) return { errors: [], record: null };
  return record.operation === operation && record.fingerprint === fingerprint(input)
    ? { errors: [], record }
    : { errors: [fieldError(['idempotencyKey'], '业务幂等键已用于其他操作或参数。')], record: null };
}
function remember(
  state: DemoState,
  operation: Operation,
  input: JsonObject & { idempotencyKey: string },
  result: ContractResult
): void {
  state.contractOperationRecords.push({
    idempotencyKey: input.idempotencyKey,
    operation,
    fingerprint: fingerprint(input),
    result: { id: result.id, status: result.status, businessVersion: result.businessVersion }
  });
}
function valid(errors: AwcpFieldError[]): void {
  if (errors.length)
    throw businessError(
      'action.invalid-contract-request',
      errors.flatMap((item) => item.messages).join('；'),
      errors.map((item) => ({ path: item.path, messages: item.messages }))
    );
}
function date(value: string): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null;
}
function today(now: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(now));
}
function actor(state: DemoState, actorId: string): AwcpFieldError[] {
  return state.employees.some((item) => item.id === actorId && item.active)
    ? []
    : [fieldError(['actorId'], '操作人不存在或已离职。')];
}
function rangeErrors(startDate: string, endDate: string, currentDay: string, renewal: boolean): AwcpFieldError[] {
  const errors: AwcpFieldError[] = [];
  const start = date(startDate);
  const end = date(endDate);
  if (start === null) errors.push(fieldError(['startDate'], '开始日期无效。'));
  if (end === null || (start !== null && end <= start))
    errors.push(fieldError(['endDate'], '结束日期须晚于开始日期。'));
  if (end !== null && end < (date(currentDay) ?? 0)) errors.push(fieldError(['endDate'], '合同结束日期已过。'));
  if (renewal && start !== null && start < (date(currentDay) ?? 0))
    errors.push(fieldError(['startDate'], '续签开始日期不能早于今天。'));
  return errors;
}
function amountErrors(amountCents: number): AwcpFieldError[] {
  return Number.isSafeInteger(amountCents) && amountCents > 0 && amountCents <= 1_000_000_000_000
    ? []
    : [fieldError(['amountCents'], '金额须为 1 到一万亿分的整数。')];
}
function materialErrors(
  state: DemoState,
  ids: string[],
  currentDay: string,
  contractId: string | null
): AwcpFieldError[] {
  const errors: AwcpFieldError[] = [];
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10 || new Set(ids).size !== ids.length)
    return [fieldError(['materialIds'], '须提供 1 到 10 份不重复的合同附件。')];
  ids.forEach((id, index) => {
    const material = state.contractMaterials.find((item) => item.id === id);
    if (!material || material.contractId !== contractId)
      errors.push(fieldError(['materialIds', index], '附件不存在或未关联目标合同。'));
    else if (material.expiresOn < currentDay) errors.push(fieldError(['materialIds', index], '附件已过期。'));
  });
  return errors;
}
function registerErrors(state: DemoState, input: ContractRegisterInput, currentDay: string): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const key = replay(state, 'register', input);
  if (key.record || key.errors.length) return key.errors;
  const errors = actor(state, input.actorId);
  if (input.companyId !== state.company.id) errors.push(fieldError(['companyId'], '签约主体须为演示公司。'));
  if (
    typeof input.counterpartyName !== 'string' ||
    !input.counterpartyName.trim() ||
    input.counterpartyName.trim().length > 100
  )
    errors.push(fieldError(['counterpartyName'], '对方主体须为 1 到 100 字。'));
  return [
    ...errors,
    ...rangeErrors(input.startDate, input.endDate, currentDay, false),
    ...amountErrors(input.amountCents),
    ...materialErrors(state, input.materialIds, currentDay, null)
  ];
}
function sealMaterialErrors(
  state: DemoState,
  contract: OfficeContract,
  ids: string[],
  currentDay: string
): AwcpFieldError[] {
  const errors = materialErrors(state, ids, currentDay, contract.id);
  if (Array.isArray(ids))
    ids.forEach((id, index) => {
      if (!contract.materialIds.includes(id))
        errors.push(fieldError(['materialIds', index], '附件不属于合同登记清单。'));
    });
  return errors;
}
function submitErrors(state: DemoState, input: SealSubmitInput, currentDay: string): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const key = replay(state, 'seal.submit', input);
  if (key.record || key.errors.length) return key.errors;
  const errors = actor(state, input.actorId);
  const contract = state.officeContracts.find((item) => item.id === input.contractId);
  if (!contract) return [...errors, fieldError(['contractId'], '合同不存在。')];
  if (contract.ownerId !== input.actorId) errors.push(fieldError(['actorId'], '仅合同登记人可申请用印。'));
  if (contract.businessVersion !== input.contractVersion)
    errors.push(fieldError(['contractVersion'], `合同版本应为 ${contract.businessVersion}。`));
  if (contract.endDate < currentDay) errors.push(fieldError(['contractId'], '合同已到期。'));
  if (typeof input.purpose !== 'string' || !input.purpose.trim() || input.purpose.trim().length > 200)
    errors.push(fieldError(['purpose'], '用印事项须为 1 到 200 字。'));
  return [...errors, ...sealMaterialErrors(state, contract, input.materialIds, currentDay)];
}
function reviewErrors(state: DemoState, input: SealReviewInput, currentDay: string): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'approve');
    if (workflowDenied.length) return workflowDenied;
  const key = replay(state, 'seal.review', input);
  if (key.record || key.errors.length) return key.errors;
  const errors = actor(state, input.actorId);
  const reviewer = state.employees.find((item) => item.id === input.actorId);
  if (!reviewer?.roles.includes('reviewer')) errors.push(fieldError(['actorId'], '只有复核员可审批用印。'));
  const seal = state.sealRequests.find((item) => item.id === input.sealId);
  if (!seal) return [...errors, fieldError(['sealId'], '用印申请不存在。')];
  if (seal.applicantId === input.actorId) errors.push(fieldError(['actorId'], '申请人不能自审。'));
  if (seal.status !== 'pending') errors.push(fieldError(['sealId'], '申请不处于待审批状态。'));
  if (seal.businessVersion !== input.expectedVersion)
    errors.push(fieldError(['expectedVersion'], `用印申请版本应为 ${seal.businessVersion}。`));
  if (input.decision !== 'approved' && input.decision !== 'rejected')
    errors.push(fieldError(['decision'], '审批决定无效。'));
  if (typeof input.note !== 'string' || !input.note.trim() || input.note.trim().length > 200)
    errors.push(fieldError(['note'], '审批意见须为 1 到 200 字。'));
  if (input.decision === 'approved') {
    const contract = state.officeContracts.find((item) => item.id === seal.contractId);
    if (!contract || contract.businessVersion !== seal.contractVersion || contract.endDate < currentDay)
      errors.push(fieldError(['sealId'], '关联合同版本无效或已到期。'));
    else errors.push(...sealMaterialErrors(state, contract, seal.materialIds, currentDay));
  }
  return errors;
}
function executeErrors(state: DemoState, input: SealExecuteInput, currentDay: string): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const key = replay(state, 'seal.execute', input);
  if (key.record || key.errors.length) return key.errors;
  const errors = actor(state, input.actorId);
  const seal = state.sealRequests.find((item) => item.id === input.sealId);
  if (!seal) return [...errors, fieldError(['sealId'], '用印申请不存在。')];
  if (seal.applicantId !== input.actorId) errors.push(fieldError(['actorId'], '只有申请人可执行用印。'));
  if (seal.status !== 'approved' || !seal.reviewerId) errors.push(fieldError(['sealId'], '用印申请尚未获批准。'));
  if (seal.businessVersion !== input.expectedVersion)
    errors.push(fieldError(['expectedVersion'], `用印申请版本应为 ${seal.businessVersion}。`));
  const contract = state.officeContracts.find((item) => item.id === seal.contractId);
  if (!contract || contract.businessVersion !== seal.contractVersion || contract.endDate < currentDay)
    errors.push(fieldError(['sealId'], '关联合同版本无效或已到期。'));
  else errors.push(...sealMaterialErrors(state, contract, seal.materialIds, currentDay));
  return errors;
}
function renewalErrors(state: DemoState, input: RenewalCreateInput, currentDay: string): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const key = replay(state, 'renewal.create', input);
  if (key.record || key.errors.length) return key.errors;
  const errors = actor(state, input.actorId);
  const source = state.officeContracts.find((item) => item.id === input.sourceContractId);
  if (!source) return [...errors, fieldError(['sourceContractId'], '原合同不存在。')];
  if (source.ownerId !== input.actorId) errors.push(fieldError(['actorId'], '仅原合同登记人可续签。'));
  if (source.businessVersion !== input.sourceVersion)
    errors.push(fieldError(['sourceVersion'], `原合同版本应为 ${source.businessVersion}。`));
  const remaining = ((date(source.endDate) ?? 0) - (date(currentDay) ?? 0)) / 86_400_000;
  if (remaining < 0 || remaining > 30)
    errors.push(fieldError(['sourceContractId'], '仅可续签未来 30 天内到期的合同。'));
  if (state.officeContracts.some((item) => item.renewedFromContractId === source.id))
    errors.push(fieldError(['sourceContractId'], '该合同已有续签记录。'));
  if (date(input.startDate) !== null && (date(input.startDate) ?? 0) <= (date(source.endDate) ?? 0))
    errors.push(fieldError(['startDate'], '续签开始日期须晚于原合同结束日期。'));
  return [
    ...errors,
    ...rangeErrors(input.startDate, input.endDate, currentDay, true),
    ...amountErrors(input.amountCents),
    ...materialErrors(state, input.materialIds, currentDay, null)
  ];
}
function audit(
  state: DemoState,
  entityType: 'office-contract' | 'seal-request',
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
export class ContractService {
  constructor(private readonly repository: DemoRepository) {}
  subscribe(listener: () => void): () => void {
    return this.repository.subscribe(listener);
  }
  snapshot(): DemoState {
    return this.repository.snapshot();
  }
  validateRead(input: ContractReadInput): AwcpFieldError[] {
    return actor(this.repository.snapshot(), input.actorId);
  }
  read(input: ContractReadInput): JsonObject {
    const state = this.repository.snapshot();
    valid(actor(state, input.actorId));
    const currentDay = today(this.repository.clock.now());
    const contracts = state.officeContracts.map((item) => ({
      ...item,
      daysUntilExpiry: ((date(item.endDate) ?? 0) - (date(currentDay) ?? 0)) / 86_400_000,
      materials: state.contractMaterials.filter((material) => item.materialIds.includes(material.id))
    }));
    return JSON.parse(
      JSON.stringify({
        today: currentDay,
        contracts,
        expiring: contracts.filter((item) => item.daysUntilExpiry >= 0 && item.daysUntilExpiry <= 30),
        availableMaterials: state.contractMaterials.filter((item) => item.contractId === null),
        seals: state.sealRequests
      })
    ) as JsonObject;
  }
  validateRegister(input: ContractRegisterInput): AwcpFieldError[] {
    return registerErrors(this.repository.snapshot(), input, today(this.repository.clock.now()));
  }
  register(input: ContractRegisterInput): ContractResult {
    return this.repository.transact((state) => {
      const key = replay(state, 'register', input);
      valid(key.errors);
      if (key.record) return { ...key.record.result };
      const at = this.repository.clock.now();
      valid(registerErrors(state, input, today(at)));
      const contract: OfficeContract = {
        id: nextId(
          'CNTR',
          state.officeContracts.map((item) => item.id)
        ),
        ownerId: input.actorId,
        companyId: input.companyId,
        counterpartyName: input.counterpartyName.trim(),
        startDate: input.startDate,
        endDate: input.endDate,
        amountCents: input.amountCents,
        materialIds: [...input.materialIds],
        businessVersion: 1,
        renewedFromContractId: null,
        sourceVersion: null,
        createdAt: at
      };
      state.officeContracts.push(contract);
      state.contractMaterials.forEach((item) => {
        if (input.materialIds.includes(item.id)) item.contractId = contract.id;
      });
      audit(state, 'office-contract', contract.id, 'register', input.actorId, 'registered', 1, at);
      const result = { id: contract.id, status: 'registered', businessVersion: 1 };
      remember(state, 'register', input, result);
      return result;
    });
  }
  validateSubmit(input: SealSubmitInput): AwcpFieldError[] {
    return submitErrors(this.repository.snapshot(), input, today(this.repository.clock.now()));
  }
  submit(input: SealSubmitInput): ContractResult {
    return this.repository.transact((state) => {
      const key = replay(state, 'seal.submit', input);
      valid(key.errors);
      if (key.record) return { ...key.record.result };
      const at = this.repository.clock.now();
      valid(submitErrors(state, input, today(at)));
      const seal: SealRequest = {
        id: nextId(
          'SEAL',
          state.sealRequests.map((item) => item.id)
        ),
        contractId: input.contractId,
        contractVersion: input.contractVersion,
        applicantId: input.actorId,
        purpose: input.purpose.trim(),
        materialIds: [...input.materialIds],
        status: 'pending',
        reviewerId: null,
        decisionNote: null,
        businessVersion: 1,
        submittedAt: at,
        decidedAt: null,
        executedAt: null
      };
      state.sealRequests.push(seal);
      audit(state, 'seal-request', seal.id, 'submit', input.actorId, 'pending', 1, at);
      const result = { id: seal.id, status: seal.status, businessVersion: 1 };
      remember(state, 'seal.submit', input, result);
      return result;
    });
  }
  validateReview(input: SealReviewInput): AwcpFieldError[] {
    return reviewErrors(this.repository.snapshot(), input, today(this.repository.clock.now()));
  }
  review(input: SealReviewInput): ContractResult {
    return this.repository.transact((state) => {
      const key = replay(state, 'seal.review', input);
      valid(key.errors);
      if (key.record) return { ...key.record.result };
      const at = this.repository.clock.now();
      valid(reviewErrors(state, input, today(at)));
      const seal = state.sealRequests.find((item) => item.id === input.sealId);
      if (!seal) throw businessError('action.seal-not-found', '用印申请不存在。');
      seal.status = input.decision;
      seal.reviewerId = input.actorId;
      seal.decisionNote = input.note.trim();
      seal.decidedAt = at;
      seal.businessVersion += 1;
      audit(state, 'seal-request', seal.id, 'review', input.actorId, seal.status, seal.businessVersion, at);
      const result = { id: seal.id, status: seal.status, businessVersion: seal.businessVersion };
      remember(state, 'seal.review', input, result);
      return result;
    });
  }
  validateExecute(input: SealExecuteInput): AwcpFieldError[] {
    return executeErrors(this.repository.snapshot(), input, today(this.repository.clock.now()));
  }
  execute(input: SealExecuteInput): ContractResult {
    return this.repository.transact((state) => {
      const key = replay(state, 'seal.execute', input);
      valid(key.errors);
      if (key.record) return { ...key.record.result };
      const at = this.repository.clock.now();
      valid(executeErrors(state, input, today(at)));
      const seal = state.sealRequests.find((item) => item.id === input.sealId);
      if (!seal) throw businessError('action.seal-not-found', '用印申请不存在。');
      seal.status = 'executed';
      seal.executedAt = at;
      seal.businessVersion += 1;
      audit(state, 'seal-request', seal.id, 'execute', input.actorId, seal.status, seal.businessVersion, at);
      const result = { id: seal.id, status: seal.status, businessVersion: seal.businessVersion };
      remember(state, 'seal.execute', input, result);
      return result;
    });
  }
  validateRenewal(input: RenewalCreateInput): AwcpFieldError[] {
    return renewalErrors(this.repository.snapshot(), input, today(this.repository.clock.now()));
  }
  renew(input: RenewalCreateInput): ContractResult {
    return this.repository.transact((state) => {
      const key = replay(state, 'renewal.create', input);
      valid(key.errors);
      if (key.record) return { ...key.record.result };
      const at = this.repository.clock.now();
      valid(renewalErrors(state, input, today(at)));
      const source = state.officeContracts.find((item) => item.id === input.sourceContractId);
      if (!source) throw businessError('action.contract-not-found', '原合同不存在。');
      const contract: OfficeContract = {
        id: nextId(
          'CNTR',
          state.officeContracts.map((item) => item.id)
        ),
        ownerId: input.actorId,
        companyId: source.companyId,
        counterpartyName: source.counterpartyName,
        startDate: input.startDate,
        endDate: input.endDate,
        amountCents: input.amountCents,
        materialIds: [...input.materialIds],
        businessVersion: 1,
        renewedFromContractId: source.id,
        sourceVersion: source.businessVersion,
        createdAt: at
      };
      state.officeContracts.push(contract);
      state.contractMaterials.forEach((item) => {
        if (input.materialIds.includes(item.id)) item.contractId = contract.id;
      });
      audit(state, 'office-contract', contract.id, 'renew', input.actorId, 'registered', 1, at);
      const result = { id: contract.id, status: 'registered', businessVersion: 1 };
      remember(state, 'renewal.create', input, result);
      return result;
    });
  }
}
