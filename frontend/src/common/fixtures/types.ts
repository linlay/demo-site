import type { RiskDossier, RiskInvestigationDraft } from '../risk/dossier';
import type { JsonObject } from '@app/awcp';

export type DemoRole =
  | 'workflow-initiator'
  | 'workflow-approver'
  | 'workflow-analyst'
  | 'employee'
  | 'manager'
  | 'reviewer'
  | 'analyst'
  | 'quality'
  | 'compliance'
  | 'publisher'
  | 'ib-manager'
  | 'ib-member'
  | 'ib-quality'
  | 'ib-committee'
  | 'hr'
  | 'it-coordinator'
  | 'it-agent'
  | 'risk-monitor'
  | 'risk-investigator'
  | 'risk-reviewer'
  | 'institution-sales'
  | 'research-service'
  | 'event-organizer';

export interface DemoCompany {
  id: string;
  name: string;
}

export interface Department {
  id: string;
  name: string;
  parentId: string | null;
}

export interface Employee {
  id: string;
  name: string;
  departmentId: string;
  roles: DemoRole[];
  active: boolean;
}

export interface OfficeTeam {
  id: string;
  name: string;
  projectId: string;
  ownerId: string;
  memberIds: string[];
  businessVersion: number;
}

export interface ContactGroup {
  id: string;
  name: string;
  ownerId: string;
  memberIds: string[];
  businessVersion: number;
}

export interface Notice {
  id: string;
  title: string;
  body: string;
  authorId: string;
  recipientDepartmentIds: string[];
  status: 'draft' | 'published';
  businessVersion: number;
  createdAt: string;
}

export interface NoticePublication {
  id: string;
  noticeId: string;
  recipientDepartmentIds: string[];
  recipientEmployeeIds: string[];
  publishedAt: string;
}

export interface NoticeReceipt {
  id: string;
  noticeId: string;
  employeeId: string;
  readAt: string | null;
}

export interface NoticeReminder {
  id: string;
  noticeId: string;
  employeeId: string;
  status: 'simulated';
  createdAt: string;
}

export interface MailMessage {
  id: string;
  senderId: string;
  recipientIds: string[];
  subject: string;
  body: string;
  attachmentIds: string[];
  folder: 'inbox' | 'archive';
  businessVersion: number;
  receivedAt: string;
}

export interface MailAttachment {
  id: string;
  ownerId: string;
  filename: string;
  mimeType: 'text/plain';
  content: string;
}

export interface MailReply {
  id: string;
  sourceMailId: string;
  authorId: string;
  recipientIds: string[];
  body: string;
  attachmentIds: string[];
  status: 'draft' | 'sent';
  businessVersion: number;
  createdAt: string;
}

export interface MailSendRecord {
  id: string;
  replyId: string;
  recipientIds: string[];
  body: string;
  attachmentIds: string[];
  sentAt: string;
  status: 'simulated';
}

export interface OfficeDiscussion {
  id: string;
  projectId: string;
  creatorId: string;
  title: string;
  body: string;
  createdAt: string;
}

export interface MeetingResource {
  id: string;
  name: string;
  capacity: number;
}

export interface Meeting {
  id: string;
  title: string;
  organizerId: string;
  participantIds: string[];
  resourceId: string;
  startAt: string;
  endAt: string;
  businessVersion: number;
  createdAt: string;
}

export interface MeetingNotification {
  id: string;
  meetingId: string;
  recipientIds: string[];
  previousResourceId: string;
  previousStartAt: string;
  previousEndAt: string;
  resourceId: string;
  startAt: string;
  endAt: string;
  status: 'simulated';
  createdAt: string;
}

export interface MeetingMinutes {
  id: string;
  meetingId: string;
  authorId: string;
  attendeeIds: string[];
  agenda: string;
  decisions: string[];
  actionItemIds: string[];
  templateLabel: '虚构会议纪要模板';
  meetingVersion: number;
  recordedAt: string;
}

export interface Client {
  id: string;
  name: string;
  kind: 'individual' | 'institution';
  managerId: string;
  riskLevel: 1 | 2 | 3 | 4 | 5;
}

export interface Product {
  id: string;
  name: string;
  riskLevel: 1 | 2 | 3 | 4 | 5;
  active: boolean;
}

