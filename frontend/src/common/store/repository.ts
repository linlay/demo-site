import { addWorkbenchSamples } from '../fixtures/workbenchSeed';
import { DemoClock } from '../fixtures/clock';
import { createSeedState, DEFAULT_DEMO_SEED } from '../fixtures/seed';
import type { DemoState } from '../fixtures/types';

/** Keep the persisted key so the project rename preserves existing browser demo data. */
export const DEMO_STORAGE_KEY = 'awcp-examples:v1:repository';

export interface DemoStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DemoRepositoryOptions {
  seed?: number;
  clock?: DemoClock;
  storage?: DemoStorage;
  /** Full linked workbench dataset; the small replay fixtures remain the default. */
  workbenchSamples?: boolean;
  assertWritable?: () => void;
}

function restoreRows<Row>(current: Row[], seeded: Row[], belongs: (row: Row) => boolean): Row[] {
  return [...current.filter((row) => !belongs(row)), ...seeded.filter(belongs)];
}

export class DemoRepository {
  readonly clock: DemoClock;
  private readonly seed: number;
  private readonly workbenchSamples: boolean;
  private readonly initialTime: string;
  private readonly storage?: DemoStorage;
  private readonly listeners = new Set<() => void>();
  private state: DemoState;
  private readonly assertWritable?: () => void;

  constructor(options: DemoRepositoryOptions = {}) {
    this.assertWritable = options.assertWritable;
    this.seed = options.seed ?? DEFAULT_DEMO_SEED;
    this.workbenchSamples = options.workbenchSamples ?? false;
    this.clock = options.clock ?? new DemoClock();
    this.initialTime = this.clock.now();
    this.storage = options.storage;
    this.state = this.load() ?? createSeedState(this.seed, this.clock);
    if (this.workbenchSamples && !this.state.workbenchSampleVersion) addWorkbenchSamples(this.state, this.initialTime);
  }

  snapshot(): DemoState {
    return structuredClone(this.state);
  }

  transact<Result>(change: (draft: DemoState) => Result): Result {
    this.assertWritable?.();
    const draft = this.snapshot();
    const result = change(draft);
    if (result && typeof result === 'object' && 'then' in result) {
      throw new Error('Demo repository transactions must be synchronous.');
    }
    this.storage?.setItem(DEMO_STORAGE_KEY, JSON.stringify(draft));
    this.state = draft;
    this.notify();
    return result;
  }

  reset(): DemoState {
    this.assertWritable?.();
    this.storage?.removeItem(DEMO_STORAGE_KEY);
    this.clock.reset();
    this.state = createSeedState(this.seed, this.clock);
    if (this.workbenchSamples) addWorkbenchSamples(this.state, this.initialTime);
    this.notify();
    return this.snapshot();
  }

