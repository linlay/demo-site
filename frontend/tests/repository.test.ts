import { expect, it } from 'vitest';

import { DemoClock } from '../src/common/fixtures/clock';
import { createSeedState, DEFAULT_DEMO_SEED } from '../src/common/fixtures/seed';
import { DEMO_STORAGE_KEY, DemoRepository, type DemoStorage } from '../src/common/store/repository';

class MemoryStorage implements DemoStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

it('replays the same fictional graph from the same seed and clock', () => {
  const first = createSeedState(DEFAULT_DEMO_SEED, new DemoClock());
  const second = createSeedState(DEFAULT_DEMO_SEED, new DemoClock());
  const otherSeed = createSeedState(DEFAULT_DEMO_SEED + 1, new DemoClock());

  expect(first).toEqual(second);
  expect(first.forms[0].amountCents).not.toBe(otherSeed.forms[0].amountCents);
  expect(first.company.name).toBe('星澜证券');
  expect(first.employees.filter((employee) => employee.active)).toHaveLength(10);

  const employeeIds = new Set(first.employees.map((employee) => employee.id));
  const departmentIds = new Set(first.departments.map((department) => department.id));
  expect(first.employees.every((employee) => departmentIds.has(employee.departmentId))).toBe(true);
  expect(first.clients.every((client) => employeeIds.has(client.managerId))).toBe(true);
  expect(first.forms.every((form) => employeeIds.has(form.applicantId) && departmentIds.has(form.departmentId))).toBe(
    true
  );
  expect(first.attachments[0].ownerId).toBe(first.forms[0].id);
  expect(first.todos[0].sourceId).toBe(first.forms[0].id);
  expect(first.todos[0].assigneeId).toBe('EMP-002');
  expect(
    first.officeApprovalRequests.every(
      (request) =>
        request.materialIds.every((id) => first.officeApprovalMaterials.some((material) => material.id === id)) &&
        first.employees.some((employee) => employee.id === request.reviewerId)
    )
  ).toBe(true);
  expect(
    first.officeApprovalRequests
      .filter((request) => request.currentTaskId !== null)
      .every((request) =>
        first.todos.some(
          (todo) => todo.id === request.currentTaskId && todo.sourceId === request.id && todo.status === 'open'
        )
      )
  ).toBe(true);
});

it('keeps transactions atomic, persists only its key, and resets without touching other data', () => {
  const storage = new MemoryStorage();
  storage.setItem('other-app:session', 'keep');
  const clock = new DemoClock();
  const repository = new DemoRepository({ clock, storage });
  const initial = repository.snapshot();
  let notifications = 0;
  const unsubscribe = repository.subscribe(() => {
    notifications += 1;
  });

  expect(() =>
    repository.transact((draft) => {
      draft.todos[0].status = 'done';
      throw new Error('invalid operation');
    })
  ).toThrow('invalid operation');
  expect(repository.snapshot()).toEqual(initial);
  expect(storage.getItem(DEMO_STORAGE_KEY)).toBeNull();

  expect(() => repository.transact(async () => 'later')).toThrow('must be synchronous');
  expect(repository.snapshot()).toEqual(initial);

  repository.transact((draft) => {
    draft.todos[0].status = 'done';
  });
  expect(notifications).toBe(1);
  expect(new DemoRepository({ storage }).snapshot().todos[0].status).toBe('done');

  const leakedCopy = repository.snapshot();
  leakedCopy.employees[0].name = '外部修改';
  expect(repository.snapshot().employees[0].name).toBe(initial.employees[0].name);

  clock.advanceBy(60_000);
  expect(clock.now()).not.toBe(initial.forms[0].createdAt);
  expect(repository.reset()).toEqual(initial);
  expect(storage.getItem(DEMO_STORAGE_KEY)).toBeNull();
  expect(storage.getItem('other-app:session')).toBe('keep');
  expect(notifications).toBe(2);
  unsubscribe();
});

