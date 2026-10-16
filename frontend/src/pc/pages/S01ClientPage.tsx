import { useCurrentActor } from '../../app/currentUserContext';
import {
  AuditOutlined,
  CheckCircleOutlined,
  FileSearchOutlined,
  FolderOutlined,
  IdcardOutlined,
  PhoneOutlined,
  RollbackOutlined,
  SafetyCertificateOutlined,
  ShoppingOutlined,
  SolutionOutlined,
  UploadOutlined
} from '@ant-design/icons';
import { useWorkflowAction as useAwcpAction } from '../../app/useWorkflowAction';
import type { AwcpActionRegistration } from '@app/awcp';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import {
  CLIENT_DECISION_SCHEMA,
  CLIENT_MATCH_SCHEMA,
  CLIENT_MUTATION_SCHEMA,
  CLIENT_PATCH_SCHEMA,
  CLIENT_READ_SCHEMA
} from '../../common/awcp/suitabilitySchemas';
import type { DemoRepository } from '../../common/store/repository';
import {
  SuitabilityService,
  type ClientDecisionInput,
  type ClientMatchInput,
  type ClientMutationInput,
  type ClientPatchInput,
  type ClientReadInput
} from '../service/suitabilityService';
import styles from './S01ClientPage.module.css';

const READ_EXAMPLE: ClientReadInput = { clientId: 'CLI-001', actorId: 'EMP-001' };
const PATCH_EXAMPLE: ClientPatchInput = {
  clientId: 'CLI-002',
  actorId: 'EMP-001',
  expectedVersion: 1,
  identityDocumentNo: 'DEMO-IDENTITY-002',
  contactPhone: '13800000002',
  questionnaire: { riskTolerance: 2, lossCapacity: 2, answeredAt: '2026-09-19T01:00:00.000Z' },
  idempotencyKey: 's01-client-patch-example-001'
};
const EVALUATE_EXAMPLE: ClientMutationInput = {
  clientId: 'CLI-001',
  actorId: 'EMP-001',
  expectedVersion: 1,
  idempotencyKey: 's01-evaluate-example-001'
};
const MATCH_EXAMPLE: ClientMatchInput = {
  clientId: 'CLI-001',
  actorId: 'EMP-001',
  expectedVersion: 1,
  productId: 'PRD-001',
  idempotencyKey: 's01-match-example-001'
};
const SUBMIT_EXAMPLE: ClientMutationInput = {
  clientId: 'CLI-001',
  actorId: 'EMP-001',
  expectedVersion: 1,
  idempotencyKey: 's01-submit-example-001'
};
const DECISION_EXAMPLES: ClientDecisionInput[] = [
  {
    clientId: 'CLI-001',
    actorId: 'EMP-004',
    expectedVersion: 2,
    decision: 'approve',
    reason: '',
    idempotencyKey: 's01-approve-example-001'
  },
  {
    clientId: 'CLI-001',
    actorId: 'EMP-004',
    expectedVersion: 2,
    decision: 'return',
    reason: '请更新联系资料',
    idempotencyKey: 's01-return-example-001'
  }
];
const ARCHIVE_EXAMPLE: ClientMutationInput = {
  clientId: 'CLI-001',
  actorId: 'EMP-004',
  expectedVersion: 3,
  idempotencyKey: 's01-archive-example-001'
};

