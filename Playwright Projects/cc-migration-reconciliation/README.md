# ClaimCenter Migration Reconciliation

Reconciles Guidewire ClaimCenter On-Prem claims against their Cloud migration
counterparts: opens the same claim in both environments, extracts both into
a shared structured model, normalizes, applies expected-migration-difference
rules, and reports classified findings — distinguishing genuine migration
defects from expected transformations, formatting noise, and extraction
failures.

Full architecture, data model, and design rationale: see the published
architecture doc (ask in the originating conversation for the link, or
regenerate from `docs/` if you've copied one in) — this README is
deliberately just the "how do I run this" reference.

## Status

This is a scaffold, not a finished tool. Per the "full catalog from day one"
decision, every section from the requirements is wired into the pipeline
(config entry, data model, page object), but **most sections are stubs**
pending a live pass against the real application — see
`config/navigation/navigationCatalog.ts` for exactly which sections have
confirmed selectors (`status: 'confirmed'` / `'partial'`) versus which don't
(`status: 'stub'`). Stubs report `EXTRACTION_FAILED` with a clear `TODO`
rather than inventing a DOM shape nobody has verified — they will not
silently look like a match.

**Confirmed today** (all live-verified 2026-08-20 against dev-tier claims
`PA-GA-10-20-0000016` on-prem / `DFP-PA-01-26-0000083` cloud — dev tiers
don't mirror each other, so these are different claims, not a matched
migration pair; use `test` tier for a real reconciliation run once it's
reachable again, see note below):
- Authentication (both platforms), claim search, claim-summary header
- Exposures, the cloud Financials summary grid, the Transactions ledger
  (both platforms)
- Policy detail, Claim Details / Loss Details (both platforms — no separate
  "Claim Details" page exists on either platform; it shares Loss Details)
- Documents, Workplan (both platforms, real multi-row data)
- Litigation / Matters (both platforms, real row data on-prem)

**Still stubs:** Parties/Contacts (both platforms expose "Parties Involved"
as a parent nav item whose real content is a "Contacts" sub-item — a 2-step
nav click not yet built), Notes (renders as a repeating card list, not a
plain grid — needs different parsing than the other sections), History
(the "History"/"Claim History" nav items show *other claims by the same
insured*, not a change-log — `HistoryEventData`'s assumed shape doesn't
match and needs remodeling first), Reserves/Payments/Recoveries/Checks as
distinct reads (the grid Transactions ground-truths has no on-screen
subtype/reserve-line/claimant/payee column), on-prem Financials summary,
Segmentation/Special Investigations/Salvage (no distinct nav item found on
either platform across two live sweeps — may be flag-conditional or not
used in this config), Subrogation (on-prem page confirmed live, not yet
built into an extractor), and all extensibility sections. See "Filling in a
stub" below.

**A real extraction bug worth knowing about:** the generic label→value
reader used by Policy/Loss Details (`labeledFieldReader.ts`) originally
queried only the labels each extractor wanted values for. On a page with
blank fields (common — many Loss Details questions go unanswered), the
blank field's "value" position is actually occupied by the *next* label;
if that label wasn't in the query list, its text got silently read as the
blank field's value — e.g. on-prem's `namedInsured` came back as the
literal string `"Summary"` (the first Left-nav item) rather than being
recognized as missing. Fixed by requiring the full on-page label inventory,
not just the wanted subset — see that file's doc comment. Caught by
manually inspecting extracted values against a live capture, not by the
comparison engine's own classification (a wrong-but-present value is
structurally indistinguishable from a correct one to a diff) — worth
remembering before trusting any new labeled-field extractor's output on
sight.

**Environment note (2026-08-20):** on-prem `test` tier returned a literal
"Server unavailable" page and cloud `test`'s configured hostname returned a
Kubernetes "default backend - 404" (likely stale/decommissioned) — both
unreachable when last checked. `dev` tier works on both platforms but each
side has its own independent claim data, not a migrated pair, so it can
prove out extractor selectors per-platform but can't validate a real
cross-environment reconciliation. Confirm/update the `test` tier URLs and
availability before relying on `npm run reconcile` for actual migration
sign-off.

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env   # fill in CC_USER / CC_PASS — never commit .env
```

## Running

```bash
# Everything in a claims file (.csv or .xlsx — same columns either way;
# see data/claims.sample.csv / data/claims.sample.xlsx. claimType doubles
# as LOB for the by-LOB summary below — it's read from this file, not
# extracted live, since claim-type extraction is still a stub)
npm run reconcile -- --claims data/claims.sample.csv
npm run reconcile -- --claims data/claims.sample.xlsx

