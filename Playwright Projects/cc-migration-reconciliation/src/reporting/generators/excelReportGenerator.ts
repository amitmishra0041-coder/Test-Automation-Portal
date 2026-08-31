import * as path from 'path';
import * as XLSX from 'xlsx';
import { ReconciliationReport } from '../ReportAggregator';

/** Section 19's "Excel-compatible report" — same three-sheet shape the sister repo's reporters/compareResults.js already uses (Summary / Claim-level / Mismatches), so it's a familiar format for the same QA audience. */
export function generateExcelReport(report: ReconciliationReport, outDir: string): string {
  const wb = XLSX.utils.book_new();
  const s = report.executiveSummary;

  const summaryRows = [
    ['CLAIMCENTER MIGRATION RECONCILIATION'],
    [''],
    ['Total Claims', s.totalClaims],
    ['Passed', s.passed],
    ['Passed with Expected Differences', s.passedWithExpectedDifferences],
    ['Failed', s.failed],
    ['Technical Failures', s.technicalFailures],
    ['Critical Findings', s.criticalFindings],
    ['High Findings', s.highFindings],
    ['Generated At', report.generatedAt],
    ['Tier', report.tier],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
  ws1['!cols'] = [{ wch: 32 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Summary');

  const claimHeader = ['On-Prem Claim', 'Cloud Claim', 'LOB', 'Status', 'Critical', 'High', 'Medium', 'Low', 'Technical Failure'];
  const claimRows = report.claims.map((c) => [c.claimNumber, c.cloudClaimNumber ?? c.claimNumber, c.claimType ?? '', c.status, c.counts.CRITICAL, c.counts.HIGH, c.counts.MEDIUM, c.counts.LOW, c.technicalFailure ?? '']);
  const ws2 = XLSX.utils.aoa_to_sheet([claimHeader, ...claimRows]);
  ws2['!cols'] = [{ wch: 20 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Claim-Level Summary');

  // Section 19's "matches and mismatches for each section" — one row per claim x section.
  const sectionHeader = ['Claim', 'LOB', 'Section', 'Status', 'Matches', 'Expected Diff', 'Mismatches', 'Unable to Compare', 'Total'];
  const sectionRows = report.claims.flatMap((c) => c.sectionSummary
    .map((r) => [c.claimNumber, c.claimType ?? '', r.section, r.sectionStatus, r.matches, r.expectedDifferences, r.mismatches, r.unableToCompare, r.total]));
  const ws3 = XLSX.utils.aoa_to_sheet([sectionHeader, ...sectionRows]);
  ws3['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws3, 'Section Summary');

  // Consolidated findings by LOB (Section 19) — one row per LOB x section, plus a claim-count rollup at the top of each LOB block.
  const lobHeader = ['LOB', 'Total Claims', 'Passed', 'Passed w/ Expected', 'Failed', 'Technical Failures', 'Critical', 'High', 'Section', 'Section Status', 'Matches', 'Expected Diff', 'Mismatches', 'Unable to Compare'];
  const lobRows = report.byLob.flatMap((l) => {
    if (!l.bySection.length) {
      return [[l.claimType, l.totalClaims, l.passed, l.passedWithExpectedDifferences, l.failed, l.technicalFailures, l.criticalFindings, l.highFindings, '', '', '', '', '', '']];
    }
    return l.bySection.map((r, i) => [
      i === 0 ? l.claimType : '', i === 0 ? l.totalClaims : '', i === 0 ? l.passed : '', i === 0 ? l.passedWithExpectedDifferences : '',
      i === 0 ? l.failed : '', i === 0 ? l.technicalFailures : '', i === 0 ? l.criticalFindings : '', i === 0 ? l.highFindings : '',
      r.section, r.sectionStatus, r.matches, r.expectedDifferences, r.mismatches, r.unableToCompare,
    ]);
  });
  const ws4 = XLSX.utils.aoa_to_sheet([lobHeader, ...lobRows]);
  ws4['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 8 }, { wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 10 }, { wch: 8 }, { wch: 20 }, { wch: 16 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws4, 'By LOB');

  const findHeader = ['Claim', 'LOB', 'Section', 'Path', 'Field', 'On-Prem', 'Cloud', 'Classification', 'Severity', 'Note'];
  const findRows = report.claims.flatMap((c) => c.findings
    .filter((f) => f.classification !== 'MATCH')
    .map((f) => [c.claimNumber, c.claimType ?? '', f.section, f.path, f.field, String(f.onprem ?? ''), String(f.cloud ?? ''), f.classification, f.severity, f.note ?? '']));
  const ws5 = XLSX.utils.aoa_to_sheet([findHeader, ...findRows]);
  ws5['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 16 }, { wch: 40 }, { wch: 24 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 10 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, ws5, 'Findings');

  // Every compared field, MATCH included — so coverage can be audited per section, not just mismatches.
  const allFindHeader = ['Claim', 'LOB', 'Section', 'Path', 'Field', 'On-Prem', 'Cloud', 'Classification', 'Severity', 'Note'];
  const allFindRows = report.claims.flatMap((c) => c.findings
    .map((f) => [c.claimNumber, c.claimType ?? '', f.section, f.path, f.field, String(f.onprem ?? ''), String(f.cloud ?? ''), f.classification, f.severity, f.note ?? '']));
  const ws6 = XLSX.utils.aoa_to_sheet([allFindHeader, ...allFindRows]);
  ws6['!cols'] = ws5['!cols'];
  XLSX.utils.book_append_sheet(wb, ws6, 'All Fields');

  const file = path.join(outDir, `reconciliation-${report.tier}.xlsx`);
  XLSX.writeFile(wb, file);
  return file;
}
