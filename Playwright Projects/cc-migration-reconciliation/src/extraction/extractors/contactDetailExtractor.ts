import { Page } from '@playwright/test';
import { ExtractionContext } from '../ExtractionContext';
import { FieldObservation } from '../FieldObservation';
import { readDynamicFields } from '../genericFieldReader';
import { clickNextGridPage } from '../pagination';
import { logger } from '../../logging/logger';

/**
 * Per-contact drill-down for the Parties Involved / Contacts grid
 * (`PeopleInvolvedDetailedLV`) — the row-level Name/Roles/Phone/Address
 * columns read by partiesExtractor.ts are only a summary; clicking INTO a
 * row opens a detail panel with its own sub-tabs, CONFIRMED live 2026-08-21
 * identical on both platforms (on-prem: `.x-tab-strip-text`/ExtJS tab strip;
 * cloud: `role="tab"`, text icon-prefixed e.g. "BaBasics" — hence substring,
 * not exact, matching): Basics, Addresses, Related Contacts, Hi Marley Case.
 * "Basics" renders by default when a row is first selected but is still
 * clicked explicitly here so every row starts from a known tab state
 * regardless of which tab a PREVIOUS row's walk left active.
 *
 * Deliberately does NOT reuse the content-hash pagination stopping used
 * elsewhere (readAllPages) — a page of rich per-contact detail includes
 * fresh `capturedAt` timestamps on every FieldObservation, so two
 * structurally-identical pages would never hash equal and the loop would
 * never terminate on repeat. Instead this walks pages bounded by the
 * caller-supplied TOTAL row count already confirmed by the separate (and
 * already-correct) flat-list pagination pass in partiesExtractor.ts.
 */
const DETAIL_TABS = ['Basics', 'Addresses', 'Related Contacts', 'Hi Marley Case'];

async function countVisibleRowsOnPage(page: Page, environment: 'onprem' | 'cloud'): Promise<number> {
  if (environment === 'onprem') {
    return page.evaluate(() => {
      const grid = document.querySelector('[id$=":PeopleInvolvedDetailedLV"]');
      if (!grid) return 0;
      return Array.from(grid.querySelectorAll('tr.x-grid-row')).filter((r) => (r as HTMLElement).offsetParent).length;
    }).catch(() => 0);
  }
  return page.evaluate(() => {
    const rows = new Set<string>();
    for (const el of Array.from(document.querySelectorAll('[id*="PeopleInvolvedDetailedLV-"]'))) {
      const m = el.id.match(/PeopleInvolvedDetailedLV-(\d+)-/);
      if (m && (el as HTMLElement).offsetParent) rows.add(m[1]);
    }
    return rows.size;
  }).catch(() => 0);
}

/**
 * `expectedName` (the SAME row's Name already read by the flat-list pass in
 * partiesExtractor.ts, before any of this detail-walking ever starts) is
 * verified against the row actually selected, not just trusted — confirmed
 * live 2026-08-27 as a real bug otherwise: a row-select silently landing on
 * the WRONG row (this exact failure mode is why cloud needs a real
 * Playwright click at all, see the comment below) still resolves its click
 * promise successfully, so the old boolean-only return had no way to tell
 * "selected SOME row" apart from "selected THE INTENDED row" — the detail
 * panel that followed got attached to the wrong contact, cascading into
 * every field under it reading as a cross-wired UNEXPECTED_DIFFERENCE
 * (e.g. one contact's Name/Notes/SSN compared against a different
 * contact's). Returning false here (treated the same as "row not found") on
 * a verification mismatch means a garbled read is skipped rather than
 * silently misattributed.
 */
