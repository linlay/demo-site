import { expect, it } from 'vitest';

import { DemoRepository } from '../src/common/store/repository';
import { NoticeService } from '../src/pc/service/noticeService';

it('publishes a scoped draft once and creates receipts for the frozen recipient set', () => {
  const repository = new DemoRepository();
  const service = new NoticeService(repository);
  const publish = { noticeId: 'NTC-001', actorId: 'EMP-004', expectedVersion: 1, idempotencyKey: 'o03-publish' };
  expect(service.publish(publish)).toMatchObject({ noticeId: 'NTC-001', status: 'published', businessVersion: 2 });
  expect(service.publish(publish).businessVersion).toBe(2);
  const view = service.read({ noticeId: 'NTC-001', actorId: 'EMP-004' });
  expect(view.publication).toMatchObject({
    recipientDepartmentIds: ['DEP-001'],
    recipientEmployeeIds: ['EMP-001', 'EMP-002']
  });
  expect(view.receipts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ employeeId: 'EMP-001', readAt: null }),
      expect.objectContaining({ employeeId: 'EMP-002', readAt: null })
    ])
  );
  expect(repository.snapshot().noticePublications.filter((item) => item.noticeId === 'NTC-001')).toHaveLength(1);
  expect(service.validateRead({ noticeId: 'NTC-001', actorId: 'EMP-003' }).map((item) => item.path)).toContainEqual([
    'actorId'
  ]);
});

it('blocks incomplete or invalid notices, then publishes after valid recipient replacement', () => {
  const repository = new DemoRepository();
  const service = new NoticeService(repository);
  const initial = repository.snapshot();
  expect(
    service
      .validateDraft({ actorId: 'EMP-004', title: '', body: '正文', idempotencyKey: 'o03-empty-title' })
      .map((item) => item.path)
  ).toContainEqual(['title']);
  expect(repository.snapshot()).toEqual(initial);
  const create = { actorId: 'EMP-004', title: '虚构新公告', body: '本公告只作演示。', idempotencyKey: 'o03-draft' };
  expect(service.draft(create)).toMatchObject({ noticeId: 'NTC-003', status: 'draft', businessVersion: 1 });
  expect(service.draft(create).noticeId).toBe('NTC-003');
  const base = {
    noticeId: 'NTC-003',
    actorId: 'EMP-004',
    expectedVersion: 1,
    idempotencyKey: 'o03-publish-before-scope'
  };
  expect(service.validatePublish(base).map((item) => item.path)).toContainEqual(['recipientDepartmentIds']);
  const before = repository.snapshot();
  expect(() => service.publish(base)).toThrow('请先设置接收部门');
  expect(repository.snapshot()).toEqual(before);
  expect(
    service
      .validateReplaceRecipients({ ...base, departmentIds: ['DEP-999'], idempotencyKey: 'o03-invalid-dept' })
      .map((item) => item.path)
  ).toContainEqual(['departmentIds']);
  expect(
    service
      .validateReplaceRecipients({
        ...base,
        departmentIds: ['DEP-002', 'DEP-002'],
        idempotencyKey: 'o03-duplicate-dept'
      })
      .map((item) => item.path)
  ).toContainEqual(['departmentIds']);
  expect(
    service.replaceRecipients({ ...base, departmentIds: ['DEP-002', 'DEP-003'], idempotencyKey: 'o03-set-depts' })
  ).toMatchObject({ status: 'draft', businessVersion: 2 });
  expect(service.validatePublish({ ...base, idempotencyKey: 'o03-stale' }).map((item) => item.path)).toContainEqual([
    'expectedVersion'
  ]);
  service.publish({ ...base, expectedVersion: 2, idempotencyKey: 'o03-publish-new' });
  expect(service.read({ noticeId: 'NTC-003', actorId: 'EMP-004' }).publication).toMatchObject({
    recipientDepartmentIds: ['DEP-002', 'DEP-003'],
    recipientEmployeeIds: [
      'EMP-003',
      'EMP-004',
      'EMP-005',
      'EMP-006',
      'EMP-007',
      'EMP-008',
      'EMP-009',
      'EMP-010',
    ]
  });
});

it('derives unread people from receipts and writes only simulated reminders once', () => {
  const repository = new DemoRepository();
  const service = new NoticeService(repository);
  expect(service.unread({ noticeId: 'NTC-002', actorId: 'EMP-004' })).toEqual({
    noticeId: 'NTC-002',
    employeeIds: ['EMP-005', 'EMP-007'],
    receiptIds: ['NREC-002', 'NREC-003']
  });
  const input = { noticeId: 'NTC-002', actorId: 'EMP-004', expectedVersion: 2, idempotencyKey: 'o03-remind' };
  expect(service.remind(input)).toMatchObject({ status: 'published', businessVersion: 3 });
  expect(service.remind(input).businessVersion).toBe(3);
  expect(repository.snapshot().noticeReminders.map((item) => [item.employeeId, item.status])).toEqual([
    ['EMP-005', 'simulated'],
    ['EMP-007', 'simulated']
  ]);
  expect(service.unread({ noticeId: 'NTC-002', actorId: 'EMP-004' }).employeeIds).toEqual(['EMP-005', 'EMP-007']);
  expect(
    service
      .validateRemind({ ...input, expectedVersion: 3, idempotencyKey: 'o03-remind-again' })
      .map((item) => item.path)
  ).toContainEqual(['noticeId']);
  expect(
    service
      .validateRemind({ ...input, actorId: 'EMP-003', idempotencyKey: 'o03-wrong-author' })
      .map((item) => item.path)
  ).toContainEqual(['actorId']);
  expect(
    repository.snapshot().auditEntries.filter((item) => item.entityId === 'NTC-002' && item.action === 'remind')
  ).toHaveLength(1);
});

it('rejects a draft whose required body was lost before publish', () => {
  const repository = new DemoRepository();
  const service = new NoticeService(repository);
  repository.transact((state) => {
    state.notices[0].body = '';
  });
  const input = { noticeId: 'NTC-001', actorId: 'EMP-004', expectedVersion: 1, idempotencyKey: 'o03-missing-body' };
  expect(service.validatePublish(input).map((item) => item.path)).toContainEqual(['body']);
  const before = repository.snapshot();
  expect(() => service.publish(input)).toThrow('通知正文不能为空');
  expect(repository.snapshot()).toEqual(before);
});
