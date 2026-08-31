import { FieldObservation } from '../extraction/FieldObservation';

/**
 * STUB shape — only `policyNumber` is confirmed today (it appears in the
 * claim header ledger read by readClaimHeader in the prototype). The rest
 * of this interface names the fields the architecture doc lists as in
 * scope (Section 7); the Policy page object needs a live pass before any
 * of them can be populated for real.
 */
export interface PolicyData {
  policyNumber: FieldObservation;
  policyType: FieldObservation;
  policyTerm: FieldObservation<string>;
  namedInsured: FieldObservation;
  jurisdiction: FieldObservation;
  producerCode: FieldObservation;
  /** Every OTHER field the Policy page renders (Effective/Expiration Date, Underwriting Company, Producer, Deductible, …), discovered dynamically — see genericFieldReader.ts. Not modeled as named properties since the field set isn't fixed across LOBs. */
  extra: Record<string, FieldObservation>;
}
