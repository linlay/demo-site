import { useCurrentActor } from '../../app/currentUserContext';
import { useAwcpAction, type AwcpActionRegistration } from '@app/awcp';
import { useState, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import { RESEARCH_CREATE_SCHEMA } from '../../common/awcp/researchSchemas';
import type { DemoRepository } from '../../common/store/repository';
import { ResearchService, type ResearchCreateInput } from '../service/researchService';
import styles from './BusinessScenePage.module.css';

const EXAMPLE: ResearchCreateInput = { actorId: 'EMP-003', topicTitle: '虚构公司跟踪研究', idempotencyKey: 's02-create-example' };

export default function S02ResearchNewPage({ repository }: { repository: DemoRepository }): ReactElement {
  const [service] = useState(() => new ResearchService(repository));
  const actorId = useCurrentActor('EMP-001');
  const [topicTitle, setTopicTitle] = useState('');
  const [message, setMessage] = useState('');
  const action: AwcpActionRegistration<ResearchCreateInput> = {
    action: 'securities.research.create', title: '建立研报课题',
    description: describeAction({ purpose: '建立虚构研究课题和研报草稿。', prerequisites: '分析师填写课题名称。', parameters: 'actorId、topicTitle 和幂等键。', effects: '创建课题和研报。', result: '返回研报 ID 与版本。', failures: '人员或标题无效时不写入。' }),
    inputSchema: RESEARCH_CREATE_SCHEMA, examples: [EXAMPLE], validate: (args) => service.validateCreate(args), invoke: (args) => completed(service.create(args))
  };
  useAwcpAction(action);
  function submit(): void {
    if (!actorId || !topicTitle.trim()) return;
    try { service.create({ actorId, topicTitle, idempotencyKey: `s02-ui-${Date.now()}-${Math.random().toString(36).slice(2)}` }); }
    catch (error) { setMessage(error instanceof Error ? error.message : '建立课题失败。'); }
  }
  return <section className={styles.page} aria-label="新建研报课题表单">

    <label>课题名称 <input value={topicTitle} onChange={(event) => setTopicTitle(event.target.value)} required /></label>
    <button type="button" disabled={!actorId || !topicTitle.trim()} onClick={submit}>建立课题并查看详情</button>
    {message && <p role="alert">{message}</p>}
  </section>;
}
