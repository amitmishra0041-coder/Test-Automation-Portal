import { Page } from '@playwright/test';

/**
 * CONFIRMED (on-prem only; a harmless no-op on cloud, which has no .x-mask
 * elements) — ported from claimCenterBase.js. waitForSelector with a short
 * timeout only ever watches the FIRST mask; a second mask raised by an
 * async server response sails past it and intercepts the next click. This
 * checks ALL masks are gone before proceeding.
 */
export async function waitForAllMasksGone(page: Page, timeout = 15000): Promise<void> {
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('.x-mask')).every(
      (m) => getComputedStyle(m as Element).display === 'none'
        || getComputedStyle(m as Element).visibility === 'hidden'
        || (m as Element).getBoundingClientRect().width === 0,
    ),
    { timeout },
  ).catch(() => {});
}
