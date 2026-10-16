import type { JsonObject } from '@app/awcp';

export interface RiskCheckRow extends JsonObject {
  id: string;
  accountRef: string;
  market: string;
  instrument: string;
  tradeDate: string;
  direction: string;
  amountCents: number;
  finding: string;
  note: string;
}
export interface RiskMeasureRow extends JsonObject {
  id: string;
  kind: string;
  ownerId: string;
  dueDate: string;
  description: string;
}
export interface RiskDossier extends JsonObject {
  periodStart: string;
  periodEnd: string;
  riskLevel: string;
  methods: string[];
  contactRequired: boolean;
  contactOn: string;
  contactMethod: string;
  contactSummary: string;
  checks: RiskCheckRow[];
  measures: RiskMeasureRow[];
}
export interface RiskInvestigationDraft extends JsonObject {
  analysis: string;
  conclusion: string;
  proposedDisposition: string;
  evidenceIds: string[];
  dossier: RiskDossier;
}
export const DEMO_MARKETS = [
  { id: 'SH', label: '沪市', instruments: ['DEMO-SH-001', 'DEMO-SH-002'] },
  { id: 'SZ', label: '深市', instruments: ['DEMO-SZ-001', 'DEMO-SZ-002'] },
  { id: 'OTC', label: '场外', instruments: ['DEMO-OTC-001', 'DEMO-OTC-002'] }
] as const;
export function emptyDossier(): RiskDossier {
  return {
    periodStart: '',
    periodEnd: '',
    riskLevel: '',
    methods: [],
    contactRequired: false,
    contactOn: '',
    contactMethod: '',
    contactSummary: '',
    checks: [],
    measures: []
  };
}
