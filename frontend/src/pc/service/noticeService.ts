import { workflowErrors } from './workflowAccess';
import type { AwcpFieldError, JsonObject } from '@app/awcp';

import { businessError, fieldError } from '../../common/awcp/contracts';
import type { DemoState, Notice, NoticePublication, NoticeReceipt, NoticeReminder } from '../../common/fixtures/types';
import type { DemoRepository } from '../../common/store/repository';

export interface NoticeDraftInput extends JsonObject {
  actorId: string;
  title: string;
  body: string;
  idempotencyKey: string;
}
export interface NoticeReadInput extends JsonObject {
  noticeId: string;
  actorId: string;
}
export interface NoticeMutationInput extends NoticeReadInput {
  expectedVersion: number;
  idempotencyKey: string;
}
export interface NoticeRecipientInput extends NoticeMutationInput {
  departmentIds: string[];
}
export interface NoticeResult extends JsonObject {
  noticeId: string;
  status: Notice['status'];
  businessVersion: number;
}
export interface NoticeUnreadResult extends JsonObject {
  noticeId: string;
  employeeIds: string[];
  receiptIds: string[];
}
export interface NoticeView extends JsonObject {
  noticeId: string;
  title: string;
  body: string;
  authorId: string;
  status: Notice['status'];
  businessVersion: number;
  recipientDepartmentIds: string[];
  publication: JsonObject | null;
  receipts: JsonObject[];
  reminders: JsonObject[];
  history: JsonObject[];
}

type Operation = 'recipients.replace' | 'publish' | 'remind';

export class NoticeService {
  constructor(private readonly repository: DemoRepository) {}
  subscribe(listener: () => void): () => void {
    return this.repository.subscribe(listener);
  }

  list(actorId: string): Array<{ noticeId: string; title: string; status: Notice['status']; businessVersion: number }> {
    return this.repository
      .snapshot()
      .notices.filter((item) => item.authorId === actorId)
      .map((item) => ({
        noticeId: item.id,
        title: item.title,
        status: item.status,
        businessVersion: item.businessVersion
      }));
  }
  actors(): Array<{ id: string; name: string }> {
    return this.repository
      .snapshot()
      .employees.filter((item) => item.active)
      .map((item) => ({ id: item.id, name: item.name }));
  }
  departments(): Array<{ id: string; name: string }> {
    return this.repository.snapshot().departments.map((item) => ({ id: item.id, name: item.name }));
  }

  validateDraft(input: NoticeDraftInput): AwcpFieldError[] {
    const state = this.repository.snapshot();
    return replayErrors(state, 'draft', input.idempotencyKey, draftFingerprint(input)) ?? draftErrors(state, input);
  }
  draft(input: NoticeDraftInput): NoticeResult {
    return this.repository.transact((state) => {
      const previous = replay(state, 'draft', input.idempotencyKey, draftFingerprint(input));
      if (previous) return previous;
      assertValid(draftErrors(state, input));
      const notice: Notice = {
        id: nextId(
          'NTC',
          state.notices.map((item) => item.id)
        ),
        title: input.title.trim(),
        body: input.body.trim(),
        authorId: input.actorId,
        recipientDepartmentIds: [],
        status: 'draft',
        businessVersion: 1,
        createdAt: this.repository.clock.now()
      };
      state.notices.push(notice);
      audit(state, this.repository.clock.now(), notice, 'draft', input.actorId, null);
      remember(state, input.idempotencyKey, 'draft', draftFingerprint(input), notice);
      return result(notice);
    });
  }

  validateRead(input: NoticeReadInput): AwcpFieldError[] {
    return readErrors(this.repository.snapshot(), input);
  }
  read(input: NoticeReadInput): NoticeView {
    const state = this.repository.snapshot();
    assertValid(readErrors(state, input));
    const notice = state.notices.find((item) => item.id === input.noticeId);
    if (!notice) throw businessError('action.notice-not-found', '通知不存在。');
    const publication = state.noticePublications.find((item) => item.noticeId === notice.id);
    return {
      noticeId: notice.id,
      title: notice.title,
      body: notice.body,
      authorId: notice.authorId,
      status: notice.status,
      businessVersion: notice.businessVersion,
      recipientDepartmentIds: [...notice.recipientDepartmentIds],
      publication: publication
        ? {
            id: publication.id,
            recipientDepartmentIds: [...publication.recipientDepartmentIds],
            recipientEmployeeIds: [...publication.recipientEmployeeIds],
            publishedAt: publication.publishedAt
          }
        : null,
      receipts: state.noticeReceipts
        .filter((item) => item.noticeId === notice.id)
        .map((item) => ({ id: item.id, employeeId: item.employeeId, readAt: item.readAt })),
      reminders: state.noticeReminders
        .filter((item) => item.noticeId === notice.id)
        .map((item) => ({ id: item.id, employeeId: item.employeeId, status: item.status, createdAt: item.createdAt })),
      history: state.auditEntries
        .filter((item) => item.entityType === 'notice' && item.entityId === notice.id)
        .map((item) => ({
          action: item.action,
          actorId: item.actorId,
          at: item.at,
          businessVersion: item.businessVersion,
          note: item.note ?? null
        }))
    };
  }

