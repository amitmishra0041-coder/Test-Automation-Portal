import { Finding, Classification } from '../comparison/types';
import { Severity } from '../../config/severity/severityRules';

export type ClaimStatus = 'PASS' | 'PASS_WITH_EXPECTED_DIFFERENCES' | 'FAIL' | 'TECHNICAL_FAILURE';

/** Section-level rollup of one claim's findings — "matches and mismatches for each section" without wading through individual field rows. */
export interface SectionSummary {
  section: string;
  matches: number;             // classification MATCH
  expectedDifferences: number; // classification EXPECTED_DIFFERENCE
  mismatches: number;          // any REAL_FINDING_CLASSIFICATIONS member (unexpected diff, missing, extra, ...)
  unableToCompare: number;     // extraction failed on one side — a technical gap, never presented as a business finding
  total: number;
  // Mirrors ClaimStatus's own PASS vs PASS_WITH_EXPECTED_DIFFERENCES split
  // (Section 22) — a section whose only differences are pre-approved isn't
  // the same as one where every field literally matched.
  sectionStatus: 'MATCH' | 'MATCH_WITH_EXPECTED_DIFFERENCES' | 'MISMATCH' | 'UNABLE_TO_COMPARE';
}

export function summarizeBySection(findings: Finding[]): SectionSummary[] {
  const bySection = new Map<string, SectionSummary>();
  for (const f of findings) {
    let row = bySection.get(f.section);
    if (!row) {
      row = { section: f.section, matches: 0, expectedDifferences: 0, mismatches: 0, unableToCompare: 0, total: 0, sectionStatus: 'MATCH' };
      bySection.set(f.section, row);
    }
    row.total += 1;
    if (f.classification === 'MATCH') row.matches += 1;
    else if (f.classification === 'EXPECTED_DIFFERENCE') row.expectedDifferences += 1;
    else if (f.classification === 'UNABLE_TO_COMPARE' || f.classification === 'EXTRACTION_ERROR') row.unableToCompare += 1;
    else if (REAL_FINDING_CLASSIFICATIONS.has(f.classification)) row.mismatches += 1;
  }
  for (const row of bySection.values()) {
    row.sectionStatus = row.mismatches > 0 ? 'MISMATCH'
      : row.unableToCompare > 0 ? 'UNABLE_TO_COMPARE'
      : row.expectedDifferences > 0 ? 'MATCH_WITH_EXPECTED_DIFFERENCES'
      : 'MATCH';
  }
  return Array.from(bySection.values()).sort((a, b) => a.section.localeCompare(b.section));
}

export interface ClaimResult {
  claimNumber: string; // the on-prem claim number
  cloudClaimNumber?: string; // set only when different from claimNumber — an asymmetric pair (real migrated pair not available yet)
  claimType?: string; // LOB, carried from the input claims file (Section 3) — not extracted live
  status: ClaimStatus;
  findings: Finding[];
  sectionSummary: SectionSummary[];
  technicalFailure?: string; // Section 22's failure taxonomy, when status is TECHNICAL_FAILURE
  counts: Record<Severity, number>; // count of UNEXPECTED_DIFFERENCE/MISMATCH/MISSING_*/EXTRA_* findings by severity
}

export interface ExecutiveSummary {
  totalClaims: number;
  passed: number;
  passedWithExpectedDifferences: number;
  failed: number;
  technicalFailures: number;
  criticalFindings: number;
  highFindings: number;
}

/** Consolidated findings for one LOB (Section 19) — every claim sharing a `claimType`, rolled up the same way the executive summary rolls up the whole run. */
export interface LobSummary {
  claimType: string;
  totalClaims: number;
  passed: number;
  passedWithExpectedDifferences: number;
  failed: number;
  technicalFailures: number;
  criticalFindings: number;
  highFindings: number;
  bySection: SectionSummary[];
}