  resetSecuritiesExample(scenarioId: string, objectId: string): void {
    if (!['S01', 'S02', 'S03', 'S04', 'S05'].includes(scenarioId))
      throw new Error('当前仅支持复位 S01～S05 的所选演示事项。');
    const seed = createSeedState(this.seed, new DemoClock(this.initialTime));
    this.transact((draft) => {
      if (scenarioId === 'S01') {
        draft.clientCases = restoreRows(draft.clientCases, seed.clientCases, (row) => row.clientId === objectId);
        draft.suitabilityAssessments = restoreRows(draft.suitabilityAssessments, seed.suitabilityAssessments, (row) => row.clientId === objectId);
        draft.suitabilityMatches = restoreRows(draft.suitabilityMatches, seed.suitabilityMatches, (row) => row.clientId === objectId);
        draft.clientReviews = restoreRows(draft.clientReviews, seed.clientReviews, (row) => row.clientId === objectId);
      } else if (scenarioId === 'S02') {
        const topicIds = new Set([...draft.researchReports, ...seed.researchReports].filter((row) => row.id === objectId).map((row) => row.topicId));
        draft.researchReports = restoreRows(draft.researchReports, seed.researchReports, (row) => row.id === objectId);
        draft.researchTopics = restoreRows(draft.researchTopics, seed.researchTopics, (row) => topicIds.has(row.id));
        draft.researchDocumentVersions = restoreRows(draft.researchDocumentVersions, seed.researchDocumentVersions, (row) => row.reportId === objectId);
        draft.researchChecks = restoreRows(draft.researchChecks, seed.researchChecks, (row) => row.reportId === objectId);
        draft.researchReviews = restoreRows(draft.researchReviews, seed.researchReviews, (row) => row.reportId === objectId);
        draft.researchPublications = restoreRows(draft.researchPublications, seed.researchPublications, (row) => row.reportId === objectId);
      } else if (scenarioId === 'S03') {
        draft.ibProjects = restoreRows(draft.ibProjects, seed.ibProjects, (row) => row.id === objectId);
        draft.ibAssignments = restoreRows(draft.ibAssignments, seed.ibAssignments, (row) => row.projectId === objectId);
        draft.ibWorkpapers = restoreRows(draft.ibWorkpapers, seed.ibWorkpapers, (row) => row.projectId === objectId);
        draft.ibFindings = restoreRows(draft.ibFindings, seed.ibFindings, (row) => row.projectId === objectId);
        draft.ibQualitySubmissions = restoreRows(draft.ibQualitySubmissions, seed.ibQualitySubmissions, (row) => row.projectId === objectId);
        draft.ibReviews = restoreRows(draft.ibReviews, seed.ibReviews, (row) => row.projectId === objectId);
      } else if (scenarioId === 'S04') {
        draft.riskAlerts = restoreRows(draft.riskAlerts, seed.riskAlerts, (row) => row.id === objectId);
        draft.riskEvidence = restoreRows(draft.riskEvidence, seed.riskEvidence, (row) => row.alertId === objectId);
        draft.riskInvestigations = restoreRows(draft.riskInvestigations, seed.riskInvestigations, (row) => row.alertId === objectId);
        draft.riskReviews = restoreRows(draft.riskReviews, seed.riskReviews, (row) => row.alertId === objectId);
        draft.riskOperationRecords = restoreRows(draft.riskOperationRecords, seed.riskOperationRecords, (row) => row.result.alertId === objectId);
      } else {
        const roadshowIds = new Set([...draft.roadshows, ...seed.roadshows].filter((row) => row.needId === objectId).map((row) => row.id));
        const meetingIds = new Set([...draft.roadshows, ...seed.roadshows].filter((row) => row.needId === objectId).map((row) => row.meetingId));
        draft.institutionNeeds = restoreRows(draft.institutionNeeds, seed.institutionNeeds, (row) => row.id === objectId);
        draft.roadshows = restoreRows(draft.roadshows, seed.roadshows, (row) => row.needId === objectId);
        draft.institutionMaterialPackages = restoreRows(draft.institutionMaterialPackages, seed.institutionMaterialPackages, (row) => roadshowIds.has(row.roadshowId));
        draft.roadshowInvitations = restoreRows(draft.roadshowInvitations, seed.roadshowInvitations, (row) => roadshowIds.has(row.roadshowId));
        draft.institutionFollowups = restoreRows(draft.institutionFollowups, seed.institutionFollowups, (row) => row.needId === objectId);
        draft.meetings = restoreRows(draft.meetings, seed.meetings, (row) => meetingIds.has(row.id));
        draft.meetingMinutes = restoreRows(draft.meetingMinutes, seed.meetingMinutes, (row) => meetingIds.has(row.meetingId));
        draft.meetingNotifications = restoreRows(draft.meetingNotifications, seed.meetingNotifications, (row) => meetingIds.has(row.meetingId));
        draft.institutionOperationRecords = restoreRows(draft.institutionOperationRecords, seed.institutionOperationRecords, (row) => row.result.needId === objectId);
      }
      draft.auditEntries = restoreRows(draft.auditEntries, seed.auditEntries, (row) => row.entityId === objectId);
      draft.idempotencyRecords = restoreRows(draft.idempotencyRecords, seed.idempotencyRecords, (row) => row.resultId === objectId);
      draft.todos = restoreRows(draft.todos, seed.todos, (row) => row.sourceId === objectId);
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private load(): DemoState | null {
    try {
      const raw = this.storage?.getItem(DEMO_STORAGE_KEY);
      if (!raw) return null;
      const value: unknown = JSON.parse(raw);
      if (!isLegacyOrCurrentState(value) || value.seed !== this.seed) return null;
      const seed = createSeedState(this.seed, this.clock);
      for (const employee of seed.employees) {
        if (!value.employees.some((item) => item.id === employee.id)) value.employees.push(employee);
      }
      const hrEmployee = value.employees.find((item) => item.id === 'EMP-004');
      if (hrEmployee && !hrEmployee.roles.includes('hr')) hrEmployee.roles.push('hr');
      if (hrEmployee && !hrEmployee.roles.includes('it-coordinator')) hrEmployee.roles.push('it-coordinator');
      const itAgent = value.employees.find((item) => item.id === 'EMP-006');
      if (itAgent && !itAgent.roles.includes('it-agent')) itAgent.roles.push('it-agent');
      if (hrEmployee && !hrEmployee.roles.includes('risk-reviewer')) hrEmployee.roles.push('risk-reviewer');
      const investigator = value.employees.find((item) => item.id === 'EMP-005');
      if (investigator && !investigator.roles.includes('risk-investigator'))
        investigator.roles.push('risk-investigator');
      if (itAgent && !itAgent.roles.includes('risk-monitor')) itAgent.roles.push('risk-monitor');
      const sales = value.employees.find((item) => item.id === 'EMP-001');
      if (sales && !sales.roles.includes('institution-sales')) sales.roles.push('institution-sales');
      const organizer = value.employees.find((item) => item.id === 'EMP-002');
      if (organizer && !organizer.roles.includes('event-organizer')) organizer.roles.push('event-organizer');
      const researchService = value.employees.find((item) => item.id === 'EMP-003');
      if (researchService && !researchService.roles.includes('research-service'))
        researchService.roles.push('research-service');
      const officeTeams = Array.isArray(value.officeTeams) ? value.officeTeams : [];
      for (const team of seed.officeTeams) {
        if (!officeTeams.some((item) => item.id === team.id)) officeTeams.push(team);
      }
      const contactGroups = Array.isArray(value.contactGroups) ? value.contactGroups : [];
      for (const group of seed.contactGroups) {
        if (!contactGroups.some((item) => item.id === group.id)) contactGroups.push(group);
      }
      const notices = Array.isArray(value.notices) ? value.notices : [];
      for (const notice of seed.notices) {
        if (!notices.some((item) => item.id === notice.id)) notices.push(notice);
      }
      const noticePublications = Array.isArray(value.noticePublications) ? value.noticePublications : [];
      for (const publication of seed.noticePublications) {
        if (!noticePublications.some((item) => item.id === publication.id)) noticePublications.push(publication);
      }
      const noticeReceipts = Array.isArray(value.noticeReceipts) ? value.noticeReceipts : [];
      for (const receipt of seed.noticeReceipts) {
        if (!noticeReceipts.some((item) => item.id === receipt.id)) noticeReceipts.push(receipt);
      }
      const mailMessages = Array.isArray(value.mailMessages) ? value.mailMessages : [];
      for (const mail of seed.mailMessages) {
        if (!mailMessages.some((item) => item.id === mail.id)) mailMessages.push(mail);
      }
      const mailAttachments = Array.isArray(value.mailAttachments) ? value.mailAttachments : [];
      for (const attachment of seed.mailAttachments) {
        if (!mailAttachments.some((item) => item.id === attachment.id)) mailAttachments.push(attachment);
      }
      const mailReplies = Array.isArray(value.mailReplies) ? value.mailReplies : [];
      for (const reply of seed.mailReplies) {
        if (!mailReplies.some((item) => item.id === reply.id)) mailReplies.push(reply);
      }
      const officeDiscussions = Array.isArray(value.officeDiscussions) ? value.officeDiscussions : [];
      for (const discussion of seed.officeDiscussions) {
        if (!officeDiscussions.some((item) => item.id === discussion.id)) officeDiscussions.push(discussion);
      }
      const meetingResources = Array.isArray(value.meetingResources) ? value.meetingResources : [];
      for (const resource of seed.meetingResources) {
        if (!meetingResources.some((item) => item.id === resource.id)) meetingResources.push(resource);
      }
      const meetings = Array.isArray(value.meetings) ? value.meetings : [];
      for (const meeting of seed.meetings) {
        if (!meetings.some((item) => item.id === meeting.id)) meetings.push(meeting);
      }
      for (const client of seed.clients) {
        if (!value.clients.some((item) => item.id === client.id)) value.clients.push(client);
      }
      for (const form of seed.forms) {
        if (!value.forms.some((item) => item.id === form.id)) value.forms.push(form);
      }
      for (const attachment of seed.attachments) {
        if (!value.attachments.some((item) => item.assetId === attachment.assetId)) value.attachments.push(attachment);
      }
      const documentVersions = value.documentVersions.map((version) => ({
        ...version,
        blocks: Array.isArray(version.blocks)
          ? version.blocks
          : [
              { id: 'DBLK-001', kind: 'heading' as const, text: version.title },
              { id: 'DBLK-002', kind: 'paragraph' as const, text: version.content }
            ]
      }));
      for (const version of seed.documentVersions) {
        if (!documentVersions.some((item) => item.id === version.id)) documentVersions.push(version);
      }
      const officeDocuments = Array.isArray(value.officeDocuments) ? value.officeDocuments : [];
      for (const document of seed.officeDocuments) {
        if (!officeDocuments.some((item) => item.id === document.id)) officeDocuments.push(document);
      }
      const officeDocumentApprovals = Array.isArray(value.officeDocumentApprovals) ? value.officeDocumentApprovals : [];
      for (const approval of seed.officeDocumentApprovals) {
        if (!officeDocumentApprovals.some((item) => item.id === approval.id)) officeDocumentApprovals.push(approval);
      }
      const sheetRows = Array.isArray(value.sheetRows) ? value.sheetRows : [];
      for (const row of seed.sheetRows) {
        if (!sheetRows.some((item) => item.id === row.id)) sheetRows.push(row);
      }
      const officeApprovalMaterials = Array.isArray(value.officeApprovalMaterials) ? value.officeApprovalMaterials : [];
      for (const material of seed.officeApprovalMaterials) {
        if (!officeApprovalMaterials.some((item) => item.id === material.id)) officeApprovalMaterials.push(material);
      }
      const officeApprovalRequests = Array.isArray(value.officeApprovalRequests) ? value.officeApprovalRequests : [];
      for (const request of seed.officeApprovalRequests) {
        if (!officeApprovalRequests.some((item) => item.id === request.id)) officeApprovalRequests.push(request);
      }
      const officeApprovalDecisions = Array.isArray(value.officeApprovalDecisions) ? value.officeApprovalDecisions : [];
      for (const decision of seed.officeApprovalDecisions) {
        if (!officeApprovalDecisions.some((item) => item.id === decision.id)) officeApprovalDecisions.push(decision);
      }
      const leaveBalances = Array.isArray(value.leaveBalances) ? value.leaveBalances : [];
      for (const balance of seed.leaveBalances) {
        if (!leaveBalances.some((item) => item.employeeId === balance.employeeId)) leaveBalances.push(balance);
      }
      const personnelMaterials = Array.isArray(value.personnelMaterials) ? value.personnelMaterials : [];
      for (const material of seed.personnelMaterials) {
        if (!personnelMaterials.some((item) => item.id === material.id)) personnelMaterials.push(material);
      }
      const personnelProfiles = Array.isArray(value.personnelProfiles) ? value.personnelProfiles : [];
      for (const profile of seed.personnelProfiles) {
        if (!personnelProfiles.some((item) => item.employeeId === profile.employeeId)) personnelProfiles.push(profile);
      }
      const trainingCourses = Array.isArray(value.trainingCourses) ? value.trainingCourses : [];
      for (const course of seed.trainingCourses) {
        if (!trainingCourses.some((item) => item.id === course.id)) trainingCourses.push(course);
      }
      const trainingEnrollments = Array.isArray(value.trainingEnrollments) ? value.trainingEnrollments : [];
      for (const enrollment of seed.trainingEnrollments) {
        if (!trainingEnrollments.some((item) => item.id === enrollment.id)) trainingEnrollments.push(enrollment);
      }
      const procurementSuppliers = Array.isArray(value.procurementSuppliers) ? value.procurementSuppliers : [];
      for (const supplier of seed.procurementSuppliers) {
        if (!procurementSuppliers.some((item) => item.id === supplier.id)) procurementSuppliers.push(supplier);
      }
      const supplierProofs = Array.isArray(value.supplierProofs) ? value.supplierProofs : [];
      for (const proof of seed.supplierProofs) {
        if (!supplierProofs.some((item) => item.id === proof.id)) supplierProofs.push(proof);
      }
      const purchaseRequests = Array.isArray(value.purchaseRequests) ? value.purchaseRequests : [];
      for (const request of seed.purchaseRequests) {
        if (!purchaseRequests.some((item) => item.id === request.id)) purchaseRequests.push(request);
      }
      const purchaseComparisons = Array.isArray(value.purchaseComparisons) ? value.purchaseComparisons : [];
      for (const comparison of seed.purchaseComparisons) {
        if (!purchaseComparisons.some((item) => item.id === comparison.id)) purchaseComparisons.push(comparison);
      }
      const contractMaterials = Array.isArray(value.contractMaterials) ? value.contractMaterials : [];
      for (const material of seed.contractMaterials) {
        if (!contractMaterials.some((item) => item.id === material.id)) contractMaterials.push(material);
      }
      const officeContracts = Array.isArray(value.officeContracts) ? value.officeContracts : [];
      for (const contract of seed.officeContracts) {
        if (!officeContracts.some((item) => item.id === contract.id)) officeContracts.push(contract);
      }
      const sealRequests = Array.isArray(value.sealRequests) ? value.sealRequests : [];
      for (const seal of seed.sealRequests) {
        if (!sealRequests.some((item) => item.id === seal.id)) sealRequests.push(seal);
      }
      const adminAssets = Array.isArray(value.adminAssets) ? value.adminAssets : [];
      for (const asset of seed.adminAssets) {
        if (!adminAssets.some((item) => item.id === asset.id)) adminAssets.push(asset);
      }
      const assetMovements = Array.isArray(value.assetMovements) ? value.assetMovements : [];
      for (const movement of seed.assetMovements) {
        if (!assetMovements.some((item) => item.id === movement.id)) assetMovements.push(movement);
      }
      const adminResources = Array.isArray(value.adminResources) ? value.adminResources : [];
      for (const resource of seed.adminResources) {
        if (!adminResources.some((item) => item.id === resource.id)) adminResources.push(resource);
      }
      const resourceReservations = Array.isArray(value.resourceReservations) ? value.resourceReservations : [];
      for (const reservation of seed.resourceReservations) {
        if (!resourceReservations.some((item) => item.id === reservation.id)) resourceReservations.push(reservation);
      }
      const repairTickets = Array.isArray(value.repairTickets) ? value.repairTickets : [];
      for (const ticket of seed.repairTickets) {
        if (!repairTickets.some((item) => item.id === ticket.id)) repairTickets.push(ticket);
      }
      const officeProjects = Array.isArray(value.officeProjects) ? value.officeProjects : [];
      for (const project of seed.officeProjects) {
        if (!officeProjects.some((item) => item.id === project.id)) officeProjects.push(project);
      }
      const projectTasks = Array.isArray(value.projectTasks) ? value.projectTasks : [];
      for (const task of seed.projectTasks) {
        if (!projectTasks.some((item) => item.id === task.id)) projectTasks.push(task);
      }
      const projectMilestones = Array.isArray(value.projectMilestones) ? value.projectMilestones : [];
      for (const milestone of seed.projectMilestones) {
        if (!projectMilestones.some((item) => item.id === milestone.id)) projectMilestones.push(milestone);
      }
      const itSystems = Array.isArray(value.itSystems) ? value.itSystems : [];
      for (const system of seed.itSystems) {
        if (!itSystems.some((item) => item.id === system.id)) itSystems.push(system);
      }
      const itPermissions = Array.isArray(value.itPermissions) ? value.itPermissions : [];
      for (const permission of seed.itPermissions) {
        if (!itPermissions.some((item) => item.id === permission.id)) itPermissions.push(permission);
      }
      const accessMaterials = Array.isArray(value.accessMaterials) ? value.accessMaterials : [];
      for (const material of seed.accessMaterials) {
        if (!accessMaterials.some((item) => item.id === material.id)) accessMaterials.push(material);
      }
      const itTickets = Array.isArray(value.itTickets) ? value.itTickets : [];
      for (const ticket of seed.itTickets) {
        if (!itTickets.some((item) => item.id === ticket.id)) itTickets.push(ticket);
      }
      const itTicketEvents = Array.isArray(value.itTicketEvents) ? value.itTicketEvents : [];
      for (const event of seed.itTicketEvents) {
        if (!itTicketEvents.some((item) => item.id === event.id)) itTicketEvents.push(event);
      }
      const officeReportJobs = Array.isArray(value.officeReportJobs) ? value.officeReportJobs : [];
      for (const job of seed.officeReportJobs) {
        if (!officeReportJobs.some((item) => item.id === job.id)) officeReportJobs.push(job);
      }
      const officeArchives = Array.isArray(value.officeArchives) ? value.officeArchives : [];
      for (const archive of seed.officeArchives) {
        if (!officeArchives.some((item) => item.id === archive.id)) officeArchives.push(archive);
      }
      const officeArchiveOperations = Array.isArray(value.officeArchiveOperations) ? value.officeArchiveOperations : [];
      for (const operation of seed.officeArchiveOperations) {
        if (!officeArchiveOperations.some((item) => item.id === operation.id)) officeArchiveOperations.push(operation);
      }
      const riskRules = Array.isArray(value.riskRules) ? value.riskRules : [];
      for (const rule of seed.riskRules) {
        if (!riskRules.some((item) => item.id === rule.id && item.version === rule.version)) riskRules.push(rule);
      }
      const riskAlerts = Array.isArray(value.riskAlerts) ? value.riskAlerts : [];
      for (const alert of seed.riskAlerts) {
        if (!riskAlerts.some((item) => item.id === alert.id)) riskAlerts.push(alert);
      }
      const riskEvidence = Array.isArray(value.riskEvidence) ? value.riskEvidence : [];
      for (const evidence of seed.riskEvidence) {
        if (!riskEvidence.some((item) => item.id === evidence.id)) riskEvidence.push(evidence);
      }
      const riskInvestigations = Array.isArray(value.riskInvestigations) ? value.riskInvestigations : [];
      for (const investigation of seed.riskInvestigations) {
        if (!riskInvestigations.some((item) => item.id === investigation.id)) riskInvestigations.push(investigation);
      }
      const riskReviews = Array.isArray(value.riskReviews) ? value.riskReviews : [];
      for (const review of seed.riskReviews) {
        if (!riskReviews.some((item) => item.id === review.id)) riskReviews.push(review);
      }
      const institutionProfiles = Array.isArray(value.institutionProfiles) ? value.institutionProfiles : [];
      for (const profile of seed.institutionProfiles) {
        if (!institutionProfiles.some((item) => item.id === profile.id)) institutionProfiles.push(profile);
      }
      const institutionMaterials = Array.isArray(value.institutionMaterials) ? value.institutionMaterials : [];
      for (const material of seed.institutionMaterials) {
        if (!institutionMaterials.some((item) => item.id === material.id)) institutionMaterials.push(material);
      }
      const institutionNeeds = Array.isArray(value.institutionNeeds) ? value.institutionNeeds : [];
      for (const need of seed.institutionNeeds) {
        if (!institutionNeeds.some((item) => item.id === need.id)) institutionNeeds.push(need);
      }
      const travelRequests = Array.isArray(value.travelRequests) ? value.travelRequests : [];
      for (const request of seed.travelRequests) {
        if (
          value.forms.some((form) => form.id === request.formId) &&
          !travelRequests.some((item) => item.formId === request.formId)
        ) {
          travelRequests.push(request);
        }
      }
      const clientCases = Array.isArray(value.clientCases) ? value.clientCases : [];
      for (const clientCase of seed.clientCases) {
        if (!clientCases.some((item) => item.clientId === clientCase.clientId)) clientCases.push(clientCase);
      }
      const researchTopics = Array.isArray(value.researchTopics) ? value.researchTopics : [];
      for (const topic of seed.researchTopics) {
        if (!researchTopics.some((item) => item.id === topic.id)) researchTopics.push(topic);
      }
      const researchReports = Array.isArray(value.researchReports) ? value.researchReports : [];
      for (const report of seed.researchReports) {
        if (!researchReports.some((item) => item.id === report.id)) researchReports.push(report);
      }
      const researchDocumentVersions = Array.isArray(value.researchDocumentVersions)
        ? value.researchDocumentVersions
        : [];
      for (const version of seed.researchDocumentVersions) {
        if (!researchDocumentVersions.some((item) => item.id === version.id)) researchDocumentVersions.push(version);
      }
      const ibIssuers = Array.isArray(value.ibIssuers) ? value.ibIssuers : [];
      for (const issuer of seed.ibIssuers) {
        if (!ibIssuers.some((item) => item.id === issuer.id)) ibIssuers.push(issuer);
      }
      const ibProjects = Array.isArray(value.ibProjects) ? value.ibProjects : [];
      for (const project of seed.ibProjects) {
        if (!ibProjects.some((item) => item.id === project.id)) ibProjects.push(project);
      }
      const ibAssignments = Array.isArray(value.ibAssignments) ? value.ibAssignments : [];
      for (const assignment of seed.ibAssignments) {
        if (!ibAssignments.some((item) => item.id === assignment.id)) ibAssignments.push(assignment);
      }
      const ibWorkpapers = Array.isArray(value.ibWorkpapers) ? value.ibWorkpapers : [];
      for (const workpaper of seed.ibWorkpapers) {
        if (!ibWorkpapers.some((item) => item.id === workpaper.id)) ibWorkpapers.push(workpaper);
      }
      const ibFindings = Array.isArray(value.ibFindings) ? value.ibFindings : [];
      for (const finding of seed.ibFindings) {
        if (!ibFindings.some((item) => item.id === finding.id)) ibFindings.push(finding);
      }
      for (const todo of seed.todos) {
        if (!value.todos.some((item) => item.id === todo.id)) value.todos.push(todo);
      }
      return {
        ...value,
        schemaVersion: 24,
        officeTeams,
        contactGroups,
        notices,
        noticePublications,
        noticeReceipts,
        noticeReminders: Array.isArray(value.noticeReminders) ? value.noticeReminders : [],
        mailMessages,
        mailAttachments,
        mailReplies,
        mailSendRecords: Array.isArray(value.mailSendRecords) ? value.mailSendRecords : [],
        officeDiscussions,
        meetingResources,
        meetings,
        meetingNotifications: Array.isArray(value.meetingNotifications) ? value.meetingNotifications : [],
        meetingMinutes: Array.isArray(value.meetingMinutes) ? value.meetingMinutes : [],
        travelRequests,
        expenseClaims: Array.isArray(value.expenseClaims) ? value.expenseClaims : [],
        suitabilityPolicy: value.suitabilityPolicy ?? seed.suitabilityPolicy,
        clientCases,
        suitabilityAssessments: Array.isArray(value.suitabilityAssessments) ? value.suitabilityAssessments : [],
        suitabilityMatches: Array.isArray(value.suitabilityMatches) ? value.suitabilityMatches : [],
        clientReviews: Array.isArray(value.clientReviews) ? value.clientReviews : [],
        researchPolicy: value.researchPolicy ?? seed.researchPolicy,
        researchTopics,
        researchReports,
        researchDocumentVersions,
        researchChecks: Array.isArray(value.researchChecks) ? value.researchChecks : [],
        researchReviews: Array.isArray(value.researchReviews) ? value.researchReviews : [],
        researchPublications: Array.isArray(value.researchPublications) ? value.researchPublications : [],
        ibPolicy: value.ibPolicy ?? seed.ibPolicy,
        ibIssuers,
        ibProjects,
        ibAssignments,
        ibWorkpapers,
        ibFindings,
        ibQualitySubmissions: Array.isArray(value.ibQualitySubmissions) ? value.ibQualitySubmissions : [],
        ibReviews: Array.isArray(value.ibReviews) ? value.ibReviews : [],
        documentVersions,
        officeDocuments,
        officeDocumentApprovals,
        officeDocumentArchives: Array.isArray(value.officeDocumentArchives) ? value.officeDocumentArchives : [],
        sheetRows,
        sheetExports: Array.isArray(value.sheetExports) ? value.sheetExports : [],
        sheetPatchRecords: Array.isArray(value.sheetPatchRecords) ? value.sheetPatchRecords : [],
        officeApprovalMaterials,
        officeApprovalRequests,
        officeApprovalDecisions,
        officeApprovalOperationRecords: Array.isArray(value.officeApprovalOperationRecords)
          ? value.officeApprovalOperationRecords
          : [],
        leaveBalances,
        leaveRequests: Array.isArray(value.leaveRequests) ? value.leaveRequests : [],
        attendanceCorrections: Array.isArray(value.attendanceCorrections) ? value.attendanceCorrections : [],
        personnelMaterials,
        personnelProfiles,
        personnelChanges: Array.isArray(value.personnelChanges) ? value.personnelChanges : [],
        trainingCourses,
        trainingEnrollments,
        hrOperationRecords: Array.isArray(value.hrOperationRecords) ? value.hrOperationRecords : [],
        procurementSuppliers,
        supplierProofs,
        supplierReviews: Array.isArray(value.supplierReviews) ? value.supplierReviews : [],
        purchaseRequests,
        purchaseComparisons,
        purchaseReceipts: Array.isArray(value.purchaseReceipts) ? value.purchaseReceipts : [],
        inventoryEntries: Array.isArray(value.inventoryEntries) ? value.inventoryEntries : [],
        procurementOperationRecords: Array.isArray(value.procurementOperationRecords)
          ? value.procurementOperationRecords
          : [],
        contractMaterials,
        officeContracts,
        sealRequests,
        contractOperationRecords: Array.isArray(value.contractOperationRecords) ? value.contractOperationRecords : [],
        adminAssets,
        assetMovements,
        adminResources,
        resourceReservations,
        repairTickets,
        adminOperationRecords: Array.isArray(value.adminOperationRecords) ? value.adminOperationRecords : [],
        officeProjects,
        projectTasks,
        projectMilestones,
        projectWeeklyReports: Array.isArray(value.projectWeeklyReports) ? value.projectWeeklyReports : [],
        projectOperationRecords: Array.isArray(value.projectOperationRecords) ? value.projectOperationRecords : [],
        itSystems,
        itPermissions,
        accessMaterials,
        accessRequests: Array.isArray(value.accessRequests) ? value.accessRequests : [],
        accessGrants: Array.isArray(value.accessGrants) ? value.accessGrants : [],
        itTickets,
        itTicketEvents,
        itOperationRecords: Array.isArray(value.itOperationRecords) ? value.itOperationRecords : [],
        officeReportJobs,
        officeArchives,
        officeArchiveOperations,
        reportOperationRecords: Array.isArray(value.reportOperationRecords) ? value.reportOperationRecords : [],
        riskRules,
        riskAlerts,
        riskEvidence,
        riskInvestigations,
        riskReviews,
        riskOperationRecords: Array.isArray(value.riskOperationRecords) ? value.riskOperationRecords : [],
        institutionPolicy: value.institutionPolicy ?? seed.institutionPolicy,
        institutionProfiles,
        institutionMaterials,
        institutionNeeds,
        roadshows: Array.isArray(value.roadshows) ? value.roadshows : [],
        institutionMaterialPackages: Array.isArray(value.institutionMaterialPackages)
          ? value.institutionMaterialPackages
          : [],
        roadshowInvitations: Array.isArray(value.roadshowInvitations) ? value.roadshowInvitations : [],
        institutionFollowups: Array.isArray(value.institutionFollowups) ? value.institutionFollowups : [],
        institutionOperationRecords: Array.isArray(value.institutionOperationRecords)
          ? value.institutionOperationRecords
          : [],
        auditEntries: Array.isArray(value.auditEntries) ? value.auditEntries : [],
        idempotencyRecords: Array.isArray(value.idempotencyRecords) ? value.idempotencyRecords : [],
        attachmentJobs: Array.isArray(value.attachmentJobs) ? value.attachmentJobs : []
      };
    } catch {
      return null;
    }
  }
}

export function createBrowserRepository(options: Omit<DemoRepositoryOptions, 'storage'> = {}): DemoRepository {
  let storage: DemoStorage | undefined;
  try {
    storage = window.localStorage;
  } catch {
    storage = undefined;
  }
  return new DemoRepository({ ...options, storage });
}

function isLegacyOrCurrentState(value: unknown): value is Omit<
  DemoState,
  | 'schemaVersion'
  | 'officeTeams'
  | 'contactGroups'
  | 'notices'
  | 'noticePublications'
  | 'noticeReceipts'
  | 'noticeReminders'
  | 'mailMessages'
  | 'mailAttachments'
  | 'mailReplies'
  | 'mailSendRecords'
  | 'officeDiscussions'
  | 'meetingResources'
  | 'meetings'
  | 'meetingNotifications'
  | 'meetingMinutes'
  | 'officeDocuments'
  | 'officeDocumentApprovals'
  | 'officeDocumentArchives'
  | 'sheetRows'
  | 'sheetExports'
  | 'sheetPatchRecords'
  | 'officeApprovalMaterials'
  | 'officeApprovalRequests'
  | 'officeApprovalDecisions'
  | 'officeApprovalOperationRecords'
  | 'leaveBalances'
  | 'leaveRequests'
  | 'attendanceCorrections'
  | 'personnelMaterials'
  | 'personnelProfiles'
  | 'personnelChanges'
  | 'trainingCourses'
  | 'trainingEnrollments'
  | 'hrOperationRecords'
  | 'procurementSuppliers'
  | 'supplierProofs'
  | 'supplierReviews'
  | 'purchaseRequests'
  | 'purchaseComparisons'
  | 'purchaseReceipts'
  | 'inventoryEntries'
  | 'procurementOperationRecords'
  | 'contractMaterials'
  | 'officeContracts'
  | 'sealRequests'
  | 'contractOperationRecords'
  | 'adminAssets'
  | 'assetMovements'
  | 'adminResources'
  | 'resourceReservations'
  | 'repairTickets'
  | 'adminOperationRecords'
  | 'officeProjects'
  | 'projectTasks'
  | 'projectMilestones'
  | 'projectWeeklyReports'
  | 'projectOperationRecords'
  | 'itSystems'
  | 'itPermissions'
  | 'accessMaterials'
  | 'accessRequests'
  | 'accessGrants'
  | 'itTickets'
  | 'itTicketEvents'
  | 'itOperationRecords'
  | 'officeReportJobs'
  | 'officeArchives'
  | 'officeArchiveOperations'
  | 'reportOperationRecords'
  | 'riskRules'
  | 'riskAlerts'
  | 'riskEvidence'
  | 'riskInvestigations'
  | 'riskReviews'
  | 'riskOperationRecords'
  | 'institutionPolicy'
  | 'institutionProfiles'
  | 'institutionMaterials'
  | 'institutionNeeds'
  | 'roadshows'
  | 'institutionMaterialPackages'
  | 'roadshowInvitations'
  | 'institutionFollowups'
  | 'institutionOperationRecords'
  | 'travelRequests'
  | 'expenseClaims'
  | 'suitabilityPolicy'
  | 'clientCases'
  | 'suitabilityAssessments'
  | 'suitabilityMatches'
  | 'clientReviews'
  | 'researchPolicy'
  | 'researchTopics'
  | 'researchReports'
  | 'researchDocumentVersions'
  | 'researchChecks'
  | 'researchReviews'
  | 'researchPublications'
  | 'ibPolicy'
  | 'ibIssuers'
  | 'ibProjects'
  | 'ibAssignments'
  | 'ibWorkpapers'
  | 'ibFindings'
  | 'ibQualitySubmissions'
  | 'ibReviews'
  | 'auditEntries'
  | 'idempotencyRecords'
  | 'attachmentJobs'
> & {
  schemaVersion:
    | 1
    | 2
    | 3
    | 4
    | 5
    | 6
    | 7
    | 8
    | 9
    | 10
    | 11
    | 12
    | 13
    | 14
    | 15
    | 16
    | 17
    | 18
    | 19
    | 20
    | 21
    | 22
    | 23
    | 24;
  officeTeams?: DemoState['officeTeams'];
  contactGroups?: DemoState['contactGroups'];
  notices?: DemoState['notices'];
  noticePublications?: DemoState['noticePublications'];
  noticeReceipts?: DemoState['noticeReceipts'];
  noticeReminders?: DemoState['noticeReminders'];
  mailMessages?: DemoState['mailMessages'];
  mailAttachments?: DemoState['mailAttachments'];
  mailReplies?: DemoState['mailReplies'];
  mailSendRecords?: DemoState['mailSendRecords'];
  officeDiscussions?: DemoState['officeDiscussions'];
  meetingResources?: DemoState['meetingResources'];
  meetings?: DemoState['meetings'];
  meetingNotifications?: DemoState['meetingNotifications'];
  meetingMinutes?: DemoState['meetingMinutes'];
  officeDocuments?: DemoState['officeDocuments'];
  officeDocumentApprovals?: DemoState['officeDocumentApprovals'];
  officeDocumentArchives?: DemoState['officeDocumentArchives'];
  sheetRows?: DemoState['sheetRows'];
  sheetExports?: DemoState['sheetExports'];
  sheetPatchRecords?: DemoState['sheetPatchRecords'];
  officeApprovalMaterials?: DemoState['officeApprovalMaterials'];
  officeApprovalRequests?: DemoState['officeApprovalRequests'];
  officeApprovalDecisions?: DemoState['officeApprovalDecisions'];
  officeApprovalOperationRecords?: DemoState['officeApprovalOperationRecords'];
  leaveBalances?: DemoState['leaveBalances'];
  leaveRequests?: DemoState['leaveRequests'];
  attendanceCorrections?: DemoState['attendanceCorrections'];
  personnelMaterials?: DemoState['personnelMaterials'];
  personnelProfiles?: DemoState['personnelProfiles'];
  personnelChanges?: DemoState['personnelChanges'];
  trainingCourses?: DemoState['trainingCourses'];
  trainingEnrollments?: DemoState['trainingEnrollments'];
  hrOperationRecords?: DemoState['hrOperationRecords'];
  procurementSuppliers?: DemoState['procurementSuppliers'];
  supplierProofs?: DemoState['supplierProofs'];
  supplierReviews?: DemoState['supplierReviews'];
  purchaseRequests?: DemoState['purchaseRequests'];
  purchaseComparisons?: DemoState['purchaseComparisons'];
  purchaseReceipts?: DemoState['purchaseReceipts'];
  inventoryEntries?: DemoState['inventoryEntries'];
  procurementOperationRecords?: DemoState['procurementOperationRecords'];
  contractMaterials?: DemoState['contractMaterials'];
  officeContracts?: DemoState['officeContracts'];
  sealRequests?: DemoState['sealRequests'];
  contractOperationRecords?: DemoState['contractOperationRecords'];
  adminAssets?: DemoState['adminAssets'];
  assetMovements?: DemoState['assetMovements'];
  adminResources?: DemoState['adminResources'];
  resourceReservations?: DemoState['resourceReservations'];
  repairTickets?: DemoState['repairTickets'];
  adminOperationRecords?: DemoState['adminOperationRecords'];
  officeProjects?: DemoState['officeProjects'];
  projectTasks?: DemoState['projectTasks'];
  projectMilestones?: DemoState['projectMilestones'];
  projectWeeklyReports?: DemoState['projectWeeklyReports'];
  projectOperationRecords?: DemoState['projectOperationRecords'];
  itSystems?: DemoState['itSystems'];
  itPermissions?: DemoState['itPermissions'];
  accessMaterials?: DemoState['accessMaterials'];
  accessRequests?: DemoState['accessRequests'];
  accessGrants?: DemoState['accessGrants'];
  itTickets?: DemoState['itTickets'];
  itTicketEvents?: DemoState['itTicketEvents'];
  itOperationRecords?: DemoState['itOperationRecords'];
  officeReportJobs?: DemoState['officeReportJobs'];
  officeArchives?: DemoState['officeArchives'];
  officeArchiveOperations?: DemoState['officeArchiveOperations'];
  reportOperationRecords?: DemoState['reportOperationRecords'];
  riskRules?: DemoState['riskRules'];
  riskAlerts?: DemoState['riskAlerts'];
  riskEvidence?: DemoState['riskEvidence'];
  riskInvestigations?: DemoState['riskInvestigations'];
  riskReviews?: DemoState['riskReviews'];
  riskOperationRecords?: DemoState['riskOperationRecords'];
  institutionPolicy?: DemoState['institutionPolicy'];
  institutionProfiles?: DemoState['institutionProfiles'];
  institutionMaterials?: DemoState['institutionMaterials'];
  institutionNeeds?: DemoState['institutionNeeds'];
  roadshows?: DemoState['roadshows'];
  institutionMaterialPackages?: DemoState['institutionMaterialPackages'];
  roadshowInvitations?: DemoState['roadshowInvitations'];
  institutionFollowups?: DemoState['institutionFollowups'];
  institutionOperationRecords?: DemoState['institutionOperationRecords'];
  travelRequests?: DemoState['travelRequests'];
  expenseClaims?: DemoState['expenseClaims'];
  suitabilityPolicy?: DemoState['suitabilityPolicy'];
  clientCases?: DemoState['clientCases'];
  suitabilityAssessments?: DemoState['suitabilityAssessments'];
  suitabilityMatches?: DemoState['suitabilityMatches'];
  clientReviews?: DemoState['clientReviews'];
  researchPolicy?: DemoState['researchPolicy'];
  researchTopics?: DemoState['researchTopics'];
  researchReports?: DemoState['researchReports'];
  researchDocumentVersions?: DemoState['researchDocumentVersions'];
  researchChecks?: DemoState['researchChecks'];
  researchReviews?: DemoState['researchReviews'];
  researchPublications?: DemoState['researchPublications'];
  ibPolicy?: DemoState['ibPolicy'];
  ibIssuers?: DemoState['ibIssuers'];
  ibProjects?: DemoState['ibProjects'];
  ibAssignments?: DemoState['ibAssignments'];
  ibWorkpapers?: DemoState['ibWorkpapers'];
  ibFindings?: DemoState['ibFindings'];
  ibQualitySubmissions?: DemoState['ibQualitySubmissions'];
  ibReviews?: DemoState['ibReviews'];
  auditEntries?: DemoState['auditEntries'];
  idempotencyRecords?: DemoState['idempotencyRecords'];
  attachmentJobs?: DemoState['attachmentJobs'];
} {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Omit<Partial<DemoState>, 'schemaVersion'> & { schemaVersion?: number };
  return (
    (candidate.schemaVersion === 1 ||
      candidate.schemaVersion === 2 ||
      candidate.schemaVersion === 3 ||
      candidate.schemaVersion === 4 ||
      candidate.schemaVersion === 5 ||
      candidate.schemaVersion === 6 ||
      candidate.schemaVersion === 7 ||
      candidate.schemaVersion === 8 ||
      candidate.schemaVersion === 9 ||
      candidate.schemaVersion === 10 ||
      candidate.schemaVersion === 11 ||
      candidate.schemaVersion === 12 ||
      candidate.schemaVersion === 13 ||
      candidate.schemaVersion === 14 ||
      candidate.schemaVersion === 15 ||
      candidate.schemaVersion === 16 ||
      candidate.schemaVersion === 17 ||
      candidate.schemaVersion === 18 ||
      candidate.schemaVersion === 19 ||
      candidate.schemaVersion === 20 ||
      candidate.schemaVersion === 21 ||
      candidate.schemaVersion === 22 ||
      candidate.schemaVersion === 23 ||
      candidate.schemaVersion === 24) &&
    Number.isSafeInteger(candidate.seed) &&
    !!candidate.company &&
    Array.isArray(candidate.departments) &&
    Array.isArray(candidate.employees) &&
    Array.isArray(candidate.clients) &&
    Array.isArray(candidate.products) &&
    Array.isArray(candidate.forms) &&
    Array.isArray(candidate.attachments) &&
    Array.isArray(candidate.documentVersions) &&
    Array.isArray(candidate.todos)
  );
}
