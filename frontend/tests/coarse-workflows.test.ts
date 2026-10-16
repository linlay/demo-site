import { expect, it } from 'vitest';
import { DemoRepository } from '../src/common/store/repository';
import { emptyDossier } from '../src/common/risk/dossier';
import { SuitabilityService } from '../src/pc/service/suitabilityService';
import { ResearchService } from '../src/pc/service/researchService';
import { IbProjectService } from '../src/pc/service/ibProjectService';
import { RiskAlertService } from '../src/pc/service/riskAlertService';
import { InstitutionService } from '../src/pc/service/institutionService';
import { NoticeService } from '../src/pc/service/noticeService';
import { CommunicationService } from '../src/pc/service/communicationService';
import { MeetingService } from '../src/pc/service/meetingService';
import { HrService } from '../src/pc/service/hrService';
import { ProcurementService } from '../src/pc/service/procurementService';
import { ContractService } from '../src/pc/service/contractService';
import { AdminService } from '../src/pc/service/adminService';
import { ProjectCollabService } from '../src/pc/service/projectCollabService';
import { ItService } from '../src/pc/service/itService';
import { ReportArchiveService } from '../src/pc/service/reportArchiveService';
import { DocumentService } from '../src/pc/service/documentService';

const one = 'EMP-001',
  two = 'EMP-002';
const repo = () => new DemoRepository({ workflowProfile: 'coarse-roles' });
const mutation = (actorId: string, expectedVersion: number, idempotencyKey: string) => ({
  actorId,
  expectedVersion,
  idempotencyKey
});

it('exposes six people with coarse duties, transfers operational ownership and preserves original audit actors across reload and reset', () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    }
  };
  const legacy = new DemoRepository({ storage });
  legacy.transact((state) => {
    state.riskAlerts[0].assigneeId = 'EMP-005';
    state.riskAlerts[0].status = 'investigating';
    state.riskAlerts[0].investigationDraft = {
      analysis: '已保存的调查内容',
      conclusion: '',
      proposedDisposition: '',
      evidenceIds: [],
      dossier: emptyDossier()
    };
  });
  const originalAudit = legacy.snapshot().auditEntries;
  const current = new DemoRepository({ storage, workflowProfile: 'coarse-roles' });
  expect(
    current
      .snapshot()
      .employees.filter((employee) => employee.active)
      .map((employee) => employee.id)
  ).toEqual(['EMP-001', 'EMP-002', 'EMP-003', 'EMP-004', 'EMP-005', 'EMP-006']);
  expect(current.snapshot().riskAlerts[0]).toMatchObject({
    assigneeId: one,
    investigationDraft: { analysis: '已保存的调查内容' }
  });
  expect(current.snapshot().auditEntries).toEqual(originalAudit);
  current.transact(() => undefined);
  expect(new DemoRepository({ storage, workflowProfile: 'coarse-roles' }).snapshot().workflowProfile).toBe(
    'coarse-roles'
  );
  current.resetSecuritiesExample('S04', 'RALT-003');
  expect(current.snapshot().riskAlerts.find((alert) => alert.id === 'RALT-003')?.assigneeId).toBe('EMP-005');
  expect(
    current
      .reset()
      .employees.filter((employee) => employee.active)
      .map((employee) => employee.id)
  ).toEqual(['EMP-001', 'EMP-002', 'EMP-003', 'EMP-004', 'EMP-005', 'EMP-006']);
});

