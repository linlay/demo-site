import { expect, it } from 'vitest';

import { DemoRepository } from '../src/common/store/repository';
import { RiskAlertService } from '../src/pc/service/riskAlertService';

it('lets investigators claim unassigned alerts for themselves with real audit, idempotency and independent review', () => {
  const repository = new DemoRepository();
  repository.transact((state) => {
    state.employees.find((employee) => employee.id === 'EMP-003')?.roles.push('risk-investigator');
    state.employees.find((employee) => employee.id === 'EMP-005')?.roles.push('risk-reviewer');
  });
  const service = new RiskAlertService(repository);
  const claim = {
    actorId: 'EMP-005',
    alertId: 'RALT-001',
    assigneeId: 'EMP-005',
    expectedVersion: 1,
    idempotencyKey: 'claim-self'
  };
  const before = repository.snapshot();
  expect(() => service.assign({ ...claim, assigneeId: 'EMP-003', idempotencyKey: 'claim-another' })).toThrow(
    '只能领取本人'
  );
  expect(() =>
    service.assign({ ...claim, actorId: 'EMP-001', assigneeId: 'EMP-001', idempotencyKey: 'claim-wrong-role' })
  ).toThrow();
  expect(() => service.assign({ ...claim, expectedVersion: 0, idempotencyKey: 'claim-old-version' })).toThrow(
    '版本应为'
  );
  expect(repository.snapshot()).toEqual(before);
  expect(service.assign(claim)).toMatchObject({ status: 'investigating', businessVersion: 2 });
  expect(service.assign(claim)).toMatchObject({ status: 'investigating', businessVersion: 2 });
  const audit = repository.snapshot().auditEntries.filter((entry) => entry.entityId === 'RALT-001');
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    actorId: 'EMP-005',
    action: 'alert.assign',
    fromStatus: 'new',
    toStatus: 'investigating'
  });
  expect(repository.snapshot().riskAlerts.find((alert) => alert.id === 'RALT-001')?.assigneeId).toBe('EMP-005');
  expect(() =>
    service.assign({
      ...claim,
      actorId: 'EMP-003',
      assigneeId: 'EMP-003',
      expectedVersion: 2,
      idempotencyKey: 'claim-taken'
    })
  ).toThrow();
  service.record({
    actorId: 'EMP-005',
    alertId: 'RALT-001',
    expectedVersion: 2,
    idempotencyKey: 'claim-record',
    evidenceIds: ['REVD-001', 'REVD-002'],
    analysis: '已核对活动流水和身份材料。',
    conclusion: 'false-positive',
    proposedDisposition: 'close'
  });
  expect(() =>
    service.review({
      actorId: 'EMP-005',
      alertId: 'RALT-001',
      expectedVersion: 3,
      idempotencyKey: 'claim-self-review',
      decision: 'approve',
      reason: '同意'
    })
  ).toThrow('不能复核自己的结论');
  expect(
    service.review({
      actorId: 'EMP-004',
      alertId: 'RALT-001',
      expectedVersion: 3,
      idempotencyKey: 'claim-independent-review',
      decision: 'approve',
      reason: '材料齐全。'
    })
  ).toMatchObject({ status: 'approved', businessVersion: 4 });
});

