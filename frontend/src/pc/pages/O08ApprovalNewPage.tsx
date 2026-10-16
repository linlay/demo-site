import { useCurrentActor } from '../../app/currentUserContext';
import { useAwcpAction, type AwcpActionRegistration } from '@app/awcp';
import { useState, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import { APPROVAL_SUBMIT_SCHEMA } from '../../common/awcp/approvalSchemas';
import type { DemoRepository } from '../../common/store/repository';
import { ApprovalService, type ApprovalSubmitInput } from '../service/approvalService';
import styles from './BusinessScenePage.module.css';

const EXAMPLE: ApprovalSubmitInput = { requestId: null, actorId: 'EMP-001', expectedVersion: null, title: '客户交流材料审批', description: '申请审批客户交流材料。', materialIds: ['APMAT-001'], idempotencyKey: 'o08-submit-example' };

export default function O08ApprovalNewPage({ repository }: { repository: DemoRepository }): ReactElement {
  const [service] = useState(() => new ApprovalService(repository));
  const actorId = useCurrentActor('EMP-001');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [materialIds, setMaterialIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const action: AwcpActionRegistration<ApprovalSubmitInput> = {
    action: 'office.approval.submit', title: '提交或重提通用审批',
    description: describeAction({ purpose: '新建并提交审批申请。', prerequisites: '申请人、标题、说明和资料齐全。', parameters: '新申请 requestId 与 expectedVersion 为 null。', effects: '保存申请并创建主管待办。', result: '返回申请 ID、状态和版本。', failures: '无有效主管或字段无效时不写入。' }),
    inputSchema: APPROVAL_SUBMIT_SCHEMA, examples: [EXAMPLE], validate: (args) => service.validateSubmit(args), invoke: (args) => completed(service.submit(args))
  };
  useAwcpAction(action);
  function submit(): void {
    if (!actorId || !title.trim() || !description.trim() || !materialIds.length) return;
    try { service.submit({ requestId: null, expectedVersion: null, actorId, title, description, materialIds, idempotencyKey: `o08-ui-${Date.now()}-${Math.random().toString(36).slice(2)}` }); }
    catch (error) { setMessage(error instanceof Error ? error.message : '提交失败。'); }
  }
  return <section className={styles.page} aria-label="通用审批申请表单">

    <label>申请标题 <input value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
    <label>申请说明 <textarea value={description} onChange={(event) => setDescription(event.target.value)} required /></label>
    <fieldset><legend>申请资料（至少选择一份）</legend>{service.materials().map((material) => <label key={material.id}><input type="checkbox" checked={materialIds.includes(material.id)} onChange={(event) => setMaterialIds((ids) => event.target.checked ? [...ids, material.id] : ids.filter((id) => id !== material.id))} />{material.name}（{material.id}）</label>)}</fieldset>
    <button type="button" disabled={!actorId || !title.trim() || !description.trim() || !materialIds.length} onClick={submit}>提交申请并查看详情</button>
    {message && <p role="alert">{message}</p>}
  </section>;
}
