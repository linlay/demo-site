import { useAwcpAction, type AwcpActionRegistration, type JsonObject } from '@app/awcp';
import { completed, describeAction } from '../../common/awcp/contracts';
import {
  APPROVAL_READ_SCHEMA,
  APPROVAL_REVIEW_SCHEMA,
  APPROVAL_SUBMIT_SCHEMA,
  APPROVAL_WITHDRAW_SCHEMA
} from '../../common/awcp/approvalSchemas';
import {
  EXPENSE_CHECK_SCHEMA,
  EXPENSE_CORRECT_SCHEMA,
  EXPENSE_READ_SCHEMA,
  EXPENSE_REVIEW_SCHEMA,
  EXPENSE_SUBMIT_SCHEMA
} from '../../common/awcp/expenseSchemas';
import { TODO_COMPLETE_SCHEMA, TODO_QUERY_SCHEMA, TODO_SUMMARY_SCHEMA } from '../../common/awcp/todoSchemas';
import type { BusinessService } from '../service/businessService';

const travelSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'actorId',
    'departmentId',
    'travelerIds',
    'origin',
    'destination',
    'startAt',
    'endAt',
    'estimatedAmountCents',
    'idempotencyKey'
  ],
  properties: {
    actorId: { type: 'string' },
    departmentId: { type: 'string' },
    travelerIds: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string' }, uniqueItems: true },
    origin: { type: 'string', minLength: 1, maxLength: 80 },
    destination: { type: 'string', minLength: 1, maxLength: 80 },
    startAt: { type: 'string' },
    endAt: { type: 'string' },
    estimatedAmountCents: { type: 'integer', minimum: 1 },
    idempotencyKey: { type: 'string', pattern: '^[A-Za-z0-9_.:-]{1,128}$' }
  }
};
const registrations = {
  O01: [
    ['office.todo.query', '查询待办', TODO_QUERY_SCHEMA],
    ['office.todo.complete', '完成差旅待办', TODO_COMPLETE_SCHEMA],
    ['office.todo.summarize', '按日期汇总待办', TODO_SUMMARY_SCHEMA]
  ],
  O08: [
    ['office.approval.read', '读取审批详情', APPROVAL_READ_SCHEMA],
    ['office.approval.submit', '提交申请', APPROVAL_SUBMIT_SCHEMA],
    ['office.approval.approve', '批准申请', APPROVAL_REVIEW_SCHEMA],
    ['office.approval.return', '退回申请', APPROVAL_REVIEW_SCHEMA],
    ['office.approval.withdraw', '撤回申请', APPROVAL_WITHDRAW_SCHEMA]
  ],
  O09: [
    [
      'office.travel-draft.save',
      '保存差旅草稿',
      {
        type: 'object',
        additionalProperties: false,
        required: ['formId', 'actorId', 'applicantId', 'departmentId', 'amountCents', 'assetIds', 'expectedVersion'],
        properties: {
          formId: { type: 'string' },
          actorId: { type: 'string' },
          applicantId: { type: 'string' },
          departmentId: { type: 'string' },
          amountCents: { type: 'integer', minimum: 0 },
          assetIds: { type: 'array', items: { type: 'string' }, uniqueItems: true },
          expectedVersion: { type: 'integer', minimum: 1 }
        }
      }
    ],
    ['office.travel.submit', '提交差旅申请', travelSchema],
    ['office.expense.check', '核验费用', EXPENSE_CHECK_SCHEMA],
    ['office.expense.submit', '提交报销', EXPENSE_SUBMIT_SCHEMA],
    ['office.expense.review', '审批报销', EXPENSE_REVIEW_SCHEMA],
    ['office.expense.correct', '补正费用', EXPENSE_CORRECT_SCHEMA],
    ['office.expense.read', '读取报销详情', EXPENSE_READ_SCHEMA]
  ]
} as const;
export function ServerBusinessActions({
  scene,
  service,
  refresh
}: {
  scene: keyof typeof registrations;
  service: BusinessService;
  refresh(): Promise<number>;
}) {
  return (
    <>
      {registrations[scene].map(([action, title, schema]) => (
        <Action
          key={action}
          action={action}
          title={title}
          schema={JSON.parse(JSON.stringify(schema)) as AwcpActionRegistration['inputSchema']}
          service={service}
          refresh={refresh}
        />
      ))}
    </>
  );
}
function Action({
  action,
  title,
  schema,
  service,
  refresh
}: {
  action: string;
  title: string;
  schema: AwcpActionRegistration['inputSchema'];
  service: BusinessService;
  refresh(): Promise<number>;
}) {
  useAwcpAction({
    action,
    title,
    inputSchema: schema,
    description: describeAction({
      purpose: title,
      prerequisites: '使用已授权空间中的虚构员工角色，当前页面已连接后端。',
      parameters: 'ID取自查询结果；金额单位为整数分。写操作携带当前业务版本和稳定幂等键。',
      effects: '读取或在SQLite事务中办理；同步任务、历史与实时分析。',
      result: '返回业务结果、单据ID和版本。',
      failures: '停用人员、角色不符、旧版本、重复票据和幂等冲突被后端拒绝。'
    }),
    validate: async (args, context) =>
      (await service.action(action, args, context.signal, true)) as Awaited<ReturnType<BusinessService['validate']>>,
    invoke: async (args, context) => {
      const result = (await service.action(action, args, context.signal)) as JsonObject;
      void refresh().catch(() => undefined);
      return completed(result);
    }
  });
  return null;
}
