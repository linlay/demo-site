export type BusinessOperation =
  | 'approval_center_query'
  | 'approval_templates_list'
  | 'todo_complete'
  | 'todo_summarize'
  | 'todos_query'
  | 'done_query'
  | 'workbench_summary'
  | 'approvals_query'
  | 'approval_read'
  | 'approval_materials_list'
  | 'approval_submit'
  | 'approval_approve'
  | 'approval_return'
  | 'approval_withdraw'
  | 'travel_draft_save'
  | 'travels_query'
  | 'travel_read'
  | 'travel_submit'
  | 'travel_approve'
  | 'travel_return'
  | 'travel_resubmit'
  | 'travel_receipts_list'
  | 'travel_receipt_register'
  | 'expenses_query'
  | 'expense_read'
  | 'expense_check'
  | 'expense_correct'
  | 'expense_submit'
  | 'expense_approve'
  | 'expense_return';
export interface BusinessResult {
  id: string;
  status: string;
  businessVersion: number;
  taskId: string | null;
  generation: string;
  revision: number;
}
export interface BusinessPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  generation: string;
  revision: number;
}
export interface BusinessHistory {
  action: string;
  actorId: string;
  at: string;
  fromStatus: string | null;
  toStatus: string;
  businessVersion: number;
  note: string;
}
export interface BusinessDetail<T> {
  assets?: BusinessAsset[];
  decisions?: Array<{
    id: string;
    taskId: string;
    action: string;
    actorId: string;
    opinion: string;
    businessVersion: number;
    decidedAt: string;
  }>;
  item: T;
  tasks: BusinessTask[];
  history: BusinessHistory[];
  generation: string;
  revision: number;
}
export interface Approval {
  templateId?: string;
  fields?: Record<string, string>;
  id: string;
  applicantId: string;
  departmentId: string;
  reviewerId: string;
  title: string;
  description: string;
  materialIds: string[];
  status: string;
  businessVersion: number;
  currentTaskId: string | null;
  createdAt: string;
}
export interface BusinessForm {
  id: string;
  kind: 'travel' | 'expense';
  applicantId: string;
  departmentId: string;
  reviewerId: string;
  status: string;
  businessVersion: number;
  amountCents: number;
  currentTaskId: string | null;
  createdAt: string;
}
export interface Travel extends BusinessForm {
  origin: string;
  destination: string;
  startAt: string;
  endAt: string;
  travelerIds: string[];
}
export interface Expense extends BusinessForm {
  travelFormId: string;
  checkedVersion: number;
  receipts: ExpenseReceipt[];
  lineItems: ExpenseLine[];
}
export interface ExpenseReceipt {
  invoiceNo: string;
  assetId: string;
  amountCents: number;
}
export interface ExpenseLine {
  category: 'transport' | 'hotel' | 'meal' | 'other';
  invoiceNo: string;
  amountCents: number;
}
export interface BusinessTask {
  id: string;
  title: string;
  assigneeId: string;
  sourceType: 'approval' | 'travel' | 'expense';
  sourceId: string;
  scenarioId: string;
  dueAt: string;
  status: 'open' | 'done';
  completedAt: string | null;
  completedBy: string | null;
  outcome: string | null;
  sourceStatus: string;
  sourceVersion: number;
}
export interface BusinessAsset {
  id: string;
  ownerId: string;
  filename: string;
}
export interface WorkbenchSummary {
  pending: number;
  done: number;
  overdue: number;
  generation: string;
  revision: number;
}

export interface ApprovalTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  fields: Array<{ id: string; label: string; type: 'text' | 'select' | 'date' | 'number'; options?: string[] }>;
}
export interface ApprovalCenterRecord extends Approval {
  kind: 'approval' | 'travel' | 'expense';
  amountCents?: number;
}