# One claim (doesn't need to be pre-listed in a file)
npm run reconcile -- --claim 123456789

# One claim, but a DIFFERENT number on each platform — for exercising the
# tool while a real migrated pair isn't available yet (see the environment
# note above). A bulk claims file can do the same per-row via an optional
# cloudClaimNumber column, alongside claimNumber (the on-prem number).
npm run reconcile -- --onprem-claim WC-DE-01-26-0000345 --cloud-claim WC-DE-85-26-0000157 --tier dev

# One migration batch (matches the migrationBatch column)
npm run reconcile -- --claims data/claims.csv --batch B3

# Against the dev tier instead of test
npm run reconcile -- --claims data/claims.csv --tier dev

# More workers for a large batch (default 4 — see the architecture doc's
# note on on-prem background-job load before raising this)
WORKERS=6 npm run reconcile -- --claims data/claims.csv --group full-migration
```

Reports land in `reports/` (HTML, JSON, CSV, XLSX — configurable via
`REPORT_FORMATS`). Evidence screenshots land in `evidence/<claimNumber>/`.

Every format carries three views of the same data: **claim-level** (one row
per claim), **section summary** (one row per claim × section — matches vs.
mismatches vs. expected-differences vs. unable-to-compare, so you can see
which sections were clean without reading every field-level finding), and
**by-LOB** (the section summary rolled up across every claim sharing a
`claimType`). CSV writes these as three separate files
(`-mismatches.csv`, `-section-summary.csv`, `-lob-summary.csv`); Excel as
separate sheets (`Section Summary`, `By LOB`); HTML and JSON inline
(`report.byLob`, `claim.sectionSummary`).

Exit code contract (also what CI gates on): `0` clean, `1` technical/
automation failures present (login, extraction), `2` unexpected CRITICAL or
HIGH findings present.

### Via Playwright directly

```bash
npx playwright test                       # uses data/claims.sample.csv
CLAIMS_FILE=data/claims.csv npx playwright test
CLAIM_NUMBER=123456789 npx playwright test
npx playwright show-report                # trace/video/screenshots for any failed claim
```

## Filling in a stub

1. Open `config/navigation/navigationCatalog.ts`, pick a section marked `'stub'`.
2. Log into the relevant ClaimCenter environment by hand, open a real claim, and record what the DOM actually looks like for that section (role/name is preferred — see Section 26 of the architecture doc).
3. Write the real extractor in `src/extraction/extractors/`, following the pattern in `exposuresExtractor.ts` (return typed `FieldObservation`s, never a bare value).
4. Write or update the page object in `src/pages/` and register it in `src/pages/registry.ts`'s `REAL_IMPLEMENTATIONS` map.
5. Flip the section's `status` to `'confirmed'` (or `'partial'` if only one platform is done) in `navigationCatalog.ts`.
6. If the section is a genuinely new model shape, add it to `src/models/` and wire it into `assembleClaimData()` in `src/orchestration/ReconciliationRunner.ts`.

## Configuration

Nothing about *what* runs or *how differences are judged* should need a code
change — see `config/`:

| File | Controls |
|---|---|
| `config/environments/*.config.ts` | Base URLs, login field labels, tiers |
| `config/navigation/navigationCatalog.ts` | Which sections run at all |
| `config/validation/arrayMatchKeys.ts` | Which arrays compare by business key, currency/date tolerance |
| `config/expected-differences/expectedDifferences.ts` | Known/expected migration differences — **empty by default**, populate once a real migration mapping doc exists |
| `config/severity/severityRules.ts` | Severity by field path |
| `config/normalization/normalizationRules.ts` | Per-field normalization overrides |

## Project layout

```
config/          — everything a QA lead should be able to edit without touching src/
src/auth/         — login (both platforms — confirmed, no SSO/MFA)
src/navigation/  — claim search + cloud tab-menu mechanics (confirmed)
src/pages/        — one ClaimSectionPage per claim section (confirmed + stub)
src/extraction/  — FieldObservation model + per-section extractors
src/models/       — the ClaimData tree both environments extract into
src/normalization/ — normalizers + generic tree-walker
src/comparison/   — the structural diff engine + classification
src/evidence/     — screenshot capture for findings that warrant it
src/reporting/    — HTML/JSON/CSV/XLSX generators + executive summary rollup
src/orchestration/ — per-claim runner + worker-pool batch runner
src/input/         — claims.csv reader + filters
src/cli/           — `npm run reconcile` entrypoint
tests/             — thin Playwright wrapper (Section J) — one describe per claim
```
