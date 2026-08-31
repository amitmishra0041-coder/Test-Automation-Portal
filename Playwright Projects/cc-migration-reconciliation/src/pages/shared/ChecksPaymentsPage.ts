import { Page } from '@playwright/test';
import { ClaimSectionPage } from '../ClaimSectionPage';
import { ExtractionContext } from '../../extraction/ExtractionContext';
import { extractChecksPayments } from '../../extraction/extractors/checksPaymentsExtractor';
import { CheckPaymentData } from '../../models/FinancialsData';
import { clickNavItem } from '../../navigation/clickNavItem';
import { logger } from '../../logging/logger';

/** CONFIRMED, both platforms — "Financials > Checks/Payments" nested nav item, same 2-step reach as Transactions. */
export class ChecksPaymentsPage implements ClaimSectionPage<CheckPaymentData[]> {
  readonly sectionKey = 'checksPayments';

  async isPresent(_page: Page): Promise<boolean> {
    return true;
  }

  async navigate(page: Page): Promise<void> {
    if (!(await clickNavItem(page, 'Financials', 'ChecksPaymentsPage.navigate'))) {
      logger.warn('ChecksPaymentsPage.navigate: no Financials nav item found — extraction will report an empty list');
      return;
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1000);

    if (!(await clickNavItem(page, 'Checks/Payments', 'ChecksPaymentsPage.navigate'))) {
      logger.warn('ChecksPaymentsPage.navigate: Financials opened but no Checks/Payments sub-tab found — extraction will report an empty list');
      return;
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    // See FinancialsPage.navigate()'s note — a fixed short wait is
    // unreliable for Financials sub-pages when this section runs later in a
    // full walkSections pass. Poll for the grid instead.
    await page.locator('[id*="ChecksLV"]').first().waitFor({ timeout: 8000 }).catch(() => {
      logger.warn('ChecksPaymentsPage.navigate: ChecksLV did not appear within 8s — extraction may report an empty list');
    });
  }

  async extract(ctx: ExtractionContext): Promise<CheckPaymentData[]> {
    return extractChecksPayments(ctx);
  }
}
