import { FieldObservation } from '../extraction/FieldObservation';
import { BusinessKeyed } from './common';

/**
 * CONFIRMED, both platforms — live pass against "Parties Involved" →
 * "Contacts" (a 2-step nav on cloud: "Parties Involved" only expands a
 * sub-menu, the real grid is the "Contacts" sub-item; on-prem's single
 * click already lands there directly). Business key uses name + role,
 * never CC's internal contact/party id, per Section 9's
 * technical-id-vs-business-data distinction.
 *
 * Extended with the real confirmed columns (city/state/zip/
 * contactProhibited) beyond the originally-assumed shape — same reasoning
 * as TransactionData's own doc comment. `email` stays NOT_PRESENT: not a
 * grid column on either platform (visible only in a per-contact detail
 * panel after clicking into one row, not confirmed here).
 */
export interface PartyData extends BusinessKeyed {
  name: FieldObservation;
  role: FieldObservation;         // e.g. Insured, Claimant, Witness (grid column "Roles" — often multiple, comma-joined)
  address: FieldObservation;
  city: FieldObservation;
  state: FieldObservation;
  zip: FieldObservation;
  phone: FieldObservation;
  email: FieldObservation;        // not present on the grid — see doc comment
  contactProhibited: FieldObservation<boolean | null>;
  /**
   * Per-contact drill-down fields, keyed `"<Tab>.<Field>"` (e.g.
   * "Basics.Date of Birth", "Addresses.County") — read by clicking INTO
   * this row and walking its Basics/Addresses/Related Contacts/Hi Marley
   * Case sub-tabs (see contactDetailExtractor.ts). CONFIRMED live
   * 2026-08-21 as real, previously-uncaptured content — the summary grid
   * columns above (name/role/address/phone) don't include DOB, SSN,
   * gender, per-address-type phone/email, etc. that only appear here.
   */
  detail: Record<string, FieldObservation>;
}

/**
 * `contacts` (navigationCatalog) and `parties` are the SAME confirmed grid
 * — there is no distinct "Contacts" data source on either platform, same
 * situation as claimDetails/lossDetails sharing one page. ContactData is
 * kept as its own (thinner) shape since that's what the model already
 * committed to; `relatedTo` stays NOT_PRESENT — no per-contact claim/
 * exposure link column is shown on this grid.
 */
export interface ContactData extends BusinessKeyed {
  name: FieldObservation;
  contactType: FieldObservation;
  relatedTo: FieldObservation;    // claim/exposure this contact is tied to — not present on this grid
}
