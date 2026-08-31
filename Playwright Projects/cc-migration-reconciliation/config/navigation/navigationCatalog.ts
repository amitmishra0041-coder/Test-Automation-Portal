/**
 * The single on/off switch for which claim sections a run walks (Section 6
 * of the architecture doc). Nothing outside this file decides whether a
 * section runs — BatchRunner/ReconciliationRunner just iterate
 * `navigationCatalog.filter(s => s.enabled)`.
 *
 * `status` records locator confidence, not scope. Every section below is
 * wired into the pipeline (model + page object + extractor) starting now,
 * per the "full catalog from day one" decision. What differs is whether the
 * page object has real, live-proven selectors yet:
 *   - 'confirmed' : ported directly from code with "confirmed via live
 *                   codegen/screenshot" provenance in the ClaimCenter-
 *                   Automation repo.
 *   - 'partial'   : confirmed on one platform, not the other (or confirmed
 *                   for navigation but not field-level extraction yet).
 *   - 'stub'      : no verified selector exists anywhere yet. The extractor
 *                   returns EXTRACTION_FAILED with a clear TODO rather than
 *                   guessing a DOM shape nobody has seen — see Section 28's
 *                   explicit instruction not to invent ClaimCenter locators.
 */
export type SectionStatus = 'confirmed' | 'partial' | 'stub';

export interface NavigationSectionConfig {
  key: string;
  label: string;
  group: 'structural' | 'exposure' | 'financial' | 'activity' | 'content' | 'specialty' | 'extensibility' | 'nav-extension';
  enabled: boolean;
  status: SectionStatus;
  /** For 'nav-extension' group entries: the left-nav path this section lives under, e.g. ['Loss Details', 'Associations'] — used to render the report's nav-mirrored section tree. */
  navPath?: string[];
  notes?: string;
}

