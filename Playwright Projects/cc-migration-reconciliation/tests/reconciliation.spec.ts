import { test, expect } from '@playwright/test';
import * as path from 'path';
import { resolveEnvironments, Tier } from '../config/environments';
import { credentialsFromEnv } from '../src/auth';
import { readClaimList, filterClaims } from '../src/input/ClaimListReader';
import { reconcileClaim } from '../src/orchestration/ReconciliationRunner';
import { EvidenceCollector } from '../src/evidence/EvidenceCollector';

/**
 * Section J/20's "thin Playwright wrapper" — one test.describe per claim so
 * a failing claim gets Playwright's own trace/video/screenshot tooling for
 * free, without the reconciliation logic itself becoming thousands of
 * expect() calls. The reconciliation report (npm run reconcile) is the
 * primary deliverable; running this spec file directly (`npx playwright
 * test`) is the secondary path, useful when you specifically want a claim's
 * failure investigated with Playwright's trace viewer.
 *
 * Claim source: CLAIMS_FILE env var, defaulting to the sample file so
 * `npx playwright test` works out of the box without extra setup.
 */
const claimsFile = process.env.CLAIMS_FILE ?? path.join(__dirname, '..', 'data', 'claims.sample.csv');
const tier = (process.env.CC_TIER as Tier) || 'test';
const claims = filterClaims(readClaimList(claimsFile), { claim: process.env.CLAIM_NUMBER, batch: process.env.CLAIM_BATCH });

const REAL_FINDING_CLASSIFICATIONS = new Set([
  'UNEXPECTED_DIFFERENCE', 'MISMATCH', 'MISSING_IN_CLOUD', 'MISSING_ON_PREM', 'NEW_IN_CLOUD', 'EXTRA_ON_PREM', 'EXTRA_TRANSACTION',
]);

for (const claim of claims) {
  test.describe(`Claim: ${claim.claimNumber}`, () => {
    test('reconciles with no unexpected CRITICAL/HIGH differences', async ({ browser }) => {
      const envs = resolveEnvironments(tier);
      const credentials = credentialsFromEnv();
      const evidenceCollector = new EvidenceCollector();

      const result = await test.step('reconcile claim', () =>
        reconcileClaim({ browser, claimNumber: claim.claimNumber, envs, credentials, evidenceCollector }));

      await test.step('assert no unexpected CRITICAL/HIGH findings', async () => {
        const blocking = result.findings.filter(
          (f) => REAL_FINDING_CLASSIFICATIONS.has(f.classification) && (f.severity === 'CRITICAL' || f.severity === 'HIGH'),
        );
        expect(blocking, `Unexpected CRITICAL/HIGH findings on ${claim.claimNumber}:\n${JSON.stringify(blocking, null, 2)}`).toHaveLength(0);
      });
    });
  });
}

if (claims.length === 0) {
  test.skip('no claims matched — set CLAIMS_FILE/CLAIM_NUMBER or populate data/claims.sample.csv', () => {});
}
