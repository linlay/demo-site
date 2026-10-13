/** HTTP contracts. These are separate from browser AWCP invocation envelopes. */
export interface SessionEmployee {
  id: string;
  departmentId: string;
  name: string;
  roles: string[];
  active: boolean;
}
export interface DemoSession {
  id: string;
  generation: string;
  seed: number;
  datasetVersion: string;
  profile: 'standard' | 'acceptance';
  simulatedAt: string;
  expiresAt: string;
  employees: SessionEmployee[];
  departments: { id: string; name: string }[];
  recordCount: number;
  mcpAvailable?: boolean;
  mcpConnectUrl?: string;
  revision?: number;
  eventCursor?: string;
  operationId?: string;
}
export interface WorkspaceEvent {
  id: string;
  workspaceId: string;
  generation: string;
  revision: number;
  type: string;
  source: string;
  operationId?: string;
  resources: string[];
}
export interface ApiFailure {
  code: string;
  message: string;
  fieldErrors?: { path: string[]; messages: string[] }[];
}
export interface ReportFilter {
  from: string;
  to: string;
  departmentId: string;
  scenarioId: string;
  status: string;
  groupBy: 'month' | 'department' | 'scenario' | 'status';
  page: number;
  pageSize: number;
}
export interface ReportMetrics {
  count: number;
  amountCents: number;
  approved: number;
  overdue: number;
  averageHours: number | null;
}
export interface ReportEntry {
  id: string;
  scenarioId: string;
  departmentId: string;
  ownerId: string;
  title: string;
  status: string;
  amountCents: number;
  createdOn: string;
  durationHours: number | null;
  overdue: boolean;
}
export interface ReportResult {
  revision?: number;
  generation: string;
  filter: ReportFilter;
  summary: ReportMetrics;
  groups: ({ key: string } & ReportMetrics)[];
  items: ReportEntry[];
}

/** Site-wide active exposure; independent from MCP and workspace resets. */
export interface AwcpSettings {
  activeEnabled: boolean;
  version: number;
}
