import { Page } from '@playwright/test';
import { ClaimSectionPage } from '../ClaimSectionPage';
import { ExtractionContext } from '../../extraction/ExtractionContext';
import { SectionRecord, SectionRow } from '../../models/common';
import { readDynamicFields } from '../../extraction/genericFieldReader';
import { readGrid } from '../../extraction/genericGridReader';
import { ok, extractionFailed } from '../../extraction/FieldObservation';
import { clickNavItem } from '../../navigation/clickNavItem';
import { logger } from '../../logging/logger';

/**
 * Factories for the batch of sub-tabs/top-level sections discovered
 * 2026-08-20 by expanding every left-nav item live (see
 * navigationCatalog.ts's notes on each `extensions.*` key). Writing 15
 * near-identical hand-written page-object classes wasn't worth it — every
 * one of these is either "click N nav steps, read every label/value pair
 * dynamically" or "click N nav steps, read one grid" with no other logic,
 * so two factories cover all of them.
 */
/**
 * Each step is either one exact label, an array of alternatives to try in
 * order, or a `{ soft }` wrapper marking a step as best-effort. Alternatives
 * exist because some sub-tab labels are LOB-specific (e.g. Policy's
 * locations sub-tab is "Locations and Class Codes" on Workers' Comp,
 * "Vehicles" on Personal Auto, plain "Locations" on BOP/DFP — confirmed
 * live 2026-08-20/21). `soft` exists for a DIFFERENT reason, confirmed live
 * 2026-08-21 on a cloud Personal Auto claim: Plan of Action's sub-items
 * (Negotiations/WCER/Surcharging) are usually reached by clicking the
 * "Plan of Action" parent first to reveal them, but on at least one real
 * cloud claim "Negotiations" rendered as a flat TOP-LEVEL menu item with no
 * "Plan of Action" parent to click at all — a mandatory first step there
 * would abort the whole chain even though the real target is directly
 * clickable. A soft step is attempted (in case it IS needed to expand a
 * real parent, as it usually is) but a failure to find it just moves on to
 * the next step instead of aborting navigation.
 */
export type NavStep = string | string[] | { soft: string | string[] };