it('adds B06 seed records to earlier demo storage without changing existing records', () => {
  const storage = new MemoryStorage();
  const old = createSeedState();
  old.forms = old.forms.filter((item) => item.id !== 'FORM-002');
  old.attachments = old.attachments.filter((item) => item.assetId !== 'AST-002');
  old.forms[0].amountCents = 4321;
  storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(old));

  const loaded = new DemoRepository({ storage }).snapshot();
  expect(loaded.forms.find((item) => item.id === 'FORM-001')?.amountCents).toBe(4321);
  expect(loaded.forms.find((item) => item.id === 'FORM-002')?.status).toBe('draft');
  expect(loaded.attachments.find((item) => item.assetId === 'AST-002')?.ownerId).toBe('');
  expect(JSON.parse(storage.getItem(DEMO_STORAGE_KEY) ?? '{}')).toEqual(old);
});

it('adds S01 cases to schema 4 storage without overwriting prior customer data', () => {
  const storage = new MemoryStorage();
  const old = createSeedState();
  old.clients = old.clients.filter((item) => item.id !== 'CLI-003');
  old.clients[0].name = '用户保留的虚构客户名称';
  const legacy = JSON.parse(JSON.stringify(old)) as Record<string, unknown>;
  legacy.schemaVersion = 4;
  for (const key of [
    'suitabilityPolicy',
    'clientCases',
    'suitabilityAssessments',
    'suitabilityMatches',
    'clientReviews'
  ]) {
    delete legacy[key];
  }
  const raw = JSON.stringify(legacy);
  storage.setItem(DEMO_STORAGE_KEY, raw);
  const loaded = new DemoRepository({ storage }).snapshot();
  expect(loaded.schemaVersion).toBe(24);
  expect(loaded.clients.find((item) => item.id === 'CLI-001')?.name).toBe('用户保留的虚构客户名称');
  expect(loaded.clients.some((item) => item.id === 'CLI-003')).toBe(true);
  expect(loaded.clientCases).toHaveLength(3);
  expect(loaded.suitabilityPolicy.version).toBe(1);
  expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(raw);
});

it('adds S02 research data to schema 5 storage without replacing client progress', () => {
  const storage = new MemoryStorage();
  const previous = createSeedState();
  previous.employees = previous.employees.filter((item) => Number(item.id.slice(4)) < 5);
  previous.clientCases[0].businessVersion = 7;
  const legacy = JSON.parse(JSON.stringify(previous)) as Record<string, unknown>;
  legacy.schemaVersion = 5;
  for (const key of [
    'researchPolicy',
    'researchTopics',
    'researchReports',
    'researchDocumentVersions',
    'researchChecks',
    'researchReviews',
    'researchPublications'
  ])
    delete legacy[key];
  const raw = JSON.stringify(legacy);
  storage.setItem(DEMO_STORAGE_KEY, raw);
  const loaded = new DemoRepository({ storage }).snapshot();
  expect(loaded.schemaVersion).toBe(24);
  expect(loaded.clientCases.find((item) => item.clientId === 'CLI-001')?.businessVersion).toBe(7);
  expect(loaded.researchReports).toHaveLength(3);
  expect(loaded.researchDocumentVersions).toHaveLength(3);
  expect(loaded.employees.some((item) => item.id === 'EMP-007' && item.roles.includes('publisher'))).toBe(true);
  expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(raw);
});

it('adds S03 project records to schema 6 storage while preserving existing research progress', () => {
  const storage = new MemoryStorage();
  const previous = createSeedState();
  previous.researchReports[0].businessVersion = 9;
  previous.attachments = previous.attachments.filter((item) => Number(item.assetId.slice(4)) < 5);
  previous.attachments.push({
    assetId: 'AST-005',
    filename: '用户既有演示附件.txt',
    mimeType: 'text/plain',
    sizeBytes: 12,
    ownerId: 'FORM-001'
  });
  const legacy = JSON.parse(JSON.stringify(previous)) as Record<string, unknown>;
  legacy.schemaVersion = 6;
  for (const key of [
    'ibPolicy',
    'ibIssuers',
    'ibProjects',
    'ibAssignments',
    'ibWorkpapers',
    'ibFindings',
    'ibQualitySubmissions',
    'ibReviews'
  ])
    delete legacy[key];
  const raw = JSON.stringify(legacy);
  storage.setItem(DEMO_STORAGE_KEY, raw);
  const loaded = new DemoRepository({ storage }).snapshot();
  expect(loaded.schemaVersion).toBe(24);
  expect(loaded.researchReports[0].businessVersion).toBe(9);
  expect(loaded.ibProjects).toHaveLength(3);
  expect(loaded.ibWorkpapers).toHaveLength(5);
  expect(loaded.attachments.some((item) => item.assetId === 'IBAST-007')).toBe(true);
  expect(loaded.attachments.find((item) => item.assetId === 'AST-005')?.filename).toBe('用户既有演示附件.txt');
  expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(raw);
});

