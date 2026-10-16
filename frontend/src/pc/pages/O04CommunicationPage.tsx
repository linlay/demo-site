import { useCurrentActor } from '../../app/currentUserContext';
import { useWorkflowAction as useAwcpAction } from '../../app/useWorkflowAction';
import type { AwcpActionRegistration } from '@app/awcp';
import { useEffect, useState, type ReactElement } from 'react';

import { completed, describeAction } from '../../common/awcp/contracts';
import {
  DISCUSSION_READ_SCHEMA,
  DISCUSSION_TASK_SCHEMA,
  MAIL_ARCHIVE_SCHEMA,
  MAIL_QUERY_SCHEMA,
  MAIL_READ_SCHEMA,
  MAIL_REPLY_DRAFT_SCHEMA,
  MAIL_SEND_SCHEMA
} from '../../common/awcp/communicationSchemas';
import type { DemoRepository } from '../../common/store/repository';
import {
  CommunicationService,
  type DiscussionReadInput,
  type DiscussionTaskInput,
  type MailArchiveInput,
  type MailQueryInput,
  type MailReadInput,
  type ReplyDraftInput,
  type ReplySendInput
} from '../service/communicationService';
import styles from './O04CommunicationPage.module.css';

const QUERY: MailQueryInput = { actorId: 'EMP-001', folder: 'inbox', keyword: '项目' };
const MAIL_READ: MailReadInput = { actorId: 'EMP-001', mailId: 'MAIL-001' };
const ARCHIVE: MailArchiveInput = { ...MAIL_READ, expectedVersion: 1, idempotencyKey: 'o04-archive-example' };
const REPLY_DRAFT: ReplyDraftInput = {
  ...MAIL_READ,
  recipientIds: ['EMP-003'],
  body: '收到虚构项目资料。',
  attachmentIds: ['MAILAST-001'],
  idempotencyKey: 'o04-reply-example'
};
const SEND: ReplySendInput = {
  actorId: 'EMP-001',
  replyId: 'REPLY-001',
  expectedVersion: 1,
  idempotencyKey: 'o04-send-example'
};
const DISCUSSION_READ: DiscussionReadInput = { actorId: 'EMP-008', discussionId: 'DISC-001' };
const TASK: DiscussionTaskInput = {
  ...DISCUSSION_READ,
  assigneeId: 'EMP-009',
  title: '确认虚构尽调资料',
  dueAt: '2026-09-19T07:00:00.000Z',
  idempotencyKey: 'o04-task-example'
};

