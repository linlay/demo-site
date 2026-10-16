import type { AwcpFieldError } from '@app/awcp';
import { fieldError } from '../../common/awcp/contracts';
import type { DemoState } from '../../common/fixtures/types';
import { isOperator, isReviewer } from '../../common/workflow/accounts';

export function workflowErrors(state: DemoState, actorId: string, duty: 'initiate' | 'approve'): AwcpFieldError[] {
  if (state.workflowProfile !== 'coarse-roles') return [];
  const actor = state.employees.find((employee) => employee.id === actorId && employee.active);
  return (duty === 'initiate' ? isOperator(actor) : isReviewer(actor))
    ? []
    : [
        fieldError(
          ['actorId'],
          duty === 'initiate'
            ? '请使用办理账户：林悦、王晨或刘洋，可发起和办理各类业务。'
            : '请使用审核账户：陈明或赵敏，可审核各类业务。'
        )
      ];
}
