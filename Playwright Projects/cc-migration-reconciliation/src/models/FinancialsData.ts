import { FieldObservation } from '../extraction/FieldObservation';
import { BusinessKeyed } from './common';

/**
 * CONFIRMED — CLOUD ONLY. Ported from readFinancialsCloud in the prototype,
 * which reads the id-addressed `[id*="FinancialsSummaryLV-<row>-<col>"]`
 * cells into `{ "<col>_row<row>": "<text>" }`. On-prem has no equivalent
 * reader yet (claimSnapshot.js's own notCaptured list says so explicitly) —
 * do not assume the on-prem Financials page shares this DOM shape.
 */
export interface FinancialsSummaryData {
  cells: Record<string, FieldObservation>; // key like "Amount_row0"
  loaded: boolean; // false = Financials page was never opened this capture, not "no money"
}

/**
 * `transactions` is the ground truth every other financial array is a view
 * over (Section C). CONFIRMED, both platforms — live pass against the
 * "Financials > Transactions" sub-page (a distinct nav item under
 * Financials, not the Summary grid): on-prem's `TransactionsLV` ExtJS grid
 * (colon-id rows, header-text + `.x-grid-cell` position mapping, same
 * pattern as exposuresExtractor's readOnPrem) and cloud's `TransactionsLV`
 * Jutro grid (dash-id-addressed cells `TransactionsLV-<row>-<col>`, same
 * pattern as exposuresExtractor's readCloud / financialsExtractor's
 * readSummaryCloud).
 *
 * The grid itself has NO on-screen "subtype", "reserve line", "claimant",
 * or "payee" column — those were assumed before any live DOM existed.
 * `payee` lives on the separate Checks/Payments sub-page instead (own
 * catalog entry, still a stub). Kept here as NOT_PRESENT rather than
 * removed, so a future Checks/Payments extractor has a slot to fill without
 * a model change; never invented from a value nobody has verified
 * (Section 28).
 */
export interface TransactionData extends BusinessKeyed {
  transactionType: FieldObservation;      // "Type" / "TType" — e.g. Reserve, Payment
  transactionDate: FieldObservation;       // "Date"
  amount: FieldObservation<number | null>; // "Amount" — parenthesized text means a reversal/negative
  status: FieldObservation;                // "Status" — e.g. Submitted, Pending approval, Voided, Submitting
  exposureNumber: FieldObservation;        // "Exposure" — the exposure # this transaction posts against
  exposureName: FieldObservation;          // "Exposure Name"
  coverage: FieldObservation;              // "Coverage" (on-prem) / "CoverageType" (cloud)
  costType: FieldObservation;              // "Cost Type"
  costCategory: FieldObservation;          // "Cost Category"
  user: FieldObservation;                  // "User"

  // Not present on the Transactions grid itself — see doc comment above.
  transactionSubtype: FieldObservation;
  reserveLine: FieldObservation;
  claimant: FieldObservation;
  payee: FieldObservation;
  technicalId: FieldObservation; // captured for evidence; excluded from comparison by default (Section H)
}

/**
 * CONFIRMED, both platforms 2026-08-20 — the "Checks/Payments" sub-page
 * under Financials (a distinct nested nav item, same reach pattern as
 * Transactions). This single combined page is where Payments AND Checks
 * both actually live — there is no separate "Payments" page and no
 * separate "Checks" page on either platform; the earlier PaymentData/
 * CheckData split (2 guessed pages) was never confirmed against a real
 * DOM and is replaced by this one real shape.
 */
export interface CheckPaymentData extends BusinessKeyed {
  checkPaymentNumber: FieldObservation;
  payTo: FieldObservation;
  grossAmount: FieldObservation<number | null>;
  scheduledSendDate: FieldObservation;
  status: FieldObservation;
  bulkInvoice: FieldObservation;
  servicePeriodStart: FieldObservation;
  servicePeriodEnd: FieldObservation;
}

/**
 * CONFIRMED, both platforms 2026-08-20 — the "Recovery Checks" sub-page
 * under Financials. Replaces the earlier guessed RecoveryData shape (a
 * "Recoveries" page that was never confirmed to exist).
 */
export interface RecoveryCheckData extends BusinessKeyed {
  payer: FieldObservation;
  payerCheckNumber: FieldObservation;
  grossAmount: FieldObservation<number | null>;
  status: FieldObservation;
  comments: FieldObservation;
  receivedDate: FieldObservation;
}

export interface FinancialsData {
  summary: FinancialsSummaryData;
  transactions: TransactionData[];
  checksPayments: CheckPaymentData[];
  recoveryChecks: RecoveryCheckData[];
  totals: {
    paidTotal: FieldObservation<number | null>;
    outstandingTotal: FieldObservation<number | null>;
    remainingReserve: FieldObservation<number | null>;
  };
}

/**
 * No single confirmed column is a unique transaction id (Section 9 forbids
 * a CC-generated technical id anyway), so the key is the combination of
 * confirmed fields that in practice identifies one ledger entry: type +
 * date + amount + which exposure it posted against + who posted it. Two
 * transactions of the same type/date/amount on DIFFERENT exposures (common
 * — see the live sample data) would otherwise collide.
 */
export function transactionBusinessKey(t: {
  transactionType: FieldObservation; transactionDate: FieldObservation;
  amount: FieldObservation<number | null>; exposureNumber: FieldObservation;
  user: FieldObservation;
}): string {
  return `${t.transactionType.value}|${t.transactionDate.value}|${t.amount.value}|${t.exposureNumber.value}|${t.user.value}`;
}