it('adds O01 dated todos to schema 7 storage without replacing existing workflow todos', () => {
  const storage = new MemoryStorage();
  const previous = createSeedState();
  previous.todos = [
    { ...previous.todos[0], dueAt: '2026-09-25T00:00:00.000Z' },
    {
      id: 'TODO-002',
      title: '用户既有待办',
      assigneeId: 'EMP-002',
      sourceType: 'form',
      sourceId: 'FORM-001',
      dueAt: '2026-09-21T00:00:00.000Z',
      status: 'open'
    }
  ];
  const legacy = JSON.parse(JSON.stringify(previous)) as Record<string, unknown>;
  legacy.schemaVersion = 7;
  const raw = JSON.stringify(legacy);
  storage.setItem(DEMO_STORAGE_KEY, raw);
  const loaded = new DemoRepository({ storage }).snapshot();
  expect(loaded.schemaVersion).toBe(24);
  expect(loaded.todos.find((item) => item.id === 'TODO-001')?.dueAt).toBe('2026-09-25T00:00:00.000Z');
  expect(loaded.todos.find((item) => item.id === 'TODO-002')?.title).toBe('用户既有待办');
  expect(loaded.todos.some((item) => item.id === 'OTODO-001')).toBe(true);
  expect(loaded.todos.some((item) => item.id === 'OTODO-002')).toBe(true);
  expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(raw);
});

it('adds O02 memberships to schema 8 storage without replacing employee details', () => {
  const storage = new MemoryStorage();
  const previous = createSeedState();
  previous.employees[2].name = '用户已有分析师名称';
  previous.employees = previous.employees.filter((item) => item.id !== 'EMP-012');
  const legacy = JSON.parse(JSON.stringify(previous)) as Record<string, unknown>;
  legacy.schemaVersion = 8;
  delete legacy.officeTeams;
  delete legacy.contactGroups;
  const raw = JSON.stringify(legacy);
  storage.setItem(DEMO_STORAGE_KEY, raw);
  const loaded = new DemoRepository({ storage }).snapshot();
  expect(loaded.schemaVersion).toBe(24);
  expect(loaded.employees.find((item) => item.id === 'EMP-003')?.name).toBe('用户已有分析师名称');
  expect(loaded.employees.find((item) => item.id === 'EMP-012')?.active).toBe(false);
  expect(loaded.officeTeams).toHaveLength(1);
  expect(loaded.contactGroups).toHaveLength(1);
  expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(raw);
});

it('adds O03 notice fixtures to schema 9 storage without replacing prior group changes', () => {
  const storage = new MemoryStorage();
  const previous = createSeedState();
  previous.contactGroups[0].memberIds = ['EMP-004'];
  const legacy = JSON.parse(JSON.stringify(previous)) as Record<string, unknown>;
  legacy.schemaVersion = 9;
  for (const key of ['notices', 'noticePublications', 'noticeReceipts', 'noticeReminders']) delete legacy[key];
  const raw = JSON.stringify(legacy);
  storage.setItem(DEMO_STORAGE_KEY, raw);
  const loaded = new DemoRepository({ storage }).snapshot();
  expect(loaded.schemaVersion).toBe(24);
  expect(loaded.contactGroups[0].memberIds).toEqual(['EMP-004']);
  expect(loaded.notices).toHaveLength(2);
  expect(loaded.noticePublications).toHaveLength(1);
  expect(loaded.noticeReceipts).toHaveLength(3);
  expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(raw);
});

