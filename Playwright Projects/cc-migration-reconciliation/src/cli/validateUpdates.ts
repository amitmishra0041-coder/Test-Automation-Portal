import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { chromium } from '@playwright/test';
import { resolveEnvironments, Tier } from '../../config/environments';
import { credentialsFromEnv } from '../auth';
import { readClaimList, filterClaims, ClaimListEntry } from '../input/ClaimListReader';
import { validateClaimUpdates } from '../dropdownValidation/updateValidationRunner';
import { generateUpdateValidationHtmlReport } from '../reporting/generators/updateValidationHtmlReportGenerator';
import { generateUpdateValidationJsonReport } from '../reporting/generators/updateValidationJsonReportGenerator';
import { UpdateValidationReport, ClaimUpdateResult } from '../models/DropdownValidation';
import { logger } from '../logging/logger';

/**
 * "Data Update & Dropdown Validation" — a DIFFERENT test from `reconcile`
 * (which is strictly read-only). This one opens every section's Edit mode,
 * compares dropdown/enum option lists between platforms, and always clicks
 * Update to confirm the underlying (often pre-migration) claim data still
 * saves cleanly. It WRITES to whatever claims it's pointed at — never point
 * it at anything other than the tiers you're prepared to have re-saved.
 *
 *   npm run validate-updates -- --claim <claimNumber> [--tier dev]
 *   npm run validate-updates -- --onprem-claim <n> --cloud-claim <n> [--tier dev]
 *   npm run validate-updates -- --claims data/claims.csv [--tier dev]
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
  const outDir = process.env.REPORTS_DIR ?? 'reports';

  let claims: ClaimListEntry[];
  if (args['onprem-claim'] || args['cloud-claim']) {
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
    console.error('Usage: npm run validate-updates -- --claim <claimNumber> [--tier dev]');
    console.error('   or: npm run validate-updates -- --onprem-claim <n> --cloud-claim <n> [--tier dev]');
    console.error('   or: npm run validate-updates -- --claims <file.csv> [--tier dev]');
    process.exit(1);
    return;
  }

  logger.info('update validation run starting', { operation: 'main', totalClaims: claims.length, tier });

  const envs = resolveEnvironments(tier);
  const credentials = credentialsFromEnv();
  const browser = await chromium.launch({ headless: true });

  const results: ClaimUpdateResult[] = [];
  try {
    for (const claim of claims) {
      const result = await validateClaimUpdates({
        browser, claimNumber: claim.claimNumber, cloudClaimNumber: claim.cloudClaimNumber,
        claimType: claim.claimType, envs, credentials,
      });
      results.push(result);
      const saveFailures = result.sections.reduce((sum, s) => sum + [...s.onpremRegions, ...s.cloudRegions].filter((r) => r.update.attempted && !r.update.succeeded).length, 0);
      logger.info('claim update-validated', { claimNumber: claim.claimNumber, saveFailures, sectionsChecked: result.sections.length });
    }
  } finally {
    await browser.close();
  }

  const report: UpdateValidationReport = { generatedAt: new Date().toISOString(), tier, claims: results };
  const runTimestamp = new Date(report.generatedAt).toISOString().replace(/[:.]/g, '-');
  const versionAndCopy = (filePath: string) => {
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    fs.copyFileSync(filePath, path.join(path.dirname(filePath), `${base}-${runTimestamp}${ext}`));
  };

  const htmlPath = generateUpdateValidationHtmlReport(report, outDir);
  versionAndCopy(htmlPath);
  const jsonPath = generateUpdateValidationJsonReport(report, outDir);
  versionAndCopy(jsonPath);

  const totalMismatches = results.flatMap((c) => c.sections).reduce((sum, s) => sum + s.dropdownComparisons.filter((r) => !r.match).length, 0);
  const totalSaveFailures = results.flatMap((c) => c.sections).reduce((sum, s) => sum + [...s.onpremRegions, ...s.cloudRegions].filter((r) => r.update.attempted && !r.update.succeeded).length, 0);

  console.log('\n' + '='.repeat(60));
  console.log('  DATA UPDATE & DROPDOWN VALIDATION — SUMMARY');
  console.log('='.repeat(60));
  console.log(`  Claims checked      : ${results.length}`);
  console.log(`  Save failures       : ${totalSaveFailures}`);
  console.log(`  Dropdown mismatches : ${totalMismatches}`);
  console.log(`  Reports written to  : ${path.resolve(outDir)}`);
  console.log('='.repeat(60));

  process.exit(totalSaveFailures > 0 ? 2 : 0);
}

main().catch((err) => {
  logger.error('update validation run failed', { error: err instanceof Error ? err.message : String(err) });
  console.error(err);
  process.exit(1);
});
