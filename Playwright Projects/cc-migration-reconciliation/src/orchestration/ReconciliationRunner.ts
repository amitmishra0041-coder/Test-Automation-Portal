import { Browser, Page } from '@playwright/test';
import { EnvironmentConfig } from '../../config/environments';
import { Credentials, createAuthProvider } from '../auth';
import { openExistingClaim } from '../navigation/openExistingClaim';
import { getSectionPage } from '../pages/registry';
import { enabledSections } from '../../config/navigation/navigationCatalog';
import { ExtractionContext } from '../extraction/ExtractionContext';
import { stubNotImplemented } from '../extraction/FieldObservation';
import { ClaimData } from '../models/ClaimData';
import { ClaimSummarySection } from '../pages/shared/ClaimSummaryPage';
import { ExposureData } from '../models/ExposureData';
import { FinancialsData, TransactionData, CheckPaymentData, RecoveryCheckData } from '../models/FinancialsData';
import { SectionRecord } from '../models/common';
import { PolicyData } from '../models/PolicyData';
import { ClaimDetailsScalars } from '../extraction/extractors/lossDetailsExtractor';
import { DocumentData, HistoryEventData, NoteData } from '../models/ContentData';
import { WorkplanItemData } from '../models/ActivityData';
import { PartyData, ContactData } from '../models/PartyData';
import { normalizeTree } from '../normalization/normalize';
import { compareClaims } from '../comparison/ComparisonEngine';
import { buildClaimResult, buildTechnicalFailureResult, ClaimResult } from '../reporting/ReportAggregator';
import { EvidenceCollector } from '../evidence/EvidenceCollector';
import { withRetry } from './retry';
import { logger } from '../logging/logger';

interface WalkResult {
  results: Map<string, unknown>;
  attempted: string[];
  failed: string[];
  /** True only when hasDriftedAwayFromClaim aborted the walk — a transient
   * "lost our place" event distinct from an ordinary per-section failure —
   * so the caller can tell "worth retrying the whole platform" apart from
   * "one section genuinely errored, the rest of the walk is still good." */
  driftDetected: boolean;
}

/**
 * Cheap, no-wait NEGATIVE checks for "we are no longer inside the claim at
 * all" — a session expiring or a stray click bouncing the page to a
 * landing/login screen mid-walk. Confirmed live 2026-08-27 as a real,
 * high-impact bug otherwise: every extractor's grid/field reader already
 * swallows a page.evaluate() finding nothing via `.catch(() => [])` (by
 * design — a real, empty section must read the same as one that's simply
 * blank), so once the page drifts away from the claim, EVERY remaining
 * section for that claim reads back silently empty instead of erroring —
 * one claim's report showed 6 matches out of 275 findings (every other
 * claim in the same batch: 500-800+ matches), with the on-prem screenshot
 * for a field near the end of the walk showing the plain post-login
 * Activities desk, not the claim at all. That claim's ~250 "differences"
 * were never real migration findings — they were 250 fields read off the
 * wrong page. Deliberately a NEGATIVE check (login form / home-desk marker
 * visible) rather than a positive "still on claim X" one — a positive check
 * would need to match text confirmed present on every section's sub-page,
 * which isn't true (see openExistingClaim's own narrower use of this
 * pattern, only at claim-open time).
 *
 * The home-desk check requires BOTH "Activities (N)" AND "Claims (N)" nav
 * labels together, not "Activities (N)" alone — a real claim's own left nav
 * could plausibly show an "Activities" count scoped to that one claim, but
 * would never also show a "Claims (N)" item (that's specifically the
 * desktop's own multi-claim queue count) — so requiring both together is a
 * much more specific, lower-false-positive signal for "this is the desktop
 * home screen, not a claim".
 */
async function hasDriftedAwayFromClaim(page: Page): Promise<boolean> {
  const loginFormShowing = await page.getByRole('textbox', { name: /Username|User name/i }).first()
    .isVisible().catch(() => false);
  if (loginFormShowing) return true;
  const activitiesVisible = await page.getByText(/^Activities \(\d+\)$/).first().isVisible().catch(() => false);
  if (!activitiesVisible) return false;
  const claimsQueueVisible = await page.getByText(/^Claims \(\d+\)$/).first().isVisible().catch(() => false);
  return claimsQueueVisible;
}