const starts: Array<[string, (r: DemoRepository, actorId: string) => unknown]> = [
  [
    '通知',
    (r, actorId) =>
      new NoticeService(r).draft({
        actorId,
        title: '部门协作安排',
        body: '请按安排办理。',
        idempotencyKey: 'start-notice'
      })
  ],
  [
    '讨论',
    (r, actorId) =>
      new CommunicationService(r).createDiscussion({
        actorId,
        projectId: 'IBP-001',
        title: '项目进展',
        body: '请更新项目进展。',
        idempotencyKey: 'start-discussion'
      })
  ],
  [
    '会议',
    (r, actorId) =>
      new MeetingService(r).reserve({
        actorId,
        participantIds: [one],
        resourceId: 'ROOM-001',
        startAt: '2026-09-24T04:00:00Z',
        endAt: '2026-09-24T05:00:00Z',
        title: '项目讨论',
        idempotencyKey: 'start-meeting'
      })
  ],
  [
    '人事申请',
    (r, actorId) =>
      new HrService(r).submitLeave({
        actorId,
        employeeId: one,
        startDate: '2026-09-22',
        endDate: '2026-09-23',
        reason: '休假安排',
        idempotencyKey: 'start-leave'
      })
  ],
  [
    '采购',
    (r, actorId) =>
      new ProcurementService(r).create({
        actorId,
        itemName: '办公显示器',
        quantity: 1,
        idempotencyKey: 'start-purchase'
      })
  ],
  [
    '合同',
    (r, actorId) =>
      new ContractService(r).register({
        actorId,
        companyId: 'COMP-001',
        counterpartyName: '启辰服务有限公司',
        startDate: '2026-10-01',
        endDate: '2027-09-30',
        amountCents: 90000,
        materialIds: ['CTMAT-003'],
        idempotencyKey: 'start-contract'
      })
  ],
  [
    '行政预约',
    (r, actorId) =>
      new AdminService(r).reserve({
        actorId,
        resourceId: 'RES-001',
        participantIds: [one],
        driverId: null,
        startAt: '2026-09-24T04:00:00Z',
        endAt: '2026-09-24T05:00:00Z',
        idempotencyKey: 'start-admin'
      })
  ],
  [
    '协作项目',
    (r, actorId) =>
      new ProjectCollabService(r).createProject({
        actorId,
        title: '四季度项目',
        memberIds: [one],
        dueDate: '2026-10-15',
        idempotencyKey: 'start-project'
      })
  ],
  [
    '系统权限',
    (r, actorId) =>
      new ItService(r).request({
        actorId,
        systemId: 'SYS-001',
        permissionId: 'PERM-001',
        materialIds: ['ACMAT-001'],
        reason: '办公查询',
        idempotencyKey: 'start-access'
      })
  ],
  [
    '部门报表',
    (r, actorId) =>
      new ReportArchiveService(r, () => undefined).generate({
        actorId,
        departmentId: 'DEP-001',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        idempotencyKey: 'start-report'
      })
  ],
  [
    '研究课题',
    (r, actorId) =>
      new ResearchService(r).create({ actorId, topicTitle: '先进制造行业展望', idempotencyKey: 'start-research' })
  ],
  [
    '投行项目',
    (r, actorId) =>
      new IbProjectService(r).create({ actorId, issuerId: 'ISS-001', title: '公司债项目', idempotencyKey: 'start-ib' })
  ]
];
it.each(starts)('lets Lin Yue initiate %s and rejects Chen Ming without writing', (_name, start) => {
  const r = repo(),
    before = r.snapshot();
  expect(() => start(r, two)).toThrow('办理账户');
  expect(r.snapshot()).toEqual(before);
  expect(() => start(r, one)).not.toThrow();
});

