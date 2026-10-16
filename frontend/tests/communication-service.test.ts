import { expect, it } from 'vitest';

import { DemoRepository } from '../src/common/store/repository';
import { CommunicationService } from '../src/pc/service/communicationService';
import { TodoService } from '../src/pc/service/todoService';

it('queries mail by folder and keyword, reads attachment content, and archives atomically', () => {
  const repository = new DemoRepository();
  const service = new CommunicationService(repository);
  expect(
    service.query({ actorId: 'EMP-001', folder: 'inbox', keyword: '项目' }).items.map((item) => item.mailId)
  ).toEqual(['MAIL-001']);
  expect(service.readMail({ actorId: 'EMP-001', mailId: 'MAIL-001' }).attachments).toEqual([
    expect.objectContaining({ id: 'MAILAST-001', content: '项目资料包含进度计划、联系人及交付清单。' })
  ]);
  expect(service.validateReadMail({ actorId: 'EMP-002', mailId: 'MAIL-001' })).toEqual([
    expect.objectContaining({ path: ['actorId'] })
  ]);
  const initial = repository.snapshot();
  expect(
    service.validateArchive({
      actorId: 'EMP-001',
      mailId: 'MAIL-001',
      expectedVersion: 2,
      idempotencyKey: 'bad-version'
    })
  ).toHaveLength(1);
  expect(repository.snapshot()).toEqual(initial);
  const args = { actorId: 'EMP-001', mailId: 'MAIL-001', expectedVersion: 1, idempotencyKey: 'archive-mail' };
  expect(service.archive(args)).toEqual({ id: 'MAIL-001', status: 'archive', businessVersion: 2 });
  expect(service.archive(args)).toEqual({ id: 'MAIL-001', status: 'archive', businessVersion: 2 });
  expect(repository.snapshot().auditEntries.filter((item) => item.entityId === 'MAIL-001')).toHaveLength(1);
  expect(service.query({ actorId: 'EMP-001', folder: 'inbox', keyword: '项目' }).items).toEqual([]);
  expect(service.query({ actorId: 'EMP-001', folder: 'archive', keyword: '项目' }).items).toHaveLength(1);
  expect(service.validateArchive({ ...args, expectedVersion: 2, idempotencyKey: 'archive-again' })).toHaveLength(1);
});

it('reads reply composition and creates a single simulated send record', () => {
  const repository = new DemoRepository();
  const service = new CommunicationService(repository);
  const initial = repository.snapshot();
  const invalid = {
    actorId: 'EMP-001',
    mailId: 'MAIL-001',
    recipientIds: ['EMP-003'],
    body: '收到',
    attachmentIds: ['AST-001'],
    idempotencyKey: 'invalid-asset'
  };
  expect(service.validateReplyDraft(invalid)).toEqual([expect.objectContaining({ path: ['attachmentIds'] })]);
  expect(() => service.replyDraft(invalid)).toThrow();
  expect(repository.snapshot()).toEqual(initial);
  const args = { ...invalid, attachmentIds: ['MAILAST-001'], idempotencyKey: 'reply-new' };
  expect(service.replyDraft(args)).toEqual({ id: 'REPLY-002', status: 'draft', businessVersion: 1 });
  expect(service.replyDraft(args)).toEqual({ id: 'REPLY-002', status: 'draft', businessVersion: 1 });
  expect(service.readMail({ actorId: 'EMP-001', mailId: 'MAIL-001' }).replies).toContainEqual(
    expect.objectContaining({
      replyId: 'REPLY-002',
      recipientIds: ['EMP-003'],
      body: '收到',
      attachmentIds: ['MAILAST-001']
    })
  );
  const send = { actorId: 'EMP-001', replyId: 'REPLY-002', expectedVersion: 1, idempotencyKey: 'send-new' };
  expect(service.send(send)).toEqual({ id: 'REPLY-002', status: 'sent', businessVersion: 2 });
  expect(service.send(send)).toEqual({ id: 'REPLY-002', status: 'sent', businessVersion: 2 });
  expect(repository.snapshot().mailSendRecords).toEqual([
    expect.objectContaining({
      replyId: 'REPLY-002',
      recipientIds: ['EMP-003'],
      body: '收到',
      attachmentIds: ['MAILAST-001'],
      status: 'simulated'
    })
  ]);
  expect(service.validateSend({ ...send, expectedVersion: 2, idempotencyKey: 'send-twice' })).toHaveLength(1);
});

it('links discussion to project and creates a visible todo retaining its source', () => {
  const repository = new DemoRepository();
  const service = new CommunicationService(repository);
  const args = {
    actorId: 'EMP-008',
    projectId: 'IBP-001',
    title: '虚构资料跟进',
    body: '请确认资料。',
    idempotencyKey: 'discussion-new'
  };
  expect(service.createDiscussion(args)).toEqual({ id: 'DISC-002', status: 'open', businessVersion: null });
  expect(service.createDiscussion(args).id).toBe('DISC-002');
  expect(service.readDiscussion({ actorId: 'EMP-009', discussionId: 'DISC-002' })).toMatchObject({
    projectId: 'IBP-001',
    tasks: []
  });
  const task = {
    actorId: 'EMP-008',
    discussionId: 'DISC-002',
    assigneeId: 'EMP-009',
    title: '检查虚构资料',
    dueAt: '2026-09-19T07:00:00.000Z',
    idempotencyKey: 'task-new'
  };
  const initialCount = repository.snapshot().todos.length;
  expect(service.validateTaskCreate({ ...task, title: '', idempotencyKey: 'empty-task' })).toEqual([
    expect.objectContaining({ path: ['title'] })
  ]);
  expect(() => service.createTask({ ...task, title: '', idempotencyKey: 'empty-task' })).toThrow();
  expect(repository.snapshot().todos).toHaveLength(initialCount);
  expect(service.createTask(task)).toEqual({ id: 'OTODO-003', status: 'open', businessVersion: null });
  expect(service.createTask(task).id).toBe('OTODO-003');
  expect(service.readDiscussion({ actorId: 'EMP-008', discussionId: 'DISC-002' })).toMatchObject({
    projectId: 'IBP-001',
    tasks: [expect.objectContaining({ todoId: 'OTODO-003', sourceType: 'discussion', sourceId: 'DISC-002' })]
  });
  expect(new TodoService(repository).query({ actorId: 'EMP-009' }).items).toContainEqual(
    expect.objectContaining({ todoId: 'OTODO-003', sourceType: 'discussion', sourceId: 'DISC-002', canComplete: false })
  );
  expect(
    service.validateTaskCreate({ ...task, assigneeId: 'EMP-012', idempotencyKey: 'inactive-assignee' })
  ).toHaveLength(1);
  expect(service.validateDiscussionCreate({ ...args, actorId: 'EMP-009', idempotencyKey: 'not-owner' })).toHaveLength(
    1
  );
});
