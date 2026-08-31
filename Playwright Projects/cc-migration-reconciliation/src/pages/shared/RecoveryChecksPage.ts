import { Page } from '@playwright/test';
import { ClaimSectionPage } from '../ClaimSectionPage';
import { ExtractionContext } from '../../extraction/ExtractionContext';
import { extractRecoveryChecks } from '../../extraction/extractors/recoveryChecksExtractor';
import { RecoveryCheckData } from '../../models/FinancialsData';
import { clickNavItem } from '../../navigation/clickNavItem';
import { logger } from '../../logging/logger';

/** CONFIRMED, both platforms — "Financials > Recovery Checks" nested nav item, same 2-step reach as Transactions. */
export class RecoveryChecksPage implements ClaimSectionPage<RecoveryCheckData[]> {
  readonly sectionKey = 'recoveryChecks';

  async isPresent(_page: Page): Promise<boolean> {
    return true;
  }

  async navigate(page: Page): Promise<void> {
    if (!(await clickNavItem(page, 'Financials', 'RecoveryChecksPage.navigate'))) {
      logger.warn('RecoveryChecksPage.navigate: no Financials nav item found — extraction will report an empty list');
      return;
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1000);

    if (!(await clickNavItem(page, 'Recovery Checks', 'RecoveryChecksPage.navigate'))) {
      logger.warn('RecoveryChecksPage.navigate: Financials opened but no Recovery Checks sub-tab found — extraction will report an empty list');
      return;
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    // See FinancialsPage.navigate()'s note — a fixed short wait is
    // unreliable for Financials sub-pages when this section runs later in a
    // full walkSections pass. Poll for the grid instead.
    await page.locator('[id*="RecoveryChecksExtLV"]').first().waitFor({ timeout: 8000 }).catch(() => {
      logger.warn('RecoveryChecksPage.navigate: RecoveryChecksExtLV did not appear within 8s — extraction may report an empty list');
    });
  }

  async extract(ctx: ExtractionContext): Promise<RecoveryCheckData[]> {
    return extractRecoveryChecks(ctx);
  }
}