it('adds O04 mail and discussion fixtures to schema 10 storage while preserving notices', () => {
  const storage = new MemoryStorage();
  const previous = createSeedState();
  previous.notices[0].title = '用户已有通知标题';
  const legacy = JSON.parse(JSON.stringify(previous)) as Record<string, unknown>;
  legacy.schemaVersion = 10;
  for (const key of ['mailMessages', 'mailAttachments', 'mailReplies', 'mailSendRecords', 'officeDiscussions'])
    delete legacy[key];
  const raw = JSON.stringify(legacy);
  storage.setItem(DEMO_STORAGE_KEY, raw);
  const loaded = new DemoRepository({ storage }).snapshot();
  expect(loaded.schemaVersion).toBe(24);
  expect(loaded.notices[0].title).toBe('用户已有通知标题');
  expect(loaded.mailMessages).toHaveLength(2);
  expect(loaded.mailAttachments).toHaveLength(2);
  expect(loaded.mailReplies).toHaveLength(1);
  expect(loaded.officeDiscussions).toHaveLength(1);
  expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(raw);
});

it('adds O05 meeting fixtures to schema 11 storage without replacing archived mail', () => {
  const storage = new MemoryStorage();
  const previous = createSeedState();
  previous.mailMessages[0].folder = 'archive';
  const legacy = JSON.parse(JSON.stringify(previous)) as Record<string, unknown>;
  legacy.schemaVersion = 11;
  for (const key of ['meetingResources', 'meetings', 'meetingNotifications', 'meetingMinutes']) delete legacy[key];
  const raw = JSON.stringify(legacy);
  storage.setItem(DEMO_STORAGE_KEY, raw);
  const loaded = new DemoRepository({ storage }).snapshot();
  expect(loaded.schemaVersion).toBe(24);
  expect(loaded.mailMessages[0].folder).toBe('archive');
  expect(loaded.meetingResources).toHaveLength(2);
  expect(loaded.meetings).toHaveLength(3);
  expect(loaded.meetingNotifications).toEqual([]);
  expect(loaded.meetingMinutes).toEqual([]);
  expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(raw);
});

it('adds O06 document metadata and blocks to schema 12 storage without replacing prior content', () => {
  const storage = new MemoryStorage();
  const previous = createSeedState();
  previous.documentVersions[0].content = '用户保留的制度内容。';
  previous.meetings[0].businessVersion = 7;
  const legacy = JSON.parse(JSON.stringify(previous)) as Record<string, unknown>;
  legacy.schemaVersion = 12;
  for (const key of ['officeDocuments', 'officeDocumentApprovals', 'officeDocumentArchives']) delete legacy[key];
  for (const version of legacy.documentVersions as Array<Record<string, unknown>>) delete version.blocks;
  const raw = JSON.stringify(legacy);
  storage.setItem(DEMO_STORAGE_KEY, raw);
  const loaded = new DemoRepository({ storage }).snapshot();
  expect(loaded.schemaVersion).toBe(24);
  expect(loaded.meetings[0].businessVersion).toBe(7);
  expect(loaded.documentVersions.find((item) => item.id === 'DOCVER-001')?.content).toBe('用户保留的制度内容。');
  expect(loaded.documentVersions.find((item) => item.id === 'DOCVER-001')?.blocks[1].text).toBe('用户保留的制度内容。');
  expect(loaded.documentVersions.some((item) => item.id === 'DOCVER-002')).toBe(true);
  expect(loaded.officeDocuments).toHaveLength(2);
  expect(loaded.officeDocumentApprovals).toHaveLength(1);
  expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(raw);
});