  validateReplaceRecipients(input: NoticeRecipientInput): AwcpFieldError[] {
    return mutationErrors(this.repository.snapshot(), 'recipients.replace', input);
  }
  replaceRecipients(input: NoticeRecipientInput): NoticeResult {
    return this.mutate('recipients.replace', input, (state, notice) => {
      notice.recipientDepartmentIds = [...input.departmentIds];
      notice.businessVersion += 1;
      audit(
        state,
        this.repository.clock.now(),
        notice,
        'recipients.replace',
        input.actorId,
        notice.recipientDepartmentIds.join('、')
      );
    });
  }

  validatePublish(input: NoticeMutationInput): AwcpFieldError[] {
    return mutationErrors(this.repository.snapshot(), 'publish', input);
  }
  publish(input: NoticeMutationInput): NoticeResult {
    return this.mutate('publish', input, (state, notice) => {
      const recipients = recipientEmployees(state, notice.recipientDepartmentIds);
      const publication: NoticePublication = {
        id: nextId(
          'NPUB',
          state.noticePublications.map((item) => item.id)
        ),
        noticeId: notice.id,
        recipientDepartmentIds: [...notice.recipientDepartmentIds],
        recipientEmployeeIds: recipients,
        publishedAt: this.repository.clock.now()
      };
      state.noticePublications.push(publication);
      for (const employeeId of recipients) {
        const receipt: NoticeReceipt = {
          id: nextId(
            'NREC',
            state.noticeReceipts.map((item) => item.id)
          ),
          noticeId: notice.id,
          employeeId,
          readAt: null
        };
        state.noticeReceipts.push(receipt);
      }
      notice.status = 'published';
      notice.businessVersion += 1;
      audit(
        state,
        this.repository.clock.now(),
        notice,
        'publish',
        input.actorId,
        `${publication.id} · ${recipients.length} 人`
      );
    });
  }

  validateUnread(input: NoticeReadInput): AwcpFieldError[] {
    return unreadErrors(this.repository.snapshot(), input);
  }
  unread(input: NoticeReadInput): NoticeUnreadResult {
    const state = this.repository.snapshot();
    assertValid(unreadErrors(state, input));
    const publication = state.noticePublications.find((item) => item.noticeId === input.noticeId);
    if (!publication) throw businessError('action.notice-publication-not-found', '发布记录不存在。');
    const receipts = unreadReceipts(state, publication);
    return {
      noticeId: input.noticeId,
      employeeIds: receipts.map((item) => item.employeeId),
      receiptIds: receipts.map((item) => item.id)
    };
  }

  validateRemind(input: NoticeMutationInput): AwcpFieldError[] {
    return mutationErrors(this.repository.snapshot(), 'remind', input);
  }
  remind(input: NoticeMutationInput): NoticeResult {
    return this.mutate('remind', input, (state, notice) => {
      const publication = state.noticePublications.find((item) => item.noticeId === notice.id);
      if (!publication) throw businessError('action.notice-publication-not-found', '发布记录不存在。');
      const targets = unreadReceipts(state, publication).filter(
        (item) =>
          !state.noticeReminders.some(
            (message) => message.noticeId === notice.id && message.employeeId === item.employeeId
          )
      );
      for (const receipt of targets) {
        const message: NoticeReminder = {
          id: nextId(
            'NREM',
            state.noticeReminders.map((item) => item.id)
          ),
          noticeId: notice.id,
          employeeId: receipt.employeeId,
          status: 'simulated',
          createdAt: this.repository.clock.now()
        };
        state.noticeReminders.push(message);
      }
      notice.businessVersion += 1;
      audit(state, this.repository.clock.now(), notice, 'remind', input.actorId, `${targets.length} 条模拟消息`);
    });
  }

