import type { DemoState } from './types';

/** Linked fictional records for the default operator. IDs do not overlap the original replay fixtures. */
export function addWorkbenchSamples(state: DemoState, now: string): void {
  if (state.workbenchSampleVersion === 1) return;
  const used = new Set([
    ...state.employees.map((row) => row.id),
    ...state.forms.map((row) => row.id),
    ...state.officeApprovalRequests.map((row) => row.id),
    ...state.todos.map((row) => row.id),
    ...state.officeApprovalDecisions.map((row) => row.id)
  ]);
  const allocate = (prefix: string): string => {
    for (let index = 100; index <= 999; index += 1) {
      const id = `${prefix}-${index}`;
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
    }
    throw new Error(`No demo IDs available for ${prefix}`);
  };
  const hour = 3_600_000;
  const at = (hours: number) => new Date(Date.parse(now) + hours * hour).toISOString();
  const applicants = ['EMP-001'];
  const titles = [
    '客户交流会物料申请',
    '营业网点设备领用',
    '客户资料归档申请',
    '服务团队培训申请',
    '季度回访活动申请',
    '业务调研资料申请',
    '客户接待安排申请',
    '办公耗材申领'
  ];
  // 13 submitted + 43 reviewed, together with the original fixtures: 14 pending / 45 reviewed.
  for (let index = 0; index < 56; index += 1) {
    const suffix = String(index + 1).padStart(3, '0');
    const id = allocate('APPR');
    const taskId = allocate('APPTODO');
    const open = index < 13;
    const returned = !open && index % 5 === 0;
    const status = open ? 'submitted' : returned ? 'returned' : 'approved';
    const createdAt = at(-24 * (2 + (index % 28)) - (index % 6));
    const completedAt = open ? null : at(-24 * (1 + (index % 28)));
    const title = `${titles[index % titles.length]} · ${String(index + 1).padStart(2, '0')}期`;
    const applicantId = applicants[index % applicants.length];
    state.officeApprovalRequests.push({
      id,
      applicantId,
      departmentId: 'DEP-001',
      reviewerId: 'EMP-002',
      title,
      description: `为第 ${index + 1} 期服务工作申请支持，资料已由经办人整理。`,
      materialIds: [returned ? 'APMAT-002' : 'APMAT-001'],
      status,
      businessVersion: open ? 1 : 2,
      currentTaskId: open ? taskId : null,
      createdAt
    });
    state.todos.push({
      id: taskId,
      title,
      assigneeId: 'EMP-002',
      sourceType: 'approval',
      sourceId: id,
      dueAt: open ? at(index % 3 === 0 ? -24 * (1 + (index % 3)) : 2 + (index % 5)) : at(-24 * (1 + (index % 28)) + 4),
      status: open ? 'open' : 'done',
      completedAt
    });
    state.auditEntries.push({
      id: `AUD-DEMO-APP-${suffix}-SUBMIT`,
      entityType: 'approval',
      entityId: id,
      action: 'submit',
      actorId: applicantId,
      at: createdAt,
      fromStatus: null,
      toStatus: 'submitted',
      businessVersion: 1
    });
    if (completedAt) {
      const opinion = returned ? '请补充活动用途和材料清单后重新提交。' : '用途明确，资料齐全，同意申请。';
      state.officeApprovalDecisions.push({
        id: allocate('APDEC'),
        requestId: id,
        taskId,
        action: returned ? 'return' : 'approve',
        actorId: 'EMP-002',
        opinion,
        businessVersion: 2,
        decidedAt: completedAt
      });
      state.auditEntries.push({
        id: `AUD-DEMO-APP-${suffix}-REVIEW`,
        entityType: 'approval',
        entityId: id,
        action: returned ? 'return' : 'approve',
        actorId: 'EMP-002',
        at: completedAt,
        fromStatus: 'submitted',
        toStatus: status,
        businessVersion: 2,
        note: opinion
      });
    }
  }
  // Another two actionable forms and 15 completed forms bring the workbench to 18 / 60.
  for (let index = 0; index < 17; index += 1) {
    const suffix = String(index + 1).padStart(3, '0');
    const id = allocate('FORM');
    const open = index < 2;
    const travel = index % 2 === 0;
    const createdAt = at(-24 * (3 + index));
    const completedAt = open ? null : at(-24 * (1 + index));
    const applicantId = applicants[index % applicants.length];
    const title = `${travel ? '客户走访出差申请' : '服务活动支持申请'} · ${suffix}`;
    state.forms.push({
      id,
      kind: travel ? 'travel' : 'general',
      applicantId,
      departmentId: 'DEP-001',
      status: open ? 'submitted' : 'approved',
      businessVersion: open ? 1 : 2,
      amountCents: travel ? 180000 + ((state.seed + index * 7919) % 120000) : 0,
      createdAt
    });
    if (travel)
      state.travelRequests.push({
        formId: id,
        origin: '上海',
        destination: ['杭州', '苏州', '南京'][index % 3],
        startAt: at(24 * (open ? 2 : -index)),
        endAt: at(24 * (open ? 3 : 1 - index)),
        travelerIds: [applicantId]
      });
    state.todos.push({
      id: allocate('TODO'),
      title,
      assigneeId: 'EMP-002',
      sourceType: 'form',
      sourceId: id,
      dueAt: open ? at(index === 0 ? 4 : -4) : at(-24 * (1 + index) + 4),
      status: open ? 'open' : 'done',
      completedAt
    });
    state.auditEntries.push({
      id: `AUD-DEMO-FORM-${suffix}-SUBMIT`,
      entityType: 'form',
      entityId: id,
      action: 'submit',
      actorId: applicantId,
      at: createdAt,
      fromStatus: 'draft',
      toStatus: 'submitted',
      businessVersion: 1
    });
    if (completedAt)
      state.auditEntries.push({
        id: `AUD-DEMO-FORM-${suffix}-APPROVE`,
        entityType: 'form',
        entityId: id,
        action: 'approve',
        actorId: 'EMP-002',
        at: completedAt,
        fromStatus: 'submitted',
        toStatus: 'approved',
        businessVersion: 2,
        note: '资料完整，同意办理。'
      });
  }
  state.workbenchSampleVersion = 1;
}
