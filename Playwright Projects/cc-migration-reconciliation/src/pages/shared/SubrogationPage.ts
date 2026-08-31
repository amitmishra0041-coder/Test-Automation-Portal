import { Page } from '@playwright/test';
import { ClaimSectionPage } from '../ClaimSectionPage';
import { ExtractionContext } from '../../extraction/ExtractionContext';
import { extractSubrogation } from '../../extraction/extractors/subrogationExtractor';
import { SectionRecord } from '../../models/common';
import { clickNavItem } from '../../navigation/clickNavItem';
import { extractionFailed } from '../../extraction/FieldObservation';
import { logger } from '../../logging/logger';

/**
 * CONFIRMED structure, both platforms — "Subrogation" is a top-level nav
 * item on both (defaults to its "Summary" sub-page). Tracks navigation
 * success — see LossDetailsPage's doc comment for why (extracting via
 * readDynamicFields after a failed navigate() silently reads whatever page
 * was left on screen and mislabels it as this section's data, confirmed
 * live as a real bug elsewhere).
 */
export class SubrogationPage implements ClaimSectionPage<SectionRecord> {
  readonly sectionKey = 'subrogation';
  private navigated = false;

  async isPresent(_page: Page): Promise<boolean> {
    return true;
  }

  async navigate(page: Page): Promise<void> {
    this.navigated = await clickNavItem(page, 'Subrogation', 'SubrogationPage.navigate');
    if (!this.navigated) {
      logger.warn('SubrogationPage.navigate: no Subrogation nav item found — extraction will report EXTRACTION_FAILED');
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
            { path: 'claim.specialty.subrogation', field: 'Subrogation', type: 'string', environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Subrogation' },
            'Could not navigate to "Subrogation" — no data read, not comparable to the other platform',
          ),
        },
      };
    }
    return extractSubrogation(ctx);
  }
}
