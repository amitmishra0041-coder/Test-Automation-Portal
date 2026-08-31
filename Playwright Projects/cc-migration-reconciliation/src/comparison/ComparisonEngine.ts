import { FieldObservation, isFieldObservation } from '../extraction/FieldObservation';
import { Finding } from './types';
import { classifyPair, classifyMissing, classifyExtractionFailure, classifyUnmatchedRow } from './classify';
import { isKeyedArrayPath, isConsolidatedRowPath } from '../../config/validation/arrayMatchKeys';
import { Severity } from '../../config/severity/severityRules';
import { ClaimData } from '../models/ClaimData';

interface RowLike {
  businessKey: string;
  [key: string]: unknown;
}

function isRowLike(v: unknown): v is RowLike {
  return !!v && typeof v === 'object' && typeof (v as Record<string, unknown>).businessKey === 'string';
}

function rowObservations(row: RowLike): FieldObservation[] {
  const out: FieldObservation[] = [];
  const walk = (node: unknown) => {
    if (isFieldObservation(node)) { out.push(node); return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === 'object') { Object.values(node as object).forEach(walk); }
  };
  walk(row);
  return out;
}

/**
 * One finding per unmatched array row (a whole missing/extra transaction,
 * exposure, activity, …), not one per field within it — Section 8's
 * "compare individual financial transactions" is about matching, not about
 * flooding the report with N findings for one absent row.
 *
 * The representative field prefers the first OK-status observation, not
 * just `fields[0]` — confirmed live as a real bug: for WorkplanItemData,
 * property #1 is `itemType`, which is ALWAYS NOT_PRESENT by design (no
 * confirmed "type" column exists on either platform — see that model's own
 * doc comment), so every unmatched Workplan row showed a useless "Item
 * Type: null vs null" finding instead of anything identifying the actual
 * row (e.g. its Subject). Falls back to fields[0] only if every field on
 * the row is genuinely absent.
 */
function unmatchedRowFinding(row: RowLike, side: 'onprem' | 'cloud', path: string, claimNumber: string, section: string): Finding {
  const fields = rowObservations(row);
  const representative: FieldObservation = fields.find((f) => f.status === 'OK') ?? fields[0] ?? {
    path: `${path}[${row.businessKey}]`, field: 'Row', value: row.businessKey, rawText: row.businessKey,
    type: 'string', environment: side, claimNumber, section, status: 'OK', capturedAt: new Date().toISOString(),
  };
  const finding = classifyUnmatchedRow({ ...representative, path: `${path}[${row.businessKey}]` }, side);
  // Always show the full business key too — the representative field alone
  // ("Subject: NEW LOSS NOTICE") doesn't explain WHY this row didn't match
  // its counterpart; the full key usually does (e.g. a due-date difference
  // when comparing two genuinely different claims).
  return { ...finding, note: `Unmatched row [${row.businessKey}]${finding.note ? ' — ' + finding.note : ''}` };
}

function compareObservationPair(onprem: FieldObservation, cloud: FieldObservation): Finding[] {
  if (onprem.status === 'EXTRACTION_FAILED') return [classifyExtractionFailure(onprem)];
  if (cloud.status === 'EXTRACTION_FAILED') return [classifyExtractionFailure(cloud)];
  if (onprem.status === 'NOT_PRESENT' && cloud.status === 'NOT_PRESENT') return []; // both genuinely absent — nothing to reconcile
  if (onprem.status === 'NOT_PRESENT') return [classifyMissing(cloud, 'onprem')];
  if (cloud.status === 'NOT_PRESENT') return [classifyMissing(onprem, 'cloud')];
  return [classifyPair(onprem, cloud)];
}

const SEVERITY_ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

function fmtVal(v: unknown): string {
  return v === null || v === undefined || v === '' ? '(missing)' : String(v);
}

/**
 * Collapses one matched row's per-field Findings into a single Finding —
 * classification MISMATCH, every real (non-MATCH, non-EXPECTED_DIFFERENCE)
 * field listed as "Field: onprem vs cloud" in the note — for paths flagged
 * via isConsolidatedRowPath. A fully-identical row still produces one MATCH
 * Finding (not zero) so section totals stay "N rows compared", not "N
 * fields compared".
 *
 * Section comes from `fieldFindings[0].section`, NOT the `section` parameter
 * threaded through compareTrees — that parameter is only ever set once, at
 * the very top (compareClaims passes the literal string 'Claim'), and the
 * object-walking recursion never updates it as it descends into `workplan`/
 * `exposures`/etc. Every per-field Finding instead carries the RIGHT section
 * already (baked into its FieldObservation at extraction time, e.g.
 * 'Workplan' — see classifyPair's use of `onprem.section`). Using the
 * threaded parameter here filed every consolidated row under a "Claim"
 * section the report doesn't group anywhere near Workplan/Exposures —
 * confirmed live 2026-08-25: 7 correctly-matched, correctly-diffed Workplan
 * rows were being built right but effectively vanishing from the report.
 */
