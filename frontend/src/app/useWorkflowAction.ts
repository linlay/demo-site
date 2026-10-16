import { useAwcpAction, type AwcpActionRegistration, type JsonObject, type JsonValue } from '@app/awcp';
import { useCurrentUser } from './currentUserContext';
import { fieldError } from '../common/awcp/contracts';

const APPROVALS = new Set([
  'office.approval.approve',
  'office.approval.return',
  'office.travel.approve',
  'office.travel.return',
  'office.expense.review',
  'office.document.revision.approve',
  'office.document.archive',
  'office.supplier.review',
  'office.seal.review',
  'securities.review.decide',
  'securities.client.archive',
  'securities.research.review',
  'securities.ib-project.review',
  'securities.alert.review',
  'office.todo.complete'
]);
const READ = /\.(read|query|summarize|summary|unread|search|availability|entitlement-check)$/;

export function useWorkflowAction(registration: AwcpActionRegistration | null): void {
  const identity = useCurrentUser();
  const simple = !!identity?.employees.some((employee) => employee.roles.includes('workflow-initiator'));
  const role = registration && APPROVALS.has(registration.action) ? 'workflow-approver' : 'workflow-initiator';
  const dutyActor = identity?.user?.roles.includes(role)
    ? identity.actorId
    : (identity?.employees.find((employee) => employee.roles.includes(role))?.id ?? 'EMP-001');
  function example(value: JsonValue, field = ''): JsonValue {
    if (Array.isArray(value)) return value.map((entry) => example(entry, field));
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, example(entry, key)]));
    if (typeof value === 'string' && /^EMP-\d+$/.test(value)) {
      if (field === 'actorId')
        return registration && READ.test(registration.action) ? (identity?.actorId ?? dutyActor) : dutyActor;
      return ['reviewerId', 'recipientIds'].includes(field) ? 'EMP-002' : 'EMP-001';
    }
    return value;
  }
  useAwcpAction(
    !registration || !simple
      ? registration
      : {
          ...registration,
          description: `账户职责：林悦（EMP-001）、王晨（EMP-003）、刘洋（EMP-005）发起与办理各类业务，各管本人事项；陈明（EMP-002）、赵敏（EMP-004）审核各类业务，各看分派给本人的单据；周宁（EMP-006）负责数据分析。可用 demo.account.read 查看账户职责，再用 demo.account.switch 切换。\n${registration.description}`,
          examples: registration.examples?.map((entry) => example(entry) as JsonObject),
          validate: (args, context) => {
            if (typeof args.actorId === 'string' && args.actorId !== identity?.actorId)
              return [
                fieldError(
                  ['actorId'],
                  'actorId 必须为当前账户；请先调用 demo.account.switch 切换到具有相应职责的用户。'
                )
              ];
            return registration.validate?.(args, context) ?? [];
          }
        }
  );
}