it('adds O07 sheet rows to schema 13 storage without replacing existing document edits', () => {
  const storage = new MemoryStorage();
  const previous = createSeedState();
  previous.officeDocuments[0].businessVersion = 9;
  previous.documentVersions[0].blocks[1].text = '保留的用户修订。';
  const legacy = JSON.parse(JSON.stringify(previous)) as Record<string, unknown>;
  legacy.schemaVersion = 13;
  for (const key of ['sheetRows', 'sheetExports', 'sheetPatchRecords']) delete legacy[key];
  const raw = JSON.stringify(legacy);
  storage.setItem(DEMO_STORAGE_KEY, raw);
  const loaded = new DemoRepository({ storage }).snapshot();
  expect(loaded.schemaVersion).toBe(24);
  expect(loaded.officeDocuments[0].businessVersion).toBe(9);
  expect(loaded.documentVersions[0].blocks[1].text).toBe('保留的用户修订。');
  expect(loaded.sheetRows).toHaveLength(5);
  expect(loaded.sheetExports).toEqual([]);
  expect(loaded.sheetPatchRecords).toEqual([]);
  expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(raw);
});

it('adds O08 approval requests and tasks to schema 14 storage while preserving sheet edits', () => {
  const storage = new MemoryStorage();
  const previous = createSeedState();
  previous.sheetRows[0].amountCents = 77777;
  previous.officeDocuments[0].businessVersion = 8;
  const legacy = JSON.parse(JSON.stringify(previous)) as Record<string, unknown>;
  legacy.schemaVersion = 14;
  for (const key of [
    'officeApprovalMaterials',
    'officeApprovalRequests',
    'officeApprovalDecisions',
    'officeApprovalOperationRecords'
  ])
    delete legacy[key];
  legacy.todos = (legacy.todos as Array<{ sourceType: string }>).filter((item) => item.sourceType !== 'approval');
  const raw = JSON.stringify(legacy);
  storage.setItem(DEMO_STORAGE_KEY, raw);
  const loaded = new DemoRepository({ storage }).snapshot();
  expect(loaded.schemaVersion).toBe(24);
  expect(loaded.sheetRows[0].amountCents).toBe(77777);
  expect(loaded.officeDocuments[0].businessVersion).toBe(8);
  expect(loaded.officeApprovalMaterials).toHaveLength(2);
  expect(loaded.officeApprovalRequests).toHaveLength(3);
  expect(loaded.officeApprovalDecisions).toHaveLength(2);
  expect(loaded.todos.filter((item) => item.sourceType === 'approval')).toHaveLength(3);
  expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(raw);
});

it('adds O10 HR fixtures to schema 15 storage without replacing existing business progress', () => {
  const storage = new MemoryStorage();
  const previous = createSeedState();
  previous.sheetRows[0].amountCents = 65432;
  previous.officeApprovalRequests[0].businessVersion = 5;
  const legacy = JSON.parse(JSON.stringify(previous)) as Record<string, unknown>;
  legacy.schemaVersion = 15;
  for (const key of [
    'leaveBalances',
    'leaveRequests',
    'attendanceCorrections',
    'personnelMaterials',
    'personnelProfiles',
    'personnelChanges',
    'trainingCourses',
    'trainingEnrollments',
    'hrOperationRecords'
  ])
    delete legacy[key];
  const employees = legacy.employees as Array<{ id: string; name: string; roles: string[] }>;
  const hr = employees.find((item) => item.id === 'EMP-004');
  if (!hr) throw new Error('Missing legacy HR employee.');
  hr.name = '用户自定义人事专员';
  hr.roles = hr.roles.filter((role) => role !== 'hr');
  const raw = JSON.stringify(legacy);
  storage.setItem(DEMO_STORAGE_KEY, raw);

  const loaded = new DemoRepository({ storage }).snapshot();
  expect(loaded.schemaVersion).toBe(24);
  expect(loaded.sheetRows[0].amountCents).toBe(65432);
  expect(loaded.officeApprovalRequests[0].businessVersion).toBe(5);
  expect(loaded.employees.find((item) => item.id === 'EMP-004')).toMatchObject({
    name: '用户自定义人事专员',
    roles: expect.arrayContaining(['hr'])
  });
  expect(loaded.leaveBalances).toHaveLength(12);
  expect(loaded.personnelMaterials).toHaveLength(5);
  expect(loaded.personnelProfiles).toHaveLength(3);
  expect(loaded.trainingCourses).toHaveLength(2);
  expect(loaded.trainingEnrollments).toHaveLength(1);
  expect(loaded.hrOperationRecords).toEqual([]);
  expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(raw);
});

