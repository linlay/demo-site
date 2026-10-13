import {
  ApiError,
  type BusinessDetail,
  type BusinessOperation,
  type BusinessResult,
  type DemoApi,
  type Approval,
  type Expense,
  type Travel
} from '@app/api';
import { AwcpActionError, type AwcpFieldError, type JsonObject } from '@app/awcp';

/** Only this typed service adapts HTTP domain contracts to existing AWCP Actions. */
export class BusinessService {
  constructor(readonly api: DemoApi) {}
  call<T>(operation: BusinessOperation, input: object, signal?: AbortSignal): Promise<T> {
    return this.api.business<T>(operation, input, signal);
  }
  async validate(operation: BusinessOperation, input: object, signal?: AbortSignal): Promise<AwcpFieldError[]> {
    try {
      await this.api.business(operation, input, signal, true);
      return [];
    } catch (error) {
      if (error instanceof ApiError) return error.failure.fieldErrors ?? [{ path: [], messages: [error.message] }];
      throw error;
    }
  }
  async action(
    action: string,
    args: JsonObject,
    signal?: AbortSignal,
    validate = false
  ): Promise<JsonObject | AwcpFieldError[]> {
    let operation: BusinessOperation;
    let input: object = args;
    if (action.startsWith('office.approval.')) {
      const suffix = action.slice('office.approval.'.length);
      operation = `approval_${suffix}` as BusinessOperation;
      const { requestId, reason, ...rest } = args;
      input =
        suffix === 'submit'
          ? { ...rest, requestId, expectedVersion: args.expectedVersion ?? 0 }
          : { ...rest, id: requestId, ...(suffix === 'withdraw' ? { opinion: reason } : {}) };
    } else if (action === 'office.travel-draft.save') {
      operation = 'travel_draft_save';
      input = { ...args, idempotencyKey: `draft:${args.formId}:${args.expectedVersion}` };
    } else if (action === 'office.travel.submit') {
      operation = 'travel_submit';
      input = { ...args, expectedVersion: 0 };
    } else if (action.startsWith('office.expense.')) {
      const suffix = action.slice('office.expense.'.length);
      const { expenseFormId, decision, reason, ...rest } = args;
      operation =
        suffix === 'review'
          ? decision === 'approve'
            ? 'expense_approve'
            : 'expense_return'
          : (`expense_${suffix}` as BusinessOperation);
      input =
        suffix === 'check'
          ? { ...rest, expectedVersion: 0 }
          : suffix === 'correct'
            ? { ...rest, expenseFormId }
            : {
                ...rest,
                id: expenseFormId,
                ...(suffix === 'review' ? { opinion: decision === 'approve' && !reason ? '同意' : reason } : {})
              };
    } else {
      operation = {
        'office.todo.query': 'todos_query',
        'office.todo.complete': 'todo_complete',
        'office.todo.summarize': 'todo_summarize'
      }[action] as BusinessOperation;
    }
    if (operation === 'todos_query') input = { ...args, pageSize: 100 };
    if (validate) return this.validate(operation, input, signal);
    try {
      const result = await this.call<BusinessResult | BusinessDetail<Approval | Travel | Expense> | JsonObject>(
        operation,
        input,
        signal
      );
      if ('item' in result) {
        const detail = result as BusinessDetail<Approval | Travel | Expense>;
        const item = detail.item;
        return json({
          ...item,
          ...(operation === 'approval_read'
            ? { requestId: item.id, taskId: item.currentTaskId }
            : { expenseFormId: item.id }),
          history: detail.history,
          tasks: detail.tasks,
          decisions: detail.decisions ?? [],
          ...('amountCents' in item ? { declaredTotalCents: item.amountCents } : {})
        });
      }
      if ('businessVersion' in result) {
        const value = result as BusinessResult;
        if (operation === 'travel_draft_save')
          return { formId: value.id, businessVersion: value.businessVersion, assetIds: args.assetIds };
        if (operation === 'todo_complete')
          return {
            todoId: args.todoId,
            sourceId: value.id,
            sourceStatus: value.status,
            businessVersion: value.businessVersion
          };
        return json({
          ...(operation.startsWith('approval_')
            ? { requestId: value.id, taskId: value.taskId }
            : operation.startsWith('expense_')
              ? { expenseFormId: value.id }
              : { formId: value.id }),
          status: operation === 'expense_check' ? 'checked' : value.status,
          businessVersion: value.businessVersion,
          ...(operation === 'expense_check' || operation === 'expense_correct'
            ? { declaredTotalCents: args.declaredTotalCents }
            : {})
        });
      }
      if (operation === 'todos_query') {
        const page = result as unknown as {
          items: Array<{
            id: string;
            title: string;
            assigneeId: string;
            sourceType: string;
            sourceId: string;
            dueAt: string;
            sourceVersion: number;
            sourceStatus: string;
          }>;
        };
        const dateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' });
        const today = dateFormat.format(new Date());
        return json({
          actorId: args.actorId,
          date: today,
          items: page.items
            .filter((item) => dateFormat.format(new Date(item.dueAt)) <= today)
            .map((item) => ({
              ...item,
              todoId: item.id,
              sourceType: item.sourceType === 'approval' ? 'approval' : 'form',
              priority: Date.parse(item.dueAt) < Date.now() ? 'overdue' : 'today',
              canComplete:
                item.sourceType === 'travel' && item.sourceStatus === 'submitted' && item.assigneeId === args.actorId
            }))
        });
      }
      return json(result);
    } catch (error) {
      if (error instanceof ApiError)
        throw new AwcpActionError('action.business-failed', error.message, {
          apiCode: error.failure.code,
          fieldErrors: error.failure.fieldErrors ?? []
        });
      throw error;
    }
  }
}
function json(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
