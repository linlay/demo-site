import { useCurrentActor } from '../../app/currentUserContext';
import { useAwcpAction, type AwcpActionRegistration } from '@app/awcp';
import { useState, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import { IB_CREATE_SCHEMA } from '../../common/awcp/ibSchemas';
import type { DemoRepository } from '../../common/store/repository';
import { IbProjectService, type IbCreateInput } from '../service/ibProjectService';
import styles from './BusinessScenePage.module.css';

const EXAMPLE: IbCreateInput = { actorId: 'EMP-008', issuerId: 'ISS-001', title: '虚构发行人尽调项目', idempotencyKey: 's03-create-example' };

export default function S03IbProjectNewPage({ repository }: { repository: DemoRepository }): ReactElement {
  const [service] = useState(() => new IbProjectService(repository));
  const actorId = useCurrentActor('EMP-001');
  const [issuerId, setIssuerId] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const action: AwcpActionRegistration<IbCreateInput> = {
    action: 'securities.ib-project.create', title: '创建投行项目',
    description: describeAction({ purpose: '为发行人创建虚构投行项目。', prerequisites: '项目经理选择发行人并填写标题。', parameters: 'actorId、issuerId、title 和幂等键。', effects: '创建项目草稿。', result: '返回项目 ID 和版本。', failures: '人员、发行人或标题无效时不写入。' }),
    inputSchema: IB_CREATE_SCHEMA, examples: [EXAMPLE], validate: (args) => service.validateCreate(args), invoke: (args) => completed(service.create(args))
  };
  useAwcpAction(action);
  function submit(): void {
    if (!actorId || !issuerId || !title.trim()) return;
    try { service.create({ actorId, issuerId, title, idempotencyKey: `s03-ui-${Date.now()}-${Math.random().toString(36).slice(2)}` }); }
    catch (error) { setMessage(error instanceof Error ? error.message : '创建项目失败。'); }
  }
  return <section className={styles.page} aria-label="新建投行项目表单">

    <label>发行人 <select value={issuerId} onChange={(event) => setIssuerId(event.target.value)} required><option value="">请选择</option>{service.issuers().map((issuer) => <option key={issuer.id} value={issuer.id}>{issuer.name}（{issuer.id}）</option>)}</select></label>
    <label>项目名称 <input value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
    <button type="button" disabled={!actorId || !issuerId || !title.trim()} onClick={submit}>创建项目并查看详情</button>
    {message && <p role="alert">{message}</p>}
  </section>;
}
