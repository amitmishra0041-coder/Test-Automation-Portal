import { Browser } from '@playwright/test';
import { EnvironmentConfig } from '../../config/environments';
import { Credentials } from '../auth';
import { ClaimListEntry } from '../input/ClaimListReader';
import { reconcileClaim } from './ReconciliationRunner';
import { EvidenceCollector } from '../evidence/EvidenceCollector';
import { ReportAggregator } from '../reporting/ReportAggregator';
import { buildTechnicalFailureResult } from '../reporting/ReportAggregator';
import { logger } from '../logging/logger';

export interface BatchRunOptions {
  browser: Browser;
  claims: ClaimListEntry[];
  envs: { onprem: EnvironmentConfig; cloud: EnvironmentConfig };
  credentials: Credentials;
  workers: number;
  aggregator: ReportAggregator;
}

/**
 * All workers pulling their FIRST claim at the same instant (Promise.all
 * over freshly-created worker() calls, no delay between them) is a real,
 * confirmed-live source of failure — not a hypothetical. 2026-08-27: even
 * at WORKERS=2, the FIRST claim in the input file failed at the exact same
 * early section (aborted right after claimSummary/claimDetails, before
 * Policy) on every single run, while every other claim in the batch was
 * fine. Lowering WORKERS reduces STEADY-STATE concurrency later in the
 * batch, but does nothing about this: whichever claims are first in the
 * file are ALWAYS the ones being logged in and opened at the single
 * heaviest-load instant of the entire run (N browser launches + N logins +
 * N claim-searches, all within moments of each other) — that's a property
 * of the input file's ordering combined with "every worker starts at once",
 * not of that particular claim. Staggering each worker's START (not its
 * ongoing pace — workers still run fully concurrently once past this) means
 * only the FIRST claim ever faces zero contention, the second faces at most
 * one other worker's tail end, and so on, instead of all N colliding at t=0.
 */
const WORKER_STARTUP_STAGGER_MS = Number(process.env.WORKER_STARTUP_STAGGER_MS ?? 20_000);

/**
 * Section L/22: a simple pull-based worker pool — each worker pulls the
 * next claim off a shared queue and calls reconcileClaim, which already
 * owns its own pair of BrowserContexts (session isolation between
 * claims/workers). One claim's exception can never stop the batch: any
 * throw reconcileClaim itself doesn't already catch is caught here too, as
 * a final backstop, and recorded as a technical failure rather than
 * aborting the remaining queue.
 */
export async function runBatch(options: BatchRunOptions): Promise<void> {
  const { browser, claims, envs, credentials, workers, aggregator } = options;
  const evidenceCollector = new EvidenceCollector();

  let index = 0;
  const next = (): ClaimListEntry | undefined => (index < claims.length ? claims[index++] : undefined);

  async function worker(workerId: number): Promise<void> {
    if (workerId > 1 && WORKER_STARTUP_STAGGER_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, (workerId - 1) * WORKER_STARTUP_STAGGER_MS));
    }
    let claim = next();
    while (claim) {
      const start = Date.now();
      try {
        const result = await reconcileClaim({ browser, claimNumber: claim.claimNumber, cloudClaimNumber: claim.cloudClaimNumber, claimType: claim.claimType, envs, credentials, evidenceCollector });
        aggregator.add(result);
        logger.info('claim reconciled', {
          claimNumber: claim.claimNumber, operation: 'reconcileClaim', claimStatus: result.status,
          durationMs: Date.now() - start, workerId,
        });
      } catch (err) {
        aggregator.add(buildTechnicalFailureResult(claim.claimNumber, `UNHANDLED: ${err instanceof Error ? err.message : String(err)}`, claim.claimType, claim.cloudClaimNumber));
        logger.error('claim reconciliation threw unhandled error', {
          claimNumber: claim.claimNumber, error: err instanceof Error ? err.message : String(err), workerId,
        });
      }
      claim = next();
    }
  }

  const workerCount = Math.max(1, Math.min(workers, claims.length || 1));
  logger.info(`starting batch run`, { operation: 'runBatch', totalClaims: claims.length, workers: workerCount });
  await Promise.all(Array.from({ length: workerCount }, (_, i) => worker(i + 1)));
}