it.each([two, 'EMP-004'])('allows reviewer %s to review clients, research and investment projects', (reviewer) => {
  const r = repo();
  const assignReview = (sourceId: string) =>
    r.transact((state) => {
      for (const todo of state.todos)
        if (todo.sourceId === sourceId && todo.status === 'open') todo.assigneeId = reviewer;
    });
  const client = new SuitabilityService(r);
  const c = { clientId: 'CLI-001', ...mutation(one, 1, 'client-evaluate') };
  client.evaluate(c);
  client.match({ ...c, idempotencyKey: 'client-match', productId: 'PRD-001' });
  client.submit({ ...c, idempotencyKey: 'client-submit' });
  r.transact((state) => {
    for (const review of state.clientReviews) if (review.status === 'pending') review.reviewerId = reviewer;
    for (const todo of state.todos)
      if (todo.sourceType === 'client' && todo.status === 'open') todo.assigneeId = reviewer;
  });
  expect(() =>
    client.decide({ clientId: 'CLI-001', ...mutation(one, 2, 'client-self'), decision: 'approve', reason: '' })
  ).toThrow('审核账户');
  expect(
    client.decide({ clientId: 'CLI-001', ...mutation(reviewer, 2, 'client-approve'), decision: 'approve', reason: '' })
      .status
  ).toBe('approved');
  const research = new ResearchService(r);
  research.check({ reportId: 'REPORT-001', ...mutation(one, 1, 'report-check') });
  research.submitReview({ reportId: 'REPORT-001', ...mutation(one, 1, 'report-submit') });
  assignReview('REPORT-001');
  expect(() =>
    research.review({ reportId: 'REPORT-001', ...mutation(one, 2, 'report-self'), decision: 'approve', reason: '' })
  ).toThrow('审核账户');
  research.review({
    reportId: 'REPORT-001',
    ...mutation(reviewer, 2, 'report-quality'),
    decision: 'approve',
    reason: ''
  });
  assignReview('REPORT-001');
  expect(
    research.review({
      reportId: 'REPORT-001',
      ...mutation(reviewer, 3, 'report-compliance'),
      decision: 'approve',
      reason: ''
    }).status
  ).toBe('approved');
  const ib = new IbProjectService(r);
  ib.qualitySubmit({ projectId: 'IBP-001', ...mutation(one, 1, 'ib-submit') });
  assignReview('IBP-001');
  expect(() =>
    ib.review({ projectId: 'IBP-001', ...mutation(one, 2, 'ib-self'), decision: 'approve', reason: '' })
  ).toThrow('审核账户');
  ib.review({ projectId: 'IBP-001', ...mutation(reviewer, 2, 'ib-quality'), decision: 'approve', reason: '' });
  assignReview('IBP-001');
  expect(
    ib.review({ projectId: 'IBP-001', ...mutation(reviewer, 3, 'ib-committee'), decision: 'approve', reason: '' })
      .status
  ).toBe('approved');
});

it.each([
  [one, two],
  ['EMP-003', 'EMP-004'],
  ['EMP-005', two]
])('lets operator %s fill risk forms directly with reviewer %s', (operator, reviewer) => {
  const r = repo(),
    risk = new RiskAlertService(r);
  expect(
    risk.saveDraft({
      alertId: 'RALT-001',
      ...mutation(operator, 1, 'direct-draft'),
      draft: { analysis: '核对中', conclusion: '', proposedDisposition: '', evidenceIds: [], dossier: emptyDossier() }
    }).status
  ).toBe('investigating');
  risk.record({
    alertId: 'RALT-001',
    ...mutation(operator, 2, 'risk-submit'),
    analysis: '已核对活动流水与身份材料。',
    conclusion: 'false-positive',
    proposedDisposition: 'close',
    evidenceIds: ['REVD-001', 'REVD-002']
  });
  expect(() =>
    risk.review({ alertId: 'RALT-001', ...mutation(operator, 3, 'risk-self'), decision: 'approve', reason: '同意' })
  ).toThrow('审核账户');
  risk.review({
    alertId: 'RALT-001',
    ...mutation(reviewer, 3, 'risk-review'),
    decision: 'approve',
    reason: '材料完整'
  });
  expect(risk.close({ alertId: 'RALT-001', ...mutation(operator, 4, 'risk-close'), resolution: 'close' }).status).toBe(
    'closed'
  );
});

