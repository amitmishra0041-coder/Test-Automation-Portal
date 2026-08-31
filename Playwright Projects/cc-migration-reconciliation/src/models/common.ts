import { FieldObservation } from '../extraction/FieldObservation';

/** Any array item the comparison engine matches by business key, not position or technical id (Section G). */
export interface BusinessKeyed {
  /** Deterministic key built from stable business fields only — never a CC-generated id (Section 9). */
  businessKey: string;
}

/**
 * A section with no confirmed field list yet (Section 6/28: don't invent a
 * schema for a screen nobody has looked at). Holds whatever named
 * observations an extractor manages to read, keyed by field name, so the
 * comparison engine can still diff two SectionRecords structurally the
 * moment a real extractor starts populating one — no model change needed
 * when a stub becomes real.
 */
/**
 * A single row within SectionRecord.rows: `businessKey` plus an arbitrary
 * set of named FieldObservations. Not `Record<string, FieldObservation> &
 * BusinessKeyed` (that combination is unsatisfiable — it demands
 * `businessKey` itself be a FieldObservation, not a string) — confirmed via
 * a real compile error the first time something actually populated `rows`.
 */
export type SectionRow = BusinessKeyed & { [field: string]: FieldObservation | string };

export interface SectionRecord {
  sectionKey: string;
  fields: Record<string, FieldObservation>;
  rows?: SectionRow[];
}