it('adds O11 procurement fixtures to schema 16 storage while preserving HR operations', () => {
  const storage = new MemoryStorage();
  const previous = createSeedState();
  previous.leaveBalances[0].totalDays = 9;
  previous.trainingEnrollments[0].businessVersion = 4;
  const legacy = JSON.parse(JSON.stringify(previous)) as Record<string, unknown>;
  legacy.schemaVersion = 16;
  for (const key of [
    'procurementSuppliers',
    'supplierProofs',
    'supplierReviews',
    'purchaseRequests',
    'purchaseComparisons',
    'purchaseReceipts',
    'inventoryEntries',
    'procurementOperationRecords'
  ])
    delete legacy[key];
  const raw = JSON.stringify(legacy);
  storage.setItem(DEMO_STORAGE_KEY, raw);

  const loaded = new DemoRepository({ storage }).snapshot();
  expect(loaded.schemaVersion).toBe(24);
  expect(loaded.leaveBalances[0].totalDays).toBe(9);
  expect(loaded.trainingEnrollments[0].businessVersion).toBe(4);
  expect(loaded.procurementSuppliers).toHaveLength(4);
  expect(loaded.supplierProofs).toHaveLength(7);
  expect(loaded.purchaseRequests).toHaveLength(2);
  expect(loaded.purchaseComparisons).toHaveLength(1);
  expect(loaded.purchaseReceipts).toEqual([]);
  expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(raw);
});

it('adds O12 contract and seal fixtures to schema 17 storage while preserving procurement progress', () => {
  const storage = new MemoryStorage();
  const previous = createSeedState();
  previous.purchaseRequests[0].businessVersion = 5;
  previous.procurementSuppliers[0].name = '用户自定义供应商';
  const legacy = JSON.parse(JSON.stringify(previous)) as Record<string, unknown>;
  legacy.schemaVersion = 17;
  for (const key of ['contractMaterials', 'officeContracts', 'sealRequests', 'contractOperationRecords'])
    delete legacy[key];
  const raw = JSON.stringify(legacy);
  storage.setItem(DEMO_STORAGE_KEY, raw);

  const loaded = new DemoRepository({ storage }).snapshot();
  expect(loaded.schemaVersion).toBe(24);
  expect(loaded.purchaseRequests[0].businessVersion).toBe(5);
  expect(loaded.procurementSuppliers[0].name).toBe('用户自定义供应商');
  expect(loaded.contractMaterials).toHaveLength(4);
  expect(loaded.officeContracts).toHaveLength(2);
  expect(loaded.sealRequests).toHaveLength(2);
  expect(loaded.contractOperationRecords).toEqual([]);
  expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(raw);
});

it('adds O13 assets, resources and repairs to schema 18 storage without replacing contracts', () => {
  const storage = new MemoryStorage();
  const previous = createSeedState();
  previous.officeContracts[0].businessVersion = 5;
  previous.contractMaterials[0].name = '用户自定义合同附件';
  const legacy = JSON.parse(JSON.stringify(previous)) as Record<string, unknown>;
  legacy.schemaVersion = 18;
  for (const key of [
    'adminAssets',
    'assetMovements',
    'adminResources',
    'resourceReservations',
    'repairTickets',
    'adminOperationRecords'
  ])
    delete legacy[key];
  const raw = JSON.stringify(legacy);
  storage.setItem(DEMO_STORAGE_KEY, raw);

  const loaded = new DemoRepository({ storage }).snapshot();
  expect(loaded.schemaVersion).toBe(24);
  expect(loaded.officeContracts[0].businessVersion).toBe(5);
  expect(loaded.contractMaterials[0].name).toBe('用户自定义合同附件');
  expect(loaded.adminAssets).toHaveLength(4);
  expect(loaded.assetMovements).toHaveLength(1);
  expect(loaded.adminResources).toHaveLength(2);
  expect(loaded.resourceReservations).toHaveLength(1);
  expect(loaded.repairTickets).toHaveLength(2);
  expect(loaded.adminOperationRecords).toEqual([]);
  expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(raw);
});