export interface SuitabilityPolicy {
  version: number;
  questionnaireMaxAgeDays: number;
  matchingRule: 'product-risk-at-most-assessed-risk';
}

export interface SuitabilityQuestionnaire extends JsonObject {
  riskTolerance: 1 | 2 | 3 | 4 | 5;
  lossCapacity: 1 | 2 | 3 | 4 | 5;
  answeredAt: string;
}

export interface ClientCase {
  clientId: string;
  businessVersion: number;
  status: 'draft' | 'submitted' | 'returned' | 'approved' | 'archived';
  identityDocumentNo: string | null;
  contactPhone: string | null;
  questionnaire: SuitabilityQuestionnaire | null;
  archivedAt: string | null;
}

export interface SuitabilityAssessment {
  id: string;
  clientId: string;
  businessVersion: number;
  policyVersion: number;
  riskLevel: 1 | 2 | 3 | 4 | 5;
  evaluatedAt: string;
}

export interface SuitabilityMatch {
  id: string;
  clientId: string;
  businessVersion: number;
  policyVersion: number;
  productId: string;
  eligible: boolean;
  reason: string;
  matchedAt: string;
}

export interface ClientReview {
  id: string;
  clientId: string;
  submittedVersion: number;
  submitterId: string;
  reviewerId: string;
  status: 'pending' | 'approved' | 'returned';
  reason: string | null;
  submittedAt: string;
  decidedAt: string | null;
}

export interface ResearchPolicy {
  version: number;
  minimumCitations: number;
  minimumDisclosures: number;
}

export interface ResearchTopic {
  id: string;
  title: string;
  analystId: string;
  createdAt: string;
}

export interface ResearchReport {
  id: string;
  topicId: string;
  authorId: string;
  status: 'draft' | 'quality-review' | 'compliance-review' | 'returned' | 'approved' | 'published' | 'archived';
  businessVersion: number;
  documentVersion: number;
  archivedAt: string | null;
}

export interface ResearchDocumentVersion {
  id: string;
  reportId: string;
  version: number;
  title: string;
  content: string;
  citations: string[];
  disclosures: string[];
  authorId: string;
  createdAt: string;
}

export interface ResearchCheck {
  id: string;
  reportId: string;
  documentVersion: number;
  businessVersion: number;
  policyVersion: number;
  checkedBy: string;
  checkedAt: string;
}

export interface ResearchReview {
  id: string;
  reportId: string;
  documentVersion: number;
  policyVersion: number;
  stage: 'quality' | 'compliance';
  decision: 'approve' | 'return';
  reviewerId: string;
  reason: string | null;
  reviewedAt: string;
}

export interface ResearchPublication {
  id: string;
  reportId: string;
  documentVersion: number;
  policyVersion: number;
  scope: 'internal' | 'clients';
  publisherId: string;
  publishedAt: string;
}

export type IbWorkpaperKind = 'financial' | 'legal';

export interface IbPolicy {
  version: number;
  requiredWorkpaperKinds: IbWorkpaperKind[];
  blockingSeverity: 'blocking';
}

export interface IbIssuer {
  id: string;
  name: string;
  industry: string;
}

export interface IbProject {
  id: string;
  issuerId: string;
  title: string;
  managerId: string;
  status:
    | 'draft'
    | 'initiated'
    | 'diligence'
    | 'quality-review'
    | 'committee-review'
    | 'returned'
    | 'approved'
    | 'archived';
  businessVersion: number;
  lastReturnVersion: number | null;
  createdAt: string;
  archivedAt: string | null;
}

export interface IbAssignment {
  id: string;
  projectId: string;
  kind: IbWorkpaperKind;
  memberId: string;
  assignedBy: string;
  assignedAt: string;
}

export interface IbWorkpaperVersion {
  id: string;
  projectId: string;
  kind: IbWorkpaperKind;
  version: number;
  assetId: string;
  summary: string;
  memberId: string;
  businessVersion: number;
  submittedAt: string;
}