  private mutate(
    operation: Operation,
    input: NoticeMutationInput,
    change: (state: DemoState, notice: Notice) => void
  ): NoticeResult {
    return this.repository.transact((state) => {
      const fingerprint = mutationFingerprint(operation, input);
      const previous = replay(state, operation, input.idempotencyKey, fingerprint);
      if (previous) return previous;
      assertValid(mutationErrors(state, operation, input));
      const notice = state.notices.find((item) => item.id === input.noticeId);
      if (!notice) throw businessError('action.notice-not-found', '通知不存在。');
      change(state, notice);
      remember(state, input.idempotencyKey, operation, fingerprint, notice);
      return result(notice);
    });
  }
}

function draftErrors(state: DemoState, input: NoticeDraftInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const errors = actorErrors(state, input.actorId);
  errors.push(...keyErrors(input.idempotencyKey));
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 120)
    errors.push(fieldError(['title'], '通知标题须为 1～120 字。'));
  if (typeof input.body !== 'string' || !input.body.trim() || input.body.trim().length > 2000)
    errors.push(fieldError(['body'], '通知正文须为 1～2000 字。'));
  return errors;
}

function readErrors(state: DemoState, input: NoticeReadInput): AwcpFieldError[] {
  const errors = actorErrors(state, input.actorId);
  const notice = state.notices.find((item) => item.id === input.noticeId);
  if (!notice) errors.push(fieldError(['noticeId'], '通知不存在。'));
  else if (notice.authorId !== input.actorId) errors.push(fieldError(['actorId'], '只有起草人可以读取完整通知记录。'));
  return errors;
}

function unreadErrors(state: DemoState, input: NoticeReadInput): AwcpFieldError[] {
  const errors = readErrors(state, input);
  const notice = state.notices.find((item) => item.id === input.noticeId);
  if (notice && notice.status !== 'published') errors.push(fieldError(['noticeId'], '通知尚未发布。'));
  if (notice && !state.noticePublications.some((item) => item.noticeId === notice.id))
    errors.push(fieldError(['noticeId'], '发布记录不存在。'));
  return errors;
}

function mutationErrors(state: DemoState, operation: Operation, input: NoticeMutationInput): AwcpFieldError[] {
    const workflowDenied = workflowErrors(state, input.actorId, 'initiate');
    if (workflowDenied.length) return workflowDenied;
  const replayCheck = replayErrors(state, operation, input.idempotencyKey, mutationFingerprint(operation, input));
  if (replayCheck) return replayCheck;
  const errors = readErrors(state, input);
  errors.push(...keyErrors(input.idempotencyKey));
  const notice = state.notices.find((item) => item.id === input.noticeId);
  if (!notice) return errors;
  if (notice.businessVersion !== input.expectedVersion)
    errors.push(fieldError(['expectedVersion'], '通知业务版本已变化。'));
  if (operation === 'recipients.replace') {
    const ids = (input as NoticeRecipientInput).departmentIds;
    if (notice.status !== 'draft') errors.push(fieldError(['noticeId'], '只有草稿可设置接收部门。'));
    if (!Array.isArray(ids) || ids.length > 20)
      return [...errors, fieldError(['departmentIds'], '接收部门须为至多 20 项数组。')];
    if (new Set(ids).size !== ids.length) errors.push(fieldError(['departmentIds'], '接收部门不能重复。'));
    if (ids.some((id) => typeof id !== 'string' || !state.departments.some((department) => department.id === id)))
      errors.push(fieldError(['departmentIds'], '接收部门包含无效 ID。'));
  } else if (operation === 'publish') {
    if (notice.status !== 'draft') errors.push(fieldError(['noticeId'], '只有草稿可发布。'));
    if (!notice.title.trim()) errors.push(fieldError(['title'], '通知标题不能为空。'));
    if (!notice.body.trim()) errors.push(fieldError(['body'], '通知正文不能为空。'));
    if (!notice.recipientDepartmentIds.length)
      errors.push(fieldError(['recipientDepartmentIds'], '请先设置接收部门。'));
    if (notice.recipientDepartmentIds.some((id) => !state.departments.some((item) => item.id === id)))
      errors.push(fieldError(['recipientDepartmentIds'], '接收部门已失效。'));
    if (!recipientEmployees(state, notice.recipientDepartmentIds).length)
      errors.push(fieldError(['recipientDepartmentIds'], '接收部门没有有效员工。'));
    if (state.noticePublications.some((item) => item.noticeId === notice.id))
      errors.push(fieldError(['noticeId'], '通知已有发布记录。'));
  } else {
    if (notice.status !== 'published') errors.push(fieldError(['noticeId'], '只有已发布通知可提醒。'));
    const publication = state.noticePublications.find((item) => item.noticeId === notice.id);
    if (!publication) errors.push(fieldError(['noticeId'], '发布记录不存在。'));
    else if (
      !unreadReceipts(state, publication).some(
        (item) =>
          !state.noticeReminders.some(
            (message) => message.noticeId === notice.id && message.employeeId === item.employeeId
          )
      )
    )
      errors.push(fieldError(['noticeId'], '没有尚未提醒的未读接收人。'));
  }
  return errors;
}

