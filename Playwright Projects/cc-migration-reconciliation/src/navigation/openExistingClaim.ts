import { Page } from '@playwright/test';
import { EnvironmentConfig } from '../../config/environments';
import { AuthProvider, Credentials } from '../auth/AuthProvider';
import { waitForAllMasksGone } from './waitForAllMasksGone';
import { logger } from '../logging/logger';

/**
 * CONFIRMED — ported from openExistingClaim in claimCenterBase.js, trimmed
 * but preserving its core logic: the original file's own comments call out
 * WHY each step exists (live-recorded/live-debugged), summarized inline
 * below. This deliberately does NOT hard-branch on platform for the search
 * steps — the prototype found that trying both platforms' locator shapes as
 * fallback candidates is more robust than an if/else, since "Search" is a
 * plain <a> on-prem but a role=menuitem (no accessible role at all in some
 * builds — only an aria-label) on cloud.
 */
export async function openExistingClaim(
  page: Page,
  claimNumber: string,
  env: EnvironmentConfig,
  auth: AuthProvider,
  credentials: Credentials,
): Promise<void> {
  await logger.timed(
    { environment: env.platform, claimNumber, section: 'navigation', operation: 'openExistingClaim' },
    async () => {
      await waitForAllMasksGone(page, 90000);

      // Already on this claim? ("Claim: X" in some headers, "Claim (X)" in the
      // top-nav tab after e.g. a wizard cancel.) Skip the whole search round-trip.
      const alreadyThere =
        await page.locator(`text="Claim: ${claimNumber}"`).first()
          .waitFor({ state: 'visible', timeout: 1000 }).then(() => true).catch(() => false)
        || await page.locator(`text="Claim (${claimNumber})"`).first()
          .waitFor({ state: 'visible', timeout: 1000 }).then(() => true).catch(() => false);
      if (alreadyThere) {
        logger.info('already on requested claim, skipping search', { claimNumber, environment: env.platform });
        return;
      }

      // Hard-navigate to the CC root: a goto() tears down pending XHR/WS ops
      // from a prior operation, guaranteeing a clean, unmasked landing page
      // before clicking Search.
      await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});

      const stillSignedIn = await Promise.any([
        page.locator('a').filter({ hasText: /^Search$/ }).first()
          .waitFor({ state: 'visible', timeout: 6000 }).then(() => true),
        page.getByRole('menuitem', { name: /^Search$/ }).first()
          .waitFor({ state: 'visible', timeout: 6000 }).then(() => true),
        page.getByRole('link', { name: /^Search$/ }).first()
          .waitFor({ state: 'visible', timeout: 6000 }).then(() => true),
      ]).catch(() => false);

      const loginFormShowing = await page.getByRole('textbox', { name: /Username|User name/i }).first()
        .isVisible().catch(() => false);

      if (!stillSignedIn && loginFormShowing) {
        logger.info('session expired after goto — re-authenticating', { claimNumber, environment: env.platform });
        await auth.login(page, credentials);
      }

      await waitForAllMasksGone(page, 30000);

      // "Search" nav: on-prem renders it as an <a>; cloud has NO role on the
      // element at all in some builds and only exposes aria-label="Search"
      // (its visible text is split by a shortcut-key span). Try each shape.
      const searchNavCandidates = [
        page.locator('[aria-label="Search"]').first(),
        page.locator('a').filter({ hasText: 'Search' }).first(),
        page.getByRole('menuitem', { name: /^Search$/ }).first(),
        page.getByRole('link', { name: /^Search$/ }).first(),
        page.getByRole('button', { name: /^Search$/ }).first(),
      ];
      let searchClicked = false;
      for (const nav of searchNavCandidates) {
        if (!(await nav.isVisible().catch(() => false))) continue;
        await nav.click({ timeout: 8000 }).catch(() => {});
        searchClicked = true;
        break;
      }
      if (!searchClicked) {
        throw new Error('openExistingClaim: no Search navigation found (tried <a>, menuitem, link, button, aria-label)');
      }

      await page.waitForLoadState('domcontentloaded').catch(() => {});
      const claimField = page.getByRole('textbox', { name: 'Claim #' });
      await claimField.waitFor({ state: 'visible', timeout: 45000 });
      await claimField.fill(claimNumber);

      // Submit control: two things named "Search" exist on this screen (nav +
      // submit); the nav comes first in the DOM, so take the LAST match.
      const searchSubmitCandidates = [
        page.getByRole('button', { name: /^Search$/ }).last(),
        page.getByRole('link', { name: 'Search', exact: true }).last(),
        page.locator('[aria-label="Search"]').last(),
      ];
      let submitted = false;
      for (const btn of searchSubmitCandidates) {
        if (!(await btn.isVisible().catch(() => false))) continue;
        await btn.click({ timeout: 8000 }).catch(() => {});
        submitted = true;
        break;
      }
      if (!submitted) {
        throw new Error('openExistingClaim: claim number entered but no Search submit control found');
      }

      await page.waitForLoadState('domcontentloaded').catch(() => {});

      // First result row — on-prem uses a colon-joined id, cloud a dash-joined
      // one with a "_button" suffix; both fall back to matching the claim
      // number's own rendered text.
      const rowSelector =
        '[id="ClaimSearch:ClaimSearchScreen:ClaimSearchResultsLV:0:ClaimNumber"],'
        + '[id^="ClaimSearch-ClaimSearchScreen-ClaimSearchResultsLV-"][id$="-ClaimNumber_button"]';
      await page.locator(rowSelector).first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

      const resultRowCandidates = [
        page.locator('[id="ClaimSearch:ClaimSearchScreen:ClaimSearchResultsLV:0:ClaimNumber"]').first(),
        page.locator('[id^="ClaimSearch-ClaimSearchScreen-ClaimSearchResultsLV-"][id$="-ClaimNumber_button"]').first(),
        page.getByRole('button', { name: claimNumber, exact: true }).first(),
        page.getByText(claimNumber, { exact: true }).first(),
      ];

      const leftSearchPage = async () => page.evaluate(
        () => !/Search Claims/i.test(document.body.innerText || ''),
      ).catch(() => false);

      let opened = false;
      for (const row of resultRowCandidates) {
        if (!(await row.isVisible().catch(() => false))) continue;
        await row.click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(2000);
        if (await leftSearchPage()) { opened = true; break; }
      }
      if (!opened) {
        const asLink = page.getByRole('link', { name: claimNumber, exact: true }).first();
        if (await asLink.isVisible().catch(() => false)) {
          await asLink.click({ timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(2000);
          opened = await leftSearchPage();
        }
      }
      if (!opened) {
        throw new Error(`openExistingClaim: search ran but no result row for "${claimNumber}" could be clicked`);
      }
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    },
  );
}
