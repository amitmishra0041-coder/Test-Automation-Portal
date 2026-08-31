import { ClaimSectionPage } from './ClaimSectionPage';
import { ClaimSummaryPage } from './shared/ClaimSummaryPage';
import { ExposuresPage } from './shared/ExposuresPage';
import { FinancialsPage } from './shared/FinancialsPage';
import { TransactionsPage } from './shared/TransactionsPage';
import { ChecksPaymentsPage } from './shared/ChecksPaymentsPage';
import { RecoveryChecksPage } from './shared/RecoveryChecksPage';
import { PolicyPage } from './shared/PolicyPage';
import { LossDetailsPage } from './shared/LossDetailsPage';
import { ClaimDetailsPage } from './shared/ClaimDetailsPage';
import { DocumentsPage } from './shared/DocumentsPage';
import { WorkplanPage } from './shared/WorkplanPage';
import { LitigationPage } from './shared/LitigationPage';
import { PartiesPage } from './shared/PartiesPage';
import { ContactsPage } from './shared/ContactsPage';
import { SubrogationPage } from './shared/SubrogationPage';
import { HistoryPage } from './shared/HistoryPage';
import { NotesPage } from './shared/NotesPage';
import { createFormSubPage, createGridSubPage } from './shared/genericPageFactories';
import { StubSectionPage } from './shared/StubSectionPage';
import { navigationCatalog } from '../../config/navigation/navigationCatalog';

/**
 * Policy: Locations and Class Codes' row shape is NOT the same across LOBs,
 * confirmed live 2026-08-27/28:
 *   - Property-based claims (BOP/CPP/WC, LocationsLV grid) carry TWO
 *     distinct numeric columns per platform: a plain row ordinal
 *     (on-prem "#", cloud "PropertyNumber") and a separate padded business
 *     location code (on-prem "LocationNumber", cloud "Number").
 *   - Auto claims (Personal/Commercial, VehiclesLV grid) carry only ONE:
 *     on-prem "#", cloud "Number" — no "PropertyNumber" column exists at
 *     all here; cloud's "Number" IS the plain ordinal on this grid.
 * A static raw-name alias can't tell these apart — cloud's raw "Number"
 * means something different depending on whether "PropertyNumber" is ALSO
 * present on the same row. A first attempt aliased "Number" unconditionally
 * to "LocationNumber", which fixed the property-based shape but broke Auto
 * claims (their only numeric column vanished into a "LocationNumber" bucket
 * with no on-prem counterpart, showing every row number as fully missing
 * on one side). This checks for "PropertyNumber" on the SAME row before
 * deciding.
 */
function canonicalizeLocationsClassCodesRow(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const hasPropertyNumber = 'PropertyNumber' in raw;
  for (const [rawKey, text] of Object.entries(raw)) {
    switch (rawKey) {
      case '#':
      case 'PropertyNumber':
        out.Number = text;
        break;
      case 'Number':
        out[hasPropertyNumber ? 'LocationNumber' : 'Number'] = text;
        break;
      case 'CPPLine':
        out.PolicyLine = text;
        break;
      case 'Lienholders':
        out.Mortgagee = text;
        break;
      case 'LicensePlate':
        out.Plate = text;
        break;
      default:
        out[rawKey] = text;
    }
  }
  return out;
}

/**
 * The one place that knows which concrete page object backs a given
 * navigationCatalog key. ReconciliationRunner never imports a page object
 * directly — it asks this registry for "whatever handles claimSummary" and
 * gets back something satisfying ClaimSectionPage, real or stub. Promoting
 * a stub to a real implementation is a one-line change here.
 */
