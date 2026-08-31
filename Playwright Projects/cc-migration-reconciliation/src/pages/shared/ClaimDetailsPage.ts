import { Page } from '@playwright/test';
import { ClaimSectionPage } from '../ClaimSectionPage';
import { ExtractionContext } from '../../extraction/ExtractionContext';
import { extractClaimDetailsScalars, ClaimDetailsScalars } from '../../extraction/extractors/lossDetailsExtractor';
import { clickNavItem } from '../../navigation/clickNavItem';
import { logger } from '../../logging/logger';

/**
 * CONFIRMED, both platforms. No separate "Claim Details" nav item exists on
 * either platform (confirmed across two live sweeps) — the fields this
 * catalog key is responsible for (claimType/lossType/jurisdiction/
 * reportedDate/closeDate) live on the SAME "Loss Details" page LossDetailsPage
 * reads, just feeding different ClaimData slots (top-level scalars, not
 * claim.lossDetails). Navigating here twice per claim (once under each
 * catalog key) is redundant but harmless.
 */
export class ClaimDetailsPage implements ClaimSectionPage<ClaimDetailsScalars> {
  readonly sectionKey = 'claimDetails';

  async isPresent(_page: Page): Promise<boolean> {
    return true;
  }

  async navigate(page: Page): Promise<void> {
    if (!(await clickNavItem(page, 'Loss Details', 'ClaimDetailsPage.navigate'))) {
      logger.warn('ClaimDetailsPage.navigate: no Loss Details nav item found — extraction will report NOT_PRESENT fields');
      return;
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1000);
  }

  async extract(ctx: ExtractionContext): Promise<ClaimDetailsScalars> {
    return extractClaimDetailsScalars(ctx);
  }
}
