/**
 * Section G: which array paths compare by business key (`.businessKey` on
 * each item — already computed at extraction time by e.g.
 * exposureBusinessKey/transactionBusinessKey) versus by plain index. Every
 * array of real claim records is keyed; only arrays of scalars (none exist
 * in the current model) would ever be positional.
 */
export const KEYED_ARRAY_PATH_PATTERNS: RegExp[] = [
  /exposures$/,
  /financials\.transactions$/,
  /financials\.checksPayments$/,
  /financials\.recoveryChecks$/,
  /activities$/,
  /workplan$/,
  /notes$/,
  /parties$/,
  /contacts$/,
  /history$/,
  /documents$/,
  // Any SectionRecord's `.rows` array (litigation, subrogation, and any
  // future specialty section built the same way) — each row already carries
  // a real `.businessKey` from its own extractor.
  /\.rows$/,
];

export function isKeyedArrayPath(path: string): boolean {
  return KEYED_ARRAY_PATH_PATTERNS.some((p) => p.test(path));
}

/**
 * Keyed arrays where a MATCHED pair's per-field differences are reported as
 * ONE consolidated Finding per row (classification MISMATCH, every
 * mismatching column listed in the note) instead of one Finding per column.
 * Requested for Exposures/Workplan 2026-08-25: a single differing column
 * (e.g. Workplan's Assigned To, Exposure's Adjuster) was otherwise flooding
 * the report with a separate row per column instead of one row per
 * real-world record. Not applied to every keyed array by default — that's a
 * bigger behavior change than asked for; extend this list deliberately.
 */
export const CONSOLIDATED_ROW_PATH_PATTERNS: RegExp[] = [
  /exposures$/,
  /workplan$/,
];

export function isConsolidatedRowPath(path: string): boolean {
  return CONSOLIDATED_ROW_PATH_PATTERNS.some((p) => p.test(path));
}

/** Section G: currency/date tolerances, also config-driven (Section 25). */
export const CURRENCY_TOLERANCE = Number(process.env.CURRENCY_TOLERANCE ?? 0.01);
export const DATE_TOLERANCE_DAYS = Number(process.env.DATE_TOLERANCE_DAYS ?? 0);
