import { workflowErrors } from './workflowAccess';
import type { AwcpFieldError, JsonObject } from '@app/awcp';

import { businessError, fieldError } from '../../common/awcp/contracts';
import type { DemoState, MailReply, OfficeDiscussion, Todo } from '../../common/fixtures/types';
import type { DemoRepository } from '../../common/store/repository';

export interface MailQueryInput extends JsonObject {
  actorId: string;
  folder: 'inbox' | 'archive';
  keyword: string;
}
export interface MailReadInput extends JsonObject {
  actorId: string;
  mailId: string;
}
export interface MailArchiveInput extends MailReadInput {
  expectedVersion: number;
  idempotencyKey: string;
}
export interface ReplyDraftInput extends MailReadInput {
  recipientIds: string[];
  body: string;
  attachmentIds: string[];
  idempotencyKey: string;
}
export interface ReplySendInput extends JsonObject {
  actorId: string;
  replyId: string;
  expectedVersion: number;
  idempotencyKey: string;
}
export interface DiscussionCreateInput extends JsonObject {
  actorId: string;
  projectId: string;
  title: string;
  body: string;
  idempotencyKey: string;
}
export interface DiscussionReadInput extends JsonObject {
  actorId: string;
  discussionId: string;
}
export interface DiscussionTaskInput extends DiscussionReadInput {
  assigneeId: string;
  title: string;
  dueAt: string;
  idempotencyKey: string;
}
export interface MailQueryResult extends JsonObject {
  actorId: string;
  folder: string;
  items: JsonObject[];
}
export interface MailView extends JsonObject {
  mailId: string;
  folder: string;
  businessVersion: number;
  senderId: string;
  recipientIds: string[];
  subject: string;
  body: string;
  attachments: JsonObject[];
  replies: JsonObject[];
  sendRecords: JsonObject[];
}
export interface MutationResult extends JsonObject {
  id: string;
  status: string;
  businessVersion: number | null;
}

type Operation = 'mail.archive' | 'mail.reply-draft' | 'mail.send' | 'discussion.create' | 'task.create';

export class CommunicationService {
  constructor(private readonly repository: DemoRepository) {}

  subscribe(listener: () => void): () => void {
    return this.repository.subscribe(listener);
  }
  actors(): Array<{ id: string; name: string }> {
    return this.repository
      .snapshot()
      .employees.filter((item) => item.active)
      .map((item) => ({ id: item.id, name: item.name }));
  }
  projects(): Array<{ id: string; title: string }> {
    return this.repository.snapshot().ibProjects.map((item) => ({ id: item.id, title: item.title }));
  }
  discussions(actorId: string): OfficeDiscussion[] {
    const state = this.repository.snapshot();
    return state.officeDiscussions.filter((item) =>
      state.officeTeams.some((team) => team.projectId === item.projectId && isTeamMember(team, actorId))
    );
  }