export interface IbFinding {
  id: string;
  projectId: string;
  severity: 'blocking' | 'minor';
  description: string;
  status: 'open' | 'resolved';
  openedBy: string;
  openedAt: string;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

export interface IbWorkpaperSnapshot {
  kind: IbWorkpaperKind;
  version: number;
}

export interface IbQualitySubmission {
  id: string;
  projectId: string;
  policyVersion: number;
  businessVersion: number;
  workpaperVersions: IbWorkpaperSnapshot[];
  submittedAt: string;
}

export interface IbReview {
  id: string;
  projectId: string;
  submissionId: string;
  policyVersion: number;
  stage: 'quality' | 'committee';
  decision: 'approve' | 'return';
  reviewerId: string;
  reason: string | null;
  reviewedAt: string;
}

export interface BusinessForm {
  id: string;
  kind: 'travel' | 'expense' | 'general';
  applicantId: string;
  departmentId: string;
  status: 'draft' | 'submitted' | 'approved' | 'returned';
  businessVersion: number;
  amountCents: number;
  createdAt: string;
}

export interface TravelRequest {
  formId: string;
  origin: string;
  destination: string;
  startAt: string;
  endAt: string;
  travelerIds: string[];
}

export interface ExpenseReceipt {
  [key: string]: string | number;
  invoiceNo: string;
  assetId: string;
  amountCents: number;
}

export interface ExpenseLineItem {
  [key: string]: string | number;
  category: 'transport' | 'hotel' | 'meal' | 'other';
  invoiceNo: string;
  amountCents: number;
}

export interface ExpenseClaim {
  formId: string;
  travelFormId: string;
  receipts: ExpenseReceipt[];
  lineItems: ExpenseLineItem[];
  declaredTotalCents: number;
  checkedVersion: number;
}

export interface Attachment {
  assetId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  ownerId: string;
}

export interface DocumentVersion {
  id: string;
  documentId: string;
  version: number;
  title: string;
  content: string;
  blocks: DocumentBlock[];
  authorId: string;
  createdAt: string;
}

export interface DocumentBlock {
  id: string;
  kind: 'heading' | 'paragraph';
  text: string;
}

export interface OfficeDocument {
  id: string;
  source: string;
  ownerId: string;
  reviewerId: string;
  currentVersion: number;
  status: 'draft' | 'approved' | 'archived';
  businessVersion: number;
}

export interface OfficeDocumentApproval {
  id: string;
  documentId: string;
  documentVersion: number;
  reviewerId: string;
  approvedAt: string;
}

export interface OfficeDocumentArchive {
  id: string;
  documentId: string;
  documentVersion: number;
  approvalId: string;
  archivedBy: string;
  archivedAt: string;
}

export interface SheetRow {
  id: string;
  departmentId: string;
  label: string;
  amountCents: number;
  status: 'draft' | 'confirmed';
  businessVersion: number;
}

export interface SheetExport {
  assetId: string;
  actorId: string;
  idempotencyKey: string;
  fingerprint: string;
  filename: string;
  mimeType: 'text/csv';
  content: string;
  rowCount: number;
  createdAt: string;
}

export interface SheetPatchRecord {
  idempotencyKey: string;
  fingerprint: string;
  rows: SheetRow[];
}

export interface OfficeApprovalMaterial {
  id: string;
  name: string;
}

export interface OfficeApprovalRequest {
  id: string;
  applicantId: string;
  departmentId: string;
  reviewerId: string;
  title: string;
  description: string;
  materialIds: string[];
  status: 'submitted' | 'approved' | 'returned' | 'withdrawn';
  businessVersion: number;
  currentTaskId: string | null;
  createdAt: string;
}

export interface OfficeApprovalDecision {
  id: string;
  requestId: string;
  taskId: string;
  action: 'approve' | 'return' | 'withdraw';
  actorId: string;
  opinion: string;
  businessVersion: number;
  decidedAt: string;
}

export interface OfficeApprovalOperationRecord {
  idempotencyKey: string;
  operation: 'submit' | 'approve' | 'return' | 'withdraw';
  fingerprint: string;
  result: {
    requestId: string;
    taskId: string | null;
    status: OfficeApprovalRequest['status'];
    businessVersion: number;
  };
}

export interface LeaveBalance {
  employeeId: string;
  totalDays: number;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: 'submitted';
  businessVersion: number;
  submittedAt: string;
}

export interface AttendanceCorrection {
  id: string;
  employeeId: string;
  date: string;
  checkIn: string;
  checkOut: string;
  reason: string;
  status: 'submitted';
  businessVersion: number;
  submittedAt: string;
}

export interface PersonnelMaterial {
  id: string;
  name: string;
  kind: 'identity' | 'contract' | 'transfer-order' | 'role-approval' | 'exit-checklist';
}

export interface PersonnelProfile {
  employeeId: string;
  position: string;
  businessVersion: number;
}

export interface PersonnelChange {
  id: string;
  employeeId: string;
  kind: 'onboard' | 'transfer' | 'role-change' | 'offboard';
  actorId: string;
  materialIds: string[];
  beforeDepartmentId: string;
  afterDepartmentId: string;
  beforeActive: boolean;
  afterActive: boolean;
  beforePosition: string;
  afterPosition: string;
  businessVersion: number;
  archivedAt: string;
}

export interface TrainingCourse {
  id: string;
  title: string;
  capacity: number;
}

export interface TrainingEnrollment {
  id: string;
  courseId: string;
  employeeId: string;
  status: 'enrolled' | 'completed';
  businessVersion: number;
  enrolledAt: string;
  completedAt: string | null;
  completedBy: string | null;
}

export interface HrOperationRecord {
  idempotencyKey: string;
  operation: 'leave.submit' | 'attendance.correct' | 'personnel.process' | 'training.enroll' | 'training.complete';
  fingerprint: string;
  result: {
    id: string;
    employeeId: string;
    status: string;
    businessVersion: number;
  };
}

export interface ProcurementSupplier {
  id: string;
  name: string;
  status: 'pending' | 'approved' | 'rejected';
  businessVersion: number;
}

export interface SupplierProof {
  id: string;
  supplierId: string;
  kind: 'registration' | 'tax';
  expiresOn: string;
}

export interface SupplierReview {
  id: string;
  supplierId: string;
  reviewerId: string;
  decision: 'approved' | 'rejected';
  proofIds: string[];
  note: string;
  businessVersion: number;
  reviewedAt: string;
}

export interface PurchaseRequest {
  id: string;
  requesterId: string;
  itemName: string;
  quantity: number;
  status: 'draft' | 'selected';
  selectedSupplierId: string | null;
  unitPriceCents: number | null;
  totalCents: number | null;
  businessVersion: number;
  createdAt: string;
}

export interface PurchaseComparison {
  id: string;
  requestId: string;
  quotes: Array<{ supplierId: string; unitPriceCents: number; totalCents: number }>;
  selectedSupplierId: string;
  selectedTotalCents: number;
  comparedAt: string;
}

export interface PurchaseReceipt {
  id: string;
  requestId: string;
  actorId: string;
  quantity: number;
  acceptedAt: string;
}

export interface InventoryEntry {
  id: string;
  receiptId: string;
  requestId: string;
  itemName: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
}

export interface ProcurementOperationRecord {
  idempotencyKey: string;
  operation: 'create' | 'compare' | 'supplier.review' | 'receipt.accept';
  fingerprint: string;
  result: { id: string; status: string; businessVersion: number };
}

export interface ContractMaterial {
  id: string;
  name: string;
  expiresOn: string;
  contractId: string | null;
}

export interface OfficeContract {
  id: string;
  ownerId: string;
  companyId: string;
  counterpartyName: string;
  startDate: string;
  endDate: string;
  amountCents: number;
  materialIds: string[];
  businessVersion: number;
  renewedFromContractId: string | null;
  sourceVersion: number | null;
  createdAt: string;
}

export interface SealRequest {
  id: string;
  contractId: string;
  contractVersion: number;
  applicantId: string;
  purpose: string;
  materialIds: string[];
  status: 'pending' | 'approved' | 'rejected' | 'executed';
  reviewerId: string | null;
  decisionNote: string | null;
  businessVersion: number;
  submittedAt: string;
  decidedAt: string | null;
  executedAt: string | null;
}

export interface ContractOperationRecord {
  idempotencyKey: string;
  operation: 'register' | 'seal.submit' | 'seal.review' | 'seal.execute' | 'renewal.create';
  fingerprint: string;
  result: { id: string; status: string; businessVersion: number };
}

export interface AdminAsset {
  id: string;
  name: string;
  status: 'available' | 'assigned' | 'repair';
  holderId: string | null;
  businessVersion: number;
}

export interface AssetMovement {
  id: string;
  assetId: string;
  holderId: string;
  actorId: string;
  action: 'assign' | 'return';
  at: string;
}

export interface AdminResource {
  id: string;
  name: string;
  kind: 'meeting-room' | 'vehicle';
  capacity: number;
  authorizedDriverIds: string[];
}

export interface ResourceReservation {
  id: string;
  resourceId: string;
  actorId: string;
  participantIds: string[];
  driverId: string | null;
  startAt: string;
  endAt: string;
  status: 'reserved';
  createdAt: string;
}

export interface RepairTicket {
  id: string;
  assetId: string;
  reporterId: string;
  assigneeId: string;
  issue: string;
  status: 'open' | 'resolved' | 'accepted';
  resolution: string | null;
  businessVersion: number;
  resolvedAt: string | null;
  acceptedAt: string | null;
}

export interface AdminOperationRecord {
  idempotencyKey: string;
  operation: 'asset.assign' | 'asset.return' | 'resource.reserve' | 'repair.resolve' | 'repair.accept';
  fingerprint: string;
  result: { id: string; status: string; businessVersion: number };
}

export interface OfficeProject {
  id: string;
  title: string;
  ownerId: string;
  memberIds: string[];
  dueDate: string;
  businessVersion: number;
  createdAt: string;
}

export interface ProjectTask {
  id: string;
  projectId: string;
  title: string;
  assigneeId: string;
  dueDate: string;
  dependencyIds: string[];
  status: 'open' | 'done';
  businessVersion: number;
  createdAt: string;
  completedAt: string | null;
}

export interface ProjectMilestone {
  id: string;
  projectId: string;
  title: string;
  dueDate: string;
  taskIds: string[];
  businessVersion: number;
}

export interface ProjectWeeklyReport {
  id: string;
  projectId: string;
  generatedBy: string;
  generatedAt: string;
  weekStart: string;
  weekEnd: string;
  taskFacts: Array<{
    id: string;
    status: 'open' | 'done';
    assigneeId: string;
    dueDate: string;
    businessVersion: number;
    dependencyIds: string[];
  }>;
  incompleteTaskIds: string[];
  overdueTaskIds: string[];
  milestoneFacts: Array<{ id: string; status: 'pending' | 'in-progress' | 'overdue' | 'completed' }>;
}

export interface ProjectOperationRecord {
  idempotencyKey: string;
  operation: 'project.create' | 'task.create' | 'task.update' | 'milestone.upsert' | 'weekly-report.generate';
  fingerprint: string;
  result: { id: string; status: string; businessVersion: number };
}

export interface ItSystem {
  id: string;
  name: string;
}

export interface ItPermission {
  id: string;
  systemId: string;
  name: string;
  allowedRoles: DemoRole[];
  requiredMaterialKinds: Array<AccessMaterial['kind']>;
}

export interface AccessMaterial {
  id: string;
  ownerId: string;
  kind: 'identity' | 'training' | 'manager-approval';
  expiresOn: string;
}

export interface AccessRequest {
  id: string;
  applicantId: string;
  systemId: string;
  permissionId: string;
  materialIds: string[];
  reason: string;
  status: 'pending';
  reviewerId: string;
  businessVersion: number;
  submittedAt: string;
}

export interface AccessGrant {
  id: string;
  requestId: string;
  employeeId: string;
  permissionId: string;
  status: 'simulated';
  grantedAt: string;
}

export interface ItTicket {
  id: string;
  title: string;
  requesterId: string;
  assigneeId: string | null;
  status: 'new' | 'assigned' | 'resolved' | 'closed';
  resolution: string | null;
  acceptanceNote: string | null;
  businessVersion: number;
  createdAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
}

export interface ItTicketEvent {
  id: string;
  ticketId: string;
  actorId: string;
  fromStatus: ItTicket['status'];
  toStatus: ItTicket['status'];
  note: string;
  businessVersion: number;
  at: string;
}

export interface ItOperationRecord {
  idempotencyKey: string;
  operation: 'access.request' | 'ticket.assign' | 'ticket.resolve' | 'ticket.close';
  fingerprint: string;
  result: { id: string; status: string; businessVersion: number };
}

export interface OfficeReportRow {
  sourceType: 'project-task' | 'purchase-request' | 'it-ticket';
  sourceId: string;
  sourceVersion: number;
  departmentId: string;
  occurredOn: string;
  title: string;
  sourceStatus: string;
  anomalyReason: string | null;
}

export interface OfficeReportJob {
  id: string;
  actorId: string;
  departmentId: string;
  startDate: string;
  endDate: string;
  status: 'accepted' | 'completed';
  unit: '件';
  totalCount: number | null;
  anomalyCount: number | null;
  rows: OfficeReportRow[];
  acceptedAt: string;
  completedAt: string | null;
}

export interface OfficeArchiveVersion {
  version: number;
  reportId: string;
  departmentId: string;
  startDate: string;
  endDate: string;
  unit: '件';
  totalCount: number;
  anomalyCount: number;
  rows: OfficeReportRow[];
  savedAt: string;
}

export interface OfficeArchive {
  id: string;
  ownerId: string;
  currentVersion: number;
  versions: OfficeArchiveVersion[];
}

export interface OfficeArchiveOperation {
  id: string;
  archiveId: string;
  actorId: string;
  action: 'save';
  version: number;
  reportId: string;
  at: string;
}

export interface ReportOperationRecord {
  idempotencyKey: string;
  operation: 'report.generate' | 'archive.save';
  fingerprint: string;
  resultId: string;
  resultVersion: number | null;
}

export type RiskEvidenceKind = 'activity-log' | 'identity-check' | 'project-metric' | 'review-note';
export interface RiskRule {
  id: string;
  version: number;
  name: string;
  threshold: number;
  unit: string;
  requiredEvidenceKinds: RiskEvidenceKind[];
}
export interface RiskAlert {
  investigationDraft?: RiskInvestigationDraft;
  id: string;
  title: string;
  sourceType: 'client' | 'ib-project';
  sourceId: string;
  ruleId: string;
  ruleVersion: number;
  observedValue: number;
  status: 'new' | 'investigating' | 'pending-review' | 'returned' | 'approved' | 'closed' | 'escalated';
  assigneeId: string | null;
  latestInvestigationId: string | null;
  latestReviewId: string | null;
  businessVersion: number;
  createdAt: string;
  completedAt: string | null;
}
export interface RiskEvidence {
  id: string;
  alertId: string | null;
  sourceType: RiskAlert['sourceType'];
  sourceId: string;
  kind: RiskEvidenceKind;
  summary: string;
  verified: boolean;
}
export interface RiskInvestigation {
  dossier?: RiskDossier;
  id: string;
  alertId: string;
  investigatorId: string;
  evidenceIds: string[];
  analysis: string;
  conclusion: 'false-positive' | 'confirmed';
  proposedDisposition: 'close' | 'escalate';
  ruleVersion: number;
  alertVersion: number;
  recordedAt: string;
}
export interface RiskReview {
  id: string;
  alertId: string;
  investigationId: string;
  reviewerId: string;
  decision: 'approve' | 'return';
  reason: string;
  alertVersion: number;
  reviewedAt: string;
}
export interface RiskOperationRecord {
  idempotencyKey: string;
  operation: 'investigation.draft.save' | 'alert.assign' | 'alert.evidence.attach' | 'investigation.record' | 'alert.review' | 'alert.close';
  fingerprint: string;
  result: { alertId: string; status: RiskAlert['status']; businessVersion: number };
}

export interface InstitutionServicePolicy {
  version: number;
  maxMeetingMinutes: number;
  serviceScope: 'research-roadshow';
}
export interface InstitutionProfile {
  id: string;
  clientId: string;
  salesId: string;
  researchId: string;
  organizerId: string;
  projectId: string;
  contactGroupId: string;
  scopes: Array<'research-roadshow'>;
  policyVersion: number;
}
export interface InstitutionMaterial {
  id: string;
  title: string;
  documentId: string;
  documentVersion: number;
  scope: 'research-roadshow' | 'internal';
}
export interface InstitutionNeed {
  id: string;
  institutionId: string;
  title: string;
  requestedMaterialIds: string[];
  status: 'new' | 'returned' | 'reserved' | 'packaged' | 'invited' | 'minutes-recorded' | 'completed';
  returnReason: string | null;
  roadshowId: string | null;
  businessVersion: number;
  createdAt: string;
}
export interface Roadshow {
  id: string;
  needId: string;
  meetingId: string;
  packageId: string | null;
  invitationId: string | null;
  minutesId: string | null;
  followupId: string | null;
  createdAt: string;
}
export interface InstitutionMaterialPackage {
  id: string;
  roadshowId: string;
  materialIds: string[];
  documentRefs: Array<{ documentId: string; version: number }>;
  policyVersion: number;
  createdBy: string;
  createdAt: string;
}
export interface RoadshowInvitation {
  id: string;
  roadshowId: string;
  meetingId: string;
  recipientLabel: string;
  status: 'simulated';
  createdBy: string;
  createdAt: string;
}
export interface InstitutionFollowup {
  id: string;
  needId: string;
  roadshowId: string;
  actorId: string;
  note: string;
  outcome: 'satisfied' | 'needs-action';
  recordedAt: string;
}
export interface InstitutionOperationRecord {
  idempotencyKey: string;
  operation:
    | 'need.revise'
    | 'roadshow.reserve'
    | 'package.create'
    | 'roadshow.invite'
    | 'roadshow.minutes'
    | 'service.followup';
  fingerprint: string;
  result: { needId: string; status: InstitutionNeed['status']; businessVersion: number; roadshowId: string | null };
}

export interface Todo {
  id: string;
  title: string;
  assigneeId: string;
  sourceType: 'form' | 'document' | 'client' | 'research' | 'ib-project' | 'discussion' | 'meeting' | 'approval';
  sourceId: string;
  dueAt: string;
  status: 'open' | 'done';
  completedAt?: string | null;
}

export interface BusinessAuditEntry {
  id: string;
  entityType:
    | 'form'
    | 'attachment-job'
    | 'client'
    | 'research'
    | 'ib-project'
    | 'office-team'
    | 'contact-group'
    | 'notice'
    | 'mail'
    | 'mail-reply'
    | 'discussion'
    | 'meeting'
    | 'document'
    | 'sheet-row'
    | 'approval'
    | 'leave'
    | 'attendance-correction'
    | 'personnel-change'
    | 'training-enrollment'
    | 'purchase-request'
    | 'supplier'
    | 'purchase-receipt'
    | 'office-contract'
    | 'seal-request'
    | 'admin-asset'
    | 'resource-reservation'
    | 'repair-ticket'
    | 'office-project'
    | 'project-task'
    | 'project-milestone'
    | 'project-weekly-report'
    | 'access-request'
    | 'it-ticket'
    | 'office-report'
    | 'office-archive'
    | 'risk-alert'
    | 'institution-need';
  entityId: string;
  action: string;
  actorId: string;
  at: string;
  fromStatus: string | null;
  toStatus: string;
  businessVersion: number | null;
  note?: string;
}

export interface BusinessIdempotencyRecord {
  key: string;
  operation: string;
  fingerprint: string;
  resultId: string;
  resultVersion: number | null;
  resultStatus: string;
  resultAmountCents?: number;
  resultDocumentVersion?: number;
}

export interface AttachmentJob {
  id: string;
  assetId: string;
  formId: string;
  actorId: string;
  status: 'accepted' | 'completed' | 'failed' | 'cancelled';
  acceptedAt: string;
  finishedAt: string | null;
  failureReason: string | null;
}

export interface DemoState {
  workflowProfile?: 'two-account' | 'coarse-roles';
  workbenchSampleVersion?: 1;
  schemaVersion: 24;
  seed: number;
  company: DemoCompany;
  departments: Department[];
  employees: Employee[];
  officeTeams: OfficeTeam[];
  contactGroups: ContactGroup[];
  notices: Notice[];
  noticePublications: NoticePublication[];
  noticeReceipts: NoticeReceipt[];
  noticeReminders: NoticeReminder[];
  mailMessages: MailMessage[];
  mailAttachments: MailAttachment[];
  mailReplies: MailReply[];
  mailSendRecords: MailSendRecord[];
  officeDiscussions: OfficeDiscussion[];
  meetingResources: MeetingResource[];
  meetings: Meeting[];
  meetingNotifications: MeetingNotification[];
  meetingMinutes: MeetingMinutes[];
  clients: Client[];
  products: Product[];
  suitabilityPolicy: SuitabilityPolicy;
  clientCases: ClientCase[];
  suitabilityAssessments: SuitabilityAssessment[];
  suitabilityMatches: SuitabilityMatch[];
  clientReviews: ClientReview[];
  researchPolicy: ResearchPolicy;
  researchTopics: ResearchTopic[];
  researchReports: ResearchReport[];
  researchDocumentVersions: ResearchDocumentVersion[];
  researchChecks: ResearchCheck[];
  researchReviews: ResearchReview[];
  researchPublications: ResearchPublication[];
  ibPolicy: IbPolicy;
  ibIssuers: IbIssuer[];
  ibProjects: IbProject[];
  ibAssignments: IbAssignment[];
  ibWorkpapers: IbWorkpaperVersion[];
  ibFindings: IbFinding[];
  ibQualitySubmissions: IbQualitySubmission[];
  ibReviews: IbReview[];
  forms: BusinessForm[];
  travelRequests: TravelRequest[];
  expenseClaims: ExpenseClaim[];
  attachments: Attachment[];
  documentVersions: DocumentVersion[];
  officeDocuments: OfficeDocument[];
  officeDocumentApprovals: OfficeDocumentApproval[];
  officeDocumentArchives: OfficeDocumentArchive[];
  sheetRows: SheetRow[];
  sheetExports: SheetExport[];
  sheetPatchRecords: SheetPatchRecord[];
  officeApprovalMaterials: OfficeApprovalMaterial[];
  officeApprovalRequests: OfficeApprovalRequest[];
  officeApprovalDecisions: OfficeApprovalDecision[];
  officeApprovalOperationRecords: OfficeApprovalOperationRecord[];
  leaveBalances: LeaveBalance[];
  leaveRequests: LeaveRequest[];
  attendanceCorrections: AttendanceCorrection[];
  personnelMaterials: PersonnelMaterial[];
  personnelProfiles: PersonnelProfile[];
  personnelChanges: PersonnelChange[];
  trainingCourses: TrainingCourse[];
  trainingEnrollments: TrainingEnrollment[];
  hrOperationRecords: HrOperationRecord[];
  procurementSuppliers: ProcurementSupplier[];
  supplierProofs: SupplierProof[];
  supplierReviews: SupplierReview[];
  purchaseRequests: PurchaseRequest[];
  purchaseComparisons: PurchaseComparison[];
  purchaseReceipts: PurchaseReceipt[];
  inventoryEntries: InventoryEntry[];
  procurementOperationRecords: ProcurementOperationRecord[];
  contractMaterials: ContractMaterial[];
  officeContracts: OfficeContract[];
  sealRequests: SealRequest[];
  contractOperationRecords: ContractOperationRecord[];
  adminAssets: AdminAsset[];
  assetMovements: AssetMovement[];
  adminResources: AdminResource[];
  resourceReservations: ResourceReservation[];
  repairTickets: RepairTicket[];
  adminOperationRecords: AdminOperationRecord[];
  officeProjects: OfficeProject[];
  projectTasks: ProjectTask[];
  projectMilestones: ProjectMilestone[];
  projectWeeklyReports: ProjectWeeklyReport[];
  projectOperationRecords: ProjectOperationRecord[];
  itSystems: ItSystem[];
  itPermissions: ItPermission[];
  accessMaterials: AccessMaterial[];
  accessRequests: AccessRequest[];
  accessGrants: AccessGrant[];
  itTickets: ItTicket[];
  itTicketEvents: ItTicketEvent[];
  itOperationRecords: ItOperationRecord[];
  officeReportJobs: OfficeReportJob[];
  officeArchives: OfficeArchive[];
  officeArchiveOperations: OfficeArchiveOperation[];
  reportOperationRecords: ReportOperationRecord[];
  riskRules: RiskRule[];
  riskAlerts: RiskAlert[];
  riskEvidence: RiskEvidence[];
  riskInvestigations: RiskInvestigation[];
  riskReviews: RiskReview[];
  riskOperationRecords: RiskOperationRecord[];
  institutionPolicy: InstitutionServicePolicy;
  institutionProfiles: InstitutionProfile[];
  institutionMaterials: InstitutionMaterial[];
  institutionNeeds: InstitutionNeed[];
  roadshows: Roadshow[];
  institutionMaterialPackages: InstitutionMaterialPackage[];
  roadshowInvitations: RoadshowInvitation[];
  institutionFollowups: InstitutionFollowup[];
  institutionOperationRecords: InstitutionOperationRecord[];
  todos: Todo[];
  auditEntries: BusinessAuditEntry[];
  idempotencyRecords: BusinessIdempotencyRecord[];
  attachmentJobs: AttachmentJob[];
}
