import { useCurrentActor } from '../../app/currentUserContext';
import { useAwcpAction, type AwcpActionRegistration } from '@app/awcp';
import { useState, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import { NOTICE_DRAFT_SCHEMA } from '../../common/awcp/noticeSchemas';
import type { DemoRepository } from '../../common/store/repository';
import { NoticeService, type NoticeDraftInput } from '../service/noticeService';
import styles from './BusinessScenePage.module.css';

const EXAMPLE: NoticeDraftInput = { actorId: 'EMP-004', title: '客户交流会议通知', body: '请相关部门参加客户交流会议。', idempotencyKey: 'o03-draft-example' };

export default function O03NoticeNewPage({ repository }: { repository: DemoRepository }): ReactElement {
  const [service] = useState(() => new NoticeService(repository));
  const actorId = useCurrentActor('EMP-001');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [message, setMessage] = useState('');

  const action: AwcpActionRegistration<NoticeDraftInput> = {
    action: 'office.notice.draft', title: '起草通知',
    description: describeAction({ purpose: '创建通知草稿。', prerequisites: '启用人员填写完整标题与正文。', parameters: 'actorId、title、body 和业务幂等键。', effects: '创建草稿及审计记录。', result: '返回新通知 ID 与版本。', failures: '必填字段或人员无效时不写入。' }),
    inputSchema: NOTICE_DRAFT_SCHEMA, examples: [EXAMPLE],
    validate: (args) => service.validateDraft(args), invoke: (args) => completed(service.draft(args))
  };
  useAwcpAction(action);

  function submit(): void {
    if (!actorId || !title.trim() || !body.trim()) return;
    try {
      service.draft({ actorId, title, body, idempotencyKey: `o03-ui-${Date.now()}-${Math.random().toString(36).slice(2)}` });
    } catch (error) { setMessage(error instanceof Error ? error.message : '起草失败。'); }
  }

  return <section className={styles.page} aria-label="起草通知表单">

    <label>通知标题 <input value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
    <label>通知正文 <textarea value={body} onChange={(event) => setBody(event.target.value)} required /></label>
    <button type="button" disabled={!actorId || !title.trim() || !body.trim()} onClick={submit}>保存草稿并查看详情</button>
    {message && <p role="alert">{message}</p>}
  </section>;
}