it('links monitored indicator, complete evidence, investigation, independent review and close history', () => {
  const repository = new DemoRepository();
  const service = new RiskAlertService(repository);
  const before = repository.snapshot();
  const assign = {
    actorId: 'EMP-006',
    alertId: 'RALT-001',
    assigneeId: 'EMP-005',
    expectedVersion: 1,
    idempotencyKey: 'risk-assign'
  };
  expect(service.validateAssign({ ...assign, assigneeId: 'EMP-001' })).not.toHaveLength(0);
  expect(repository.snapshot()).toEqual(before);
  expect(service.assign(assign)).toMatchObject({ status: 'investigating', businessVersion: 2 });
  expect(service.assign(assign)).toMatchObject({ status: 'investigating', businessVersion: 2 });
  expect(service.validateAssign({ ...assign, expectedVersion: 2, idempotencyKey: 'stale-assign' })).not.toHaveLength(0);
  const record = {
    actorId: 'EMP-005',
    alertId: 'RALT-001',
    evidenceIds: ['REVD-001', 'REVD-002'],
    analysis: '已核对虚构日志与身份来源。',
    conclusion: 'false-positive' as const,
    proposedDisposition: 'close' as const,
    expectedVersion: 2,
    idempotencyKey: 'risk-record'
  };
  expect(service.record(record)).toMatchObject({ status: 'pending-review', businessVersion: 3 });
  expect(
    service.validateReview({
      actorId: 'EMP-005',
      alertId: 'RALT-001',
      decision: 'approve',
      reason: '同意',
      expectedVersion: 3,
      idempotencyKey: 'self-review'
    })
  ).not.toHaveLength(0);
  expect(
    service.review({
      actorId: 'EMP-004',
      alertId: 'RALT-001',
      decision: 'approve',
      reason: '证据齐全。',
      expectedVersion: 3,
      idempotencyKey: 'risk-review'
    })
  ).toMatchObject({ status: 'approved', businessVersion: 4 });
  expect(
    service.validateClose({
      actorId: 'EMP-006',
      alertId: 'RALT-001',
      resolution: 'escalate',
      expectedVersion: 4,
      idempotencyKey: 'wrong-disposition'
    })
  ).not.toHaveLength(0);
  expect(
    service.close({
      actorId: 'EMP-006',
      alertId: 'RALT-001',
      resolution: 'close',
      expectedVersion: 4,
      idempotencyKey: 'risk-close'
    })
  ).toMatchObject({ status: 'closed', businessVersion: 5 });
  expect(service.read({ actorId: 'EMP-006', alertId: 'RALT-001' })).toMatchObject({
    rule: { id: 'RRULE-001', version: 1, threshold: 3 },
    investigations: [expect.objectContaining({ evidenceIds: ['REVD-001', 'REVD-002'] })],
    reviews: [expect.objectContaining({ decision: 'approve' })],
    history: [expect.anything(), expect.anything(), expect.anything(), expect.anything()]
  });
  expect(repository.snapshot().riskOperationRecords).toHaveLength(4);
});