export async function walkSections(page: Page, env: EnvironmentConfig, claimNumber: string): Promise<WalkResult> {
  const results = new Map<string, unknown>();
  const attempted: string[] = [];
  const failed: string[] = [];
  const ctx: ExtractionContext = { page, claimNumber, environment: env.platform, tier: env.tier };

  const remainingSections = enabledSections();
  for (let i = 0; i < remainingSections.length; i++) {
    const section = remainingSections[i];
    if (await hasDriftedAwayFromClaim(page)) {
      const remainingKeys = remainingSections.slice(i).map((s) => s.key);
      failed.push(...remainingKeys);
      attempted.push(...remainingKeys);
      logger.error(
        'walkSections: page is no longer on the claim (login form or home desk detected) — aborting remaining sections instead of silently reading empty data from every one',
        { claimNumber, environment: env.platform, abortedAt: section.key, remainingCount: remainingKeys.length },
      );
      return { results, attempted, failed, driftDetected: true };
    }
    const pageObject = getSectionPage(section.key);
    attempted.push(section.key);
    try {
      const present = await pageObject.isPresent(page);
      if (!present) continue; // a genuine "this LOB has no such section" (Section 6) — not a failure
      await pageObject.navigate(page);
      const data = await pageObject.extract(ctx);
      results.set(section.key, data);
    } catch (err) {
      failed.push(section.key);
      logger.error('section extraction failed', {
        claimNumber, environment: env.platform, section: section.key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { results, attempted, failed, driftDetected: false };
}

/** Assembles the strongly-typed ClaimData from whatever section results came back. Sections with no result (stub or failed) get an honest EXTRACTION_FAILED/empty-array placeholder — never silently omitted, per Section 16. */
export function assembleClaimData(walk: WalkResult, env: EnvironmentConfig, claimNumber: string): ClaimData {
  const stub = (field: string, path: string, section: string) => stubNotImplemented(field, path, section, env.platform, claimNumber);
  const stubStr = (field: string, path: string, section: string) => stubNotImplemented<string>(field, path, section, env.platform, claimNumber);
  const stubNum = (field: string, path: string, section: string) => stubNotImplemented<number | null>(field, path, section, env.platform, claimNumber);
  const summary = walk.results.get('claimSummary') as ClaimSummarySection | undefined;
  const exposures = (walk.results.get('exposures') as ExposureData[] | undefined) ?? [];
  const financials = walk.results.get('financials') as FinancialsData | undefined;
  // 'transactions' is its own navigationCatalog section (own nested nav
  // click, own status flag — see TransactionsPage) but the data it produces
  // belongs on claim.financials.transactions, per README's "wire it into
  // assembleClaimData()" instruction for a section that isn't a new model
  // shape. financialsExtractor.ts never populates this field itself.
  const transactions = (walk.results.get('transactions') as TransactionData[] | undefined) ?? [];
  const checksPayments = (walk.results.get('checksPayments') as CheckPaymentData[] | undefined) ?? [];
  const recoveryChecks = (walk.results.get('recoveryChecks') as RecoveryCheckData[] | undefined) ?? [];
  const policy = walk.results.get('policy') as PolicyData | undefined;
  const lossDetails = walk.results.get('lossDetails') as SectionRecord | undefined;
  const claimDetails = walk.results.get('claimDetails') as ClaimDetailsScalars | undefined;
  const documents = (walk.results.get('documents') as DocumentData[] | undefined) ?? [];
  const workplan = (walk.results.get('workplan') as WorkplanItemData[] | undefined) ?? [];
  const litigation = walk.results.get('litigation') as SectionRecord | undefined;
  const parties = (walk.results.get('parties') as PartyData[] | undefined) ?? [];
  const contacts = (walk.results.get('contacts') as ContactData[] | undefined) ?? [];
  const subrogation = walk.results.get('subrogation') as SectionRecord | undefined;
  const history = (walk.results.get('history') as HistoryEventData[] | undefined) ?? [];
  const notes = (walk.results.get('notes') as NoteData[] | undefined) ?? [];
  const stubRecord = (key: string): SectionRecord => ({ sectionKey: key, fields: { __status: stub(key, `claim.${key}`, key) } });

  // See navigationCatalog.ts's 'nav-extension' group / genericPageFactories.ts.
  // fnolSnapshot (singular, "default landing tab only") was replaced
  // 2026-08-25 by 7 explicit per-sub-tab keys (fnol* below) — see
  // navigationCatalog.ts and registry.ts's notes on those keys. Leaving the
  // old key here would silently drop all 7 real results back to an empty
  // stub, since walkSections() no longer produces a 'fnolSnapshot' entry.
  const EXTENSION_KEYS = [
    'lossDetailsAssociations', 'lossDetailsMedical', 'policyLocationsClassCodes',
    'policyEndorsements', 'policyAggregateLimits', 'summaryOverview', 'summaryStatus',
    'summaryHealthMetrics', 'partiesUsers', 'reinsurance', 'hiMarleyCases',
    'planOfActionWcer', 'planOfActionNegotiations',
    'fnolLossDetails', 'fnolPartiesInvolved', 'fnolPolicy', 'fnolExposures',
    'fnolNotes', 'fnolDocuments', 'fnolAdditionalFields', 'calendar',
  ];
  const extensions: Record<string, SectionRecord> = {};
  for (const key of EXTENSION_KEYS) {
    extensions[key] = (walk.results.get(key) as SectionRecord | undefined) ?? stubRecord(key);
  }

  return {
    header: summary?.header ?? {
      policyNumber: stub('Policy Number', 'claim.header.policyNumber', 'Claim Summary'),
      claimNumber: stub('Claim Number', 'claim.header.claimNumber', 'Claim Summary'),
      insured: stub('Insured', 'claim.header.insured', 'Claim Summary'),
      claimant: stub('Claimant', 'claim.header.claimant', 'Claim Summary'),
      lossDate: stub('Date of Loss', 'claim.header.lossDate', 'Claim Summary'),
      status: stub('Claim Status', 'claim.header.status', 'Claim Summary'),
      adjuster: stub('Adjuster', 'claim.header.adjuster', 'Claim Summary'),
    },
    claimType: claimDetails?.claimType ?? stub('Claim Type', 'claim.claimType', 'Claim Details'),
    lossType: claimDetails?.lossType ?? stub('Loss Type', 'claim.lossType', 'Claim Details'),
    jurisdiction: claimDetails?.jurisdiction ?? stub('Jurisdiction', 'claim.jurisdiction', 'Claim Details'),
    reportedDate: claimDetails?.reportedDate ?? stub('Reported Date', 'claim.reportedDate', 'Claim Details'),
    closeDate: claimDetails?.closeDate ?? stub('Close Date', 'claim.closeDate', 'Claim Details'),

    policy: policy ?? {
      policyNumber: summary?.header.policyNumber ?? stub('Policy Number', 'claim.policy.policyNumber', 'Policy'),
      policyType: stub('Policy Type', 'claim.policy.policyType', 'Policy'),
      policyTerm: stubStr('Policy Term', 'claim.policy.policyTerm', 'Policy'),
      namedInsured: stub('Named Insured', 'claim.policy.namedInsured', 'Policy'),
      jurisdiction: stub('Jurisdiction', 'claim.policy.jurisdiction', 'Policy'),
      producerCode: stub('Producer Code', 'claim.policy.producerCode', 'Policy'),
      extra: {},
    },
    parties,
    contacts,
    exposures,
    activities: [],
    workplan,
    notes,
    documents,
    financials: {
      ...(financials ?? {
        summary: { cells: {}, loaded: false },
        totals: {
          paidTotal: stubNum('Paid Total', 'claim.financials.totals.paidTotal', 'Financials'),
          outstandingTotal: stubNum('Outstanding Total', 'claim.financials.totals.outstandingTotal', 'Financials'),
          remainingReserve: stubNum('Remaining Reserve', 'claim.financials.totals.remainingReserve', 'Financials'),
        },
      }),
      transactions,
      checksPayments,
      recoveryChecks,
    },
    history,
    lossDetails: lossDetails ?? stubRecord('lossDetails'),

    specialty: {
      segmentation: stubRecord('segmentation'),
      specialInvestigations: stubRecord('specialInvestigations'),
      litigation: litigation ?? stubRecord('litigation'),
      subrogation: subrogation ?? stubRecord('subrogation'),
      salvage: stubRecord('salvage'),
    },
    extensions,
    customFields: {},
    customScreens: [],
    customExtensions: [],

    validation: summary?.validation ?? { present: false, text: null },

    extraction: {
      environment: env.platform, claimNumber, tier: env.tier,
      sectionsAttempted: walk.attempted, sectionsFailed: walk.failed,
      capturedAt: new Date().toISOString(),
    },
  };
}

/**
 * LOB for the report's "by LOB" rollup and claim-list column. Input-file
 * claimType (Section 3) wins if supplied — the by-LOB summary is meant to
 * answer "how well did each of the input file's LOBs migrate", so a value
 * someone deliberately put in the claims file should win over anything read
 * live. Falls back to the extracted "Policy Type" field on Loss Details
 * (e.g. "Personal auto", "Workers Comp" — confirmed live 2026-08-25) for
 * single-claim runs from the UI runner, which never carry an input file at
 * all and would otherwise always group under "UNSPECIFIED". claim.claimType
 * itself is NOT used here — it's always NOT_PRESENT (no distinct "Claim
 * Type" field exists on either platform's Loss Details page — see
 * navigationCatalog.ts's claimDetails note).
 */
function deriveClaimType(claimType: string | undefined, onpremClaim: ClaimData, cloudClaim: ClaimData): string | undefined {
  if (claimType) return claimType;
  const policyType = onpremClaim.lossDetails.fields['Policy Type']?.value ?? cloudClaim.lossDetails.fields['Policy Type']?.value;
  return typeof policyType === 'string' && policyType ? policyType : undefined;
}

export interface ReconcileClaimOptions {
  browser: Browser;
  claimNumber: string; // the on-prem claim number, and the report's primary claim identifier
  cloudClaimNumber?: string; // defaults to claimNumber when omitted — same-number comparison is the common case; migration in progress means a real migrated pair often isn't available yet, so an asymmetric pair (different claim on each platform) is also supported for exercising the tool
  claimType?: string; // LOB, carried through from the input claims file to ClaimResult for the by-LOB summary
  envs: { onprem: EnvironmentConfig; cloud: EnvironmentConfig };
  credentials: Credentials;
  evidenceCollector: EvidenceCollector;
}

/**
 * Reconciles ONE claim end-to-end: opens both environments in parallel
 * BrowserContexts (Section A/L's confirmed single-process design), walks
 * every enabled section on both, normalizes, compares, collects evidence
 * for any finding that warrants it, and returns a ClaimResult. Any
 * exception before extraction starts (login, claim not found) is caught
 * here and reported as a TECHNICAL_FAILURE (Section 22) rather than
 * propagating and killing the batch (Section M).
 */
export async function reconcileClaim(options: ReconcileClaimOptions): Promise<ClaimResult> {
  const { browser, claimNumber, claimType, envs, credentials, evidenceCollector } = options;
  const cloudClaimNumber = options.cloudClaimNumber ?? claimNumber;
  const asymmetric = cloudClaimNumber !== claimNumber;

  const onpremContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const cloudContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const onpremPage = await onpremContext.newPage();
  const cloudPage = await cloudContext.newPage();

  try {
    const onpremAuth = createAuthProvider(envs.onprem);
    const cloudAuth = createAuthProvider(envs.cloud);

    try {
      await withRetry(`login onprem ${claimNumber}`, 2, () => onpremAuth.login(onpremPage, credentials));
      await withRetry(`login cloud ${cloudClaimNumber}`, 2, () => cloudAuth.login(cloudPage, credentials));
    } catch (err) {
      return buildTechnicalFailureResult(claimNumber, `LOGIN_FAILURE: ${err instanceof Error ? err.message : String(err)}`, claimType, asymmetric ? cloudClaimNumber : undefined);
    }

    try {
      await openExistingClaim(onpremPage, claimNumber, envs.onprem, onpremAuth, credentials);
      await openExistingClaim(cloudPage, cloudClaimNumber, envs.cloud, cloudAuth, credentials);
    } catch (err) {
      return buildTechnicalFailureResult(claimNumber, `CLAIM_NOT_FOUND_OR_NAVIGATION_FAILURE: ${err instanceof Error ? err.message : String(err)}`, claimType, asymmetric ? cloudClaimNumber : undefined);
    }

    const [onpremWalkFirst, cloudWalkFirst] = await Promise.all([
      walkSections(onpremPage, envs.onprem, claimNumber),
      walkSections(cloudPage, envs.cloud, cloudClaimNumber),
    ]);

    /**
     * A drifted walk (hasDriftedAwayFromClaim aborted it) gets ONE retry —
     * re-open the claim fresh and re-walk from scratch — rather than being
     * accepted as final. Confirmed live 2026-08-27 this is worth doing, not
     * just theoretical: staggering worker START times (BatchRunner.ts) did
     * NOT fix the same claim repeatedly drifting, which shows the cause
     * isn't inter-claim batch contention — EVERY claim already runs its
     * on-prem and cloud walks concurrently via Promise.all (right here),
     * every single run, so that alone can't explain why only one claim
     * fails. The one confirmed-different fact about that claim is that its
     * Parties section (~30-36s, by far the slowest of any section) makes
     * its walk uniquely long, so a transient slow patch on either the
     * shared on-prem or cloud test server has more time to land mid-walk
     * for THIS claim than for a faster one. Retrying can't fix a server
     * that's persistently down, but it directly recovers from exactly the
     * transient case this whole investigation has pointed at.
     */
    async function retryDriftedWalk(
      label: 'onprem' | 'cloud', page: Page, env: EnvironmentConfig, claimNum: string, auth: ReturnType<typeof createAuthProvider>, first: WalkResult,
    ): Promise<WalkResult> {
      if (!first.driftDetected) return first;
      logger.warn('reconcileClaim: walk drifted — retrying claim open + full walk once before giving up', { claimNumber: claimNum, environment: label });
      try {
        await openExistingClaim(page, claimNum, env, auth, credentials);
        const retried = await walkSections(page, env, claimNum);
        logger.info('reconcileClaim: retry after drift complete', {
          claimNumber: claimNum, environment: label, stillDrifted: retried.driftDetected, failedCount: retried.failed.length,
        });
        return retried;
      } catch (err) {
        logger.error('reconcileClaim: retry after drift itself failed — keeping the original (drifted) walk result', {
          claimNumber: claimNum, environment: label, error: err instanceof Error ? err.message : String(err),
        });
        return first;
      }
    }

    const [onpremWalk, cloudWalk] = await Promise.all([
      retryDriftedWalk('onprem', onpremPage, envs.onprem, claimNumber, onpremAuth, onpremWalkFirst),
      retryDriftedWalk('cloud', cloudPage, envs.cloud, cloudClaimNumber, cloudAuth, cloudWalkFirst),
    ]);

    const onpremClaim = normalizeTree(assembleClaimData(onpremWalk, envs.onprem, claimNumber));
    const cloudClaim = normalizeTree(assembleClaimData(cloudWalk, envs.cloud, cloudClaimNumber));

    const findings = compareClaims(onpremClaim, cloudClaim, claimNumber);

    for (const finding of findings) {
      await evidenceCollector.capture(finding, onpremPage, cloudPage);
    }

    const resolvedClaimType = deriveClaimType(claimType, onpremClaim, cloudClaim);
    return buildClaimResult(claimNumber, findings, resolvedClaimType, asymmetric ? cloudClaimNumber : undefined);
  } finally {
    await onpremContext.close().catch(() => {});
    await cloudContext.close().catch(() => {});
  }
}