function intentKey(): string {
  return `s01-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function S01ClientPage({
  repository,
  objectId
}: {
  repository: DemoRepository;
  objectId?: string;
}): ReactElement {
  const [service] = useState(() => new SuitabilityService(repository));
  const [items, setItems] = useState(() => service.list());
  const actorId = useCurrentActor('EMP-001');
  const [productId, setProductId] = useState('');
  const [identityDocumentNo, setIdentityDocumentNo] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [riskTolerance, setRiskTolerance] = useState<number | ''>('');
  const [lossCapacity, setLossCapacity] = useState<number | ''>('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const keys = useRef(new Map<string, string>());
  const clientId = items.some((item) => item.clientId === objectId) ? (objectId ?? '') : (items[0]?.clientId ?? '');
  const current = items.find((item) => item.clientId === clientId);
  const actors = service.actors(clientId);
  const view = current && actors[0] ? service.read({ clientId, actorId }) : null;

  useEffect(() => service.subscribe(() => setItems(service.list())), [service]);
  useEffect(() => {
    setIdentityDocumentNo(view?.identityDocumentNo ?? '');
    setContactPhone(view?.contactPhone ?? '');
    setRiskTolerance(view?.questionnaire?.riskTolerance ?? '');
    setLossCapacity(view?.questionnaire?.lossCapacity ?? '');
  }, [
    clientId,
    view?.status,
    view?.identityDocumentNo,
    view?.contactPhone,
    view?.questionnaire?.riskTolerance,
    view?.questionnaire?.lossCapacity
  ]);

  function keyFor(operation: string, payload: string): string {
    const key = `${operation}:${clientId}:${current?.businessVersion}:${actorId}:${payload}`;
    let value = keys.current.get(key);
    if (!value) {
      value = intentKey();
      keys.current.set(key, value);
    }
    return value;
  }

  const readAction: AwcpActionRegistration<ClientReadInput> = {
    action: 'securities.client.read',
    title: '查询客户资料与进度',
    description: describeAction({
      purpose: '读取虚构客户档案、问卷、评估、匹配、复核和审计历史。',
      prerequisites: '客户经理或复核人员访问现有客户。',
      parameters: 'clientId 是客户 ID；actorId 是读取人。',
      effects: '只读，不改变记录。',
      result: '返回当前版本、状态、规则版本和完整历史。',
      failures: '不存在或无权时返回字段错误。'
    }),
    inputSchema: CLIENT_READ_SCHEMA,
    examples: [READ_EXAMPLE],
    validate: (args) => service.validateRead(args),
    invoke: (args) => completed(service.read(args))
  };
  useAwcpAction(readAction);

  const patchAction: AwcpActionRegistration<ClientPatchInput> = {
    action: 'securities.client.patch',
    title: '补充客户资料',
    description: describeAction({
      purpose: '更新演示证件、联系方式和风险问卷。',
      prerequisites: '客户经理操作草稿或退回档案；CLI-002 样例补全缺失资料。',
      parameters: '提供完整资料和问卷、当前业务版本及稳定业务幂等键。',
      effects: '原子更新资料并增加业务版本，退回档案恢复为草稿。',
      result: '返回客户 ID、draft 状态和新版本。',
      failures: '资料格式、角色、状态或版本不符时不写入。'
    }),
    inputSchema: CLIENT_PATCH_SCHEMA,
    examples: [PATCH_EXAMPLE],
    validate: (args) => service.validatePatch(args),
    invoke: (args) => completed(service.patch(args))
  };
  useAwcpAction(patchAction);

  const evaluateAction: AwcpActionRegistration<ClientMutationInput> = {
    action: 'securities.suitability.evaluate',
    title: '评估演示风险等级',
    description: describeAction({
      purpose: '按版本化演示规则评估问卷等级。',
      prerequisites: '档案完整且问卷在规则有效期内；CLI-001 初始满足。',
      parameters: 'clientId、actorId、expectedVersion 和 idempotencyKey。',
      effects: '记录评估等级、规则版本和审计。',
      result: '返回 assessmentId、风险等级和规则版本。',
      failures: '资料缺失或问卷过期返回具体字段且不写入。'
    }),
    inputSchema: CLIENT_MUTATION_SCHEMA,
    examples: [EVALUATE_EXAMPLE],
    validate: (args) => service.validateEvaluate(args),
    invoke: (args) => completed(service.evaluate(args))
  };
  useAwcpAction(evaluateAction);

  const matchAction: AwcpActionRegistration<ClientMatchInput> = {
    action: 'securities.suitability.match',
    title: '匹配演示产品',
    description: describeAction({
      purpose: '比较产品风险等级与当前版本问卷评估等级。',
      prerequisites: '先运行 evaluate；CLI-001 可匹配 PRD-001，PRD-002 会记录不匹配原因。',
      parameters: '提供产品 ID、当前业务版本及业务幂等键。',
      effects: '记录匹配结果、规则版本和原因。',
      result: '返回 matchId、eligible 和原因。',
      failures: '无当前评估或产品停用时不写入。'
    }),
    inputSchema: CLIENT_MATCH_SCHEMA,
    examples: [MATCH_EXAMPLE],
    validate: (args) => service.validateMatch(args),
    invoke: (args) => completed(service.match(args))
  };
  useAwcpAction(matchAction);

  const submitAction: AwcpActionRegistration<ClientMutationInput> = {
    action: 'securities.review.submit',
    title: '提交客户资料复核',
    description: describeAction({
      purpose: '把当前版本的评估和可匹配产品提交复核。',
      prerequisites: '先 evaluate 再 match 成功；退回补正后须按新版本重做。',
      parameters: '提供客户、经理、当前业务版本和幂等键。',
      effects: '原子创建复核记录及待办，更新状态、版本和审计。',
      result: '返回 submitted 状态和新版本。',
      failures: '缺资料、问卷过期或无合格匹配时不写入。'
    }),
    inputSchema: CLIENT_MUTATION_SCHEMA,
    examples: [SUBMIT_EXAMPLE],
    validate: (args) => service.validateSubmit(args),
    invoke: (args) => completed(service.submit(args))
  };
  useAwcpAction(submitAction);

  const decisionAction: AwcpActionRegistration<ClientDecisionInput> = {
    action: 'securities.review.decide',
    title: '批准或退回客户复核',
    description: describeAction({
      purpose: '复核人员批准或退回待办中的客户资料。',
      prerequisites: '先 submit；approve 和 return 样例分别从复位状态使用。',
      parameters: 'decision 为 approve 或 return；退回需填写 reason。',
      effects: '关闭待办并记录结论、原因、业务版本和审计。',
      result: '返回 approved 或 returned 状态和新版本。',
      failures: '非待办复核人员、缺原因、旧版本不写入。'
    }),
    inputSchema: CLIENT_DECISION_SCHEMA,
    examples: DECISION_EXAMPLES,
    validate: (args) => service.validateDecide(args),
    invoke: (args) => completed(service.decide(args))
  };
  useAwcpAction(decisionAction);

  const archiveAction: AwcpActionRegistration<ClientMutationInput> = {
    action: 'securities.client.archive',
    title: '归档已批准客户资料',
    description: describeAction({
      purpose: '归档经复核批准的演示客户资料。',
      prerequisites: '先 submit、decide approve；由复核人员操作。',
      parameters: '提供客户、复核人、批准后的业务版本和幂等键。',
      effects: '写入归档时间、状态、版本和审计。',
      result: '返回 archived 状态和新版本。',
      failures: '未批准或旧版本不写入。'
    }),
    inputSchema: CLIENT_MUTATION_SCHEMA,
    examples: [ARCHIVE_EXAMPLE],
    validate: (args) => service.validateArchive(args),
    invoke: (args) => completed(service.archive(args))
  };
  useAwcpAction(archiveAction);

  function run(action: () => string): void {
    try {
      setMessage(action());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败。');
    }
  }

  function base(operation: string, payload = ''): ClientMutationInput {
    return {
      clientId,
      actorId,
      expectedVersion: current?.businessVersion ?? 0,
      idempotencyKey: keyFor(operation, payload)
    };
  }

  return (
    <section className={styles.page} aria-label="客户适当性办理">

      {/* Workstation Split Layout */}
      <div className={styles.layoutGrid}>
        {/* Left Column: KYC & Risk Assessment Form */}
        <div className={styles.cardPanel}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>
              <SolutionOutlined /> 投资者 KYC 档案与问卷
            </h2>
          </div>

          <div className={styles.formGrid}>

            <div className={styles.formGroup}>


            </div>

            <div className={styles.formGroup}>
              <label htmlFor="s01-identity" className={styles.formLabel}>
                <IdcardOutlined /> 证件编号
              </label>
              <input
                id="s01-identity"
                className={styles.input}
                value={identityDocumentNo}
                onChange={(event) => setIdentityDocumentNo(event.target.value)}
                placeholder="DEMO-IDENTITY-002"
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="s01-phone" className={styles.formLabel}>
                <PhoneOutlined /> 联系电话
              </label>
              <input
                id="s01-phone"
                className={styles.input}
                value={contactPhone}
                onChange={(event) => setContactPhone(event.target.value)}
                placeholder="13800000002"
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="s01-tolerance" className={styles.formLabel}>
                风险承受意愿（1～5 级）
              </label>
              <input
                id="s01-tolerance"
                className={styles.input}
                type="number"
                min="1"
                max="5"
                value={riskTolerance}
                onChange={(event) => setRiskTolerance(event.target.value ? Number(event.target.value) : '')}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="s01-capacity" className={styles.formLabel}>
                损失承受能力（1～5 级）
              </label>
              <input
                id="s01-capacity"
                className={styles.input}
                type="number"
                min="1"
                max="5"
                value={lossCapacity}
                onChange={(event) => setLossCapacity(event.target.value ? Number(event.target.value) : '')}
              />
            </div>

            <div className={styles.formGroupFull}>
              <label htmlFor="s01-product" className={styles.formLabel}>
                <ShoppingOutlined /> 匹配意向金融产品
              </label>
              <select
                id="s01-product"
                className={styles.select}
                value={productId}
                onChange={(event) => setProductId(event.target.value)}
              >
                <option value="">请选择</option>
                {service.products().map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · 风险等级 R{item.riskLevel}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.formGroupFull}>
              <label htmlFor="s01-reason" className={styles.formLabel}>
                复核退回/批准备注
              </label>
              <input
                id="s01-reason"
                className={styles.input}
                value={reason}
                maxLength={200}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Right Column: Investor Suitability & Review Progress */}
        {view && (
          <div className={styles.summary} aria-label="客户业务进度">
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>
                <FileSearchOutlined /> 适当性评估与复核总览
              </h2>
            </div>

            <div className={styles.summaryStatusBanner}>
              {view.clientId} · {view.status} · 版本 {view.businessVersion}；最新评估等级：
              {view.latestAssessment?.riskLevel ? `C${view.latestAssessment.riskLevel}` : '未评估'}
            </div>

            <div className={styles.summaryMeta}>
              问卷有效期：{view.questionnaireMaxAgeDays} 天；匹配记录 {view.matches.length} 条；复核记录{' '}
              {view.reviews.length} 条。
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)' }}>生命周期与审计追踪</span>
              <ol className={styles.historyList}>
                {view.history.map((item, index) => (
                  <li key={index} className={styles.historyItem}>
                    {String(item.action)} · {String(item.toStatus)} · {String(item.note ?? '')}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>

      {/* Action Toolbar */}
      <div className={styles.actionsRow}>
        <button
          type="button"
          className={styles.btnAction}
          onClick={() =>
            run(() => {
              const result = service.patch({
                ...base('patch', `${identityDocumentNo}:${contactPhone}:${riskTolerance}:${lossCapacity}`),
                identityDocumentNo,
                contactPhone,
                questionnaire: {
                  riskTolerance: riskTolerance as 1 | 2 | 3 | 4 | 5,
                  lossCapacity: lossCapacity as 1 | 2 | 3 | 4 | 5,
                  answeredAt: repository.clock.now()
                }
              });
              return `已补资料，版本 ${result.businessVersion}。`;
            })
          }
          disabled={!current || !identityDocumentNo.trim() || !contactPhone.trim() || !riskTolerance || !lossCapacity || (current.status !== 'draft' && current.status !== 'returned')}
        >
          <UploadOutlined /> 补充资料
        </button>

        <button
          type="button"
          className={styles.btnAction}
          onClick={() => run(() => `评估等级 ${service.evaluate(base('evaluate')).riskLevel}。`)}
          disabled={current?.status !== 'draft'}
        >
          <SafetyCertificateOutlined /> 风险评估
        </button>

        <button
          type="button"
          className={styles.btnAction}
          onClick={() => run(() => service.match({ ...base('match', productId), productId }).reason)}
          disabled={current?.status !== 'draft' || !productId}
        >
          <ShoppingOutlined /> 匹配产品
        </button>

        <button
          type="button"
          className={styles.btnAction}
          onClick={() => run(() => `已提交复核，版本 ${service.submit(base('submit')).businessVersion}。`)}
          disabled={current?.status !== 'draft'}
        >
          <AuditOutlined /> 提交复核
        </button>

        <button
          type="button"
          className={`${styles.btnAction} ${styles.btnActionSuccess}`}
          onClick={() =>
            run(() => `复核结果：${service.decide({ ...base('approve'), decision: 'approve', reason: '' }).status}。`)
          }
          disabled={current?.status !== 'submitted'}
        >
          <CheckCircleOutlined /> 复核批准
        </button>

        <button
          type="button"
          className={`${styles.btnAction} ${styles.btnActionAmber}`}
          onClick={() =>
            run(() => `复核结果：${service.decide({ ...base('return', reason), decision: 'return', reason }).status}。`)
          }
          disabled={current?.status !== 'submitted' || !reason.trim()}
        >
          <RollbackOutlined /> 复核退回
        </button>

        <button
          type="button"
          className={styles.btnAction}
          onClick={() => run(() => `已归档，版本 ${service.archive(base('archive')).businessVersion}。`)}
          disabled={current?.status !== 'approved'}
        >
          <FolderOutlined /> 归档
        </button>

        <button
          type="button"
          className={styles.btnAction}
          onClick={() => run(() => `当前状态：${service.read({ clientId, actorId }).status}。`)}
          disabled={!current}
        >
          <FileSearchOutlined /> 查询进度
        </button>
      </div>

      {message && (
        <p role="status" className={styles.statusMessage}>
          {message}
        </p>
      )}
    </section>
  );
}