export function summarizeByLob(claims: ClaimResult[]): LobSummary[] {
  const groups = new Map<string, ClaimResult[]>();
  for (const c of claims) {
    const key = c.claimType ?? 'UNSPECIFIED';
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }
  const rows: LobSummary[] = [];
  for (const [claimType, group] of groups) {
    rows.push({
      claimType,
      totalClaims: group.length,
      passed: group.filter((c) => c.status === 'PASS').length,
      passedWithExpectedDifferences: group.filter((c) => c.status === 'PASS_WITH_EXPECTED_DIFFERENCES').length,
      failed: group.filter((c) => c.status === 'FAIL').length,
      technicalFailures: group.filter((c) => c.status === 'TECHNICAL_FAILURE').length,
      criticalFindings: group.reduce((sum, c) => sum + c.counts.CRITICAL, 0),
      highFindings: group.reduce((sum, c) => sum + c.counts.HIGH, 0),
      bySection: summarizeBySection(group.flatMap((c) => c.findings)),
    });
  }
  return rows.sort((a, b) => a.claimType.localeCompare(b.claimType));
}

export interface ReconciliationReport {
  generatedAt: string;
  tier: string;
  claims: ClaimResult[];
  executiveSummary: ExecutiveSummary;
  byLob: LobSummary[];
}

const REAL_FINDING_CLASSIFICATIONS: ReadonlySet<Classification> = new Set([
  'UNEXPECTED_DIFFERENCE', 'MISMATCH', 'MISSING_IN_CLOUD', 'MISSING_ON_PREM', 'NEW_IN_CLOUD', 'EXTRA_ON_PREM', 'EXTRA_TRANSACTION',
]);

export function buildClaimResult(claimNumber: string, findings: Finding[], claimType?: string, cloudClaimNumber?: string): ClaimResult {
  const counts: Record<Severity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
  let hasExtractionError = false;
  let hasExpectedDifference = false;
  let hasRealFinding = false;

  for (const f of findings) {
    if (f.classification === 'UNABLE_TO_COMPARE' || f.classification === 'EXTRACTION_ERROR') { hasExtractionError = true; continue; }
    if (f.classification === 'EXPECTED_DIFFERENCE') { hasExpectedDifference = true; continue; }
    if (REAL_FINDING_CLASSIFICATIONS.has(f.classification)) {
      hasRealFinding = true;
      counts[f.severity] += 1;
    }
  }

  let status: ClaimStatus;
  if (hasRealFinding && (counts.CRITICAL > 0 || counts.HIGH > 0)) status = 'FAIL';
  else if (hasRealFinding) status = 'FAIL'; // any unexpected finding fails the claim, severity only affects the exit-code contract (Section M)
  else if (hasExpectedDifference) status = 'PASS_WITH_EXPECTED_DIFFERENCES';
  else status = 'PASS';

  return { claimNumber, cloudClaimNumber, claimType, status, findings, sectionSummary: summarizeBySection(findings), counts };
}

export function buildTechnicalFailureResult(claimNumber: string, reason: string, claimType?: string, cloudClaimNumber?: string): ClaimResult {
  return {
    claimNumber, cloudClaimNumber, claimType, status: 'TECHNICAL_FAILURE', findings: [], sectionSummary: [], technicalFailure: reason,
    counts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 },
  };
}

export class ReportAggregator {
  private readonly claims: ClaimResult[] = [];

  constructor(private readonly tier: string) {}

  add(result: ClaimResult): void {
    this.claims.push(result);
  }

  build(): ReconciliationReport {
    const executiveSummary: ExecutiveSummary = {
      totalClaims: this.claims.length,
      passed: this.claims.filter((c) => c.status === 'PASS').length,
      passedWithExpectedDifferences: this.claims.filter((c) => c.status === 'PASS_WITH_EXPECTED_DIFFERENCES').length,
      failed: this.claims.filter((c) => c.status === 'FAIL').length,
      technicalFailures: this.claims.filter((c) => c.status === 'TECHNICAL_FAILURE').length,
      criticalFindings: this.claims.reduce((sum, c) => sum + c.counts.CRITICAL, 0),
      highFindings: this.claims.reduce((sum, c) => sum + c.counts.HIGH, 0),
    };
    return { generatedAt: new Date().toISOString(), tier: this.tier, claims: this.claims, executiveSummary, byLob: summarizeByLob(this.claims) };
  }

  /** Section M/22's exit-code contract: 0 clean, 1 technical failures only, 2 unexpected CRITICAL/HIGH findings present. */
  exitCode(): 0 | 1 | 2 {
    const summary = this.build().executiveSummary;
    if (summary.criticalFindings > 0 || summary.highFindings > 0) return 2;
    if (summary.technicalFailures > 0) return 1;
    return 0;
  }
}