export async function navigateSteps(page: Page, sectionKey: string, steps: NavStep[]): Promise<boolean> {
  for (const step of steps) {
    const isSoft = typeof step === 'object' && !Array.isArray(step);
    const raw = isSoft ? (step as { soft: string | string[] }).soft : (step as string | string[]);
    const alternatives = Array.isArray(raw) ? raw : [raw];
    let clicked = false;
    for (const label of alternatives) {
      if (await clickNavItem(page, label, `${sectionKey}.navigate`)) {
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      if (isSoft) {
        logger.warn(`${sectionKey}.navigate: optional step [${alternatives.join(', ')}] not found — continuing without it`);
        continue;
      }
      logger.warn(`${sectionKey}.navigate: none of [${alternatives.join(', ')}] found`);
      return false;
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1000);
  }
  return true;
}

/**
 * A section reached by clicking `navSteps` in order, read as a dynamic
 * label/value form (genericFieldReader.ts) — no fixed vocabulary.
 *
 * CONFIRMED live 2026-08-21 as a real bug (not hypothetical): navigate()
 * previously discarded navigateSteps()'s success/failure signal, so when a
 * nav item genuinely didn't exist for a given claim/LOB (e.g. "Calendar"
 * failing to fully open), extract() still ran readDynamicFields() against
 * WHATEVER page was left on screen from the previous section and reported
 * it under THIS section's name — Calendar's report entry was showing real
 * Contacts-detail fields (Mainframe Name, SPA Status, Tax ID…) because
 * Contacts (or whatever ran before it) was still the active page. Tracked
 * here via closure state so extract() can tell the difference between
 * "navigated here, page is genuinely empty" and "never got here at all".
 */
export function createFormSubPage(sectionKey: string, label: string, navSteps: NavStep[]): ClaimSectionPage<SectionRecord> {
  let navigated = false;
  return {
    sectionKey,
    async isPresent(): Promise<boolean> {
      return true;
    },
    async navigate(page: Page): Promise<void> {
      navigated = await navigateSteps(page, sectionKey, navSteps);
    },
    async extract(ctx: ExtractionContext): Promise<SectionRecord> {
      if (!navigated) {
        return {
          sectionKey,
          fields: {
            __status: extractionFailed(
              { path: `claim.extensions.${sectionKey}`, field: label, type: 'string', environment: ctx.environment, claimNumber: ctx.claimNumber, section: label },
              `Could not navigate to "${label}" (nav step not found) — no data read, not comparable to the other platform`,
            ),
          },
        };
      }
      const fields = await readDynamicFields(ctx, label, `claim.extensions.${sectionKey}.fields`);
      return { sectionKey, fields };
    },
  };
}

/**
 * A section reached by clicking `navSteps` in order, read as one grid
 * (genericGridReader.ts) keyed by the RAW discovered column name per
 * platform, UNLESS the caller supplies `columnAliases` — an optional
 * raw-name -> canonical-name map, the same pattern as the hand-confirmed
 * alias tables in the dedicated extractors (Documents/Workplan/Litigation/…
 * mapColumnKey, exposuresExtractor's COLUMN_ALIASES). Confirmed live
 * 2026-08-27 as a real, high-volume bug otherwise: on Policy: Endorsements
 * alone, 4 unaliased column-name pairs (Actions/View, PolicyForm/FormNumber,
 * EditionDate/ExtEditionDate, UnitNumber/ExtUnitNumber) accounted for EVERY
 * mismatch finding in that section across a full batch run — not real
 * migration differences, just the same value under two names. Unmapped
 * column names still pass through unchanged, so an un-aliased difference is
 * a disclosed limitation (see each key's navigationCatalog.ts note), not
 * silent data loss.
 */
/**
 * Tries each candidate grid-id substring in turn and returns the first one
 * actually present in the DOM — needed because a nav-step label alternative
 * (e.g. "Vehicles" vs "Locations and Class Codes") can point at a
 * DIFFERENT grid id per LOB too, not just a different click target.
 * Confirmed live 2026-08-21 on claim PA-DE-01-26-0000422: clicking
 * "Vehicles" renders grid id `VehiclesLV`, never `LocationsLV` (the WC
 * equivalent) — the two ids never coexist on one claim, so "first found"
 * is an unambiguous, safe choice rather than a guess.
 */
async function resolveGridId(page: Page, sectionKey: string, candidates: string[]): Promise<string> {
  for (const candidate of candidates) {
    const found = await page.locator(`[id*="${candidate}"]`).first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
    if (found) return candidate;
  }
  logger.warn(`${sectionKey}.navigate: none of [${candidates.join(', ')}] appeared within 8s`);
  return candidates[0];
}

export function createGridSubPage(
  sectionKey: string,
  label: string,
  navSteps: NavStep[],
  gridIdSubstring: string | string[],
  columnAliases?: Record<string, string>,
  // Canonical column name(s) — after aliasing — that alone identify "the
  // same real-world row" across a re-run/migration, e.g. ['Name'] for
  // Parties Involved: Users. Default (all columns joined) breaks the moment
  // ANY column differs, even a legitimate one: confirmed live 2026-08-27 on
  // Users — one contact's role/team was genuinely reassigned between
  // platforms, and because the whole-row key includes every column, the
  // SAME person showed as "removed" (old team) + "added" (new team) instead
  // of one matched row with a clean role-field diff. Same principle
  // workplanExtractor.ts already applies deliberately by excluding Assigned
  // To from ITS key — a reassignment is a real, reportable difference, but
  // it should read as "this record's field changed," not "this record is
  // gone and an unrelated one appeared."
  businessKeyColumns?: string[],
  // Escape hatch for when a raw column's MEANING is ambiguous without
  // seeing the rest of the row — a plain Record<string,string> alias can't
  // express that. Confirmed live 2026-08-28 on Policy: Locations and Class
  // Codes: cloud's raw "Number" column means TWO different things
  // depending on which grid variant rendered — on Auto claims (VehiclesLV)
  // it's the plain row ordinal (pairs with on-prem's "#"); on
  // property-based claims (LocationsLV) it's a padded business code that
  // ONLY exists alongside a separate "PropertyNumber" column (the ordinal,
  // there). A blanket columnAliases redirect (`Number -> LocationNumber`)
  // fixed the second shape but broke the first — Auto claims lost their
  // "Number" value entirely, since nothing produced it once "Number" was
  // unconditionally redirected. When provided, this REPLACES columnAliases
  // for canonicalization — it receives the row's raw (un-aliased) keys and
  // decides the canonical shape itself, with full visibility into what
  // else is on the same row.
  canonicalizeRow?: (raw: Record<string, string>) => Record<string, string>,
): ClaimSectionPage<SectionRecord> {
  const candidates = Array.isArray(gridIdSubstring) ? gridIdSubstring : [gridIdSubstring];
  let navigated = false;
  let resolvedGridId = candidates[0];
  return {
    sectionKey,
    async isPresent(): Promise<boolean> {
      return true;
    },
    async navigate(page: Page): Promise<void> {
      navigated = await navigateSteps(page, sectionKey, navSteps);
      if (!navigated) return;
      resolvedGridId = await resolveGridId(page, sectionKey, candidates);
    },
    async extract(ctx: ExtractionContext): Promise<SectionRecord> {
      if (!navigated) {
        return {
          sectionKey,
          fields: {
            __status: extractionFailed(
              { path: `claim.extensions.${sectionKey}`, field: label, type: 'string', environment: ctx.environment, claimNumber: ctx.claimNumber, section: label },
              `Could not navigate to "${label}" (nav step not found) — no data read, not comparable to the other platform`,
            ),
          },
        };
      }
      const rawRows = await readGrid(ctx.page, ctx.environment, resolvedGridId);
      const rows: SectionRow[] = rawRows.map((row, i) => {
        // Canonicalize raw column names BEFORE building the row, same as
        // every hand-built extractor's mapColumnKey — two raw names that
        // alias to the same canonical key (one per platform, never both on
        // the same row) collapse to one entry rather than two separate
        // MISSING_IN_CLOUD/MISSING_ON_PREM findings for what's really one field.
        const canonical: Record<string, string> = canonicalizeRow ? canonicalizeRow(row) : {};
        if (!canonicalizeRow) {
          for (const [rawKey, text] of Object.entries(row)) {
            canonical[columnAliases?.[rawKey] ?? rawKey] = text;
          }
        }
        const entries = Object.entries(canonical);
        const keyEntries = businessKeyColumns
          ? businessKeyColumns.map((col) => [col, canonical[col] ?? ''] as [string, string])
          : entries;
        const businessKey = keyEntries.map(([, v]) => v).join('|') || `row${i}`;
        const rowObj: SectionRow = { businessKey };
        for (const [key, text] of entries) {
          const path = `claim.extensions.${sectionKey}.rows[].${key}`;
          rowObj[key] = ok({
            path, field: key, value: text, rawText: text, type: 'string',
            environment: ctx.environment, claimNumber: ctx.claimNumber, section: label,
          });
        }
        return rowObj;
      });
      return { sectionKey, fields: {}, rows };
    },
  };
}
