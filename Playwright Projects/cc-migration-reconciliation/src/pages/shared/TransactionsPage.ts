import { Page } from '@playwright/test';
import { ClaimSectionPage } from '../ClaimSectionPage';
import { ExtractionContext } from '../../extraction/ExtractionContext';
import { extractTransactions } from '../../extraction/extractors/transactionsExtractor';
import { TransactionData } from '../../models/FinancialsData';
import { clickNavItem } from '../../navigation/clickNavItem';
import { logger } from '../../logging/logger';

/**
 * CONFIRMED, both platforms. Reaching the ledger is a two-step nav: click
 * the "Financials" section, THEN a nested "Transactions" sub-tab that only
 * appears once Financials is open — neither platform exposes it as a
 * top-level nav item. See clickNavItem's doc comment for why both steps
 * need the role+name / leaf-text fallback, not just role+name.
 */
export class TransactionsPage implements ClaimSectionPage<TransactionData[]> {
  readonly sectionKey = 'transactions';

  async isPresent(_page: Page): Promise<boolean> {
    return true;
  }

  async navigate(page: Page): Promise<void> {
    if (!(await clickNavItem(page, 'Financials', 'TransactionsPage.navigate'))) {
      logger.warn('TransactionsPage.navigate: no Financials nav item found — extraction will report an empty ledger');
      return;
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1000);

    if (!(await clickNavItem(page, 'Transactions', 'TransactionsPage.navigate'))) {
      logger.warn('TransactionsPage.navigate: Financials opened but no Transactions sub-tab found — extraction will report an empty ledger');
      return;
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    // Confirmed live 2026-08-20 (see FinancialsPage.navigate()'s own note):
    // a fixed short wait is unreliable for Financials sub-pages specifically
    // when this section runs later in a full walkSections pass. Poll for
    // the grid instead of guessing a longer fixed number.
    await page.locator('[id*="TransactionsLV"]').first().waitFor({ timeout: 8000 }).catch(() => {
      logger.warn('TransactionsPage.navigate: TransactionsLV did not appear within 8s — extraction may report an empty ledger');
    });
  }

  async extract(ctx: ExtractionContext): Promise<TransactionData[]> {
    return extractTransactions(ctx);
  }
}
