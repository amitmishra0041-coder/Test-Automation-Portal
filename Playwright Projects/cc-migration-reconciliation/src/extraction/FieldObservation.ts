export type FieldType = 'string' | 'currency' | 'date' | 'boolean' | 'enum' | 'integer';
export type ExtractionStatus = 'OK' | 'NOT_PRESENT' | 'EXTRACTION_FAILED';
export type Platform = 'onprem' | 'cloud';

/**
 * The atomic unit of everything this framework extracts. Never store a bare
 * value — wrap it. This is what lets the comparison engine (Section G) tell
 * "field is genuinely empty" apart from "extractor couldn't find it"
 * (Section 16's DATA DOES NOT EXIST vs UI EXTRACTION FAILED distinction).
 */
export interface FieldObservation<T = string | number | boolean | null> {
  path: string;                 // e.g. "claim.financials.reserves[0].amount"
  field: string;                // human label, for reports, e.g. "Reserve Amount"
  value: T;
  rawText: string | null;       // pre-normalization text, kept for evidence
  type: FieldType;
  environment: Platform;
  claimNumber: string;
  section: string;               // "Financials", "Activities", ...
  capturedAt: string;             // ISO timestamp
  status: ExtractionStatus;
  errorMessage?: string;
}

export function isFieldObservation(v: unknown): v is FieldObservation {
  return !!v && typeof v === 'object' && 'status' in v && 'path' in v && 'type' in (v as Record<string, unknown>);
}

export function ok<T>(params: Omit<FieldObservation<T>, 'status' | 'capturedAt' | 'errorMessage'>): FieldObservation<T> {
  return { ...params, status: 'OK', capturedAt: new Date().toISOString() };
}

export function notPresent<T>(
  params: Omit<FieldObservation<T>, 'status' | 'capturedAt' | 'value' | 'rawText' | 'errorMessage'>,
  reason?: string,
): FieldObservation<T> {
  return {
    ...params,
    value: null as unknown as T,
    rawText: null,
    status: 'NOT_PRESENT',
    capturedAt: new Date().toISOString(),
    errorMessage: reason,
  };
}

export function extractionFailed<T>(
  params: Omit<FieldObservation<T>, 'status' | 'capturedAt' | 'value' | 'rawText'>,
  errorMessage: string,
): FieldObservation<T> {
  return {
    ...params,
    value: null as unknown as T,
    rawText: null,
    status: 'EXTRACTION_FAILED',
    capturedAt: new Date().toISOString(),
    errorMessage,
  };
}

/** Convenience for the very common case of a not-yet-built extractor (Section 28: mark placeholders, never invent selectors). */
export function stubNotImplemented<T = string | number | boolean | null>(
  field: string, path: string, section: string, environment: Platform, claimNumber: string,
): FieldObservation<T> {
  return extractionFailed<T>(
    { path, field, type: 'string', environment, claimNumber, section },
    `TODO: extractor for "${section}" not yet implemented against live ClaimCenter — see navigationCatalog.ts status for this section.`,
  );
}