export const navigationCatalog: NavigationSectionConfig[] = [
  // ── Structural ────────────────────────────────────────────────────────
  { key: 'claimSummary', label: 'Claim Summary', group: 'structural', enabled: true, status: 'partial',
    navPath: ['Summary'],
    notes: 'Header ledger (policy/claim/insured/claimant/lossDate/status/adjuster) is confirmed via readClaimHeader; the rest of the Summary page is not.' },
  { key: 'claimDetails', label: 'Claim Details', group: 'structural', enabled: true, status: 'confirmed',
    navPath: ['Loss Details'],
    notes: 'CONFIRMED both platforms 2026-08-20. No separate "Claim Details" nav item exists on either platform — these scalars (claimType/lossType/jurisdiction/reportedDate/closeDate) live on the "Loss Details" page instead; claimType stays NOT_PRESENT (no distinct field found).' },
  { key: 'policy', label: 'Policy', group: 'structural', enabled: true, status: 'confirmed',
    navPath: ['Policy', 'General'],
    notes: 'CONFIRMED both platforms 2026-08-20. The 6 named PolicyData fields are pulled from a dynamic full-page read (genericFieldReader.ts, same as Loss Details) rather than a fixed label list; everything else the page renders (Effective/Expiration Date, Underwriting Company, Deductible, …) is compared too, via PolicyData.extra — the old LABELS-array version discovered these but never wired them into the returned object at all. jurisdiction stays NOT_PRESENT (not shown on this page on either platform); policyTerm maps on-prem "Policy Mod" to cloud "Policy Term" via the alias table (same value observed live, different label).' },
  { key: 'parties', label: 'Parties', group: 'structural', enabled: true, status: 'confirmed',
    navPath: ['Parties Involved', 'Contacts'],
    notes: 'CONFIRMED both platforms 2026-08-20. "Parties Involved" is a PARENT nav item on both — the real grid (PeopleInvolvedDetailedLV) is reached via its "Contacts" sub-item (2-step click on cloud; on-prem\'s single click already lands there). email stays NOT_PRESENT — not a grid column.' },
  { key: 'contacts', label: 'Contacts', group: 'structural', enabled: true, status: 'confirmed',
    navPath: ['Parties Involved', 'Contacts'],
    notes: 'CONFIRMED both platforms 2026-08-20 — same grid as parties (PeopleInvolvedDetailedLV); there is no distinct "Contacts" data source on either platform. relatedTo stays NOT_PRESENT — no per-contact claim/exposure link column on this grid.' },

  // ── Exposure & coverage ─────────────────────────────────────────────
  { key: 'incidents', label: 'Incidents', group: 'exposure', enabled: true, status: 'stub' },
  { key: 'exposures', label: 'Exposures', group: 'exposure', enabled: true, status: 'confirmed', navPath: ['Exposures'] },
  { key: 'lossDetails', label: 'Loss Details', group: 'exposure', enabled: true, status: 'confirmed',
    navPath: ['Loss Details', 'General'],
    notes: 'CONFIRMED both platforms 2026-08-20. Reads EVERY label/value pair on the page dynamically (genericFieldReader.ts) rather than a fixed per-LOB label list — confirmed live it discovers 91 fields symmetrically on both platforms for a Workers\' Comp claim (up from 17 hand-picked ones), and will pick up fields on LOBs never tested (Commercial Auto/BOP/GL/Umbrella/…) without code changes. Cloud shows a real label quirk on at least Property/Dwelling Fire claims — some labels render as raw internal property names ("LossType", "LOBCode") instead of human text; the alias table in genericFieldReader.ts reconciles the ones confirmed so far.' },
  { key: 'coverage', label: 'Coverage', group: 'exposure', enabled: true, status: 'stub',
    notes: 'Coverage menu SHAPE varies by LOB (see project_cc_e2e_close_rules memory) — extractor must branch per LOB once built, not assume one layout.' },
  { key: 'claimStatus', label: 'Claim Status', group: 'exposure', enabled: true, status: 'partial',
    navPath: ['Summary'],
    notes: 'The status VALUE is confirmed via the header ledger; a dedicated status-history view is not.' },
  { key: 'exposureStatus', label: 'Exposure Status', group: 'exposure', enabled: true, status: 'stub' },

  // ── Financial ─────────────────────────────────────────────────────────
  { key: 'financials', label: 'Financials', group: 'financial', enabled: true, status: 'confirmed',
    navPath: ['Financials', 'Summary'],
    notes: 'CONFIRMED both platforms 2026-08-20. The "Claim Total" row of the Summary grid is read on both (on-prem was cloud-only before); the deeper per-exposure/per-cost-type breakdown rows are a real, documented gap — see financialsExtractor.ts\'s readSummaryOnPrem doc comment. paidTotal/remainingReserve totals are pulled from that same row; outstandingTotal has no confirmed matching column, stays NOT_PRESENT.' },
  { key: 'checksPayments', label: 'Checks/Payments', group: 'financial', enabled: true, status: 'partial',
    navPath: ['Financials', 'Checks/Payments'],
    notes: 'CONFIRMED structure both platforms 2026-08-20 — real "Financials > Checks/Payments" sub-page (on-prem grid id ChecksLV), replacing the earlier guessed separate "Payments"/"Checks" pages (neither was ever confirmed to exist). Both test claims had zero rows (no payment made), so row-level parsing is unvalidated against real data.' },
  { key: 'recoveryChecks', label: 'Recovery Checks', group: 'financial', enabled: true, status: 'partial',
    navPath: ['Financials', 'Recovery Checks'],
    notes: 'CONFIRMED structure both platforms 2026-08-20 — real "Financials > Recovery Checks" sub-page (on-prem grid id RecoveryChecksExtLV), replacing the earlier guessed "Recoveries" page (never confirmed). Both test claims had zero rows, so row-level parsing is unvalidated against real data.' },
  { key: 'lineCategorySummary', label: 'Line Category Summary', group: 'financial', enabled: true, status: 'stub',
    navPath: ['Financials', 'Line Category Summary'],
    notes: 'Nav item confirmed real on both platforms ("Financials > Line Category Summary") but renders NO content at all beyond its own title for either test claim — no grid, no ids, no headers found live 2026-08-20. Left as stub rather than guessing a shape nobody has seen; may only render once the claim has multiple reserve lines/cost categories to summarize.' },
  { key: 'transactions', label: 'Transactions', group: 'financial', enabled: true, status: 'confirmed',
    navPath: ['Financials', 'Transactions'],
    notes: 'CONFIRMED both platforms via live dev-tier pass 2026-08-20 (PA-GA-10-20-0000016 onprem, DFP-PA-01-26-0000083 cloud — different claims, dev tiers do not mirror each other). Still the ground-truth array Reserves/Payments/Recoveries/Checks are views over (Section C/G) — those remain stubs; the grid has no subtype/reserveLine/claimant/payee column, see TransactionData doc comment.' },

  // ── Activity ──────────────────────────────────────────────────────────
  { key: 'activities', label: 'Activities', group: 'activity', enabled: true, status: 'partial',
    navPath: ['Workplan'],
    notes: 'The activity DETAIL FORM question fields (e.g. "Was contact able to be made?") are confirmed on-prem via TreeWalker text-node search — see feedback_cc_activity_fields memory. Reading the activities GRID itself is not confirmed.' },
  { key: 'workplan', label: 'Workplan', group: 'activity', enabled: true, status: 'confirmed',
    navPath: ['Workplan'],
    notes: 'CONFIRMED both platforms 2026-08-20 with real multi-row data (13 rows onprem, 23 rows cloud). Model extended with the real columns (Subject/Priority/Description/Exposure/Assigned By/Assigned To) — no confirmed "type" column, itemType stays NOT_PRESENT.' },

  // ── Content ───────────────────────────────────────────────────────────
  { key: 'notes', label: 'Notes', group: 'content', enabled: true, status: 'partial',
    navPath: ['Notes'],
    notes: 'CONFIRMED on-prem 2026-08-20 against a real note (PA-GA-10-20-0000016) — the "card list" is a repeating id-addressed pattern (ClaimNotesLV:<row>:<field> — Author/Topic/RelatedTo/AuthoringDate/Body), read the same way as the id-addressed grids elsewhere. Cloud\'s id pattern is inferred from the same convention every other grid uses on both platforms, NOT confirmed against real data — no cloud test claim had a note.' },
  { key: 'documents', label: 'Documents', group: 'content', enabled: true, status: 'confirmed',
    navPath: ['Documents'],
    notes: 'CONFIRMED both platforms 2026-08-20. relatedTo stays NOT_PRESENT ("Related To" is a search filter above the grid, not a column, on either platform); author captured under metadata (no dedicated field on DocumentData).' },
  { key: 'history', label: 'History', group: 'content', enabled: false, status: 'confirmed',
    navPath: ['History'],
    notes: 'DISABLED 2026-08-27 at user request — not a locator or extraction problem, the section is fundamentally uncomparable by nature: simply running this tool visits the claim on both platforms, and each visit writes its OWN fresh "Viewed" audit row (own timestamp, own user) into that claim\'s History grid on that platform. Confirmed live: 32 of 34 real History mismatches across a full batch were exactly these self-inflicted "Viewed" rows never matching their counterpart — noise this tool itself creates every run, not a migration difference. Disabling (both platforms skip the walk, so both sides come back equally empty and produce zero findings) rather than leaving it enabled and papering over it with an expected-difference rule, since that would still require opening the page and accumulating another "Viewed" row on every future run. CONFIRMED both platforms 2026-08-20 as a real, working extractor (HistoryLV grid: Type/Related To/User/Event Time Stamp/Description/Link) before this was disabled — re-enable by flipping `enabled` back to true if this tradeoff changes.' },

  // ── Specialty ─────────────────────────────────────────────────────────
  { key: 'segmentation', label: 'Segmentation', group: 'specialty', enabled: true, status: 'stub',
    notes: 'CONFIRMED ABSENT 2026-08-20: full ARIA-accessibility-tree dump of the left nav (same mechanism clickNavItem uses) on cloud across 2 LOBs (WC, Property/Dwelling Fire), plus on-prem\'s "New..." activity-creation menu — no "Segmentation" entry anywhere in either. Not a locator gap; this ClaimCenter config has no distinct Segmentation page reachable from these test claims. Left as stub (EXTRACTION_FAILED, honest) rather than removed, in case it is flag-conditional on a claim state these test claims don\'t have.' },
  { key: 'specialInvestigations', label: 'Special Investigations', group: 'specialty', enabled: true, status: 'stub',
    notes: 'CONFIRMED ABSENT 2026-08-20 (same ARIA-tree sweep as segmentation) — no "Special Investigation"/"SIU" nav entry on either platform. A "SIU Assignment" flag FIELD is confirmed on Loss Details (see lossDetails) — this suggests a full SIU page may only appear once a claim is actually SIU-flagged, which neither test claim is. Left as stub for the same reason as segmentation.' },
  { key: 'litigation', label: 'Litigation', group: 'specialty', enabled: true, status: 'confirmed',
    navPath: ['Litigation'],
    notes: 'CONFIRMED both platforms 2026-08-20 (Matters grid) with real row data (18 rows on PA-GA-10-20-0000016 onprem; 0 on the unrelated cloud test claim, plausible for a different claim, not a gap).' },
  { key: 'subrogation', label: 'Subrogation', group: 'specialty', enabled: true, status: 'partial',
    navPath: ['Subrogation', 'Summary'],
    notes: 'CONFIRMED structure both platforms 2026-08-20 ("Subrogation: Summary" — General fields + Responsible Parties grid, EditableAdverseGeneralLV) and live-validated against 2 real claim pairs (WC, Personal Auto/Dwelling Fire) — General labels confirmed present-but-blank on all 4 test claims except Jurisdiction (honest NOT_PRESENT, not a locator gap); the grid\'s "Claim Total:" footer row is explicitly filtered out so it cannot masquerade as a fake responsible party. All 4 test claims had zero real responsible parties, so row-level column mapping (Party/Classification/Strategy/%s) is unvalidated against actual multi-row data.' },
  { key: 'salvage', label: 'Salvage', group: 'specialty', enabled: true, status: 'stub',
    notes: 'CONFIRMED ABSENT 2026-08-20 (same ARIA-tree sweep as segmentation) — no "Salvage" nav entry on either platform; on-prem\'s activity-creation menu has "Total Loss" as an activity type (adjacent concept) but not a Salvage page. A "Salvage Status"/"Salvage Potential" flag FIELD is confirmed on Loss Details. Left as stub for the same reason as segmentation.' },

  // ── Nav extensions ───────────────────────────────────────────────────
  // Discovered 2026-08-20 by expanding every left-nav item live on a WC
  // claim (see the user-provided nav-tree screenshot) — sub-tabs of
  // sections already covered above, and whole top-level sections that had
  // no catalog entry at all. Built via the two shared factories in
  // src/pages/shared/genericPageFactories.ts (dynamic form read, or a
  // single grid read keyed by raw column names) rather than hand-written
  // page objects — see that file's doc comment. Land under
  // claim.extensions.<key> (ClaimData.ts), not a dedicated model slot.
  { key: 'lossDetailsAssociations', label: 'Loss Details: Associations', group: 'nav-extension', enabled: true, status: 'partial',
    navPath: ['Loss Details', 'Associations'],
    notes: 'CONFIRMED live 2026-08-20 — grid id AssociatedClaimsLV (columns Association/Claims/Type). Row-level cross-platform column-name matching unvalidated (raw column names, no hand-built alias table — see genericPageFactories.ts).' },
  { key: 'lossDetailsMedical', label: 'Loss Details: Medical', group: 'nav-extension', enabled: true, status: 'partial',
    navPath: ['Loss Details', 'Medical'],
    notes: 'CONFIRMED live 2026-08-20 — 40 real WC-specific form fields (Estimated RTW Date, MMI Date, Hospital, etc.) read dynamically. The page ALSO has a nested "IME Medical Actions" grid (EditableMedicalActionsLV) that is NOT captured — only the form fields are, a known gap.' },
  { key: 'policyLocationsClassCodes', label: 'Policy: Locations and Class Codes', group: 'nav-extension', enabled: true, status: 'partial',
    navPath: ['Policy', 'Locations and Class Codes'],
    notes: 'CONFIRMED live 2026-08-20 — grid id LocationsLV (the locations list) on Workers\' Comp. LOB-VARIANT, confirmed live 2026-08-21: this same Policy sub-tab is labeled "Vehicles" (grid id VehiclesLV) on Personal Auto, and plain "Locations" (same grid id LocationsLV, confirmed on a live BOP claim) on BOP/DFP — the registry entry now tries all three labels in order, with two candidate grid ids (see genericPageFactories.ts resolveGridId). The page also has nested BuildingLV/EditableClassCodesLV (WC/BOP/DFP) or per-vehicle coverage/lienholder grids (PA) reached by drilling into a row, NOT captured — only the top-level list is.' },
  { key: 'policyEndorsements', label: 'Policy: Endorsements', group: 'nav-extension', enabled: true, status: 'partial',
    navPath: ['Policy', 'Endorsements'],
    notes: 'CONFIRMED live 2026-08-20 — grid id EndorsementsLV, real multi-row data (30 rows onprem test claim). Row-level cross-platform column-name matching unvalidated.' },
  { key: 'policyAggregateLimits', label: 'Policy: Aggregate Limits', group: 'nav-extension', enabled: true, status: 'partial',
    navPath: ['Policy', 'Aggregate Limits'],
    notes: 'CONFIRMED live 2026-08-20 — grid id AggregateLimitsLV (columns Applies To/Aggregate Type/Amount/Realized/Remaining/Count Towards Limit/Coverages).' },
  { key: 'summaryOverview', label: 'Summary: Overview', group: 'nav-extension', enabled: true, status: 'partial',
    navPath: ['Summary', 'Overview'],
    notes: 'CONFIRMED live 2026-08-20, but this is a DASHBOARD aggregating Workplan/Litigation/Associated Claims/Latest Notes — expect heavy overlap with those already-covered sections rather than new information.' },
  { key: 'summaryStatus', label: 'Summary: Status', group: 'nav-extension', enabled: true, status: 'partial',
    navPath: ['Summary', 'Status'],
    notes: 'CONFIRMED live 2026-08-20 — 36 real form fields not captured anywhere else (Large Loss?, Coverage in Question?, SIU Status/Referral Type/Investigation Type, Flagged, Attorney Represented, Reinsurance flag, Legal Hold). High value, purely dynamic-form-shaped.' },
  { key: 'summaryHealthMetrics', label: 'Summary: Health Metrics', group: 'nav-extension', enabled: true, status: 'partial',
    navPath: ['Summary', 'Health Metrics'],
    notes: 'CONFIRMED live 2026-08-20 as content (computed KPIs: Days Open, Time to First Loss Payment, % Reserve Change, etc.) but only 2 fields matched the standard .x-form-item-label pattern genericFieldReader looks for — most of this page likely uses a different DOM shape not yet reverse-engineered. Real, disclosed gap.' },
  { key: 'partiesUsers', label: 'Parties Involved: Users', group: 'nav-extension', enabled: true, status: 'partial',
    navPath: ['Parties Involved', 'Users'],
    notes: 'CONFIRMED live 2026-08-20 — grid id ClaimUsersLV. Two more nested grids (ClaimUserAssignmentsLV/EditableClaimUserRolesLV) are NOT captured.' },
  { key: 'reinsurance', label: 'Reinsurance', group: 'nav-extension', enabled: true, status: 'partial',
    navPath: ['Reinsurance'],
    notes: 'CONFIRMED live 2026-08-20 — no catalog entry existed before. Real content (RI Financials figures: Total RI Recoverable, Ceded Reserves, Net Total Incurred with Reinsurance, etc.), read as a dynamic form. The page also has a Reinsurance Agreements grid (id ReinsuranceSummaryLV — same id as the whole panel, ambiguous) that is NOT reliably captured separately.' },
  { key: 'hiMarleyCases', label: 'Hi Marley Cases', group: 'nav-extension', enabled: true, status: 'partial',
    navPath: ['Hi Marley Cases'],
    notes: 'CONFIRMED live 2026-08-20 — no catalog entry existed before. Grid id HiMarleyClaimCases_AccLV (SMS/texting integration case list — Contact Name/Case Number/Customer ID/Mobile No/Case Status/Opt Status). Zero rows on the test claim (no SMS case opened), so row-level parsing is unvalidated.' },
  { key: 'planOfActionWcer', label: 'Plan of Action: WCER', group: 'nav-extension', enabled: true, status: 'partial',
    navPath: ['Plan of Action', 'WCER'],
    notes: 'CONFIRMED live 2026-08-20 on a WC claim — no catalog entry existed before. Grid id EditableEvaluationsLV (same id confirmed on BOP too). LOB-VARIANT, confirmed live 2026-08-21 on BOP/DFP/PA claims: this sub-tab is labeled "WCER" on Workers\' Comp claims but "Evaluations" (plural — an earlier guess of singular "Evaluation" was wrong) on every other LOB tried — the registry entry now tries both labels in order.' },
  { key: 'planOfActionNegotiations', label: 'Plan of Action: Negotiations', group: 'nav-extension', enabled: true, status: 'partial',
    navPath: ['Plan of Action', 'Negotiations'],
    notes: 'CONFIRMED live 2026-08-20 — no catalog entry existed before. Grid id EditableNegotiationsLV.' },
  { key: 'planOfActionSurcharging', label: 'Plan of Action: Surcharging', group: 'nav-extension', enabled: true, status: 'partial',
    navPath: ['Plan of Action', 'Surcharging'],
    notes: 'CONFIRMED live 2026-08-21 on a Personal Auto claim — LOB-SPECIFIC, this sub-tab does not appear on WC/BOP/DFP\'s Plan of Action menu at all (correctly reported as not-navigable there, not a bug). No grid — a dynamic form: a list of surcharge-exemption criteria (checkbox-style, long explanatory label text) plus "Underwriter review required?" and "Comments".' },
  // FNOL Snapshot — CONFIRMED live 2026-08-25 (user-provided nav-tree
  // screenshot) to have 7 sub-tabs, one entry each rather than the single
  // "default landing tab only" entry this used to be — see registry.ts's
  // note on these keys for the read-shape caveat (form-shaped tabs only,
  // for now).
  { key: 'fnolLossDetails', label: 'FNOL Snapshot: Loss Details', group: 'nav-extension', enabled: true, status: 'partial',
    navPath: ['FNOL Snapshot', 'Loss Details'],
    notes: 'CONFIRMED live 2026-08-25 as a real sub-tab (nav-tree screenshot); read shape (dynamic form) not yet confirmed against live field data.' },
  { key: 'fnolPartiesInvolved', label: 'FNOL Snapshot: Parties Involved', group: 'nav-extension', enabled: true, status: 'stub',
    navPath: ['FNOL Snapshot', 'Parties Involved'],
    notes: 'CONFIRMED live 2026-08-25 as a real sub-tab. Likely grid-shaped (mirrors the live Parties Involved grid) — read via the generic FORM factory for now, so probably reads empty until confirmed and upgraded to createGridSubPage with a real grid id.' },
  { key: 'fnolPolicy', label: 'FNOL Snapshot: Policy', group: 'nav-extension', enabled: true, status: 'partial',
    navPath: ['FNOL Snapshot', 'Policy'],
    notes: 'CONFIRMED live 2026-08-25 as a real sub-tab. Read shape (dynamic form) not yet confirmed against live field data.' },
  { key: 'fnolExposures', label: 'FNOL Snapshot: Exposures', group: 'nav-extension', enabled: true, status: 'stub',
    navPath: ['FNOL Snapshot', 'Exposures'],
    notes: 'CONFIRMED live 2026-08-25 as a real sub-tab. Likely grid-shaped (mirrors the live Exposures grid) — read via the generic FORM factory for now, so probably reads empty until confirmed and upgraded to createGridSubPage with a real grid id.' },
  { key: 'fnolNotes', label: 'FNOL Snapshot: Notes', group: 'nav-extension', enabled: true, status: 'stub',
    navPath: ['FNOL Snapshot', 'Notes'],
    notes: 'CONFIRMED live 2026-08-25 as a real sub-tab. Likely grid-shaped (mirrors the live Notes grid) — read via the generic FORM factory for now, so probably reads empty until confirmed and upgraded to createGridSubPage with a real grid id.' },
  { key: 'fnolDocuments', label: 'FNOL Snapshot: Documents', group: 'nav-extension', enabled: true, status: 'stub',
    navPath: ['FNOL Snapshot', 'Documents'],
    notes: 'CONFIRMED live 2026-08-25 as a real sub-tab. Likely grid-shaped (mirrors the live Documents grid) — read via the generic FORM factory for now, so probably reads empty until confirmed and upgraded to createGridSubPage with a real grid id.' },
  { key: 'fnolAdditionalFields', label: 'FNOL Snapshot: Additional Fields', group: 'nav-extension', enabled: true, status: 'partial',
    navPath: ['FNOL Snapshot', 'Additional Fields'],
    notes: 'CONFIRMED live 2026-08-25 as a real sub-tab. Read shape (dynamic form) not yet confirmed against live field data.' },
  { key: 'calendar', label: 'Calendar', group: 'nav-extension', enabled: true, status: 'stub',
    navPath: ['Calendar'],
    notes: 'CONFIRMED live 2026-08-20 — this is a personal scheduling widget (My Calendar/Supervisor Calendar — a month grid + per-day event list), not claim field data. User request 2026-08-25: compare it per-date, marking a date FAILED when its assigned items differ between platforms — a real, wanted signal, not "not meaningful" as this note previously argued. Not yet built: doing that correctly needs a real page object with confirmed selectors for the month grid + per-day item list, and this project\'s own convention (Section 28) is never to invent ClaimCenter locators. Registered as a plain StubSectionPage (not createFormSubPage) as of 2026-08-25 specifically because the old wiring was confirmed leaking a stale contact-detail page\'s fields under the Calendar label (see partiesExtractor.ts\'s post-drilldown reset) — a stub can\'t leak, a mis-navigated form reader can. Needs a live screenshot of the actual Calendar widget on both platforms before a real per-date reader can be built.' },

  // ── Extensibility ─────────────────────────────────────────────────────
  { key: 'customFields', label: 'Custom Fields', group: 'extensibility', enabled: true, status: 'stub' },
  { key: 'customScreens', label: 'Custom Screens', group: 'extensibility', enabled: false, status: 'stub',
    notes: 'Disabled by default — no custom screens have been identified for this implementation yet. Enable per Section S question 7-9 once known.' },
  { key: 'customExtensions', label: 'Custom Extensions', group: 'extensibility', enabled: false, status: 'stub',
    notes: 'Disabled by default, same reason as customScreens.' },
];