it('adds O14 project tasks and milestones to schema 19 storage while preserving equipment history', () => {
  const storage = new MemoryStorage();
  const previous = createSeedState();
  previous.adminAssets[0].businessVersion = 7;
  previous.repairTickets[0].issue = '用户自定义报修问题';
  const legacy = JSON.parse(JSON.stringify(previous)) as Record<string, unknown>;
  legacy.schemaVersion = 19;
  for (const key of [
    'officeProjects',
    'projectTasks',
    'projectMilestones',
    'projectWeeklyReports',
    'projectOperationRecords'
  ])
    delete legacy[key];
  const raw = JSON.stringify(legacy);
  storage.setItem(DEMO_STORAGE_KEY, raw);

  const loaded = new DemoRepository({ storage }).snapshot();
  expect(loaded.schemaVersion).toBe(24);
  expect(loaded.adminAssets[0].businessVersion).toBe(7);
  expect(loaded.repairTickets[0].issue).toBe('用户自定义报修问题');
  expect(loaded.officeProjects).toHaveLength(1);
  expect(loaded.projectTasks).toHaveLength(3);
  expect(loaded.projectMilestones).toHaveLength(2);
  expect(loaded.projectWeeklyReports).toEqual([]);
  expect(loaded.projectOperationRecords).toEqual([]);
  expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(raw);
});

it('adds O15 IT catalog and tickets to schema 20 storage while preserving project edits', () => {
  const storage = new MemoryStorage();
  const previous = createSeedState();
  previous.officeProjects[0].title = '用户自定义项目';
  const legacy = JSON.parse(JSON.stringify(previous)) as Record<string, unknown>;
  legacy.schemaVersion = 20;
  for (const key of [
    'itSystems',
    'itPermissions',
    'accessMaterials',
    'accessRequests',
    'accessGrants',
    'itTickets',
    'itTicketEvents',
    'itOperationRecords'
  ])
    delete legacy[key];
  const raw = JSON.stringify(legacy);
  storage.setItem(DEMO_STORAGE_KEY, raw);
  const loaded = new DemoRepository({ storage }).snapshot();
  expect(loaded.schemaVersion).toBe(24);
  expect(loaded.officeProjects[0].title).toBe('用户自定义项目');
  expect(loaded.employees.find((item) => item.id === 'EMP-004')?.roles).toContain('it-coordinator');
  expect(loaded.employees.find((item) => item.id === 'EMP-006')?.roles).toContain('it-agent');
  expect(loaded.itSystems).toHaveLength(2);
  expect(loaded.itTickets).toHaveLength(3);
  expect(loaded.itTicketEvents).toHaveLength(3);
  expect(loaded.accessRequests).toEqual([]);
  expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(raw);
});

it('adds O16 report and archive examples to schema 21 storage while preserving IT progress', () => {
  const storage = new MemoryStorage();
  const previous = createSeedState();
  previous.itTickets[0].status = 'assigned';
  previous.itTickets[0].assigneeId = 'EMP-006';
  previous.itTickets[0].businessVersion = 2;
  const legacy = JSON.parse(JSON.stringify(previous)) as Record<string, unknown>;
  legacy.schemaVersion = 21;
  for (const key of ['officeReportJobs', 'officeArchives', 'officeArchiveOperations', 'reportOperationRecords'])
    delete legacy[key];
  const raw = JSON.stringify(legacy);
  storage.setItem(DEMO_STORAGE_KEY, raw);
  const loaded = new DemoRepository({ storage }).snapshot();
  expect(loaded.schemaVersion).toBe(24);
  expect(loaded.itTickets[0]).toMatchObject({ status: 'assigned', assigneeId: 'EMP-006', businessVersion: 2 });
  expect(loaded.officeReportJobs).toHaveLength(1);
  expect(loaded.officeArchives).toHaveLength(1);
  expect(loaded.officeArchiveOperations).toHaveLength(1);
  expect(loaded.reportOperationRecords).toEqual([]);
  expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(raw);
});