function consolidateRowFinding(fieldFindings: Finding[], row: RowLike, path: string, claimNumber: string, section: string): Finding {
  const rowPath = `${path}[${row.businessKey}]`;
  const rowSection = fieldFindings[0]?.section ?? section;
  const real = fieldFindings.filter((f) => f.classification !== 'MATCH' && f.classification !== 'EXPECTED_DIFFERENCE');
  if (real.length === 0) {
    return { claimNumber, section: rowSection, path: rowPath, field: 'Row', onprem: row.businessKey, cloud: row.businessKey, classification: 'MATCH', severity: 'INFO' };
  }
  const severity = SEVERITY_ORDER.find((s) => real.some((f) => f.severity === s)) ?? 'LOW';
  const note = real.map((f) => `${f.field}: ${fmtVal(f.onprem)} vs ${fmtVal(f.cloud)}`).join('; ');
  return { claimNumber, section: rowSection, path: rowPath, field: 'Row', onprem: row.businessKey, cloud: row.businessKey, classification: 'MISMATCH', severity, note };
}

function compareKeyedArrays(onpremRows: unknown[], cloudRows: unknown[], path: string, claimNumber: string, section: string): Finding[] {
  const findings: Finding[] = [];
  const onp = onpremRows.filter(isRowLike);
  const cld = cloudRows.filter(isRowLike);

  // A plain `Map<businessKey, row>` silently drops every row but the LAST
  // one sharing a key — confirmed live 2026-08-27 on Notes: two same-day
  // notes from the same author on the same topic (a coarse but genuine key,
  // `author|topic|date`) both matched the SAME single cloud row, so one
  // note's real body got diffed against a completely unrelated note's body
  // instead of either being correctly matched or reported as unmatched.
  // Bucketing by key and consuming in order (1st on-prem dup -> 1st cloud
  // dup, 2nd -> 2nd, ...) fixes this for every keyed array, not just Notes —
  // any hand-built businessKey can collide when it doesn't include every
  // distinguishing column.
  const cloudByKey = new Map<string, RowLike[]>();
  for (const row of cld) {
    const bucket = cloudByKey.get(row.businessKey);
    if (bucket) bucket.push(row); else cloudByKey.set(row.businessKey, [row]);
  }
  const consolidate = isConsolidatedRowPath(path);

  for (const row of onp) {
    const bucket = cloudByKey.get(row.businessKey);
    const match = bucket?.shift();
    if (match) {
      const fieldFindings = compareTrees(row, match, path, claimNumber, section);
      findings.push(...(consolidate ? [consolidateRowFinding(fieldFindings, row, path, claimNumber, section)] : fieldFindings));
    } else {
      findings.push(unmatchedRowFinding(row, 'onprem', path, claimNumber, section));
    }
  }
  for (const bucket of cloudByKey.values()) {
    for (const row of bucket) {
      findings.push(unmatchedRowFinding(row, 'cloud', path, claimNumber, section));
    }
  }
  return findings;
}

/**
 * The generic structural diff (Section G). Walks two already-normalized
 * trees of the SAME shape (both produced from ClaimData) in parallel;
 * FieldObservation leaves compare directly, arrays declared "keyed" in
 * config/validation/arrayMatchKeys.ts match by business key first,
 * everything else recurses by object key. No caller needs to know the
 * shape of ClaimData to use this — it introspects both trees at runtime.
 */
