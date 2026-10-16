import { workflowErrors } from './workflowAccess';
import type { AwcpFieldError, JsonObject } from '@app/awcp';

import { businessError, fieldError } from '../../common/awcp/contracts';
import type { BusinessForm, DemoState, Employee, ExpenseClaim } from '../../common/fixtures/types';
import type { DemoRepository } from '../../common/store/repository';
import { validateExpense, type ExpenseCheckInput } from './expenseService';
import { WorkflowService, type FormMutationResult, type TransitionInput } from './workflowService';

export interface ExpenseMutationInput extends JsonObject {
  expenseFormId: string;
  actorId: string;
  expectedVersion: number;
  idempotencyKey: string;
}

export interface ExpenseReviewInput extends ExpenseMutationInput {
  decision: 'approve' | 'return';
  reason: string;
}

export interface ExpenseCorrectInput extends ExpenseCheckInput {
  expenseFormId: string;
  expectedVersion: number;
}

export interface ExpenseReadInput extends JsonObject {
  expenseFormId: string;
  actorId: string;
}

export interface ExpenseHistoryItem extends JsonObject {
  action: string;
  actorId: string;
  at: string;
  fromStatus: string | null;
  toStatus: string;
  businessVersion: number | null;
  note: string | null;
}

export interface ExpenseProgress extends JsonObject {
  expenseFormId: string;
  travelFormId: string;
  status: BusinessForm['status'];
  businessVersion: number;
  checkedVersion: number;
  declaredTotalCents: number;
  reviewerId: string | null;
  history: ExpenseHistoryItem[];
}

export interface ExpenseCorrectionResult extends JsonObject {
  expenseFormId: string;
  status: 'returned';
  businessVersion: number;
  declaredTotalCents: number;
}

export class ExpenseFlowService {
  private readonly workflow: WorkflowService;

  constructor(private readonly repository: DemoRepository) {
    this.workflow = new WorkflowService(repository);
  }

  subscribe(listener: () => void): () => void {
    return this.repository.subscribe(listener);
  }

  list(): Array<{
    formId: string;
    status: BusinessForm['status'];
    businessVersion: number;
    applicantId: string;
    travelFormId: string;
    checkedVersion: number;
    declaredTotalCents: number;
  }> {
    const state = this.repository.snapshot();
    return state.expenseClaims.flatMap((claim) => {
      const form = state.forms.find((item) => item.id === claim.formId);
      return form
        ? [
            {
              formId: form.id,
              status: form.status,
              businessVersion: form.businessVersion,
              applicantId: form.applicantId,
              travelFormId: claim.travelFormId,
              checkedVersion: claim.checkedVersion,
              declaredTotalCents: claim.declaredTotalCents
            }
          ]
        : [];
    });
  }

  claim(expenseFormId: string): ExpenseClaim | null {
    return this.repository.snapshot().expenseClaims.find((item) => item.formId === expenseFormId) ?? null;
  }

  participants(expenseFormId: string): Employee[] {
    const state = this.repository.snapshot();
    const form = state.forms.find((item) => item.id === expenseFormId && item.kind === 'expense');
    if (!form) return [];
    return state.employees.filter(
      (item) =>
        item.active &&
        (item.id === form.applicantId || (item.departmentId === form.departmentId && item.roles.includes('manager')))
    );
  }