it('blocks incomplete evidence, preserves a returned review and supports supplemented investigation', () => {
  const repository = new DemoRepository();
  const service = new RiskAlertService(repository);
  expect(
    service.assign({
      actorId: 'EMP-006',
      alertId: 'RALT-002',
      assigneeId: 'EMP-005',
      expectedVersion: 1,
      idempotencyKey: 'blocked-assign'
    })
  ).toMatchObject({ status: 'investigating', businessVersion: 2 });
  expect(
    service.record({
      actorId: 'EMP-005',
      alertId: 'RALT-002',
      evidenceIds: ['REVD-003'],
      analysis: '初次记录缺少复核说明。',
      conclusion: 'confirmed',
      proposedDisposition: 'escalate',
      expectedVersion: 2,
      idempotencyKey: 'blocked-record'
    })
  ).toMatchObject({ status: 'pending-review', businessVersion: 3 });
  const before = repository.snapshot();
  expect(
    service
      .validateReview({
        actorId: 'EMP-004',
        alertId: 'RALT-002',
        decision: 'approve',
        reason: '同意',
        expectedVersion: 3,
        idempotencyKey: 'blocked-review'
      })
      .flatMap((item) => item.messages)
      .join('')
  ).toContain('review-note');
  expect(
    service.validateClose({
      actorId: 'EMP-006',
      alertId: 'RALT-002',
      resolution: 'escalate',
      expectedVersion: 3,
      idempotencyKey: 'blocked-close'
    })
  ).not.toHaveLength(0);
  expect(repository.snapshot()).toEqual(before);
  expect(
    service.review({
      actorId: 'EMP-004',
      alertId: 'RALT-002',
      decision: 'return',
      reason: '补充复核说明。',
      expectedVersion: 3,
      idempotencyKey: 'return-review'
    })
  ).toMatchObject({ status: 'returned', businessVersion: 4 });
  expect(
    service.attach({
      actorId: 'EMP-005',
      alertId: 'RALT-002',
      evidenceId: 'REVD-004',
      expectedVersion: 4,
      idempotencyKey: 'attach-note'
    })
  ).toMatchObject({ status: 'returned', businessVersion: 5 });
  expect(
    service.record({
      actorId: 'EMP-005',
      alertId: 'RALT-002',
      evidenceIds: ['REVD-003', 'REVD-004'],
      analysis: '已补充复核说明，确认需要演示升级。',
      conclusion: 'confirmed',
      proposedDisposition: 'escalate',
      expectedVersion: 5,
      idempotencyKey: 'recovered-record'
    })
  ).toMatchObject({ status: 'pending-review', businessVersion: 6 });
  expect(
    service.review({
      actorId: 'EMP-004',
      alertId: 'RALT-002',
      decision: 'approve',
      reason: '证据齐全。',
      expectedVersion: 6,
      idempotencyKey: 'recovered-review'
    })
  ).toMatchObject({ status: 'approved', businessVersion: 7 });
  expect(
    service.close({
      actorId: 'EMP-006',
      alertId: 'RALT-002',
      resolution: 'escalate',
      expectedVersion: 7,
      idempotencyKey: 'recovered-close'
    })
  ).toMatchObject({ status: 'escalated', businessVersion: 8 });
  expect(repository.snapshot().riskInvestigations.filter((item) => item.alertId === 'RALT-002')).toHaveLength(2);
  expect(
    repository
      .snapshot()
      .riskReviews.filter((item) => item.alertId === 'RALT-002')
      .map((item) => item.decision)
  ).toEqual(['return', 'approve']);
});

it('replays fixed returned and approved examples and rejects stale concurrent versions', () => {
  const service = new RiskAlertService(new DemoRepository());
  expect(service.query({ actorId: 'EMP-006', status: 'all', ruleId: null, page: 1, pageSize: 2 })).toMatchObject({
    totalCount: 5,
    alerts: [expect.anything(), expect.anything()]
  });
  expect(
    service.validateQuery({ actorId: 'EMP-001', status: 'all', ruleId: null, page: 1, pageSize: 2 })
  ).not.toHaveLength(0);
  expect(
    service.record({
      actorId: 'EMP-005',
      alertId: 'RALT-003',
      evidenceIds: ['REVD-005', 'REVD-006'],
      analysis: '已补充具体核对说明。',
      conclusion: 'false-positive',
      proposedDisposition: 'close',
      expectedVersion: 4,
      idempotencyKey: 'returned-record'
    })
  ).toMatchObject({ status: 'pending-review', businessVersion: 5 });
  expect(service.read({ actorId: 'EMP-004', alertId: 'RALT-003' })).toMatchObject({
    reviews: [expect.objectContaining({ decision: 'return' })],
    investigations: [expect.anything(), expect.anything()]
  });
  expect(
    service
      .validateRecord({
        actorId: 'EMP-005',
        alertId: 'RALT-003',
        evidenceIds: ['REVD-005'],
        analysis: '旧版本覆盖',
        conclusion: 'false-positive',
        proposedDisposition: 'close',
        expectedVersion: 4,
        idempotencyKey: 'stale-record'
      })
      .flatMap((item) => item.messages)
      .join('')
  ).toContain('版本应为 5');
  expect(
    service.close({
      actorId: 'EMP-006',
      alertId: 'RALT-004',
      resolution: 'escalate',
      expectedVersion: 4,
      idempotencyKey: 'seed-escalate'
    })
  ).toMatchObject({ status: 'escalated', businessVersion: 5 });
});
