import { Page } from '@playwright/test';

/**
 * Clicks a SPECIFIC grid's "next page" control if one exists, is visible,
 * and isn't disabled (already on the last page). Returns whether it
 * actually advanced. CONFIRMED live 2026-08-21 on both platforms:
 *   on-prem: ExtJS's standard PagingToolbar — the next-page icon carries
 *            class `x-tbar-page-next`, inside an element whose id is
 *            `<gridIdSubstring>:_ListPaging` (e.g.
 *            "ClaimHistory:ClaimHistoryScreen:HistoryLV:_ListPaging").
 *   cloud:   Jutro's own paging widget — id is
 *            `<gridIdSubstring>-_ListPaging-next` (e.g.
 *            "ClaimWorkplan-ClaimWorkplanScreen-WorkplanLV-_ListPaging-next"),
 *            aria-label="Next", class "gw-paging--button-next".
 *
 * MUST be scoped to `gridIdSubstring`, not "any pagination control on the
 * page" — confirmed live as a real bug: an unscoped `document.querySelector`
 * for the first "_ListPaging-next" element on the page grabbed a DIFFERENT
 * grid's paging button than the one actually being read whenever more than
 * one grid's paging widget was present simultaneously, producing wildly
 * inflated/duplicated row counts (750/1000 "rows" on a claim that doesn't
 * remotely have that many) by repeatedly re-reading the same page while
 * paging through an unrelated grid.
 */
export async function clickNextGridPage(page: Page, environment: 'onprem' | 'cloud', gridIdSubstring: string): Promise<boolean> {
  if (environment === 'onprem') {
    return page.evaluate((sub) => {
      const icon = Array.from(document.querySelectorAll(`[id*="${sub}:_ListPaging"] .x-tbar-page-next`))
        .find((e) => (e as HTMLElement).offsetParent) as HTMLElement | undefined;
      if (!icon) return false;
      const btn = (icon.closest('.x-btn') as HTMLElement | null) ?? icon;
      if (/x-item-disabled|x-btn-disabled/.test(btn.className)) return false;
      btn.click();
      return true;
    }, gridIdSubstring).catch(() => false);
  }
  return page.evaluate((sub) => {
    const btn = document.querySelector(`[id*="${sub}-_ListPaging-next"]`) as HTMLElement | null;
    if (!btn || !btn.offsetParent) return false;
    if (btn.getAttribute('aria-disabled') === 'true' || /disabled/.test(btn.className)) return false;
    btn.click();
    return true;
  }, gridIdSubstring).catch(() => false);
}

/**
 * Runs `readOnePage` repeatedly, clicking `gridIdSubstring`'s specific next-
 * page control between calls, until no next page is available (or
 * `maxPages` is hit — a safety guard against a misbehaving paging control
 * looping forever, not an expected real limit). `settleMs` gives the newly-
 * rendered page time to paint before reading it — the same class of timing
 * issue documented on FinancialsPage.navigate() elsewhere in this codebase.
 *
 * Stopping is content-based (has this exact page of rows been seen before,
 * as JSON), NOT just "did the next-page control report disabled" — confirmed
 * live as necessary: a real cloud grid's "next" control kept reporting
 * clickable/enabled well past its true last page (produced 750/1000
 * duplicated "rows" on a grid with a small fraction that many real rows,
 * scoping the button to the right grid did not fix it), so the button's own
 * state can't be trusted as the sole stop condition. A repeated (or cycled-
 * back-to) page's content is the reliable signal instead.
 */
export async function readAllPages<T>(
  page: Page,
  environment: 'onprem' | 'cloud',
  gridIdSubstring: string,
  readOnePage: () => Promise<T[]>,
  opts: { maxPages?: number; settleMs?: number } = {},
): Promise<T[]> {
  const maxPages = opts.maxPages ?? 50;
  const settleMs = opts.settleMs ?? 800;
  const all: T[] = [];
  const seenPages = new Set<string>();
  for (let i = 0; i < maxPages; i++) {
    const pageRows = await readOnePage();
    const pageKey = JSON.stringify(pageRows);
    if (seenPages.has(pageKey)) break; // repeated or cycled-back-to content — not a genuinely new page
    seenPages.add(pageKey);
    // Drop exact-duplicate rows WITHIN this one page read. The whole-page
    // hash above only catches a REPEATED page, not two duplicate rows
    // produced by a single read — confirmed live 2026-08-25: Notes returned
    // the same note twice from one page (most likely two DOM nodes for the
    // same card, e.g. a read view + an edit-mode copy, both matching the
    // id-scoped selector). A row byte-for-byte identical to an earlier one
    // on the same page is virtually never two genuinely different real
    // records, so collapsing it here benefits every grid built on this
    // function, not just Notes.
    const seenRowsThisPage = new Set<string>();
    const dedupedPage = pageRows.filter((row) => {
      const key = JSON.stringify(row);
      if (seenRowsThisPage.has(key)) return false;
      seenRowsThisPage.add(key);
      return true;
    });
    all.push(...dedupedPage);
    const advanced = await clickNextGridPage(page, environment, gridIdSubstring);
    if (!advanced) break;
    await page.waitForTimeout(settleMs);
  }
  return all;
}
