import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { chromium } from '@playwright/test';
import { resolveEnvironments, Tier } from '../../config/environments';
import { credentialsFromEnv } from '../auth';
import { readClaimList, filterClaims, ClaimListEntry } from '../input/ClaimListReader';
import { runBatch } from '../orchestration/BatchRunner';
import { ReportAggregator } from '../reporting/ReportAggregator';
import { generateHtmlReport } from '../reporting/generators/htmlReportGenerator';
import { generateJsonReport } from '../reporting/generators/jsonReportGenerator';
import { generateCsvReport, generateAllFieldsCsv, generateSectionSummaryCsv, generateLobSummaryCsv } from '../reporting/generators/csvReportGenerator';
import { generateExcelReport } from '../reporting/generators/excelReportGenerator';
import { logger } from '../logging/logger';

/**
 * Section 3/27's execution surface:
 *   npm run reconcile -- --claims data/claims.csv
 *   npm run reconcile -- --claim 123456789
 *   npm run reconcile -- --claims data/claims.csv --batch B3
 *   npm run reconcile -- --claims data/claims.csv --tier dev
 *   WORKERS=6 npm run reconcile -- --claims data/claims.csv --group full-migration
 *
 * Deliberately hand-rolled arg parsing rather than a dependency — the
 * surface is small and fixed (Section 3's own examples), so a parser
 * library would be more code than it saves.
 */
function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[key] = value;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const tier = (args.tier as Tier) || (process.env.CC_TIER as Tier) || 'test';
  const workers = Number(process.env.WORKERS ?? 4);
  const reportFormats = (process.env.REPORT_FORMATS ?? 'html,json,csv,xlsx').split(',').map((s) => s.trim());
  const outDir = process.env.REPORTS_DIR ?? 'reports';

  let claims: ClaimListEntry[];
  if (args['onprem-claim'] || args['cloud-claim']) {
    // Asymmetric single-claim mode: different claim number per platform —
    // for exercising the tool while a real migrated pair isn't available
    // yet. Either flag alone still needs the other; omit both and use
    // --claim for the common same-number case.
    if (!args['onprem-claim'] || !args['cloud-claim']) {
      console.error('Both --onprem-claim and --cloud-claim are required together (use --claim for a single number on both sides).');
      process.exit(1);
      return;
    }
    claims = [{ claimNumber: args['onprem-claim'], cloudClaimNumber: args['cloud-claim'] }];
  } else if (args.claim) {
    claims = [{ claimNumber: args.claim }];
  } else if (args.claims) {
    const all = readClaimList(path.resolve(args.claims));
    claims = filterClaims(all, { batch: args.batch, group: args.group });
  } else {
    console.error('Usage: npm run reconcile -- --claims <file.csv|file.xlsx> [--batch B3] [--group smoke] [--tier dev]');
    console.error('   or: npm run reconcile -- --claim <claimNumber> [--tier dev]');
    console.error('   or: npm run reconcile -- --onprem-claim <claimNumber> --cloud-claim <claimNumber> [--tier dev]');
    process.exit(1);
    return;
  }

  if (claims.length === 0) {
    console.error('No claims matched the given filter — nothing to reconcile.');
    process.exit(1);
    return;
  }

  logger.info('reconciliation run starting', { operation: 'main', totalClaims: claims.length, tier, workers });

  const envs = resolveEnvironments(tier);
  const credentials = credentialsFromEnv();
  const aggregator = new ReportAggregator(tier);

  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  try {
    await runBatch({ browser, claims, envs, credentials, workers, aggregator });
  } finally {
    await browser.close();
  }

  const report = aggregator.build();

  // Each format writes independently — confirmed live as necessary: a
  // single locked report file (e.g. the previous run's CSV still open in
  // Excel — Windows EBUSY) previously threw out of this whole block,
  // silently skipping every format that hadn't run yet (XLSX, in that
  // case) and losing the run's results with no report at all to show for
  // it. One format's write failure should never cost the others.
  //
  // Every generator still writes/overwrites the stable `reconciliation-
  // <tier>.<ext>` name (existing consumers — e.g. the Playwright runner
  // UI's static /reports/recon/* links — keep working unchanged), but each
  // written file is ALSO copied to a per-run timestamped sibling here so
  // past runs stay available for tracking/troubleshooting instead of being
  // silently overwritten on the next run.
  const runTimestamp = new Date(report.generatedAt).toISOString().replace(/[:.]/g, '-');
  const writeFormat = (name: string, fn: () => string | string[] | void) => {
    if (!reportFormats.includes(name)) return;
    try {
      const result = fn();
      const paths = result ? (Array.isArray(result) ? result : [result]) : [];
      for (const filePath of paths) {
        const ext = path.extname(filePath);
        const base = path.basename(filePath, ext);
        const versionedPath = path.join(path.dirname(filePath), `${base}-${runTimestamp}${ext}`);
        fs.copyFileSync(filePath, versionedPath);
      }
    } catch (err) {
      logger.error(`failed to write ${name} report — other formats still attempted`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  writeFormat('html', () => generateHtmlReport(report, outDir));
  writeFormat('json', () => generateJsonReport(report, outDir));
  writeFormat('csv', () => [
    generateCsvReport(report, outDir),
    generateAllFieldsCsv(report, outDir),
    generateSectionSummaryCsv(report, outDir),
    generateLobSummaryCsv(report, outDir),
  ]);
  writeFormat('xlsx', () => generateExcelReport(report, outDir));

  const s = report.executiveSummary;
  console.log('\n' + '='.repeat(60));
  console.log('  CLAIMCENTER MIGRATION RECONCILIATION — SUMMARY');
  console.log('='.repeat(60));
  console.log(`  Total Claims        : ${s.totalClaims}`);
  console.log(`  Passed              : ${s.passed}`);
  console.log(`  Passed w/ Expected  : ${s.passedWithExpectedDifferences}`);
  console.log(`  Failed              : ${s.failed}`);
  console.log(`  Technical Failures  : ${s.technicalFailures}`);
  console.log(`  Critical Findings   : ${s.criticalFindings}`);
  console.log(`  High Findings       : ${s.highFindings}`);
  console.log(`  Reports written to  : ${path.resolve(outDir)}`);
  console.log('='.repeat(60));
  if (report.byLob.length) {
    console.log('  BY LOB');
    for (const l of report.byLob) {
      console.log(`    ${l.claimType.padEnd(18)} claims=${l.totalClaims} passed=${l.passed} failed=${l.failed} technicalFailures=${l.technicalFailures} critical=${l.criticalFindings} high=${l.highFindings}`);
    }
    console.log('='.repeat(60));
  }
  console.log('');

  process.exit(aggregator.exitCode());
}

main().catch((err) => {
  logger.error('reconciliation run crashed', { error: err instanceof Error ? err.stack ?? err.message : String(err) });
  process.exit(1);
});
