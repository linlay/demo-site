import { useAwcpAction } from '@app/awcp';
import { useCurrentUser } from './currentUserContext';
import { completed, fieldError } from '../common/awcp/contracts';
import { accountResponsibilities } from '../pc/service/accountResponsibilities';

export function AccountActions() {
  const identity = useCurrentUser();
  const enabled = !!identity?.employees.some((employee) => employee.roles.includes('workflow-initiator'));
  const read = () =>
    completed({
      currentActorId: identity?.actorId ?? '',
      users: (identity?.employees ?? []).map((employee) => ({
        id: employee.id,
        name: employee.name,
        responsibility: accountResponsibilities(employee).join(' · ')
      }))
    });
  useAwcpAction(
    enabled
      ? {
          action: 'demo.account.read',
          title: '查看当前账户与职责',
          description:
            '返回当前账户和六位用户的粗职责。林悦、王晨、刘洋发起与办理各类业务；陈明、赵敏审核各类业务；周宁进行数据分析。个人事项按办理人分配。',
          inputSchema: { type: 'object', additionalProperties: false, properties: {} },
          examples: [{}],
          invoke: read
        }
      : null
  );
  useAwcpAction(
    enabled
      ? {
          action: 'demo.account.switch',
          title: '切换全局账户',
          description:
            '切换全站当前账户，刷新后保留。EMP-001 林悦、EMP-003 王晨、EMP-005 刘洋发起／办理；EMP-002 陈明、EMP-004 赵敏审核；EMP-006 周宁数据分析。切换后重新获取当前页面 manual 和 revision。',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['actorId'],
            properties: {
              actorId: { type: 'string', enum: (identity?.employees ?? []).map((employee) => employee.id) }
            }
          },
          examples: (identity?.employees ?? []).map((employee) => ({ actorId: employee.id })),
          validate: (args) =>
            identity?.employees.some((employee) => employee.id === args.actorId)
              ? []
              : [fieldError(['actorId'], '请选择账户菜单中的可用用户。')],
          invoke: (args) => {
            const actorId = String(args.actorId);
            setTimeout(() => identity?.changeUser(actorId), 0);
            return completed({ actorId, refreshManual: true });
          }
        }
      : null
  );
  return null;
}