export function compareTrees(onpremNode: unknown, cloudNode: unknown, path: string, claimNumber: string, section: string): Finding[] {
  if (isFieldObservation(onpremNode) || isFieldObservation(cloudNode)) {
    // A dynamically-discovered field (see genericFieldReader) can legitimately
    // exist as a key on only ONE side's object — the other side's page simply
    // never rendered that label. That is functionally the same signal as an
    // explicit NOT_PRESENT status, not "nothing to compare" — treating it as
    // the latter (the old behaviour, requiring BOTH sides to already be
    // FieldObservation-shaped) silently dropped every such field instead of
    // surfacing it as EXTRA_ON_PREM/NEW_IN_CLOUD.
    if (isFieldObservation(onpremNode) && isFieldObservation(cloudNode)) {
      return compareObservationPair(onpremNode, cloudNode);
    }
    // The side with a real FieldObservation can itself be status NOT_PRESENT
    // (the label was found but rendered blank) — that's the same "nothing to
    // reconcile" outcome as the other side's key being structurally absent
    // altogether, not a MISSING_* finding. Confirmed live 2026-08-27:
    // Summary: Status's Fatalities?/Large Loss?/Attorney Represented showed
    // as MISSING_ON_PREM with BOTH sides null — on-prem never renders that
    // label at all (key absent) while cloud renders it but blank (NOT_PRESENT
    // status) — functionally identical to compareObservationPair's own
    // both-NOT_PRESENT short-circuit above, just reached via a different
    // shape (one side missing the key rather than both holding the key).
    if (isFieldObservation(onpremNode)) {
      if (onpremNode.status === 'NOT_PRESENT') return [];
      return [classifyMissing(onpremNode, 'cloud')];
    }
    if ((cloudNode as FieldObservation).status === 'NOT_PRESENT') return [];
    return [classifyMissing(cloudNode as FieldObservation, 'onprem')];
  }

  if (Array.isArray(onpremNode) || Array.isArray(cloudNode)) {
    const a = (onpremNode as unknown[]) ?? [];
    const b = (cloudNode as unknown[]) ?? [];
    if (isKeyedArrayPath(path)) {
      return compareKeyedArrays(a, b, path, claimNumber, section);
    }
    const findings: Finding[] = [];
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      findings.push(...compareTrees(a[i], b[i], `${path}[${i}]`, claimNumber, section));
    }
    return findings;
  }

  const onpremIsObj = onpremNode && typeof onpremNode === 'object';
  const cloudIsObj = cloudNode && typeof cloudNode === 'object';
  if (onpremIsObj || cloudIsObj) {
    // Union of both sides' keys — a dynamically-discovered section can have a
    // key that exists ONLY on cloud (a field/label on-prem never rendered at
    // all), which the old on-prem-only key iteration silently skipped rather
    // than surfacing as a finding.
    const aObj = (onpremNode ?? {}) as Record<string, unknown>;
    const bObj = (cloudNode ?? {}) as Record<string, unknown>;

    // A whole SectionRecord ({ sectionKey, fields, rows }) where one side
    // failed to navigate reports ONE UNABLE_TO_COMPARE finding for the whole
    // section, not one per field/row. Confirmed live 2026-08-27: on-prem's
    // walk aborted mid-claim (session drift — see walkSections' own fix),
    // so a later section's SectionRecord had `fields: { __status:
    // <EXTRACTION_FAILED> }` and NO `rows` key at all on that side, while
    // cloud's `rows` held real data. The generic per-key walk below treats
    // "key absent" the same as "confirmed empty array" (`?? []` in the array
    // branch), so it happily "compared" on-prem's absent rows against
    // cloud's real ones and reported every real cloud row as a false
    // NEW_IN_CLOUD instead of one honest "couldn't read this section"
    // finding. `__status` is a reserved sentinel key only ever written by
    // createFormSubPage/createGridSubPage/StubSectionPage for exactly this
    // situation (see their own doc comments) — safe to special-case.
    const aStatus = (aObj.fields as Record<string, unknown> | undefined)?.__status;
    const bStatus = (bObj.fields as Record<string, unknown> | undefined)?.__status;
    const failedStatus = isFieldObservation(aStatus) && aStatus.status === 'EXTRACTION_FAILED' ? aStatus
      : isFieldObservation(bStatus) && bStatus.status === 'EXTRACTION_FAILED' ? bStatus : null;
    if (failedStatus) return [classifyExtractionFailure(failedStatus)];

    const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
    const findings: Finding[] = [];
    for (const key of keys) {
      if (key === 'businessKey') continue; // structural, not a comparable business field
      findings.push(...compareTrees(aObj[key], bObj[key], path ? `${path}.${key}` : key, claimNumber, section));
    }
    return findings;
  }

  return []; // both primitives outside a FieldObservation wrapper — nothing this engine compares
}

