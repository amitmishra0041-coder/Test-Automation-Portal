import { FieldObservation } from '../extraction/FieldObservation';
import { BusinessKeyed } from './common';

// STUB shapes — Sections 10/11's field lists. No Notes/Documents/History
// reader exists in the prototype yet; nav-level tab presence for these is
// not even confirmed (only the generic tab-click mechanics in
// ClaimNavigator are proven, not that these specific tabs exist under those
// exact labels on either platform).

/**
 * CONFIRMED on-prem, PARTIAL cloud — live pass against the "Notes" nav item
 * (`ClaimNotesLV`), which renders as a repeating id-addressed card list
 * (`ClaimNotesLV:<row>:<field>` on-prem, colon-separated — not a plain
 * `.x-grid-row` grid like Documents/Workplan/etc), not a header+row table.
 * Real columns confirmed on-prem via a live note (PA-GA-10-20-0000016):
 * Author, Topic, Related To, Authoring Date (often blank — same
 * zero/blank-cell-not-rendered behavior confirmed on Financials Summary),
 * Body (the note text). Cloud's equivalent id pattern (`ClaimNotesLV-
 * <row>-<field>`) is inferred from the same naming convention every other
 * grid this session has used on both platforms — no cloud test claim had a
 * real note to confirm its exact column names against, so cloud row
 * parsing is UNVALIDATED, unlike the on-prem side. `noteType` stays
 * NOT_PRESENT — no distinct "type" field confirmed, "Topic" is the closest
 * real column (mapped to `subject` instead, per the visible label).
 */
export interface NoteData extends BusinessKeyed {
  noteType: FieldObservation;
  subject: FieldObservation;
  body: FieldObservation;
  author: FieldObservation;
  createdDate: FieldObservation;
  relatedTo: FieldObservation;
}

export interface DocumentData extends BusinessKeyed {
  documentName: FieldObservation;
  documentType: FieldObservation;
  status: FieldObservation;
  documentDate: FieldObservation;
  relatedTo: FieldObservation;
  /** Section 10: binary comparison is configurable, not assumed — metadata only by default. */
  metadata: Record<string, FieldObservation>;
}

/**
 * CONFIRMED, both platforms 2026-08-20 — live pass against the "History"
 * nav item (`HistoryLV` grid), NOT "Claim History" (a genuinely different
 * page, `PriorClaimHistoryLV`, showing other claims by the insured — not
 * built, see navigationCatalog.ts's 'history' key notes). This IS the real
 * field/event-level audit trail (type/who/when/what) the model originally
 * assumed; the earlier previousValue/newValue/statusTransition shape was
 * never confirmed and is replaced by the real columns.
 */
export interface HistoryEventData extends BusinessKeyed {
  type: FieldObservation;
  relatedTo: FieldObservation;
  user: FieldObservation;
  eventTimeStamp: FieldObservation;
  description: FieldObservation;
  link: FieldObservation;
}
