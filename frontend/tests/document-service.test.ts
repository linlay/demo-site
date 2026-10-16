import { expect, it } from 'vitest';

import { DemoRepository } from '../src/common/store/repository';
import { DocumentService } from '../src/pc/service/documentService';

it('queries document IDs, versions and sources without inventing empty search results', () => {
  const repository = new DemoRepository();
  const service = new DocumentService(repository);
  expect(service.query({ actorId: 'EMP-003', keyword: '办公' }).items).toEqual([
    expect.objectContaining({
      documentId: 'DOC-001',
      title: '办公指引',
      source: '办公制度库',
      documentVersion: 1,
      status: 'draft'
    })
  ]);
  expect(service.query({ actorId: 'EMP-003', keyword: '不存在的制度' })).toEqual({
    keyword: '不存在的制度',
    items: []
  });
  expect(service.read({ actorId: 'EMP-003', documentId: 'DOC-001', version: null })).toMatchObject({
    source: '办公制度库',
    documentVersion: 1,
    blocks: [
      { id: 'DBLK-001', kind: 'heading', text: '办公指引' },
      { id: 'DBLK-002', kind: 'paragraph', text: '本指引用于规范部门日常办公和审批流程。' }
    ]
  });
  expect(service.validateRead({ actorId: 'EMP-003', documentId: 'DOC-001', version: 99 })).toContainEqual(
    expect.objectContaining({ path: ['version'] })
  );
  expect(service.validateQuery({ actorId: 'EMP-012', keyword: '' })).toContainEqual(
    expect.objectContaining({ path: ['actorId'] })
  );
});

it('patches a document block into a new version while preserving old content', () => {
  const repository = new DemoRepository();
  const service = new DocumentService(repository);
  const initial = repository.snapshot();
  const args = {
    actorId: 'EMP-003',
    documentId: 'DOC-001',
    expectedVersion: 1,
    blockId: 'DBLK-002',
    text: '虚构流程修订内容。',
    idempotencyKey: 'patch-doc'
  };
  expect(service.validatePatch({ ...args, blockId: 'DBLK-999', idempotencyKey: 'wrong-block' })).toEqual([
    expect.objectContaining({ path: ['blockId'] })
  ]);
  expect(() => service.patch({ ...args, blockId: 'DBLK-999', idempotencyKey: 'wrong-block' })).toThrow();
  expect(repository.snapshot()).toEqual(initial);
  expect(service.patch(args)).toEqual({
    documentId: 'DOC-001',
    documentVersion: 2,
    businessVersion: 2,
    status: 'draft'
  });
  expect(service.patch(args).documentVersion).toBe(2);
  expect(service.read({ actorId: 'EMP-003', documentId: 'DOC-001', version: null })).toMatchObject({
    documentVersion: 2,
    blocks: [
      expect.objectContaining({ id: 'DBLK-001', text: '办公指引' }),
      expect.objectContaining({ id: 'DBLK-002', text: '虚构流程修订内容。' })
    ]
  });
  expect(service.read({ actorId: 'EMP-003', documentId: 'DOC-001', version: 1 })).toMatchObject({
    documentVersion: 1,
    blocks: [
      expect.objectContaining({ id: 'DBLK-001', text: '办公指引' }),
      expect.objectContaining({ id: 'DBLK-002', text: '本指引用于规范部门日常办公和审批流程。' })
    ]
  });
  expect(service.validatePatch({ ...args, idempotencyKey: 'old-business-version' })).toContainEqual(
    expect.objectContaining({ path: ['expectedVersion'] })
  );
  expect(repository.snapshot().documentVersions.filter((item) => item.documentId === 'DOC-001')).toHaveLength(2);
});

it('binds approval and archive to the current exact version', () => {
  const repository = new DemoRepository();
  const service = new DocumentService(repository);
  const firstApproval = {
    actorId: 'EMP-004',
    documentId: 'DOC-001',
    documentVersion: 1,
    expectedVersion: 1,
    idempotencyKey: 'approve-v1'
  };
  expect(service.approve(firstApproval)).toEqual({
    documentId: 'DOC-001',
    documentVersion: 1,
    businessVersion: 2,
    status: 'approved'
  });
  expect(service.approve(firstApproval).businessVersion).toBe(2);
  expect(
    service.patch({
      actorId: 'EMP-003',
      documentId: 'DOC-001',
      expectedVersion: 2,
      blockId: 'DBLK-002',
      text: '未审阅的新内容。',
      idempotencyKey: 'patch-after-approval'
    })
  ).toEqual({ documentId: 'DOC-001', documentVersion: 2, businessVersion: 3, status: 'draft' });
  const invalidArchive = {
    actorId: 'EMP-004',
    documentId: 'DOC-001',
    documentVersion: 2,
    expectedVersion: 3,
    idempotencyKey: 'premature-archive'
  };
  expect(service.validateArchive(invalidArchive)).toContainEqual(expect.objectContaining({ path: ['documentId'] }));
  expect(service.validateArchive(invalidArchive)).toContainEqual(
    expect.objectContaining({ path: ['documentVersion'] })
  );
  const before = repository.snapshot();
  expect(() => service.archive(invalidArchive)).toThrow();
  expect(repository.snapshot()).toEqual(before);
  expect(
    service.validateApprove({ ...firstApproval, expectedVersion: 3, idempotencyKey: 'approve-old' })
  ).toContainEqual(expect.objectContaining({ path: ['documentVersion'] }));
  const secondApproval = {
    ...firstApproval,
    documentVersion: 2,
    expectedVersion: 3,
    idempotencyKey: 'approve-v2'
  };
  expect(service.approve(secondApproval)).toEqual({
    documentId: 'DOC-001',
    documentVersion: 2,
    businessVersion: 4,
    status: 'approved'
  });
  const archive = { ...invalidArchive, expectedVersion: 4, idempotencyKey: 'archive-v2' };
  expect(service.archive(archive)).toEqual({
    documentId: 'DOC-001',
    documentVersion: 2,
    businessVersion: 5,
    status: 'archived'
  });
  expect(service.archive(archive).businessVersion).toBe(5);
  expect(service.read({ actorId: 'EMP-003', documentId: 'DOC-001', version: 2 })).toMatchObject({
    approval: { documentVersion: 2, reviewerId: 'EMP-004' },
    archive: { documentVersion: 2, approvalId: 'OAPP-003' }
  });
  expect(service.read({ actorId: 'EMP-003', documentId: 'DOC-001', version: 1 })).toMatchObject({
    approval: { documentVersion: 1 },
    archive: null
  });
  expect(repository.snapshot().officeDocumentArchives).toHaveLength(1);
  expect(
    service.validatePatch({
      actorId: 'EMP-003',
      documentId: 'DOC-001',
      expectedVersion: 5,
      blockId: 'DBLK-002',
      text: '不能修改',
      idempotencyKey: 'patch-archived'
    })
  ).toContainEqual(expect.objectContaining({ path: ['documentId'] }));
});