  validateQuery(input: MailQueryInput): AwcpFieldError[] {
    return queryErrors(this.repository.snapshot(), input);
  }
  query(input: MailQueryInput): MailQueryResult {
    const state = this.repository.snapshot();
    assertValid(queryErrors(state, input));
    const keyword = input.keyword.trim().toLocaleLowerCase();
    return {
      actorId: input.actorId,
      folder: input.folder,
      items: state.mailMessages
        .filter(
          (item) =>
            item.recipientIds.includes(input.actorId) &&
            item.folder === input.folder &&
            (!keyword || `${item.subject} ${item.body}`.toLocaleLowerCase().includes(keyword))
        )
        .map((item) => ({
          mailId: item.id,
          senderId: item.senderId,
          subject: item.subject,
          folder: item.folder,
          businessVersion: item.businessVersion,
          attachmentIds: [...item.attachmentIds]
        }))
    };
  }
  validateReadMail(input: MailReadInput): AwcpFieldError[] {
    return mailAccessErrors(this.repository.snapshot(), input);
  }
  readMail(input: MailReadInput): MailView {
    const state = this.repository.snapshot();
    assertValid(mailAccessErrors(state, input));
    const mail = state.mailMessages.find((item) => item.id === input.mailId);
    if (!mail) throw businessError('action.mail-not-found', '邮件不存在。');
    const replies = state.mailReplies.filter(
      (item) => item.sourceMailId === mail.id && item.authorId === input.actorId
    );
    return {
      mailId: mail.id,
      folder: mail.folder,
      businessVersion: mail.businessVersion,
      senderId: mail.senderId,
      recipientIds: [...mail.recipientIds],
      subject: mail.subject,
      body: mail.body,
      attachments: mail.attachmentIds.map((id) => attachmentView(state, id)),
      replies: replies.map((item) => ({
        replyId: item.id,
        recipientIds: [...item.recipientIds],
        body: item.body,
        attachmentIds: [...item.attachmentIds],
        attachments: item.attachmentIds.map((id) => attachmentView(state, id)),
        status: item.status,
        businessVersion: item.businessVersion
      })),
      sendRecords: state.mailSendRecords
        .filter((item) => replies.some((reply) => reply.id === item.replyId))
        .map((item) => ({ ...item, recipientIds: [...item.recipientIds], attachmentIds: [...item.attachmentIds] }))
    };
  }
  validateArchive(input: MailArchiveInput): AwcpFieldError[] {
    return archiveErrors(this.repository.snapshot(), input);
  }
  archive(input: MailArchiveInput): MutationResult {
    return this.repository.transact((state) => {
      const previous = replay(state, 'mail.archive', input.idempotencyKey, fingerprint(input));
      if (previous) return previous;
      assertValid(archiveErrors(state, input));
      const mail = state.mailMessages.find((item) => item.id === input.mailId);
      if (!mail) throw businessError('action.mail-not-found', '邮件不存在。');
      mail.folder = 'archive';
      mail.businessVersion += 1;
      audit(state, 'mail', mail.id, 'archive', input.actorId, mail.businessVersion, this.repository.clock.now());
      return remember(
        state,
        'mail.archive',
        input.idempotencyKey,
        fingerprint(input),
        mail.id,
        mail.folder,
        mail.businessVersion
      );
    });
  }
  validateReplyDraft(input: ReplyDraftInput): AwcpFieldError[] {
    return replyDraftErrors(this.repository.snapshot(), input);
  }
  replyDraft(input: ReplyDraftInput): MutationResult {
    return this.repository.transact((state) => {
      const previous = replay(state, 'mail.reply-draft', input.idempotencyKey, fingerprint(input));
      if (previous) return previous;
      assertValid(replyDraftErrors(state, input));
      const reply: MailReply = {
        id: nextId(
          'REPLY',
          state.mailReplies.map((item) => item.id)
        ),
        sourceMailId: input.mailId,
        authorId: input.actorId,
        recipientIds: [...input.recipientIds],
        body: input.body.trim(),
        attachmentIds: [...input.attachmentIds],
        status: 'draft',
        businessVersion: 1,
        createdAt: this.repository.clock.now()
      };
      state.mailReplies.push(reply);
      audit(state, 'mail-reply', reply.id, 'draft', input.actorId, 1, this.repository.clock.now());
      return remember(state, 'mail.reply-draft', input.idempotencyKey, fingerprint(input), reply.id, reply.status, 1);
    });
  }
  validateSend(input: ReplySendInput): AwcpFieldError[] {
    return sendErrors(this.repository.snapshot(), input);
  }
  send(input: ReplySendInput): MutationResult {
    return this.repository.transact((state) => {
      const previous = replay(state, 'mail.send', input.idempotencyKey, fingerprint(input));
      if (previous) return previous;
      assertValid(sendErrors(state, input));
      const reply = state.mailReplies.find((item) => item.id === input.replyId);
      if (!reply) throw businessError('action.reply-not-found', '回复草稿不存在。');
      state.mailSendRecords.push({
        id: nextId(
          'SEND',
          state.mailSendRecords.map((item) => item.id)
        ),
        replyId: reply.id,
        recipientIds: [...reply.recipientIds],
        body: reply.body,
        attachmentIds: [...reply.attachmentIds],
        sentAt: this.repository.clock.now(),
        status: 'simulated'
      });
      reply.status = 'sent';
      reply.businessVersion += 1;
      audit(state, 'mail-reply', reply.id, 'send', input.actorId, reply.businessVersion, this.repository.clock.now());
      return remember(
        state,
        'mail.send',
        input.idempotencyKey,
        fingerprint(input),
        reply.id,
        reply.status,
        reply.businessVersion
      );
    });
  }
  validateDiscussionCreate(input: DiscussionCreateInput): AwcpFieldError[] {
    return discussionCreateErrors(this.repository.snapshot(), input);
  }
  createDiscussion(input: DiscussionCreateInput): MutationResult {
    return this.repository.transact((state) => {
      const previous = replay(state, 'discussion.create', input.idempotencyKey, fingerprint(input));
      if (previous) return previous;
      assertValid(discussionCreateErrors(state, input));
      const discussion: OfficeDiscussion = {
        id: nextId(
          'DISC',
          state.officeDiscussions.map((item) => item.id)
        ),
        projectId: input.projectId,
        creatorId: input.actorId,
        title: input.title.trim(),
        body: input.body.trim(),
        createdAt: this.repository.clock.now()
      };
      state.officeDiscussions.push(discussion);
      audit(state, 'discussion', discussion.id, 'create', input.actorId, null, this.repository.clock.now());
      return remember(
        state,
        'discussion.create',
        input.idempotencyKey,
        fingerprint(input),
        discussion.id,
        'open',
        null
      );
    });
  }
  validateDiscussionRead(input: DiscussionReadInput): AwcpFieldError[] {
    return discussionAccessErrors(this.repository.snapshot(), input);
  }
  readDiscussion(input: DiscussionReadInput): JsonObject {
    const state = this.repository.snapshot();
    assertValid(discussionAccessErrors(state, input));
    const discussion = state.officeDiscussions.find((item) => item.id === input.discussionId);
    if (!discussion) throw businessError('action.discussion-not-found', '讨论不存在。');
    return {
      discussionId: discussion.id,
      projectId: discussion.projectId,
      creatorId: discussion.creatorId,
      title: discussion.title,
      body: discussion.body,
      tasks: state.todos
        .filter((item) => item.sourceType === 'discussion' && item.sourceId === discussion.id)
        .map((item) => ({
          todoId: item.id,
          title: item.title,
          assigneeId: item.assigneeId,
          sourceType: item.sourceType,
          sourceId: item.sourceId,
          dueAt: item.dueAt,
          status: item.status
        }))
    };
  }
  validateTaskCreate(input: DiscussionTaskInput): AwcpFieldError[] {
    return taskErrors(this.repository.snapshot(), input, this.repository.clock.now());
  }
  createTask(input: DiscussionTaskInput): MutationResult {
    return this.repository.transact((state) => {
      const previous = replay(state, 'task.create', input.idempotencyKey, fingerprint(input));
      if (previous) return previous;
      assertValid(taskErrors(state, input, this.repository.clock.now()));
      const task: Todo = {
        id: nextId(
          'OTODO',
          state.todos.map((item) => item.id)
        ),
        title: input.title.trim(),
        assigneeId: input.assigneeId,
        sourceType: 'discussion',
        sourceId: input.discussionId,
        dueAt: input.dueAt,
        status: 'open',
        completedAt: null
      };
      state.todos.push(task);
      audit(
        state,
        'discussion',
        input.discussionId,
        'task.create',
        input.actorId,
        null,
        this.repository.clock.now(),
        task.id
      );
      return remember(state, 'task.create', input.idempotencyKey, fingerprint(input), task.id, 'open', null);
    });
  }
}

