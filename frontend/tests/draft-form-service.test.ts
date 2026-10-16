import { expect, it } from 'vitest';

import { DemoRepository } from '../src/common/store/repository';
import { DraftFormService, type DraftFormInput } from '../src/pc/service/draftFormService';

function initialInput(repository: DemoRepository): DraftFormInput {
  const view = new DraftFormService(repository).read('FORM-002');
  return {
    formId: view.form.id,
    actorId: view.form.applicantId,
    applicantId: view.form.applicantId,
    departmentId: view.form.departmentId,
    amountCents: view.form.amountCents,
    assetIds: view.assetIds,
    expectedVersion: view.form.businessVersion
  };
}

it('projects only public table fields and exposes valid IDs through the form and tree', () => {
  const service = new DraftFormService(new DemoRepository());
  const rows = service.listRows();
  const view = service.read('FORM-002');
  expect(rows.find((row) => row.id === 'FORM-002')).toEqual({
    id: 'FORM-002',
    kind: 'travel',
    status: 'draft',
    applicant: '林悦',
    department: '客户服务部',
    amountCents: view.form.amountCents,
    businessVersion: 1
  });
  expect(rows.some((row) => 'applicantId' in row || 'createdAt' in row)).toBe(false);
  expect(view.availableAssets.map((item) => item.assetId)).toEqual(['AST-002']);
  expect(service.organizationTree()[0].children?.map((item) => item.id)).toEqual(['EMP-001', 'EMP-002']);
});

it('saves a draft and controlled asset IDs atomically, rejecting stale or unauthorized writes', () => {
  const repository = new DemoRepository();
  const service = new DraftFormService(repository);
  const input = initialInput(repository);
  const next = { ...input, amountCents: input.amountCents + 100, assetIds: ['AST-002'] };

  expect(service.validate(next)).toEqual([]);
  expect(service.save(next)).toEqual({ formId: 'FORM-002', businessVersion: 2, assetIds: ['AST-002'] });
  expect(service.read('FORM-002').assetIds).toEqual(['AST-002']);
  const saved = repository.snapshot();
  expect(saved.forms.find((item) => item.id === 'FORM-002')?.amountCents).toBe(next.amountCents);
  expect(saved.attachments.find((item) => item.assetId === 'AST-002')?.ownerId).toBe('FORM-002');
  expect(saved.auditEntries).toEqual([
    expect.objectContaining({ entityId: 'FORM-002', action: 'save-draft', actorId: 'EMP-001', businessVersion: 2 })
  ]);

  expect(() => service.save(next)).toThrow('版本已变化');
  expect(() => service.save({ ...next, expectedVersion: 2, actorId: 'EMP-002' })).toThrow('只有当前申请人');
  expect(() => service.save({ ...next, expectedVersion: 2, assetIds: ['AST-001'] })).toThrow('已属于其他单据');
  expect(repository.snapshot()).toEqual(saved);

  expect(service.save({ ...next, expectedVersion: 2, assetIds: [] }).businessVersion).toBe(3);
  expect(repository.snapshot().attachments.find((item) => item.assetId === 'AST-002')?.ownerId).toBe('');
});
