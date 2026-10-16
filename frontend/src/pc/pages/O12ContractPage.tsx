import { useCurrentActor } from '../../app/currentUserContext';
import { useWorkflowAction as useAwcpAction } from '../../app/useWorkflowAction';
import type { AwcpActionRegistration } from '@app/awcp';
import { useEffect, useState, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import {
  CONTRACT_READ_SCHEMA,
  RENEWAL_CREATE_SCHEMA,
  SEAL_EXECUTE_SCHEMA,
  SEAL_REVIEW_SCHEMA,
  SEAL_SUBMIT_SCHEMA
} from '../../common/awcp/contractSchemas';
import type { DemoRepository } from '../../common/store/repository';
import {
  ContractService,
  type ContractReadInput,
  type RenewalCreateInput,
  type SealExecuteInput,
  type SealReviewInput,
  type SealSubmitInput
} from '../service/contractService';
import styles from './O12ContractPage.module.css';

const READ: ContractReadInput = { actorId: 'EMP-001' };
const SUBMIT: SealSubmitInput = {
  actorId: 'EMP-001',
  contractId: 'CNTR-001',
  contractVersion: 1,
  purpose: '虚构签署用印',
  materialIds: ['CTMAT-001'],
  idempotencyKey: 'o12-seal-submit-example'
};
const REVIEW: SealReviewInput = {
  actorId: 'EMP-004',
  sealId: 'SEAL-001',
  decision: 'approved',
  note: '虚构审批同意。',
  expectedVersion: 1,
  idempotencyKey: 'o12-seal-review-example'
};
const EXECUTE: SealExecuteInput = {
  actorId: 'EMP-001',
  sealId: 'SEAL-002',
  expectedVersion: 2,
  idempotencyKey: 'o12-seal-execute-example'
};
const RENEW: RenewalCreateInput = {
  actorId: 'EMP-001',
  sourceContractId: 'CNTR-001',
  sourceVersion: 1,
  startDate: '2026-09-26',
  endDate: '2027-09-25',
  amountCents: 130000,
  materialIds: ['CTMAT-004'],
  idempotencyKey: 'o12-renew-example'
};
function guide(purpose: string, prerequisites: string, effects: string): string {
  return describeAction({
    purpose,
    prerequisites,
    parameters: '提供虚构合同、员工、附件与日期；写操作附稳定幂等键及需要的业务版本。',
    effects,
    result: '返回合同或用印申请编号、状态与版本；只读动作返回到期列表。',
    failures: '主体、金额、日期、附件、角色、审批状态或版本无效时返回字段错误且不写入。'
  });
}
function key(): string {
  return `o12-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function O12ContractPage({
  repository,
  objectId
}: {
  repository: DemoRepository;
  objectId?: string;
}): ReactElement {
  const [service] = useState(() => new ContractService(repository));
  const [, setRevision] = useState(0);
  useEffect(() => service.subscribe(() => setRevision((value) => value + 1)), [service]);
  const actorId = useCurrentActor('EMP-001');
  const [contractId, setContractId] = useState(() => objectId?.startsWith('CNTR-') ? objectId : repository.snapshot().sealRequests.find((item) => item.id === objectId)?.contractId ?? 'CNTR-001');
  const [sealId, setSealId] = useState(() => objectId?.startsWith('SEAL-') ? objectId : 'SEAL-001');
  const [purpose, setPurpose] = useState('');
  const [decision, setDecision] = useState<'' | SealReviewInput['decision']>('');
  const [note, setNote] = useState('');
  const [renewStartDate, setRenewStartDate] = useState('');
  const [renewEndDate, setRenewEndDate] = useState('');
  const [renewAmountCents, setRenewAmountCents] = useState<number | ''>('');
  const [renewMaterialIds, setRenewMaterialIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const state = service.snapshot();
  const view = service.read({ actorId });
  const contract = state.officeContracts.find((item) => item.id === contractId);
  const seal = state.sealRequests.find((item) => item.id === sealId);
  const expiring = view.expiring as Array<{ id: string; endDate: string; daysUntilExpiry: number }>;
  function run(action: () => string): void {
    try {
      setMessage(action());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败。');
    }
  }
  const readAction: AwcpActionRegistration<ContractReadInput> = {
    action: 'office.contract.read',
    title: '查询合同与到期状态',
    description: guide('查看合同、材料、用印审批及未来 30 天到期合同。', '在职员工。', '只读。'),
    inputSchema: CONTRACT_READ_SCHEMA,
    examples: [READ],
    validate: (args) => service.validateRead(args),
    invoke: (args) => completed(service.read(args))
  };
  useAwcpAction(readAction);
  const submitAction: AwcpActionRegistration<SealSubmitInput> = {
    action: 'office.seal.submit',
    title: '发起用印审批',
    description: guide(
      '就指定合同版本和事项发起用印申请。',
      '合同登记人、当前版本及有效附件。',
      '生成待审批申请，不执行用印。'
    ),
    inputSchema: SEAL_SUBMIT_SCHEMA,
    examples: [SUBMIT],
    validate: (args) => service.validateSubmit(args),
    invoke: (args) => completed(service.submit(args))
  };
  useAwcpAction(submitAction);
  const reviewAction: AwcpActionRegistration<SealReviewInput> = {
    action: 'office.seal.review',
    title: '审批用印申请',
    description: guide('由复核员批准或驳回申请。', '申请待审、当前版本、非申请人复核员。', '保存审批意见和决定。'),
    inputSchema: SEAL_REVIEW_SCHEMA,
    examples: [REVIEW],
    validate: (args) => service.validateReview(args),
    invoke: (args) => completed(service.review(args))
  };
  useAwcpAction(reviewAction);
  const executeAction: AwcpActionRegistration<SealExecuteInput> = {
    action: 'office.seal.execute',
    title: '执行已批准用印',
    description: guide(
      '对已批准申请登记实际用印。',
      '申请人、已批准状态、当前合同版本及未过期附件。',
      '记录执行时间并关闭申请。'
    ),
    inputSchema: SEAL_EXECUTE_SCHEMA,
    examples: [EXECUTE],
    validate: (args) => service.validateExecute(args),
    invoke: (args) => completed(service.execute(args))
  };
  useAwcpAction(executeAction);
  const renewalAction: AwcpActionRegistration<RenewalCreateInput> = {
    action: 'office.renewal.create',
    title: '续签到期合同',
    description: guide(
      '从未来 30 天内到期的合同创建续签版本。',
      '原合同登记人、当前原版本、原到期日后的新期间和有效未占用附件。',
      '保存关联原合同和源版本的新合同，原记录不改写。'
    ),
    inputSchema: RENEWAL_CREATE_SCHEMA,
    examples: [RENEW],
    validate: (args) => service.validateRenewal(args),
    invoke: (args) => completed(service.renew(args))
  };
  useAwcpAction(renewalAction);

  return (
    <main className={styles.page}>

      <section>
        <h2>用印审批与执行</h2>
        <label>
          合同{' '}
          <select id="o12-contract" value={contractId} onChange={(e) => setContractId(e.target.value)}>
            {state.officeContracts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} {item.counterpartyName}（v{item.businessVersion}）
              </option>
            ))}
          </select>
        </label>
        <p>
          期间：{contract?.startDate}～{contract?.endDate}；金额 {contract?.amountCents} 分；附件{' '}
          {contract?.materialIds.join('、')}。
        </p>
        <label>
          用印事项 <input aria-label="用印事项" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </label>
        <button
          disabled={!contract || !purpose.trim()}
          onClick={() =>
            run(() => {
              const result = service.submit({
                actorId,
                contractId,
                contractVersion: contract?.businessVersion ?? 0,
                purpose,
                materialIds: contract?.materialIds ?? [],
                idempotencyKey: key()
              });
              setSealId(result.id);
              return `已发起 ${result.id}`;
            })
          }
        >
          发起用印审批
        </button>
        <label>
          用印申请{' '}
          <select id="o12-seal" value={sealId} onChange={(e) => setSealId(e.target.value)}>
            {state.sealRequests.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id}（{item.status}）
              </option>
            ))}
          </select>
        </label>
        <p>
          关联合同 {seal?.contractId} v{seal?.contractVersion}；状态 {seal?.status}；事项 {seal?.purpose}。
        </p>
        <label>
          决定{' '}
          <select
            aria-label="用印审批决定"
            value={decision}
            onChange={(e) => setDecision(e.target.value as SealReviewInput['decision'])}
          >
            <option value="">请选择</option>
            <option value="approved">批准</option>
            <option value="rejected">驳回</option>
          </select>
        </label>
        <label>
          意见 <input aria-label="用印审批意见" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button
          disabled={!seal || !decision || !note.trim()}
          onClick={() =>
            run(() => {
              if (!decision) throw new Error('请选择审批决定。');
              const result = service.review({
                actorId,
                sealId,
                decision,
                note,
                expectedVersion: seal?.businessVersion ?? 0,
                idempotencyKey: key()
              });
              return `审批结果 ${result.status}`;
            })
          }
        >
          审批用印
        </button>
        <button
          disabled={!seal || seal.status !== 'approved'}
          onClick={() =>
            run(() => {
              const result = service.execute({
                actorId,
                sealId,
                expectedVersion: seal?.businessVersion ?? 0,
                idempotencyKey: key()
              });
              return `已执行 ${result.id}`;
            })
          }
        >
          执行用印
        </button>
      </section>
      <section>
        <h2>到期查询与续签</h2>
        <p>
          固定演示日期：{String(view.today)}。未来 30 天内到期合同：
          {expiring.length
            ? expiring.map((item) => `${item.id}（${item.endDate}，剩余 ${item.daysUntilExpiry} 天）`).join('；')
            : '无'}
          。
        </p>
        <label>
          续签开始{' '}
          <input
            aria-label="续签开始日期"
            type="date"
            value={renewStartDate}
            onChange={(e) => setRenewStartDate(e.target.value)}
          />
        </label>
        <label>
          续签结束{' '}
          <input
            aria-label="续签结束日期"
            type="date"
            value={renewEndDate}
            onChange={(e) => setRenewEndDate(e.target.value)}
          />
        </label>
        <label>
          续签金额（分）{' '}
          <input
            aria-label="续签金额"
            type="number"
            value={renewAmountCents}
            onChange={(e) => setRenewAmountCents(Number(e.target.value))}
          />
        </label>
        <div>
          续签附件：
          {state.contractMaterials
            .filter((item) => item.contractId === null)
            .map((item) => (
              <label key={item.id}>
                <input
                  type="checkbox"
                  checked={renewMaterialIds.includes(item.id)}
                  onChange={(e) =>
                    setRenewMaterialIds(
                      e.target.checked
                        ? [...renewMaterialIds, item.id]
                        : renewMaterialIds.filter((id) => id !== item.id)
                    )
                  }
                />
                {item.id} {item.name}
              </label>
            ))}
        </div>
        <button
          disabled={!contract || !renewStartDate || !renewEndDate || renewAmountCents === '' || renewAmountCents <= 0 || renewMaterialIds.length === 0}
          onClick={() =>
            run(() => {
              const result = service.renew({
                actorId,
                sourceContractId: contractId,
                sourceVersion: contract?.businessVersion ?? 0,
                startDate: renewStartDate,
                endDate: renewEndDate,
                amountCents: Number(renewAmountCents),
                materialIds: renewMaterialIds,
                idempotencyKey: key()
              });
              setContractId(result.id);
              setRenewMaterialIds([]);
              return `已续签 ${result.id}`;
            })
          }
        >
          创建续签
        </button>
        {state.officeContracts
          .filter((item) => item.renewedFromContractId !== null)
          .map((item) => (
            <p key={item.id}>
              {item.id} 续签自 {item.renewedFromContractId} v{item.sourceVersion}，期限 {item.startDate}～{item.endDate}
              。
            </p>
          ))}
      </section>
      {message && <p role="status">{message}</p>}
    </main>
  );
}