function queryErrors(state: DemoState, input: MailQueryInput): AwcpFieldError[] {
  const errors = actorErrors(state, input.actorId);
  if (input.folder !== 'inbox' && input.folder !== 'archive') errors.push(fieldError(['folder'], '邮件分类无效。'));
  if (typeof input.keyword !== 'string' || input.keyword.length > 120)
    errors.push(fieldError(['keyword'], '关键词须为至多 120 字。'));
  return errors;
}
function mailAccessErrors(state: DemoState, input: MailReadInput): AwcpFieldError[] {
  const errors = actorErrors(state, input.actorId);
  const mail = state.mailMessages.find((item) => item.id === input.mailId);
  if (!mail) errors.push(fieldError(['mailId'], '邮件不存在。'));
  else if (!mail.recipientIds.includes(input.actorId)) errors.push(fieldError(['actorId'], '只有收件人可读取此邮件。'));
  return errors;
}
function archiveErrors(state: DemoState, input: MailArchiveInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const errors = keyAndReplayErrors(state, 'mail.archive', input);
  if (errors.length || hasReplay(state, input.idempotencyKey)) return errors;
  errors.push(...mailAccessErrors(state, input));
  const mail = state.mailMessages.find((item) => item.id === input.mailId);
  if (mail && mail.folder !== 'inbox') errors.push(fieldError(['mailId'], '邮件已归档。'));
  if (mail && mail.businessVersion !== input.expectedVersion)
    errors.push(fieldError(['expectedVersion'], '邮件业务版本已变化。'));
  return errors;
}
function replyDraftErrors(state: DemoState, input: ReplyDraftInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const errors = keyAndReplayErrors(state, 'mail.reply-draft', input);
  if (errors.length || hasReplay(state, input.idempotencyKey)) return errors;
  errors.push(...mailAccessErrors(state, input));
  if (!Array.isArray(input.recipientIds) || input.recipientIds.length < 1 || input.recipientIds.length > 20)
    errors.push(fieldError(['recipientIds'], '收件人须为 1～20 人。'));
  else {
    if (new Set(input.recipientIds).size !== input.recipientIds.length)
      errors.push(fieldError(['recipientIds'], '收件人不能重复。'));
    if (input.recipientIds.some((id) => !active(state, id)))
      errors.push(fieldError(['recipientIds'], '收件人不存在或已停用。'));
  }
  if (typeof input.body !== 'string' || !input.body.trim() || input.body.trim().length > 2000)
    errors.push(fieldError(['body'], '回复正文须为 1～2000 字。'));
  if (!Array.isArray(input.attachmentIds) || input.attachmentIds.length > 10)
    errors.push(fieldError(['attachmentIds'], '附件须为至多 10 项数组。'));
  else {
    if (new Set(input.attachmentIds).size !== input.attachmentIds.length)
      errors.push(fieldError(['attachmentIds'], '附件不能重复。'));
    if (
      input.attachmentIds.some(
        (id) => !state.mailAttachments.some((item) => item.id === id && item.ownerId === input.mailId)
      )
    )
      errors.push(fieldError(['attachmentIds'], '附件必须属于原邮件且可读取。'));
  }
  return errors;
}
function sendErrors(state: DemoState, input: ReplySendInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const errors = keyAndReplayErrors(state, 'mail.send', input);
  if (errors.length || hasReplay(state, input.idempotencyKey)) return errors;
  errors.push(...actorErrors(state, input.actorId));
  const reply = state.mailReplies.find((item) => item.id === input.replyId);
  if (!reply) return [...errors, fieldError(['replyId'], '回复草稿不存在。')];
  if (reply.authorId !== input.actorId) errors.push(fieldError(['actorId'], '只有起草人可以模拟发送。'));
  if (reply.status !== 'draft' || state.mailSendRecords.some((item) => item.replyId === reply.id))
    errors.push(fieldError(['replyId'], '此回复已有发送记录。'));
  if (reply.businessVersion !== input.expectedVersion)
    errors.push(fieldError(['expectedVersion'], '回复业务版本已变化。'));
  if (!reply.body.trim() || !reply.recipientIds.length || reply.recipientIds.some((id) => !active(state, id)))
    errors.push(fieldError(['replyId'], '回复收件人或正文无效。'));
  if (
    reply.attachmentIds.some(
      (id) =>
        !state.mailAttachments.some(
          (item) => item.id === id && (item.ownerId === reply.sourceMailId || item.ownerId === reply.id)
        )
    )
  )
    errors.push(fieldError(['replyId'], '回复附件已失效。'));
  return errors;
}
function discussionCreateErrors(state: DemoState, input: DiscussionCreateInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const errors = keyAndReplayErrors(state, 'discussion.create', input);
  if (errors.length || hasReplay(state, input.idempotencyKey)) return errors;
  errors.push(...actorErrors(state, input.actorId));
  if (!state.ibProjects.some((item) => item.id === input.projectId))
    errors.push(fieldError(['projectId'], '项目不存在。'));
  if (!state.officeTeams.some((item) => item.projectId === input.projectId && item.ownerId === input.actorId))
    errors.push(fieldError(['actorId'], '只有项目协作组负责人可以创建讨论。'));
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 120)
    errors.push(fieldError(['title'], '讨论标题须为 1～120 字。'));
  if (typeof input.body !== 'string' || !input.body.trim() || input.body.trim().length > 2000)
    errors.push(fieldError(['body'], '讨论正文须为 1～2000 字。'));
  return errors;
}
function discussionAccessErrors(state: DemoState, input: DiscussionReadInput): AwcpFieldError[] {
  const errors = actorErrors(state, input.actorId);
  const discussion = state.officeDiscussions.find((item) => item.id === input.discussionId);
  if (!discussion) errors.push(fieldError(['discussionId'], '讨论不存在。'));
  else if (
    !state.officeTeams.some((item) => item.projectId === discussion.projectId && isTeamMember(item, input.actorId))
  )
    errors.push(fieldError(['actorId'], '只有项目协作组成员可以读取讨论。'));
  return errors;
}
function taskErrors(state: DemoState, input: DiscussionTaskInput, now: string): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const errors = keyAndReplayErrors(state, 'task.create', input);
  if (errors.length || hasReplay(state, input.idempotencyKey)) return errors;
  errors.push(...discussionAccessErrors(state, input));
  const discussion = state.officeDiscussions.find((item) => item.id === input.discussionId);
  if (discussion && discussion.creatorId !== input.actorId)
    errors.push(fieldError(['actorId'], '只有讨论创建人可以分派行动项。'));
  const team = state.officeTeams.find((item) => item.projectId === discussion?.projectId);
  if (!active(state, input.assigneeId) || !team || !isTeamMember(team, input.assigneeId))
    errors.push(fieldError(['assigneeId'], '处理人须为有效项目协作组成员。'));
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 120)
    errors.push(fieldError(['title'], '行动项标题须为 1～120 字。'));
  if (
    typeof input.dueAt !== 'string' ||
    !Number.isFinite(Date.parse(input.dueAt)) ||
    Date.parse(input.dueAt) < Date.parse(now)
  )
    errors.push(fieldError(['dueAt'], '截止时间须为当前或未来的有效时间。'));
  return errors;
}
function actorErrors(state: DemoState, actorId: string): AwcpFieldError[] {
  return active(state, actorId) ? [] : [fieldError(['actorId'], '操作人不存在或已停用。')];
}
function active(state: DemoState, id: string): boolean {
  return state.employees.some((item) => item.id === id && item.active);
}
function isTeamMember(team: DemoState['officeTeams'][number], actorId: string): boolean {
  return team.ownerId === actorId || team.memberIds.includes(actorId);
}
function attachmentView(state: DemoState, id: string): JsonObject {
  const asset = state.mailAttachments.find((item) => item.id === id);
  if (!asset) throw businessError('action.mail-attachment-not-found', `附件 ${id} 不存在。`);
  return { id: asset.id, filename: asset.filename, mimeType: asset.mimeType, content: asset.content };
}
function keyAndReplayErrors(
  state: DemoState,
  operation: Operation,
  input: { idempotencyKey: string }
): AwcpFieldError[] {
  const errors: AwcpFieldError[] = [];
  if (typeof input.idempotencyKey !== 'string' || !/^[\w.:-]{1,128}$/.test(input.idempotencyKey))
    errors.push(fieldError(['idempotencyKey'], '业务幂等键格式不正确。'));
  const record = state.idempotencyRecords.find((item) => item.key === input.idempotencyKey);
  if (record && (record.operation !== operation || record.fingerprint !== fingerprint(input)))
    errors.push(fieldError(['idempotencyKey'], '业务幂等键已用于其他操作或参数。'));
  return errors;
}
function hasReplay(state: DemoState, key: string): boolean {
  return state.idempotencyRecords.some((item) => item.key === key);
}
function fingerprint(input: object): string {
  const { idempotencyKey: _key, ...fields } = input as Record<string, unknown>;
  return JSON.stringify(fields);
}
function replay(state: DemoState, operation: Operation, key: string, value: string): MutationResult | null {
  const record = state.idempotencyRecords.find((item) => item.key === key);
  if (!record) return null;
  if (record.operation !== operation || record.fingerprint !== value)
    throw businessError('action.idempotency-conflict', '业务幂等键已用于其他操作或参数。');
  return { id: record.resultId, status: record.resultStatus, businessVersion: record.resultVersion };
}
function remember(
  state: DemoState,
  operation: Operation,
  key: string,
  value: string,
  id: string,
  status: string,
  version: number | null
): MutationResult {
  state.idempotencyRecords.push({
    key,
    operation,
    fingerprint: value,
    resultId: id,
    resultStatus: status,
    resultVersion: version
  });
  return { id, status, businessVersion: version };
}
function audit(
  state: DemoState,
  entityType: 'mail' | 'mail-reply' | 'discussion',
  entityId: string,
  action: string,
  actorId: string,
  businessVersion: number | null,
  at: string,
  note?: string
): void {
  state.auditEntries.push({
    id: nextId(
      'AUD',
      state.auditEntries.map((item) => item.id)
    ),
    entityType,
    entityId,
    action,
    actorId,
    at,
    fromStatus: null,
    toStatus: action,
    businessVersion,
    ...(note ? { note } : {})
  });
}
function nextId(prefix: string, ids: readonly string[]): string {
  const max = ids.reduce((current, id) => {
    const match = new RegExp(`^${prefix}-([0-9]+)$`).exec(id);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}
function assertValid(errors: AwcpFieldError[]): void {
  if (errors.length)
    throw businessError('action.invalid-communication', errors.flatMap((item) => item.messages).join('；'));
}