async function selectContactRow(page: Page, environment: 'onprem' | 'cloud', rowIndex: number, expectedName: string | null): Promise<boolean> {
  const wanted = (expectedName ?? '').trim().toUpperCase();
  if (environment === 'onprem') {
    return page.evaluate(({ idx, wanted }) => {
      const grid = document.querySelector('[id$=":PeopleInvolvedDetailedLV"]');
      if (!grid) return false;
      const rows = Array.from(grid.querySelectorAll('tr.x-grid-row')).filter((r) => (r as HTMLElement).offsetParent);
      const row = rows[idx] as HTMLElement | undefined;
      if (!row) return false;
      if (wanted) {
        const cellTexts = Array.from(row.querySelectorAll('.x-grid-cell')).map((c) => ((c as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().toUpperCase());
        if (!cellTexts.some((t) => t === wanted)) return false; // this row isn't the contact we think it is — don't read/attach its detail
      }
      const cell = row.querySelector('.x-grid-cell') as HTMLElement | null;
      (cell ?? row).click();
      return true;
    }, { idx: rowIndex, wanted }).catch(() => false);
  }
  // CONFIRMED live 2026-08-21: a raw DOM `.click()` inside page.evaluate() does
  // NOT reliably trigger Jutro's row-selection handler here — all 3 rows kept
  // reading row 0's ("Anne Campbell") detail regardless of index. A genuine
  // Playwright-dispatched click (real pointer event sequence) does work.
  const cell = page.locator(`[id*="PeopleInvolvedDetailedLV-${rowIndex}-Name"]`).first();
  // Short bounded wait, not an instant snapshot — see clickDetailTab's doc
  // comment; this is the same per-contact hot loop and the same fix.
  if (!(await cell.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false))) return false;
  if (wanted) {
    const actual = (await cell.innerText().catch(() => '')).replace(/\s+/g, ' ').trim().toUpperCase();
    if (actual !== wanted) return false;
  }
  return cell.click({ timeout: 5000 }).then(() => true).catch(() => false);
}

async function clickDetailTab(page: Page, tabLabel: string): Promise<boolean> {
  const candidates = [
    page.locator('[role="tab"]:visible').filter({ hasText: tabLabel }).first(),
    page.locator('.x-tab-strip-text:visible, .x-tab-inner:visible').filter({ hasText: tabLabel }).first(),
  ];
  for (const candidate of candidates) {
    // A short bounded wait, not an instant isVisible() snapshot — confirmed
    // live 2026-08-27 via an isolated (no-contention) diagnostic run that
    // Parties is by far the slowest section in the whole pipeline (~30-36s
    // for a claim with many contacts, vs ~1-2s for every other section),
    // being N contacts x up to 4 tabs x multiple instant visibility checks
    // each — exactly the shape most likely to tip over under concurrent
    // WORKERS load (this project runs 4 claims in parallel against a
    // shared test server): a tab that's rendering but not QUITE painted yet
    // reads as "absent" with an instant check, silently skipping real data
    // instead of clicking it a few hundred ms later. Still bounded and
    // still cheap for a tab that's genuinely absent (not every contact has
    // e.g. Hi Marley Case) — this only changes "not there yet" into "not
    // there", not the other way around.
    const becameVisible = await candidate.waitFor({ state: 'visible', timeout: 1200 }).then(() => true).catch(() => false);
    if (!becameVisible) continue;
    const clicked = await candidate.click({ timeout: 5000 }).then(() => true).catch(() => false);
    if (clicked) return true;
  }
  return false;
}

async function readOneContactDetail(ctx: ExtractionContext, rowIndex: number, label: string, expectedName: string | null): Promise<Record<string, FieldObservation>> {
  const selected = await selectContactRow(ctx.page, ctx.environment, rowIndex, expectedName);
  if (!selected) {
    logger.warn(`readOneContactDetail: could not select row ${rowIndex}${expectedName ? ` (expected "${expectedName}")` : ''} — skipping rather than risk attaching the wrong contact's detail`);
    return {};
  }
  await ctx.page.waitForTimeout(700);

  const detail: Record<string, FieldObservation> = {};
  for (const tab of DETAIL_TABS) {
    const clicked = await clickDetailTab(ctx.page, tab);
    if (!clicked) continue; // a tab genuinely absent for this contact/LOB — not every contact has e.g. Hi Marley Case
    await ctx.page.waitForTimeout(600);
    const fields = await readDynamicFields(ctx, `${label} > ${tab}`, `claim.parties[].detail.${tab.replace(/\s+/g, '')}`);
    for (const [key, value] of Object.entries(fields)) {
      detail[`${tab}.${key}`] = value;
    }
  }
  return detail;
}

/**
 * Assumes the page is ALREADY on the Contacts grid, page 1 (caller must
 * (re-)navigate first — the flat-list read that normally precedes this call
 * leaves the grid on its LAST page, not page 1, since it pages all the way
 * through). Returns one detail record per contact, in the same top-to-
 * bottom / page-to-page order as the flat-list read, so callers can zip them
 * together by array index. `expectedNames[i]` is that row's Name from the
 * SAME flat-list pass that determined `totalRows` (partiesExtractor.ts's
 * `rawRows`) — passed through so selectContactRow can verify each selection
 * against the contact it's actually supposed to be, instead of trusting raw
 * position (see that function's doc comment for the cross-wiring bug this
 * closes).
 */
export async function readAllContactDetails(ctx: ExtractionContext, totalRows: number, label: string, expectedNames: (string | null)[]): Promise<Record<string, FieldObservation>[]> {
  if (totalRows <= 0) return [];
  const results: Record<string, FieldObservation>[] = [];
  const maxPages = 50;
  for (let page = 0; page < maxPages && results.length < totalRows; page++) {
    const rowsOnThisPage = await countVisibleRowsOnPage(ctx.page, ctx.environment);
    if (rowsOnThisPage === 0) break;
    for (let i = 0; i < rowsOnThisPage && results.length < totalRows; i++) {
      results.push(await readOneContactDetail(ctx, i, label, expectedNames[results.length] ?? null));
    }
    if (results.length >= totalRows) break;
    const advanced = await clickNextGridPage(ctx.page, ctx.environment, 'PeopleInvolvedDetailedLV');
    if (!advanced) break;
    await ctx.page.waitForTimeout(800);
  }
  if (results.length !== totalRows) {
    logger.warn(`readAllContactDetails: read ${results.length} detail record(s) but the list pass found ${totalRows} — row order may not line up 1:1`);
  }
  return results;
}
