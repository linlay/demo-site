import type { DemoRole, DemoState, Employee } from '../fixtures/types';

export const INITIATOR_ID = 'EMP-001';
export const APPROVER_ID = 'EMP-002';
export const OPERATOR_IDS = ['EMP-001', 'EMP-003', 'EMP-005'] as const;
export const REVIEWER_IDS = ['EMP-002', 'EMP-004'] as const;
export const ACCOUNT_IDS = ['EMP-001', 'EMP-002', 'EMP-003', 'EMP-004', 'EMP-005', 'EMP-006'] as const;

export function isOperator(employee?: { active?: boolean; roles: readonly string[] }): boolean {
  return !!employee && employee.active !== false && employee.roles.includes('workflow-initiator');
}
export function isReviewer(employee?: { active?: boolean; roles: readonly string[] }): boolean {
  return !!employee && employee.active !== false && employee.roles.includes('workflow-approver');
}

export function workflowEmployees(employees: readonly Employee[]): Employee[] {
  const initiating: DemoRole[] = [
    'workflow-initiator',
    'employee',
    'analyst',
    'publisher',
    'ib-manager',
    'ib-member',
    'risk-monitor',
    'risk-investigator',
    'institution-sales',
    'research-service',
    'event-organizer',
    'hr',
    'it-coordinator',
    'it-agent'
  ];
  const approving: DemoRole[] = [
    'workflow-approver',
    'manager',
    'reviewer',
    'quality',
    'compliance',
    'ib-quality',
    'ib-committee',
    'risk-reviewer',
    'hr'
  ];
  return employees.map((employee) => ({
    ...employee,
    active: ACCOUNT_IDS.some((id) => id === employee.id),
    roles: OPERATOR_IDS.some((id) => id === employee.id)
      ? initiating
      : REVIEWER_IDS.some((id) => id === employee.id)
        ? approving
        : employee.id === 'EMP-006'
          ? ['workflow-analyst']
          : employee.roles
  }));
}

function owners<T extends object>(items: T[], fields: readonly (keyof T)[], id = INITIATOR_ID): void {
  for (const [index, item] of items.entries())
    for (const field of fields) {
      if (typeof item[field] === 'string' && /^EMP-\d+$/.test(String(item[field])))
        Object.assign(item, {
          [field]:
            id === INITIATOR_ID
              ? OPERATOR_IDS[
                  (Number(String((item as { id?: string }).id ?? '').match(/\d+$/)?.[0] ?? index + 1) - 1) %
                    OPERATOR_IDS.length
                ]
              : id
        });
    }
}

/** Transfer operational ownership once; audit entries, decisions and submitted snapshots retain their actors. */
export function applyWorkflowAccounts(state: DemoState, resetOwnership = false): void {
  const migrate = state.workflowProfile !== 'coarse-roles' || resetOwnership;
  state.workflowProfile = 'coarse-roles';
  state.employees = workflowEmployees(state.employees);
  if (!migrate) return;
  owners(state.clients, ['managerId']);
  for (const review of state.clientReviews)
    if (review.status === 'pending') {
      review.reviewerId = APPROVER_ID;
      review.submitterId = INITIATOR_ID;
    }
  owners(state.officeTeams, ['ownerId']);
  owners(state.contactGroups, ['ownerId']);
  for (const item of [...state.officeTeams, ...state.contactGroups])
    item.memberIds = [...OPERATOR_IDS, ...REVIEWER_IDS];
  owners(state.notices, ['authorId']);
  for (const item of state.mailMessages) item.recipientIds = [...OPERATOR_IDS, ...REVIEWER_IDS];
  owners(state.mailReplies, ['authorId']);
  owners(state.officeDiscussions, ['creatorId']);
  owners(state.meetings, ['organizerId']);
  for (const item of state.meetings) item.participantIds = [...OPERATOR_IDS, ...REVIEWER_IDS];
  owners(state.researchTopics, ['analystId']);
  owners(state.researchReports, ['authorId']);
  owners(state.ibProjects, ['managerId']);
  owners(state.ibAssignments, ['memberId', 'assignedBy']);
  owners(state.ibWorkpapers, ['memberId']);
  owners(state.forms, ['applicantId']);
  for (const item of state.forms)
    item.departmentId = state.employees.find((employee) => employee.id === item.applicantId)?.departmentId ?? 'DEP-001';
  for (const item of state.travelRequests)
    item.travelerIds = [state.forms.find((form) => form.id === item.formId)?.applicantId ?? INITIATOR_ID];
  owners(state.officeDocuments, ['ownerId']);
  owners(state.officeDocuments, ['reviewerId'], APPROVER_ID);
  owners(state.officeApprovalRequests, ['applicantId']);
  owners(state.officeApprovalRequests, ['reviewerId'], APPROVER_ID);
  for (const item of state.officeApprovalRequests)
    item.departmentId = state.employees.find((employee) => employee.id === item.applicantId)?.departmentId ?? 'DEP-001';
  owners(state.leaveRequests, ['employeeId']);
  owners(state.attendanceCorrections, ['employeeId']);
  owners(state.purchaseRequests, ['requesterId']);
  owners(state.officeContracts, ['ownerId']);
  owners(state.sealRequests, ['applicantId']);
  owners(state.sealRequests, ['reviewerId'], APPROVER_ID);
  owners(state.adminAssets, ['holderId']);
  owners(state.resourceReservations, ['actorId']);
  owners(state.repairTickets, ['reporterId', 'assigneeId']);
  owners(state.officeProjects, ['ownerId']);
  for (const item of state.officeProjects) item.memberIds = [...OPERATOR_IDS, ...REVIEWER_IDS];
  owners(state.projectTasks, ['assigneeId']);
  owners(state.accessMaterials, ['ownerId']);
  owners(state.accessRequests, ['applicantId']);
  owners(state.accessRequests, ['reviewerId'], APPROVER_ID);
  owners(state.itTickets, ['requesterId', 'assigneeId']);
  owners(state.officeArchives, ['ownerId']);
  owners(state.riskAlerts, ['assigneeId']);
  owners(state.institutionProfiles, ['salesId', 'researchId', 'organizerId']);
  for (const item of state.todos)
    if (item.status === 'open') {
      item.assigneeId = ['client', 'research', 'ib-project', 'approval', 'form'].includes(item.sourceType)
        ? APPROVER_ID
        : INITIATOR_ID;
    }
}