function guide(purpose: string, prerequisites: string, effects: string): string {
  return describeAction({
    purpose,
    prerequisites,
    parameters: '使用固定演示对象 ID；写操作提供稳定幂等键，归档与发送还需业务版本。',
    effects,
    result: '返回查询明细或记录 ID、状态和业务版本。',
    failures: '权限、字段、附件归属、状态或版本无效时返回字段错误且不写入。'
  });
}
function key(): string {
  return `o04-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function O04CommunicationPage({
  repository,
  objectId
}: {
  repository: DemoRepository;
  objectId?: string;
}): ReactElement {
  const [service] = useState(() => new CommunicationService(repository));
  const mailActorId = useCurrentActor(() => repository.snapshot().mailReplies.find((item) => item.id === objectId)?.authorId ?? 'EMP-001');
  const [folder, setFolder] = useState<'inbox' | 'archive'>('inbox');
  const [keyword, setKeyword] = useState('');
  const [selectedMail, setSelectedMail] = useState(() => objectId?.startsWith('MAIL-') ? objectId : repository.snapshot().mailReplies.find((item) => item.id === objectId)?.sourceMailId ?? 'MAIL-001');
  const [replyRecipientId, setReplyRecipientId] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [replyAttachmentIds, setReplyAttachmentIds] = useState<string[]>([]);
  const [selectedReply, setSelectedReply] = useState('REPLY-001');
  const discussionActorId = useCurrentActor(() => repository.snapshot().officeDiscussions.find((item) => item.id === objectId)?.creatorId ?? 'EMP-008');
  const [selectedDiscussion, setSelectedDiscussion] = useState(objectId?.startsWith('DISC-') ? objectId : 'DISC-001');
  const [assigneeId, setAssigneeId] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [message, setMessage] = useState('');
  const [, setRevision] = useState(0);
  const discussionDetail = objectId?.startsWith('DISC-') ?? false;
  const mailDetail = objectId?.startsWith('MAIL-') || objectId?.startsWith('REPLY-');

  useEffect(() => service.subscribe(() => setRevision((value) => value + 1)), [service]);
  const mailbox = service.query({ actorId: mailActorId, folder, keyword });
  const mailId = mailbox.items.some((item) => item.mailId === selectedMail)
    ? selectedMail
    : String(mailbox.items[0]?.mailId ?? '');
  const mail = mailId ? service.readMail({ actorId: mailActorId, mailId }) : null;
  const currentAttachmentIds = replyAttachmentIds.filter((id) => mail?.attachments.some((item) => item.id === id));
  const replies = mail?.replies ?? [];
  const replyId = replies.some((item) => item.replyId === selectedReply)
    ? selectedReply
    : String(replies[0]?.replyId ?? '');
  const reply = replies.find((item) => item.replyId === replyId);
  const discussions = service.discussions(discussionActorId);
  const discussionId = discussions.some((item) => item.id === selectedDiscussion)
    ? selectedDiscussion
    : (discussions[0]?.id ?? '');
  const discussion = discussionId ? service.readDiscussion({ actorId: discussionActorId, discussionId }) : null;

  function run(action: () => string): void {
    try {
      setMessage(action());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败。');
    }
  }

  const queryAction: AwcpActionRegistration<MailQueryInput> = {
    action: 'office.mail.query',
    title: '检索模拟邮件',
    description: guide('按收件人、分类与关键词检索虚构邮件。', '有效收件人和 inbox/archive 分类。', '只读。'),
    inputSchema: MAIL_QUERY_SCHEMA,
    examples: [QUERY],
    validate: (args) => service.validateQuery(args),
    invoke: (args) => completed(service.query(args))
  };
  useAwcpAction(discussionDetail ? null : queryAction);
  const readAction: AwcpActionRegistration<MailReadInput> = {
    action: 'office.mail.read',
    title: '读取模拟邮件与附件',
    description: guide('读取邮件正文、附件内容、本人回复与发送快照。', '当前人员是原邮件收件人。', '只读。'),
    inputSchema: MAIL_READ_SCHEMA,
    examples: [MAIL_READ],
    validate: (args) => service.validateReadMail(args),
    invoke: (args) => completed(service.readMail(args))
  };
  useAwcpAction(discussionDetail ? null : readAction);
  const archiveAction: AwcpActionRegistration<MailArchiveInput> = {
    action: 'office.mail.archive',
    title: '归档模拟邮件',
    description: guide('把收件箱邮件移至归档分类。', '收件人操作 inbox 邮件且业务版本一致。', '更新分类、版本和审计。'),
    inputSchema: MAIL_ARCHIVE_SCHEMA,
    examples: [ARCHIVE],
    validate: (args) => service.validateArchive(args),
    invoke: (args) => completed(service.archive(args))
  };
  useAwcpAction(discussionDetail ? null : archiveAction);
  const draftAction: AwcpActionRegistration<ReplyDraftInput> = {
    action: 'office.mail.reply-draft',
    title: '起草邮件回复',
    description: guide(
      '为模拟邮件起草回复。',
      '原邮件收件人指定有效收件人、正文及原邮件附件。',
      '保存可读回的回复草稿。'
    ),
    inputSchema: MAIL_REPLY_DRAFT_SCHEMA,
    examples: [REPLY_DRAFT],
    validate: (args) => service.validateReplyDraft(args),
    invoke: (args) => completed(service.replyDraft(args))
  };
  useAwcpAction(discussionDetail ? null : draftAction);
  const sendAction: AwcpActionRegistration<ReplySendInput> = {
    action: 'office.mail.send',
    title: '模拟发送回复',
    description: guide(
      '模拟发送本人回复草稿。',
      '草稿收件人、正文、附件有效且版本一致。',
      '生成唯一发送快照并更新草稿版本，不连接真实邮箱。'
    ),
    inputSchema: MAIL_SEND_SCHEMA,
    examples: [SEND],
    validate: (args) => service.validateSend(args),
    invoke: (args) => completed(service.send(args))
  };
  useAwcpAction(discussionDetail ? null : sendAction);
  const readDiscussionAction: AwcpActionRegistration<DiscussionReadInput> = {
    action: 'office.discussion.read',
    title: '读取项目讨论与行动项',
    description: guide('读取讨论的项目关联和已创建行动项。', '当前人员属于项目协作组。', '只读。'),
    inputSchema: DISCUSSION_READ_SCHEMA,
    examples: [DISCUSSION_READ],
    validate: (args) => service.validateDiscussionRead(args),
    invoke: (args) => completed(service.readDiscussion(args))
  };
  useAwcpAction(mailDetail ? null : readDiscussionAction);
  const taskAction: AwcpActionRegistration<DiscussionTaskInput> = {
    action: 'office.task.create',
    title: '创建讨论行动项',
    description: guide(
      '从项目讨论派生待办。',
      '讨论创建人指定有效组员、非空标题和未来截止时间。',
      '创建保留讨论来源的待办。'
    ),
    inputSchema: DISCUSSION_TASK_SCHEMA,
    examples: [TASK],
    validate: (args) => service.validateTaskCreate(args),
    invoke: (args) => completed(service.createTask(args))
  };
  useAwcpAction(mailDetail ? null : taskAction);

  return (
    <section className={styles.page} aria-label="邮件或讨论事项办理">
      {!discussionDetail && <div className={styles.panel}>
        <h2>模拟邮箱</h2>
        <div className={styles.grid}>


          <label htmlFor="o04-folder">分类</label>
          <select
            id="o04-folder"
            value={folder}
            onChange={(event) => setFolder(event.target.value as 'inbox' | 'archive')}
          >
            <option value="inbox">收件箱</option>
            <option value="archive">已归档</option>
          </select>
          <label htmlFor="o04-keyword">关键词</label>
          <input id="o04-keyword" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
          <label htmlFor="o04-mail">邮件</label>
          <select id="o04-mail" value={mailId} onChange={(event) => setSelectedMail(event.target.value)}>
            {mailbox.items.map((item) => (
              <option key={String(item.mailId)} value={String(item.mailId)}>
                {String(item.mailId)} · {String(item.subject)}
              </option>
            ))}
          </select>
        </div>
        <p>筛选命中 {mailbox.items.length} 封。</p>
        {mail && (
          <div className={styles.record} aria-label="邮件内容">
            <strong>{mail.subject}</strong>
            <p>{mail.body}</p>
            <p>
              分类 {mail.folder} · 业务版本 {mail.businessVersion}
            </p>
            <ul>
              {mail.attachments.map((item) => (
                <li key={String(item.id)}>
                  {String(item.filename)}：{String(item.content)}
                </li>
              ))}
            </ul>
            <p>
              回复 {mail.replies.length} 条 · 模拟发送记录 {mail.sendRecords.length} 条
            </p>
          </div>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            disabled={!mail || mail.folder !== 'inbox'}
            onClick={() =>
              run(() => {
                const result = service.archive({
                  actorId: mailActorId,
                  mailId,
                  expectedVersion: mail?.businessVersion ?? 0,
                  idempotencyKey: key()
                });
                return `邮件 ${result.id} 已归档。`;
              })
            }
          >
            归档邮件
          </button>
        </div>
        <h3>回复</h3>
        <div className={styles.grid}>
          <label htmlFor="o04-reply-recipient">回复收件人</label>
          <select
            id="o04-reply-recipient"
            value={replyRecipientId}
            onChange={(event) => setReplyRecipientId(event.target.value)}
          >
            <option value="">请选择</option>
            {service
              .actors()
              .filter((item) => item.id !== mailActorId)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}（{item.id}）
                </option>
              ))}
          </select>
          <label htmlFor="o04-reply-body">回复正文</label>
          <textarea
            id="o04-reply-body"
            rows={3}
            value={replyBody}
            onChange={(event) => setReplyBody(event.target.value)}
          />
        </div>
        <fieldset className={styles.attachments}>
          <legend>回复引用原邮件附件</legend>
          {mail?.attachments.map((item) => (
            <label key={String(item.id)}>
              <input
                type="checkbox"
                checked={currentAttachmentIds.includes(String(item.id))}
                onChange={() =>
                  setReplyAttachmentIds((ids) =>
                    ids.includes(String(item.id)) ? ids.filter((id) => id !== item.id) : [...ids, String(item.id)]
                  )
                }
              />
              {String(item.filename)}
            </label>
          ))}
        </fieldset>
        <div className={styles.actions}>
          <button
            type="button"
            disabled={!mail || !replyRecipientId || !replyBody.trim()}
            onClick={() =>
              run(() => {
                const result = service.replyDraft({
                  actorId: mailActorId,
                  mailId,
                  recipientIds: [replyRecipientId],
                  body: replyBody,
                  attachmentIds: currentAttachmentIds,
                  idempotencyKey: key()
                });
                setSelectedReply(result.id);
                return `已起草 ${result.id}。`;
              })
            }
          >
            起草回复
          </button>
          <label htmlFor="o04-reply">回复草稿</label>
          <select id="o04-reply" value={replyId} onChange={(event) => setSelectedReply(event.target.value)}>
            {replies.map((item) => (
              <option key={String(item.replyId)} value={String(item.replyId)}>
                {String(item.replyId)} · {String(item.status)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!reply || reply.status !== 'draft'}
            onClick={() =>
              run(() => {
                const result = service.send({
                  actorId: mailActorId,
                  replyId,
                  expectedVersion: Number(reply?.businessVersion),
                  idempotencyKey: key()
                });
                return `回复 ${result.id} 已模拟发送。`;
              })
            }
          >
            模拟发送回复
          </button>
        </div>
      </div>}
      {!mailDetail && <div className={styles.panel}>
        <h2>项目讨论与待办</h2>
        <div className={styles.grid}>
          <label htmlFor="o04-discussion">讨论</label>
          <select
            id="o04-discussion"
            value={discussionId}
            onChange={(event) => setSelectedDiscussion(event.target.value)}
          >
            {discussions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} · {item.title}
              </option>
            ))}
          </select>
          <label htmlFor="o04-task-assignee">行动项处理人</label>
          <select id="o04-task-assignee" value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
            <option value="">请选择</option>
            {service.actors().map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}（{item.id}）
              </option>
            ))}
          </select>
          <label htmlFor="o04-task-title">行动项标题</label>
          <input id="o04-task-title" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} />
          <label htmlFor="o04-task-due">截止时间 ISO</label>
          <input id="o04-task-due" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            disabled={!discussion || !assigneeId || !taskTitle.trim() || !dueAt.trim()}
            onClick={() =>
              run(() => {
                const result = service.createTask({
                  actorId: discussionActorId,
                  discussionId,
                  assigneeId,
                  title: taskTitle,
                  dueAt,
                  idempotencyKey: key()
                });
                return `已创建待办 ${result.id}。`;
              })
            }
          >
            创建行动项
          </button>
        </div>
        {discussion && (
          <div className={styles.record} aria-label="讨论记录">
            <strong>{String(discussion.title)}</strong>
            <p>{String(discussion.body)}</p>
            <p>
              关联项目 {String(discussion.projectId)} · 行动项 {(discussion.tasks as object[]).length} 条
            </p>
            <ul>
              {(discussion.tasks as Array<Record<string, unknown>>).map((item) => (
                <li key={String(item.todoId)}>
                  {String(item.todoId)} · {String(item.title)} · 来源 {String(item.sourceType)}:{String(item.sourceId)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>}
      <p role="status">{message}</p>
    </section>
  );
}