  validateSubmit(input: ExpenseMutationInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(this.repository.snapshot(), input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
    const state = this.repository.snapshot();
    const record = state.idempotencyRecords.find((item) => item.key === input.idempotencyKey);
    if (record)
      return (record.operation === 'form.submit' || record.operation === 'form.resubmit') &&
        record.fingerprint === transitionFingerprint(input)
        ? []
        : [fieldError(['idempotencyKey'], '业务幂等键已用于其他操作或参数。')];
    const errors = validateMutation(state, input);
    const form = state.forms.find((item) => item.id === input.expenseFormId);
    if (form && form.kind === 'expense') {
      const actor = state.employees.find((item) => item.id === input.actorId && item.active);
      if (!actor || actor.id !== form.applicantId || !actor.roles.includes('employee')) {
        errors.push(fieldError(['actorId'], '只有原申请人可以提交费用单。'));
      }
      if (form.status !== 'draft' && form.status !== 'returned') {
        errors.push(fieldError(['expenseFormId'], '只有已校验草稿或退回补正单可提交。'));
      }
      const claim = state.expenseClaims.find((item) => item.formId === form.id);
      if (claim && claim.checkedVersion !== form.businessVersion) {
        errors.push(fieldError(['expenseFormId'], '费用明细尚未按当前业务版本重新校验。'));
      }
      if (
        !state.employees.some(
          (item) => item.active && item.departmentId === form.departmentId && item.roles.includes('manager')
        )
      ) {
        errors.push(fieldError(['expenseFormId'], '所属部门没有可用主管。'));
      }
    }
    return errors;
  }

  submit(input: ExpenseMutationInput): FormMutationResult {
    const errors = this.validateSubmit(input);
    if (errors.length)
      throw businessError('action.invalid-expense-submit', errors.flatMap((item) => item.messages).join('；'));
    const state = this.repository.snapshot();
    const record = state.idempotencyRecords.find((item) => item.key === input.idempotencyKey);
    const form = state.forms.find((item) => item.id === input.expenseFormId);
    const action =
      record?.operation === 'form.resubmit' || (!record && form?.status === 'returned') ? 'resubmit' : 'submit';
    return this.workflow.transition(
      {
        formId: input.expenseFormId,
        actorId: input.actorId,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        action
      },
      (draft, current) => {
        const claim = draft.expenseClaims.find((item) => item.formId === current.id);
        if (!claim || current.kind !== 'expense' || claim.checkedVersion !== current.businessVersion) {
          throw businessError('action.expense-not-checked', '费用明细尚未按当前业务版本校验。');
        }
      }
    );
  }

  validateReview(input: ExpenseReviewInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(this.repository.snapshot(), input.actorId, 'approve');
    if (workflowDenied.length) return workflowDenied;
    const state = this.repository.snapshot();
    const operation = `form.${input.decision}`;
    const record = state.idempotencyRecords.find((item) => item.key === input.idempotencyKey);
    const reason = input.decision === 'return' ? input.reason?.trim() : undefined;
    if (record)
      return record.operation === operation && record.fingerprint === transitionFingerprint(input, reason)
        ? []
        : [fieldError(['idempotencyKey'], '业务幂等键已用于其他操作或参数。')];
    const errors = validateMutation(state, input);
    const form = state.forms.find((item) => item.id === input.expenseFormId);
    if (input.decision !== 'approve' && input.decision !== 'return') {
      errors.push(fieldError(['decision'], '审批决定无效。'));
    }
    if (
      input.decision === 'return' &&
      (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.trim().length > 200)
    ) {
      errors.push(fieldError(['reason'], '退回需填写 1～200 字原因。'));
    }
    if (input.decision === 'approve' && input.reason?.trim()) {
      errors.push(fieldError(['reason'], '批准时请留空退回原因。'));
    }
    if (form && form.status !== 'submitted') errors.push(fieldError(['expenseFormId'], '只有已提交费用单可审批。'));
    if (form) {
      const actor = state.employees.find((item) => item.id === input.actorId && item.active);
      if (
        !actor ||
        !actor.roles.includes('manager') ||
        actor.departmentId !== form.departmentId ||
        actor.id === form.applicantId
      ) {
        errors.push(fieldError(['actorId'], '只有同部门非申请人的主管可以审批。'));
      }
      if (
        !state.todos.some(
          (todo) =>
            todo.sourceType === 'form' &&
            todo.sourceId === form.id &&
            todo.status === 'open' &&
            todo.assigneeId === input.actorId
        )
      ) {
        errors.push(fieldError(['actorId'], '当前主管没有该单据的待办。'));
      }
    }
    return errors;
  }

  review(input: ExpenseReviewInput): FormMutationResult {
    const errors = this.validateReview(input);
    if (errors.length)
      throw businessError('action.invalid-expense-review', errors.flatMap((item) => item.messages).join('；'));
    const transition: TransitionInput = {
      formId: input.expenseFormId,
      actorId: input.actorId,
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      action: input.decision,
      ...(input.decision === 'return' ? { reason: input.reason?.trim() } : {})
    };
    return this.workflow.transition(transition, (draft, form) => {
      if (form.kind !== 'expense' || !draft.expenseClaims.some((item) => item.formId === form.id)) {
        throw businessError('action.expense-not-found', '费用单据不存在。');
      }
      if (
        !draft.todos.some(
          (todo) =>
            todo.sourceType === 'form' &&
            todo.sourceId === form.id &&
            todo.status === 'open' &&
            todo.assigneeId === input.actorId
        )
      ) {
        throw businessError('action.role-denied', '当前主管没有该单据的待办。');
      }
    });
  }

  validateCorrect(input: ExpenseCorrectInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(this.repository.snapshot(), input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
    const state = this.repository.snapshot();
    const record = state.idempotencyRecords.find((item) => item.key === input.idempotencyKey);
    if (record)
      return record.operation === 'expense.correct' && record.fingerprint === correctionFingerprint(input)
        ? []
        : [fieldError(['idempotencyKey'], '业务幂等键已用于其他操作或参数。')];
    return validateCorrectionDraft(state, input);
  }

  correct(input: ExpenseCorrectInput): ExpenseCorrectionResult {
    return this.repository.transact((draft) => {
      const record = draft.idempotencyRecords.find((item) => item.key === input.idempotencyKey);
      if (record) {
        if (record.operation !== 'expense.correct' || record.fingerprint !== correctionFingerprint(input)) {
          throw businessError('action.idempotency-conflict', '业务幂等键已用于其他操作或参数。');
        }
        return {
          expenseFormId: record.resultId,
          status: 'returned',
          businessVersion: record.resultVersion ?? 1,
          declaredTotalCents: record.resultAmountCents ?? input.declaredTotalCents
        };
      }
      const errors = validateCorrectionDraft(draft, input);
      if (errors.length)
        throw businessError('action.invalid-expense-correction', errors.flatMap((item) => item.messages).join('；'));
      const form = draft.forms.find((item) => item.id === input.expenseFormId);
      const claim = draft.expenseClaims.find((item) => item.formId === input.expenseFormId);
      if (!form || !claim) throw businessError('action.expense-not-found', '费用单据不存在。');
      form.businessVersion += 1;
      form.amountCents = input.declaredTotalCents;
      claim.receipts = input.receipts.map((item) => ({ ...item }));
      claim.lineItems = input.lineItems.map((item) => ({ ...item }));
      claim.declaredTotalCents = input.declaredTotalCents;
      claim.checkedVersion = form.businessVersion;
      draft.auditEntries.push({
        id: nextId(
          'AUD',
          draft.auditEntries.map((item) => item.id)
        ),
        entityType: 'form',
        entityId: form.id,
        action: 'expense-correct',
        actorId: input.actorId,
        at: this.repository.clock.now(),
        fromStatus: 'returned',
        toStatus: 'returned',
        businessVersion: form.businessVersion
      });
      draft.idempotencyRecords.push({
        key: input.idempotencyKey,
        operation: 'expense.correct',
        fingerprint: correctionFingerprint(input),
        resultId: form.id,
        resultVersion: form.businessVersion,
        resultStatus: 'returned',
        resultAmountCents: input.declaredTotalCents
      });
      return {
        expenseFormId: form.id,
        status: 'returned',
        businessVersion: form.businessVersion,
        declaredTotalCents: claim.declaredTotalCents
      };
    });
  }

  validateRead(input: ExpenseReadInput): AwcpFieldError[] {
    const state = this.repository.snapshot();
    const form = state.forms.find((item) => item.id === input.expenseFormId && item.kind === 'expense');
    if (!form || !state.expenseClaims.some((item) => item.formId === form.id))
      return [fieldError(['expenseFormId'], '费用单据不存在。')];
    const actor = state.employees.find((item) => item.id === input.actorId && item.active);
    if (
      !actor ||
      (actor.id !== form.applicantId && !(actor.roles.includes('manager') && actor.departmentId === form.departmentId))
    ) {
      return [fieldError(['actorId'], '只有申请人或同部门主管可以查询。')];
    }
    return [];
  }

  read(input: ExpenseReadInput): ExpenseProgress {
    const errors = this.validateRead(input);
    if (errors.length)
      throw businessError('action.expense-read-denied', errors.flatMap((item) => item.messages).join('；'));
    const state = this.repository.snapshot();
    const form = state.forms.find((item) => item.id === input.expenseFormId);
    const claim = state.expenseClaims.find((item) => item.formId === input.expenseFormId);
    if (!form || !claim) throw businessError('action.expense-not-found', '费用单据不存在。');
    const todo = state.todos.find(
      (item) => item.sourceType === 'form' && item.sourceId === form.id && item.status === 'open'
    );
    return {
      expenseFormId: form.id,
      travelFormId: claim.travelFormId,
      status: form.status,
      businessVersion: form.businessVersion,
      checkedVersion: claim.checkedVersion,
      declaredTotalCents: claim.declaredTotalCents,
      reviewerId: todo?.assigneeId ?? null,
      history: state.auditEntries
        .filter((item) => item.entityType === 'form' && item.entityId === form.id)
        .map((item) => ({
          action: item.action,
          actorId: item.actorId,
          at: item.at,
          fromStatus: item.fromStatus,
          toStatus: item.toStatus,
          businessVersion: item.businessVersion,
          note: item.note ?? null
        }))
    };
  }
}

function validateMutation(state: DemoState, input: ExpenseMutationInput): AwcpFieldError[] {
  const errors: AwcpFieldError[] = [];
  const form = state.forms.find((item) => item.id === input.expenseFormId && item.kind === 'expense');
  if (!form || !state.expenseClaims.some((item) => item.formId === form.id)) {
    errors.push(fieldError(['expenseFormId'], '费用单据不存在。'));
  } else if (form.businessVersion !== input.expectedVersion) {
    errors.push(fieldError(['expectedVersion'], '业务版本已变化，请刷新后重试。'));
  }
  if (!state.employees.some((item) => item.id === input.actorId && item.active)) {
    errors.push(fieldError(['actorId'], '当前人员不存在或已停用。'));
  }
  if (typeof input.idempotencyKey !== 'string' || !/^[\w.:-]{1,128}$/.test(input.idempotencyKey)) {
    errors.push(fieldError(['idempotencyKey'], '业务幂等键格式不正确。'));
  }
  return errors;
}

function validateCorrectionDraft(state: DemoState, input: ExpenseCorrectInput): AwcpFieldError[] {
  const errors = validateExpense(state, input, input.expenseFormId);
  const form = state.forms.find((item) => item.id === input.expenseFormId && item.kind === 'expense');
  const claim = state.expenseClaims.find((item) => item.formId === input.expenseFormId);
  if (!form || !claim) return [...errors, fieldError(['expenseFormId'], '费用单据不存在。')];
  if (form.status !== 'returned') errors.push(fieldError(['expenseFormId'], '只有退回单可补正。'));
  if (form.businessVersion !== input.expectedVersion) errors.push(fieldError(['expectedVersion'], '业务版本已变化。'));
  if (form.applicantId !== input.actorId) errors.push(fieldError(['actorId'], '只有原申请人可以补正。'));
  if (claim.travelFormId !== input.travelFormId) errors.push(fieldError(['travelFormId'], '关联出差申请不可变更。'));
  return errors;
}

function transitionFingerprint(input: ExpenseMutationInput, reason?: string): string {
  return JSON.stringify(
    reason === undefined
      ? [input.expenseFormId, input.actorId, input.expectedVersion]
      : [input.expenseFormId, input.actorId, input.expectedVersion, reason]
  );
}

function correctionFingerprint(input: ExpenseCorrectInput): string {
  return JSON.stringify([
    input.expenseFormId,
    input.expectedVersion,
    input.actorId,
    input.travelFormId,
    input.receipts,
    input.lineItems,
    input.declaredTotalCents
  ]);
}

function nextId(prefix: string, ids: readonly string[]): string {
  const max = ids.reduce((current, id) => {
    const match = new RegExp(`^${prefix}-([0-9]+)$`).exec(id);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}