function recipientEmployees(state: DemoState, departmentIds: string[]): string[] {
  return state.employees
    .filter((item) => item.active && departmentIds.includes(item.departmentId))
    .map((item) => item.id);
}
function unreadReceipts(state: DemoState, publication: NoticePublication): NoticeReceipt[] {
  return state.noticeReceipts.filter(
    (item) =>
      item.noticeId === publication.noticeId &&
      publication.recipientEmployeeIds.includes(item.employeeId) &&
      item.readAt === null
  );
}
function actorErrors(state: DemoState, actorId: string): AwcpFieldError[] {
  return state.employees.some((item) => item.id === actorId && item.active)
    ? []
    : [fieldError(['actorId'], '操作人不存在或已停用。')];
}
function keyErrors(value: string): AwcpFieldError[] {
  return typeof value === 'string' && /^[\w.:-]{1,128}$/.test(value)
    ? []
    : [fieldError(['idempotencyKey'], '业务幂等键格式不正确。')];
}
function mutationFingerprint(operation: Operation, input: NoticeMutationInput): string {
  return JSON.stringify([
    input.noticeId,
    input.actorId,
    input.expectedVersion,
    ...(operation === 'recipients.replace' ? [(input as NoticeRecipientInput).departmentIds] : [])
  ]);
}
function draftFingerprint(input: NoticeDraftInput): string {
  return JSON.stringify([input.actorId, input.title?.trim(), input.body?.trim()]);
}
function replayErrors(state: DemoState, operation: string, key: string, fingerprint: string): AwcpFieldError[] | null {
  const record = state.idempotencyRecords.find((item) => item.key === key);
  return record
    ? record.operation === `notice.${operation}` && record.fingerprint === fingerprint
      ? []
      : [fieldError(['idempotencyKey'], '业务幂等键已用于其他操作或参数。')]
    : null;
}
function replay(state: DemoState, operation: string, key: string, fingerprint: string): NoticeResult | null {
  const errors = replayErrors(state, operation, key, fingerprint);
  if (errors === null) return null;
  assertValid(errors);
  const record = state.idempotencyRecords.find((item) => item.key === key);
  if (
    !record ||
    record.resultVersion === null ||
    (record.resultStatus !== 'draft' && record.resultStatus !== 'published')
  )
    throw new Error('Invalid notice replay record.');
  return { noticeId: record.resultId, status: record.resultStatus, businessVersion: record.resultVersion };
}
function remember(state: DemoState, key: string, operation: string, fingerprint: string, notice: Notice): void {
  state.idempotencyRecords.push({
    key,
    operation: `notice.${operation}`,
    fingerprint,
    resultId: notice.id,
    resultVersion: notice.businessVersion,
    resultStatus: notice.status
  });
}
function result(notice: Notice): NoticeResult {
  return { noticeId: notice.id, status: notice.status, businessVersion: notice.businessVersion };
}
function audit(
  state: DemoState,
  at: string,
  notice: Notice,
  action: string,
  actorId: string,
  note: string | null
): void {
  state.auditEntries.push({
    id: nextId(
      'AUD',
      state.auditEntries.map((item) => item.id)
    ),
    entityType: 'notice',
    entityId: notice.id,
    action,
    actorId,
    at,
    fromStatus: action === 'draft' ? null : action === 'publish' ? 'draft' : notice.status,
    toStatus: notice.status,
    businessVersion: notice.businessVersion,
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
  if (errors.length) throw businessError('action.invalid-notice', errors.flatMap((item) => item.messages).join('；'));
}