it('lets the initiator complete every institutional service step without switching jobs', () => {
  const r = repo(),
    service = new InstitutionService(r);
  expect(service.validateQuery({ actorId: two, institutionId: 'INST-001' })).toEqual([]);
  service.reserve({
    needId: 'SNEED-001',
    ...mutation(one, 1, 'institution-reserve'),
    resourceId: 'ROOM-001',
    startAt: '2026-09-20T04:00:00Z',
    endAt: '2026-09-20T05:00:00Z'
  });
  service.createPackage({ needId: 'SNEED-001', ...mutation(one, 2, 'institution-package'), materialIds: ['SMAT-001'] });
  service.invite({ needId: 'SNEED-001', ...mutation(one, 3, 'institution-invite') });
  r.clock.advanceBy(30 * 3600000);
  service.recordMinutes({
    needId: 'SNEED-001',
    ...mutation(one, 4, 'institution-minutes'),
    agenda: '策略交流',
    decisions: ['后续补充资料']
  });
  expect(
    service.followup({
      needId: 'SNEED-001',
      ...mutation(one, 5, 'institution-followup'),
      note: '客户已收到资料',
      outcome: 'satisfied'
    }).status
  ).toBe('completed');
});

it.each([two, 'EMP-004'])('allows reviewer %s to review documents, suppliers and seals', (reviewer) => {
  const r = repo(),
    doc = new DocumentService(r);
  const patch = doc.patch({
    documentId: 'DOC-001',
    ...mutation(one, 1, 'document-patch'),
    blockId: 'DBLK-002',
    text: '更新后的办公流程'
  });
  r.transact((state) => {
    const document = state.officeDocuments.find((item) => item.id === 'DOC-001');
    if (!document) throw new Error('Missing document fixture');
    document.reviewerId = reviewer;
  });
  expect(() =>
    doc.approve({ documentId: 'DOC-001', documentVersion: patch.documentVersion, ...mutation(one, 2, 'document-self') })
  ).toThrow('审核账户');
  expect(
    doc.approve({
      documentId: 'DOC-001',
      documentVersion: patch.documentVersion,
      ...mutation(reviewer, 2, 'document-approve')
    }).status
  ).toBe('approved');
  const contract = new ContractService(r);
  const seal = contract.submit({
    actorId: one,
    contractId: 'CNTR-001',
    contractVersion: 1,
    purpose: '签署业务合同',
    materialIds: ['CTMAT-001'],
    idempotencyKey: 'seal-start'
  });
  expect(() =>
    contract.review({ sealId: seal.id, ...mutation(one, 1, 'seal-self'), decision: 'approved', note: '同意' })
  ).toThrow('审核账户');
  expect(
    contract.review({ sealId: seal.id, ...mutation(reviewer, 1, 'seal-review'), decision: 'approved', note: '同意' })
      .status
  ).toBe('approved');
  const procurement = new ProcurementService(r);
  expect(() =>
    procurement.review({
      supplierId: 'SUP-003',
      ...mutation(one, 1, 'supplier-self'),
      decision: 'approved',
      note: '材料齐全',
      proofIds: ['SPRF-005', 'SPRF-006']
    })
  ).toThrow('审核账户');
  expect(
    procurement.review({
      supplierId: 'SUP-003',
      ...mutation(reviewer, 1, 'supplier-review'),
      decision: 'approved',
      note: '材料齐全',
      proofIds: ['SPRF-005', 'SPRF-006']
    }).status
  ).toBe('approved');
});

it.each(['EMP-001', 'EMP-003', 'EMP-005'])('allows operator %s to initiate across business categories', (actorId) => {
  const r = repo();
  expect(() =>
    new NoticeService(r).draft({
      actorId,
      title: '季度工作安排',
      body: '请按计划推进各项工作。',
      idempotencyKey: 'notice-' + actorId
    })
  ).not.toThrow();
  expect(() =>
    new ResearchService(r).create({ actorId, topicTitle: '先进制造行业跟踪', idempotencyKey: 'research-' + actorId })
  ).not.toThrow();
  expect(() =>
    new IbProjectService(r).create({
      actorId,
      issuerId: 'ISS-001',
      title: '公司债融资方案',
      idempotencyKey: 'ib-' + actorId
    })
  ).not.toThrow();
});
