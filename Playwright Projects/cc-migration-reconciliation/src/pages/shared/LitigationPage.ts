import { Page } from '@playwright/test';
import { ClaimSectionPage } from '../ClaimSectionPage';
import { ExtractionContext } from '../../extraction/ExtractionContext';
import { extractLitigation } from '../../extraction/extractors/litigationExtractor';
import { SectionRecord } from '../../models/common';
import { clickNavItem } from '../../navigation/clickNavItem';
import { logger } from '../../logging/logger';

/** CONFIRMED structure, both platforms — "Litigation" is a top-level nav item on both (defaults to its "Matters" grid). */
export class LitigationPage implements ClaimSectionPage<SectionRecord> {
  readonly sectionKey = 'litigation';

  async isPresent(_page: Page): Promise<boolean> {
    return true;
  }

  async navigate(page: Page): Promise<void> {
    if (!(await clickNavItem(page, 'Litigation', 'LitigationPage.navigate'))) {
      logger.warn('LitigationPage.navigate: no Litigation nav item found — extraction will report an empty list');
      return;
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1000);
  }

  async extract(ctx: ExtractionContext): Promise<SectionRecord> {
    return extractLitigation(ctx);
  }
}
