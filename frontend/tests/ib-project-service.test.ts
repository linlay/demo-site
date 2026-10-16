import { expect, it } from 'vitest';

import { DemoRepository } from '../src/common/store/repository';
import { IbProjectService, type IbMutationInput, type IbReviewInput } from '../src/pc/service/ibProjectService';

function mutation(
  projectId: string,
  expectedVersion: number,
  idempotencyKey: string,
  actorId = 'EMP-008'
): IbMutationInput {
  return { projectId, actorId, expectedVersion, idempotencyKey };
}

function review(
  projectId: string,
  expectedVersion: number,
  idempotencyKey: string,
  actorId: string,
  decision: 'approve' | 'return',
  reason = ''
): IbReviewInput {
  return { ...mutation(projectId, expectedVersion, idempotencyKey, actorId), decision, reason };
}

it('moves a complete fixed project through quality, committee and archive once', () => {
  const repository = new DemoRepository();
  const service = new IbProjectService(repository);
  const submit = mutation('IBP-001', 1, 's03-quality-normal');
  expect(service.qualitySubmit(submit)).toMatchObject({
    status: 'quality-review',
    businessVersion: 2,
    submissionId: 'IBSUB-001',
    policyVersion: 1
  });
  expect(service.qualitySubmit(submit).submissionId).toBe('IBSUB-001');
  expect(service.review(review('IBP-001', 2, 's03-quality-approve', 'EMP-010', 'approve'))).toMatchObject({
    status: 'committee-review',
    businessVersion: 3
  });
  expect(service.review(review('IBP-001', 3, 's03-committee-approve', 'EMP-004', 'approve'))).toMatchObject({
    status: 'approved',
    businessVersion: 4
  });
  expect(service.archive(mutation('IBP-001', 4, 's03-archive'))).toMatchObject({
    status: 'archived',
    businessVersion: 5
  });
  expect(service.qualitySubmit(submit).businessVersion).toBe(2);
  expect(repository.snapshot().ibQualitySubmissions).toHaveLength(1);
  expect(
    repository
      .snapshot()
      .todos.filter((item) => item.sourceId === 'IBP-001')
      .map((item) => item.status)
  ).toEqual(['done', 'done']);
  expect(service.read({ projectId: 'IBP-001', actorId: 'EMP-008' })).toMatchObject({
    status: 'archived',
    submissions: [
      {
        policyVersion: 1,
        workpaperVersions: [
          { kind: 'financial', version: 1 },
          { kind: 'legal', version: 1 }
        ]
      }
    ],
    reviews: [
      { stage: 'quality', decision: 'approve' },
      { stage: 'committee', decision: 'approve' }
    ]
  });
});

it('lists missing workpapers and blocking findings, then advances after correction', () => {
  const repository = new DemoRepository();
  const service = new IbProjectService(repository);
  const initial = repository.snapshot();
  expect(service.validateQualitySubmit(mutation('IBP-002', 1, 's03-blocked')).map((item) => item.path)).toEqual(
    expect.arrayContaining([['workpapers'], ['findings']])
  );
  expect(() => service.qualitySubmit(mutation('IBP-002', 1, 's03-blocked'))).toThrow('缺少底稿');
  expect(repository.snapshot()).toEqual(initial);
  expect(
    service.assign({ ...mutation('IBP-002', 1, 's03-assign-legal'), kind: 'legal', memberId: 'EMP-009' })
  ).toMatchObject({ status: 'diligence', businessVersion: 2, kind: 'legal' });
  expect(
    service.attach({
      ...mutation('IBP-002', 2, 's03-attach-legal', 'EMP-009'),
      kind: 'legal',
      assetId: 'IBAST-004',
      summary: '补交虚构法律底稿'
    })
  ).toMatchObject({ businessVersion: 3, workpaperVersion: 1 });
  expect(
    service.resolve({
      ...mutation('IBP-002', 3, 's03-resolve-blocked'),
      findingId: 'IBFIND-001',
      resolution: '法律底稿已补交并核对。'
    })
  ).toMatchObject({ businessVersion: 4, findingStatus: 'resolved' });
  expect(service.qualitySubmit(mutation('IBP-002', 4, 's03-quality-after-fix')).status).toBe('quality-review');
  expect(repository.snapshot().ibFindings.find((item) => item.id === 'IBFIND-001')?.resolution).toBe(
    '法律底稿已补交并核对。'
  );
});

