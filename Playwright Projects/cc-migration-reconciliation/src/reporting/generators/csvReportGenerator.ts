import * as fs from 'fs';
import * as path from 'path';
import { ReconciliationReport } from '../ReportAggregator';

function csvEscape(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Section 19's "detailed mismatch report" as CSV — one row per finding, only non-MATCH findings (a full-MATCH dump isn't a mismatch report). */
export function generateCsvReport(report: ReconciliationReport, outDir: string): string {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `reconciliation-${report.tier}-mismatches.csv`);

  const header = ['On-Prem Claim', 'Cloud Claim', 'LOB', 'Status', 'Section', 'Path', 'Field', 'On-Prem', 'Cloud', 'Classification', 'Severity', 'Note'];
  const rows: string[] = [header.join(',')];

  for (const claim of report.claims) {
    const cloudClaim = claim.cloudClaimNumber ?? claim.claimNumber;
    if (claim.technicalFailure) {
      rows.push([claim.claimNumber, cloudClaim, claim.claimType ?? '', claim.status, 'N/A', 'N/A', 'N/A', '', '', 'TECHNICAL_FAILURE', 'N/A', claim.technicalFailure].map(csvEscape).join(','));
      continue;
    }
    for (const f of claim.findings) {
      if (f.classification === 'MATCH') continue;
      rows.push([claim.claimNumber, cloudClaim, claim.claimType ?? '', claim.status, f.section, f.path, f.field, f.onprem, f.cloud, f.classification, f.severity, f.note ?? '']
        .map(csvEscape).join(','));
    }
  }

  fs.writeFileSync(file, rows.join('\n'), 'utf8');
  return file;
}

/** Every compared field, MATCH included — so coverage (not just mismatches) can be audited per section. Companion to the mismatches-only CSV above, not a replacement for it. */
export function generateAllFieldsCsv(report: ReconciliationReport, outDir: string): string {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `reconciliation-${report.tier}-all-fields.csv`);

  const header = ['On-Prem Claim', 'Cloud Claim', 'LOB', 'Status', 'Section', 'Path', 'Field', 'On-Prem', 'Cloud', 'Classification', 'Severity', 'Note'];
  const rows: string[] = [header.join(',')];

  for (const claim of report.claims) {
    const cloudClaim = claim.cloudClaimNumber ?? claim.claimNumber;
    if (claim.technicalFailure) {
      rows.push([claim.claimNumber, cloudClaim, claim.claimType ?? '', claim.status, 'N/A', 'N/A', 'N/A', '', '', 'TECHNICAL_FAILURE', 'N/A', claim.technicalFailure].map(csvEscape).join(','));
      continue;
    }
    for (const f of claim.findings) {
      rows.push([claim.claimNumber, cloudClaim, claim.claimType ?? '', claim.status, f.section, f.path, f.field, f.onprem, f.cloud, f.classification, f.severity, f.note ?? '']
        .map(csvEscape).join(','));
    }
  }

  fs.writeFileSync(file, rows.join('\n'), 'utf8');
  return file;
}

/** One row per claim x section — "matches and mismatches for each section, for each claim" without opening the full findings dump. */
export function generateSectionSummaryCsv(report: ReconciliationReport, outDir: string): string {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `reconciliation-${report.tier}-section-summary.csv`);

  const header = ['Claim', 'LOB', 'Section', 'Status', 'Matches', 'Expected Diff', 'Mismatches', 'Unable to Compare', 'Total'];
  const rows: string[] = [header.join(',')];

  for (const claim of report.claims) {
    for (const r of claim.sectionSummary) {
      rows.push([claim.claimNumber, claim.claimType ?? '', r.section, r.sectionStatus, r.matches, r.expectedDifferences, r.mismatches, r.unableToCompare, r.total]
        .map(csvEscape).join(','));
    }
  }

  fs.writeFileSync(file, rows.join('\n'), 'utf8');
  return file;
}

/** Consolidated findings by LOB (Section 19) — one row per LOB x section. */
export function generateLobSummaryCsv(report: ReconciliationReport, outDir: string): string {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `reconciliation-${report.tier}-lob-summary.csv`);

  const header = ['LOB', 'Total Claims', 'Passed', 'Passed w/ Expected', 'Failed', 'Technical Failures', 'Critical', 'High', 'Section', 'Section Status', 'Matches', 'Expected Diff', 'Mismatches', 'Unable to Compare'];
  const rows: string[] = [header.join(',')];

  for (const l of report.byLob) {
    if (!l.bySection.length) {
      rows.push([l.claimType, l.totalClaims, l.passed, l.passedWithExpectedDifferences, l.failed, l.technicalFailures, l.criticalFindings, l.highFindings, '', '', '', '', '', '']
        .map(csvEscape).join(','));
      continue;
    }
    for (const r of l.bySection) {
      rows.push([l.claimType, l.totalClaims, l.passed, l.passedWithExpectedDifferences, l.failed, l.technicalFailures, l.criticalFindings, l.highFindings, r.section, r.sectionStatus, r.matches, r.expectedDifferences, r.mismatches, r.unableToCompare]
        .map(csvEscape).join(','));
    }
  }

  fs.writeFileSync(file, rows.join('\n'), 'utf8');
  return file;
}
