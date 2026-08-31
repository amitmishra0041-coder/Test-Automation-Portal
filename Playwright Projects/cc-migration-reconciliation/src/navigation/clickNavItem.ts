import { Page } from '@playwright/test';
import { logger } from '../logging/logger';

/**
 * CONFIRMED, both platforms — the general-purpose left-nav click every
 * ClaimSectionPage.navigate() should use, not just Transactions/Financials.
 * Cloud (Jutro) nav items ARE addressable by role+name. On-prem's ExtJS
 * left-nav tree items are NOT — confirmed live: an exact role+name query
 * finds nothing for e.g. "Financials", because the item is a plain
 * `<span class="x-tree-node-text">` with no accessible role at all. Falls
 * back to a leaf text match scoped to `a, span` ONLY — not `div`, which
 * live testing showed matches an ancestor wrapping the ENTIRE nav panel
 * (and clicking it does nothing useful) rather than the one nav item.
 *
 * The fallback candidate matches on the SAME anchored `exact` regex as the
 * role-based ones, not a bare substring — confirmed live as a real bug:
 * with a plain string, Playwright's `hasText` does substring matching, so
 * asking for "History" matched "Claim History" too (it contains "History"),
 * and `.first()` picked whichever renders first in DOM order — on this
 * page, "Claim History", silently and consistently for EVERY call asking
 * for plain "History". Any nav label that is a substring of another one on
 * the same page hits this; anchoring closes the whole class of bug, not
 * just this one instance.
 */
export async function clickNavItem(page: Page, text: string, callerLabel = 'clickNavItem'): Promise<boolean> {
  const exact = new RegExp(`^${text}$`, 'i');
  const candidates = [
    page.getByRole('link', { name: exact }).first(),
    page.getByRole('menuitem', { name: exact }).first(),
    page.locator('a, span').filter({ hasText: exact }).first(),
  ];
  for (const candidate of candidates) {
    if (!(await candidate.isVisible().catch(() => false))) continue;

    const clicked = await candidate.click({ timeout: 8000 }).then(() => true).catch(async (e) => {
      // Confirmed live on cloud: a transient `.gw-click-overlay` intercepts
      // pointer events right after some transitions, even though the target
      // itself (already matched by role+name above, so it IS the right
      // element) is visible/enabled/stable. Force bypasses that overlay
      // check specifically — it does not change WHICH element gets clicked.
      logger.warn(`${callerLabel}: click intercepted, retrying with force`, { text, error: String(e) });
      return candidate.click({ timeout: 8000, force: true }).then(() => true).catch((e2) => {
        logger.warn(`${callerLabel}: forced click also failed`, { text, error: String(e2) });
        return false;
      });
    });
    // Only report success on a click that actually happened — returning
    // true unconditionally here previously masked failed clicks, silently
    // leaving extraction reading whatever page was already open (confirmed
    // live: a failed "Documents" click left the page on "Notes", and its
    // extractor would have read Notes data under the Documents label).
    if (clicked) return true;
  }
  return false;
}