it('preserves workpaper and finding history across return, replacement and resubmission', () => {
  const repository = new DemoRepository();
  const service = new IbProjectService(repository);
  service.qualitySubmit(mutation('IBP-003', 1, 's03-return-submit'));
  expect(service.review(review('IBP-003', 2, 's03-return', 'EMP-010', 'return', '请更新财务底稿'))).toMatchObject({
    status: 'returned',
    businessVersion: 3
  });
  expect(service.read({ projectId: 'IBP-003', actorId: 'EMP-008' }).findings).toEqual(
    expect.arrayContaining([expect.objectContaining({ status: 'open', description: '质控退回：请更新财务底稿' })])
  );
  expect(
    service.attach({
      ...mutation('IBP-003', 3, 's03-attach-revision', 'EMP-009'),
      kind: 'financial',
      assetId: 'IBAST-007',
      summary: '补充虚构财务核对'
    })
  ).toMatchObject({ status: 'diligence', businessVersion: 4, workpaperVersion: 2 });
  const afterAttach = repository.snapshot();
  expect(() => service.qualitySubmit(mutation('IBP-003', 4, 's03-too-early'))).toThrow('阻断问题未整改');
  expect(repository.snapshot()).toEqual(afterAttach);
  const findingId = repository.snapshot().ibFindings.find((item) => item.projectId === 'IBP-003')?.id;
  if (!findingId) throw new Error('Returned finding is missing.');
  service.resolve({ ...mutation('IBP-003', 4, 's03-resolve-return'), findingId, resolution: '新版财务底稿已核对。' });
  expect(service.qualitySubmit(mutation('IBP-003', 5, 's03-resubmit')).businessVersion).toBe(6);
  service.review(review('IBP-003', 6, 's03-quality-again', 'EMP-010', 'approve'));
  service.review(review('IBP-003', 7, 's03-committee-again', 'EMP-004', 'approve'));
  expect(service.archive(mutation('IBP-003', 8, 's03-archive-after-return')).status).toBe('archived');
  const state = repository.snapshot();
  expect(
    state.ibWorkpapers
      .filter((item) => item.projectId === 'IBP-003' && item.kind === 'financial')
      .map((item) => item.version)
  ).toEqual([1, 2]);
  expect(
    state.ibQualitySubmissions.filter((item) => item.projectId === 'IBP-003').map((item) => item.workpaperVersions)
  ).toEqual([
    [
      { kind: 'financial', version: 1 },
      { kind: 'legal', version: 1 }
    ],
    [
      { kind: 'financial', version: 2 },
      { kind: 'legal', version: 1 }
    ]
  ]);
  expect(state.ibReviews.filter((item) => item.projectId === 'IBP-003').map((item) => item.decision)).toEqual([
    'return',
    'approve',
    'approve'
  ]);
  expect(state.ibFindings.find((item) => item.id === findingId)?.status).toBe('resolved');
});

it('creates an issuer project and enforces roles, versions and rule changes', () => {
  const repository = new DemoRepository();
  const service = new IbProjectService(repository);
  const create = { issuerId: 'ISS-001', title: '新建虚构投行项目', actorId: 'EMP-008', idempotencyKey: 's03-create' };
  expect(service.create(create)).toMatchObject({ projectId: 'IBP-004', status: 'draft', businessVersion: 1 });
  expect(service.create(create).projectId).toBe('IBP-004');
  expect(service.assets('IBP-004').map((item) => item.assetId)).toEqual(['IBAST-008', 'IBAST-009']);
  service.submit(mutation('IBP-004', 1, 's03-initiate'));
  service.assign({ ...mutation('IBP-004', 2, 's03-assign-financial'), kind: 'financial', memberId: 'EMP-009' });
  service.assign({ ...mutation('IBP-004', 3, 's03-assign-legal'), kind: 'legal', memberId: 'EMP-009' });
  const assigned = repository.snapshot();
  expect(() =>
    service.attach({
      ...mutation('IBP-004', 4, 's03-wrong-role', 'EMP-008'),
      kind: 'financial',
      assetId: 'IBAST-008',
      summary: '无权底稿'
    })
  ).toThrow('只有该底稿');
  expect(() =>
    service.attach({
      ...mutation('IBP-004', 3, 's03-stale', 'EMP-009'),
      kind: 'financial',
      assetId: 'IBAST-008',
      summary: '旧版底稿'
    })
  ).toThrow('业务版本已变化');
  expect(repository.snapshot()).toEqual(assigned);
  service.attach({
    ...mutation('IBP-004', 4, 's03-attach-financial', 'EMP-009'),
    kind: 'financial',
    assetId: 'IBAST-008',
    summary: '虚构财务底稿'
  });
  service.attach({
    ...mutation('IBP-004', 5, 's03-attach-legal', 'EMP-009'),
    kind: 'legal',
    assetId: 'IBAST-009',
    summary: '虚构法律底稿'
  });
  repository.transact((state) => {
    state.ibPolicy.version = 2;
  });
  expect(service.qualitySubmit(mutation('IBP-004', 6, 's03-submit-policy-v2')).policyVersion).toBe(2);
  repository.transact((state) => {
    state.ibPolicy.version = 3;
  });
  expect(() => service.review(review('IBP-004', 7, 's03-outdated-policy', 'EMP-010', 'approve'))).toThrow(
    '规则版本已变化'
  );
  expect(service.review(review('IBP-004', 7, 's03-return-policy', 'EMP-010', 'return', '请按新规则复核')).status).toBe(
    'returned'
  );
  expect(
    service
      .assets('IBP-004')
      .filter((item) => !item.used)
      .map((item) => item.assetId)
  ).toEqual(['IBAST-010', 'IBAST-011']);
  service.attach({
    ...mutation('IBP-004', 8, 's03-new-project-revision', 'EMP-009'),
    kind: 'financial',
    assetId: 'IBAST-010',
    summary: '按新规则补正'
  });
  const finding = repository
    .snapshot()
    .ibFindings.find((item) => item.projectId === 'IBP-004' && item.status === 'open');
  if (!finding) throw new Error('New project return finding is missing.');
  service.resolve({
    ...mutation('IBP-004', 9, 's03-new-project-resolve'),
    findingId: finding.id,
    resolution: '已复核'
  });
  expect(service.qualitySubmit(mutation('IBP-004', 10, 's03-new-project-resubmit')).policyVersion).toBe(3);
});
