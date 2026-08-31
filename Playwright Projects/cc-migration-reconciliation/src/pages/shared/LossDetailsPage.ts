import { Page } from '@playwright/test';
import { ClaimSectionPage } from '../ClaimSectionPage';
import { ExtractionContext } from '../../extraction/ExtractionContext';
import { extractLossDetails } from '../../extraction/extractors/lossDetailsExtractor';
import { SectionRecord } from '../../models/common';
import { clickNavItem } from '../../navigation/clickNavItem';
import { extractionFailed } from '../../extraction/FieldObservation';
import { logger } from '../../logging/logger';

/**
 * CONFIRMED, both platforms — "Loss Details" is a top-level nav item on
 * both. Tracks navigation success — confirmed live 2026-08-21 as a real bug
 * elsewhere (genericPageFactories.ts) that extracting via readDynamicFields
 * after a FAILED navigate() silently reads whatever page was left on
 * screen and mislabels it as this section's data, rather than honestly
 * reporting "couldn't get here". Loss Details is a reliable top-level item
 * so this hasn't been observed failing here, but the same guard belongs on
 * every page object using the dynamic reader, not just the ones where it's
 * already bitten someone.
 */
export class LossDetailsPage implements ClaimSectionPage<SectionRecord> {
  readonly sectionKey = 'lossDetails';
  private navigated = false;

  async isPresent(_page: Page): Promise<boolean> {
    return true;
  }

  async navigate(page: Page): Promise<void> {
    this.navigated = await clickNavItem(page, 'Loss Details', 'LossDetailsPage.navigate');
    if (!this.navigated) {
      logger.warn('LossDetailsPage.navigate: no Loss Details nav item found — extraction will report EXTRACTION_FAILED');
      return;
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1000);
  }

  async extract(ctx: ExtractionContext): Promise<SectionRecord> {
    if (!this.navigated) {
      return {
        sectionKey: this.sectionKey,
        fields: {
          __status: extractionFailed(
            { path: 'claim.lossDetails', field: 'Loss Details', type: 'string', environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Loss Details' },
            'Could not navigate to "Loss Details" — no data read, not comparable to the other platform',
          ),
        },
      };
    }
    return extractLossDetails(ctx);
  }
}
