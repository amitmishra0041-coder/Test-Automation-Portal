import { Severity } from '../../config/severity/severityRules';

export type Classification =
  | 'MATCH'
  | 'EXPECTED_DIFFERENCE'
  | 'UNEXPECTED_DIFFERENCE'
  | 'MISMATCH'
  | 'MISSING_IN_CLOUD'
  | 'MISSING_ON_PREM'
  | 'NEW_IN_CLOUD'
  | 'EXTRA_ON_PREM'
  | 'EXTRA_TRANSACTION'
  | 'UNABLE_TO_COMPARE'
  | 'EXTRACTION_ERROR';

export interface Finding {
  claimNumber: string;
  section: string;
  path: string;
  field: string;
  onprem: unknown;
  cloud: unknown;
  classification: Classification;
  severity: Severity;
  note?: string;
  expectedDifferenceRuleId?: string;
}