/**
 * Top-level ClaimData fields shaped as an array (exposures/parties/…) or a
 * dynamically-keyed map (policy's own "extra" fields, financials' summary
 * cells) have no `fields.__status` sentinel the way a SectionRecord does —
 * assembleClaimData (ReconciliationRunner.ts) falls back to a plain `[]` or
 * `{}` when the section never ran, and an empty collection is
 * indistinguishable from "confirmed zero records" to everything downstream.
 * Confirmed live 2026-08-27, twice: cloud's walk aborted before/at Exposures
 * for one claim (a genuine session drift under concurrent load — see
 * walkSections' own fix), so cloud's exposures came back `[]` while the
 * LIVE cloud page (screenshotted by the user) showed the same 3 exposures
 * as on-prem — reported as 3 false EXTRA_ON_PREM/CRITICAL findings. Same
 * claim, same run: cloud's Policy walk ALSO failed (correctly reported as
 * UNABLE_TO_COMPARE for policyType/policyTerm/namedInsured/jurisdiction/
 * producerCode, which DO go through per-field stub()/EXTRACTION_FAILED) but
 * policy.extra — the dynamically-discovered rest of the page — defaults to
 * a bare `{}`, so its 8 real on-prem fields (Effective Date, Underwriting
 * Company, …) showed as false MISSING_IN_CLOUD instead. `ClaimData.
 * extraction.sectionsFailed` (already populated by walkSections/
 * assembleClaimData) is the one place that still knows the difference;
 * this maps each such section back to its ClaimData path so a failed one
 * collapses into a single honest UNABLE_TO_COMPARE instead of N false
 * per-row/per-field diffs.
 */
const FAILURE_PRONE_SECTION_PATHS: Record<string, string> = {
  exposures: 'claim.exposures',
  parties: 'claim.parties',
  contacts: 'claim.contacts',
  documents: 'claim.documents',
  workplan: 'claim.workplan',
  notes: 'claim.notes',
  history: 'claim.history',
  transactions: 'claim.financials.transactions',
  checksPayments: 'claim.financials.checksPayments',
  recoveryChecks: 'claim.financials.recoveryChecks',
  policy: 'claim.policy.extra',
  // NOT 'claim.financials.summary.cells' — that's the JS object nesting,
  // but each FieldObservation's own baked-in `.path` (financialsExtractor.ts
  // line 66, what Finding.path actually reports) skips the "cells" level
  // entirely: `claim.financials.summary.${key}`. Confirmed live 2026-08-27
  // this mismatch meant the collapse silently never fired for Financials —
  // OpenRecoveryReserves/RemainingReserves/TotalPayments/etc. still showed
  // as individual false MISSING_ON_PREM findings instead of one marker.
  financials: 'claim.financials.summary',
};

function pathBelongsToSection(path: string, sectionPath: string): boolean {
  return path === sectionPath || path.startsWith(`${sectionPath}[`) || path.startsWith(`${sectionPath}.`);
}

/** Top-level entry point: reconciles one claim's already-normalized on-prem and cloud ClaimData. */
export function compareClaims(onprem: ClaimData, cloud: ClaimData, claimNumber: string): Finding[] {
  const raw = compareTrees(onprem, cloud, 'claim', claimNumber, 'Claim');

  const onpremFailed = new Set(onprem.extraction?.sectionsFailed ?? []);
  const cloudFailed = new Set(cloud.extraction?.sectionsFailed ?? []);
  const failedSections = Object.entries(FAILURE_PRONE_SECTION_PATHS)
    .filter(([key]) => onpremFailed.has(key) || cloudFailed.has(key));
  if (failedSections.length === 0) return raw;

  const findings: Finding[] = [];
  const alreadyReported = new Set<string>();
  for (const finding of raw) {
    const hit = failedSections.find(([, sectionPath]) => pathBelongsToSection(finding.path, sectionPath));
    if (!hit) { findings.push(finding); continue; }
    const [key, sectionPath] = hit;
    if (alreadyReported.has(key)) continue; // one representative finding per failed array section, not one per row
    alreadyReported.add(key);
    const side = onpremFailed.has(key) ? 'onprem' : 'cloud';
    findings.push({
      claimNumber, section: finding.section, path: sectionPath, field: finding.field,
      onprem: null, cloud: null, classification: 'UNABLE_TO_COMPARE', severity: 'INFO',
      note: `extraction failed on ${side}: section did not complete this run — not comparable to the other platform`,
    });
  }
  return findings;
}