export function enabledSections(): NavigationSectionConfig[] {
  return navigationCatalog.filter(s => s.enabled);
}

export function getSection(key: string): NavigationSectionConfig {
  const found = navigationCatalog.find(s => s.key === key);
  if (!found) throw new Error(`Unknown navigation section: ${key}`);
  return found;
}

/**
 * The real ClaimCenter left-nav order (confirmed live 2026-08-20, see the
 * user-provided nav-tree screenshot) — used only to sort the report's
 * nav-mirrored section tree so it reads top-to-bottom the same way the
 * actual left nav does, not alphabetically.
 */
export const REAL_NAV_ORDER: string[] = [
  'Summary', 'Workplan', 'Loss Details', 'Reinsurance', 'Parties Involved', 'Policy',
  'Financials', 'Notes', 'Documents', 'Hi Marley Cases', 'Plan of Action', 'Subrogation',
  'Litigation', 'Claim History', 'History', 'FNOL Snapshot', 'Calendar',
  // Not real left-nav items, but reported sections that need a stable slot:
  'Claim Summary', 'Claim Details', 'Exposures', 'Contacts', 'Segmentation',
  'Special Investigations', 'Salvage',
];

/**
 * A `Finding.section` string (set per-field inside each extractor, e.g.
 * "Financials: Transactions", or the bare catalog key for the specialty
 * stubs like "segmentation") doesn't always match a catalog entry's
 * `label` exactly — this reconciles the handful of known mismatches so the
 * report can group findings by real left-nav path. Falls back to treating
 * the section string as its own one-level path if nothing matches, so an
 * unrecognized section still renders (as its own top-level group) rather
 * than being dropped.
 */
const SECTION_LABEL_ALIASES: Record<string, string> = {
  'Financials: Transactions': 'transactions',
  'Financials: Checks/Payments': 'checksPayments',
  'Financials: Recovery Checks': 'recoveryChecks',
};

export function getNavPathForSection(sectionLabel: string): string[] {
  const aliasKey = SECTION_LABEL_ALIASES[sectionLabel];
  if (aliasKey) {
    const byAlias = navigationCatalog.find((s) => s.key === aliasKey);
    if (byAlias?.navPath) return byAlias.navPath;
  }
  const byKey = navigationCatalog.find((s) => s.key === sectionLabel);
  if (byKey?.navPath) return byKey.navPath;
  const byLabel = navigationCatalog.find((s) => s.label === sectionLabel);
  if (byLabel?.navPath) return byLabel.navPath;
  return [sectionLabel];
}