const REAL_IMPLEMENTATIONS: Record<string, () => ClaimSectionPage<unknown>> = {
  claimSummary: () => new ClaimSummaryPage(),
  exposures: () => new ExposuresPage(),
  financials: () => new FinancialsPage(),
  transactions: () => new TransactionsPage(),
  checksPayments: () => new ChecksPaymentsPage(),
  recoveryChecks: () => new RecoveryChecksPage(),
  policy: () => new PolicyPage(),
  lossDetails: () => new LossDetailsPage(),
  claimDetails: () => new ClaimDetailsPage(),
  documents: () => new DocumentsPage(),
  workplan: () => new WorkplanPage(),
  litigation: () => new LitigationPage(),
  parties: () => new PartiesPage(),
  contacts: () => new ContactsPage(),
  subrogation: () => new SubrogationPage(),
  history: () => new HistoryPage(),
  notes: () => new NotesPage(),

  // Sub-tabs/top-level sections discovered 2026-08-20 by expanding every
  // left-nav item live — see navigationCatalog.ts's 'nav-extension' group
  // and genericPageFactories.ts's doc comment.
  // 'Claims'/'Claim' pair confirmed live 2026-08-27 — same column, plural
  // header on-prem vs singular on cloud.
  lossDetailsAssociations: () => createGridSubPage('lossDetailsAssociations', 'Loss Details: Associations', ['Loss Details', 'Associations'], 'AssociatedClaimsLV', {
    Claims: 'Claim',
  }),
  lossDetailsMedical: () => createFormSubPage('lossDetailsMedical', 'Loss Details: Medical', ['Loss Details', 'Medical']),
  // Column-name pairs below are CONFIRMED live 2026-08-27 — same value,
  // different header per platform — from a full batch run's findings (see
  // createGridSubPage's doc comment). Not a guess: every one of these
  // accounted for 100% of its section's mismatches before being aliased.
  // Additional pairs confirmed live 2026-08-27 on a 35-claim, multi-LOB
  // batch (Commercial Auto/BOP/CPP, not just Personal Auto): each LOB's
  // version of this grid names a couple of its own columns differently.
  // 'Number' padding (onprem "1" vs cloud "001", same value) is handled as
  // an expected-difference rule instead of an alias, since it's the SAME
  // canonical column name on both sides — only the value needs reconciling.
  policyLocationsClassCodes: () => createGridSubPage('policyLocationsClassCodes', 'Policy: Locations and Class Codes', ['Policy', ['Locations and Class Codes', 'Vehicles', 'Locations']], ['LocationsLV', 'VehiclesLV'], undefined, undefined, canonicalizeLocationsClassCodesRow),
  policyEndorsements: () => createGridSubPage('policyEndorsements', 'Policy: Endorsements', ['Policy', 'Endorsements'], 'EndorsementsLV', {
    Actions: 'View',
    PolicyForm: 'FormNumber',
    EditionDate: 'ExtEditionDate',
    // 'ExtEditionDatePC' confirmed live 2026-08-27 across a 35-claim,
    // multi-LOB batch (Commercial Auto/BOP/WC/CPP, not just Personal Auto)
    // — cloud's internal column name for this same field varies by LOB;
    // this one variant alone accounted for 100% of this section's
    // mismatches (502 findings / 251 rows) before being aliased.
    ExtEditionDatePC: 'ExtEditionDate',
    UnitNumber: 'ExtUnitNumber',
  }),
  policyAggregateLimits: () => createGridSubPage('policyAggregateLimits', 'Policy: Aggregate Limits', ['Policy', 'Aggregate Limits'], 'AggregateLimitsLV'),
  summaryOverview: () => createFormSubPage('summaryOverview', 'Summary: Overview', ['Summary', 'Overview']),
  summaryStatus: () => createFormSubPage('summaryStatus', 'Summary: Status', ['Summary', 'Status']),
  summaryHealthMetrics: () => createFormSubPage('summaryHealthMetrics', 'Summary: Health Metrics', ['Summary', 'Health Metrics']),
  // Keyed by Name alone, not the whole row — confirmed live 2026-08-27 a
  // user's role/team is a real, reassignable field (e.g. "Bodily Injury Mgr
  // 4" -> "Bodily Injury Team 6"), and keying on every column made a
  // reassignment look like that person vanishing and a stranger appearing
  // instead of one matched row with a role diff. See createGridSubPage's
  // businessKeyColumns doc comment.
  partiesUsers: () => createGridSubPage('partiesUsers', 'Parties Involved: Users', ['Parties Involved', 'Users'], 'ClaimUsersLV', {
    OfficePhoneExtension: 'OfficePhnExt',
  }, ['Name']),
  reinsurance: () => createFormSubPage('reinsurance', 'Reinsurance', ['Reinsurance']),
  // Column-name pairs confirmed live 2026-08-27 on a 35-claim batch — same
  // value, different internal name per platform (2 case-only variants:
  // CustomerID/CustomerId, MobileNo/mobile).
  hiMarleyCases: () => createGridSubPage('hiMarleyCases', 'Hi Marley Cases', ['Hi Marley Cases'], 'HiMarleyClaimCases_AccLV', {
    Contact: 'ContactName',
    CustomerId: 'CustomerID',
    mobile: 'MobileNo',
    ConsentStatus: 'CaseStatus',
    HiMarleyLink: 'HiMarleyCaseLink',
    PrivacyStatus: 'Privacy',
  }),
  planOfActionWcer: () => createGridSubPage('planOfActionWcer', 'Plan of Action: WCER', [{ soft: 'Plan of Action' }, ['WCER', 'Evaluations']], 'EditableEvaluationsLV'),
  planOfActionNegotiations: () => createGridSubPage('planOfActionNegotiations', 'Plan of Action: Negotiations', [{ soft: 'Plan of Action' }, 'Negotiations'], 'EditableNegotiationsLV'),
  planOfActionSurcharging: () => createFormSubPage('planOfActionSurcharging', 'Plan of Action: Surcharging', [{ soft: 'Plan of Action' }, 'Surcharging']),
  // FNOL Snapshot is itself a mini left-nav with 7 sub-tabs (confirmed live
  // 2026-08-25 — see the user-provided nav-tree screenshot) rather than one
  // flat page — reading only the bare ['FNOL Snapshot'] landing view (the
  // old single entry) silently skipped the other 6. Wired the same way as
  // Policy's/Summary's/Plan of Action's other multi-tab sub-sections: one
  // createFormSubPage per tab, 2-step navPath. Best-effort like those —
  // genericFieldReader only reads label/value FORM fields, so the tabs that
  // render as grids on the live pages they snapshot (Parties Involved,
  // Exposures, Documents) will likely read empty here until confirmed
  // against a real capture and (if needed) upgraded to createGridSubPage.
  fnolLossDetails: () => createFormSubPage('fnolLossDetails', 'FNOL Snapshot: Loss Details', ['FNOL Snapshot', 'Loss Details']),
  fnolPartiesInvolved: () => createFormSubPage('fnolPartiesInvolved', 'FNOL Snapshot: Parties Involved', ['FNOL Snapshot', 'Parties Involved']),
  fnolPolicy: () => createFormSubPage('fnolPolicy', 'FNOL Snapshot: Policy', ['FNOL Snapshot', 'Policy']),
  fnolExposures: () => createFormSubPage('fnolExposures', 'FNOL Snapshot: Exposures', ['FNOL Snapshot', 'Exposures']),
  // FNOL Snapshot's Notes/Documents sub-tabs are StubSectionPages, not
  // createFormSubPage, DELIBERATELY — confirmed live 2026-08-27 this page
  // shape is a filter panel + scrollable list, not a label/value form.
  // readDynamicFields (built for label/value forms — see its own doc
  // comment) instead swept up the filter dropdowns as fake "fields": on
  // cloud a native <select> read via textContent returns every <option>
  // concatenated together (e.g. "Since" read as
  // "AnyTodayLast 7 daysLast 30 days...") while on-prem's combo shows just
  // the current value ("Any") — a guaranteed mismatch every run, on data
  // that was never a real claim field to begin with. The underlying notes/
  // documents ARE already reconciled cleanly by the dedicated 'notes'/
  // 'documents' sections (readAllPages against ClaimNotesLV/DocumentsLV) —
  // this sub-tab added zero unique signal, only noise. Swap back to a real
  // page object only if this tab is confirmed to expose data the main
  // Notes/Documents sections don't.
  fnolNotes: () => new StubSectionPage('fnolNotes', 'FNOL Snapshot: Notes'),
  fnolDocuments: () => new StubSectionPage('fnolDocuments', 'FNOL Snapshot: Documents'),
  fnolAdditionalFields: () => createFormSubPage('fnolAdditionalFields', 'FNOL Snapshot: Additional Fields', ['FNOL Snapshot', 'Additional Fields']),

  // Calendar is a StubSectionPage, not createFormSubPage, DELIBERATELY —
  // see navigationCatalog.ts's note on this key. Its extract() never runs
  // readDynamicFields against whatever page happens to be open, so it can't
  // leak another section's leftover fields under the Calendar label the way
  // it was confirmed doing live 2026-08-25 (see partiesExtractor.ts's reset
  // step). Swap back to a real page object once the actual Calendar widget
  // (month grid + per-day event list) has been seen live and its selectors
  // confirmed — needed for the requested per-date comparison.
};

const registry = new Map<string, ClaimSectionPage<unknown>>();

for (const section of navigationCatalog) {
  const factory = REAL_IMPLEMENTATIONS[section.key];
  registry.set(section.key, factory ? factory() : new StubSectionPage(section.key, section.label));
}

export function getSectionPage(key: string): ClaimSectionPage<unknown> {
  const page = registry.get(key);
  if (!page) throw new Error(`No page object registered for section "${key}" — is it in navigationCatalog.ts?`);
  return page;
}