it('adds S04 versioned risk rules and alert history to schema 22 storage without replacing archived reports', () => {
  const storage = new MemoryStorage();
  const previous = createSeedState();
  previous.officeArchives[0].currentVersion = 3;
  const legacy = JSON.parse(JSON.stringify(previous)) as Record<string, unknown>;
  legacy.schemaVersion = 22;
  for (const key of [
    'riskRules',
    'riskAlerts',
    'riskEvidence',
    'riskInvestigations',
    'riskReviews',
    'riskOperationRecords'
  ])
    delete legacy[key];
  const raw = JSON.stringify(legacy);
  storage.setItem(DEMO_STORAGE_KEY, raw);
  const loaded = new DemoRepository({ storage }).snapshot();
  expect(loaded.schemaVersion).toBe(24);
  expect(loaded.officeArchives[0].currentVersion).toBe(3);
  expect(loaded.employees.find((item) => item.id === 'EMP-004')?.roles).toContain('risk-reviewer');
  expect(loaded.employees.find((item) => item.id === 'EMP-005')?.roles).toContain('risk-investigator');
  expect(loaded.employees.find((item) => item.id === 'EMP-006')?.roles).toContain('risk-monitor');
  expect(loaded.riskRules).toHaveLength(2);
  expect(loaded.riskAlerts).toHaveLength(5);
  expect(loaded.riskEvidence).toHaveLength(11);
  expect(loaded.riskInvestigations).toHaveLength(3);
  expect(loaded.riskReviews).toHaveLength(2);
  expect(loaded.riskOperationRecords).toEqual([]);
  expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(raw);
});

it('adds S05 institution fixtures to schema 23 storage without replacing risk progress', () => {
  const storage = new MemoryStorage();
  const previous = createSeedState();
  previous.riskAlerts[0].businessVersion = 8;
  previous.clients[0].name = '用户保留的机构客户';
  const legacy = JSON.parse(JSON.stringify(previous)) as Record<string, unknown>;
  legacy.schemaVersion = 23;
  for (const key of [
    'institutionPolicy',
    'institutionProfiles',
    'institutionMaterials',
    'institutionNeeds',
    'roadshows',
    'institutionMaterialPackages',
    'roadshowInvitations',
    'institutionFollowups',
    'institutionOperationRecords'
  ])
    delete legacy[key];
  const raw = JSON.stringify(legacy);
  storage.setItem(DEMO_STORAGE_KEY, raw);
  const loaded = new DemoRepository({ storage }).snapshot();
  expect(loaded.schemaVersion).toBe(24);
  expect(loaded.riskAlerts[0].businessVersion).toBe(8);
  expect(loaded.clients[0].name).toBe('用户保留的机构客户');
  expect(loaded.institutionProfiles).toHaveLength(1);
  expect(loaded.institutionNeeds).toHaveLength(3);
  expect(loaded.institutionPolicy.version).toBe(1);
  expect(loaded.employees.find((item) => item.id === 'EMP-001')?.roles).toContain('institution-sales');
  expect(loaded.roadshows).toEqual([]);
  expect(storage.getItem(DEMO_STORAGE_KEY)).toBe(raw);
});

it('resets only the selected securities example to its original fictional record', () => {
  const repository = new DemoRepository();
  const original = repository.snapshot();
  repository.transact((draft) => {
    draft.clientCases[0].status = 'returned';
    draft.clientCases[0].businessVersion = 9;
    draft.clientCases[1].businessVersion = 7;
  });
  repository.clock.advanceBy(86_400_000);
  repository.resetSecuritiesExample('S01', 'CLI-001');
  const restored = repository.snapshot();
  expect(restored.clientCases.find((item) => item.clientId === 'CLI-001')).toEqual(original.clientCases[0]);
  expect(restored.clientCases.find((item) => item.clientId === 'CLI-002')?.businessVersion).toBe(7);
});
