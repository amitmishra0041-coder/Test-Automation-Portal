import { Page } from '@playwright/test';
import { ClaimSectionPage } from '../ClaimSectionPage';
import { ExtractionContext } from '../../extraction/ExtractionContext';
import { extractFinancials } from '../../extraction/extractors/financialsExtractor';
import { FinancialsData } from '../../models/FinancialsData';
import { clickNavItem } from '../../navigation/clickNavItem';
import { logger } from '../../logging/logger';

export class FinancialsPage implements ClaimSectionPage<FinancialsData> {
  readonly sectionKey = 'financials';

  async isPresent(_page: Page): Promise<boolean> {
    return true;
  }

  async navigate(page: Page): Promise<void> {
    // Was role+name-only, which live testing (via TransactionsPage's own
    // Financials click) proved never finds on-prem's ExtJS left-nav item —
    // it has no accessible role at all — silently leaving on-prem's
    // financials.summary at loaded:false on every run. clickNavItem's
    // leaf-text fallback fixes that; extractFinancials() still reports
    // loaded:false honestly if this somehow finds nothing.
    if (!(await clickNavItem(page, 'Financials', 'FinancialsPage.navigate'))) {
      logger.warn('FinancialsPage.navigate: no Financials tab found — extraction will report loaded:false');
      return;
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    // A fixed 1000ms (the other pages' usual wait) is confirmed live to be
    // too short here specifically when Financials runs later in a full
    // walkSections pass (more accumulated app state to process than an
    // isolated navigation) — the content pane stayed on the PREVIOUS
    // section for 3+ more seconds after the click while the nav tree had
    // already visually expanded. Poll for the actual grid instead of
    // guessing a longer fixed number.
    await page.locator('[id*="FinancialsSummaryLV"]').first().waitFor({ timeout: 8000 }).catch(() => {
      logger.warn('FinancialsPage.navigate: FinancialsSummaryLV did not appear within 8s — extraction may report loaded:false');
    });
  }

  async extract(ctx: ExtractionContext): Promise<FinancialsData> {
    return extractFinancials(ctx);
  }
}
