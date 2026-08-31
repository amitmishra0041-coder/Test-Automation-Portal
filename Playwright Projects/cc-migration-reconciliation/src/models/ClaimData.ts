import { FieldObservation, Platform } from '../extraction/FieldObservation';
import { PolicyData } from './PolicyData';
import { PartyData, ContactData } from './PartyData';
import { ExposureData } from './ExposureData';
import { FinancialsData } from './FinancialsData';
import { ActivityData, WorkplanItemData } from './ActivityData';
import { NoteData, DocumentData, HistoryEventData } from './ContentData';
import { SectionRecord } from './common';

/**
 * CONFIRMED — ported from readClaimHeader in the prototype. The header
 * ledger line ("Pol: … Claim: … Ins: … DoL: … St: … Adj: …") is read by
 * label POSITION, not per-field regex — Clmt: is absent on non-WC-style
 * claims, so treat any of these as legitimately NOT_PRESENT rather than a
 * defect.
 */
export interface ClaimHeaderData {
  policyNumber: FieldObservation;
  claimNumber: FieldObservation;
  insured: FieldObservation;
  claimant: FieldObservation;   // only present on WC-style claims
  lossDate: FieldObservation;
  status: FieldObservation;
  adjuster: FieldObservation;
}

/** CONFIRMED — ported from readValidation. Presence, not wording, is what's meaningful (Section 11). */
export interface ValidationState {
  present: boolean;
  text: string | null;
}

export interface ClaimData {
  header: ClaimHeaderData;
  claimType: FieldObservation;
  lossType: FieldObservation;
  jurisdiction: FieldObservation;
  reportedDate: FieldObservation;
  closeDate: FieldObservation;

  policy: PolicyData;
  parties: PartyData[];
  contacts: ContactData[];
  exposures: ExposureData[];
  activities: ActivityData[];
  workplan: WorkplanItemData[];
  notes: NoteData[];
  documents: DocumentData[];
  financials: FinancialsData;
  history: HistoryEventData[];
  // CONFIRMED, both platforms — the "Loss Details" page's field set beyond
  // what already lives on the ClaimData scalars above (claimType/lossType/
  // jurisdiction/reportedDate/closeDate — same page, see
  // lossDetailsExtractor.ts's doc comment for why there's no separate
  // "Claim Details" page). No fixed schema was assumed ahead of a live
  // pass (Section 6/28), same reasoning as the specialty SectionRecords.
  lossDetails: SectionRecord;

  // Specialty/extensibility sections with no confirmed field-level schema
  // yet (Section 6/28) — see navigationCatalog.ts status per key.
  specialty: Record<
    'segmentation' | 'specialInvestigations' | 'litigation' | 'subrogation' | 'salvage',
    SectionRecord
  >;
  // Sub-tabs and top-level nav items discovered 2026-08-20 by expanding
  // every left-nav item live (Loss Details > Associations/Medical, Policy >
  // Locations and Class Codes/Endorsements/Aggregate Limits, Summary >
  // Overview/Status/Health Metrics, Parties Involved > Users, Reinsurance,
  // Hi Marley Cases, Plan of Action > WCER/Negotiations, FNOL Snapshot,
  // Calendar) — none had a dedicated typed model slot, so each gets a
  // SectionRecord here rather than growing ClaimData's top level by 15
  // fields. Keyed by navigationCatalog section key; see
  // src/pages/shared/genericPageFactories.ts for how these are built.
  extensions: Record<string, SectionRecord>;
  customFields: Record<string, FieldObservation>;
  customScreens: SectionRecord[];
  customExtensions: SectionRecord[];

  validation: ValidationState;

  extraction: {
    environment: Platform;
    claimNumber: string;
    tier: string;
    sectionsAttempted: string[];
    sectionsFailed: string[];
    capturedAt: string;
  };
}
