import { Page } from '@playwright/test';
import { ClaimSectionPage } from '../ClaimSectionPage';
import { ExtractionContext } from '../../extraction/ExtractionContext';
import { extractWorkplan } from '../../extraction/extractors/workplanExtractor';
import { WorkplanItemData } from '../../models/ActivityData';
import { clickNavItem } from '../../navigation/clickNavItem';
import { logger } from '../../logging/logger';

/** CONFIRMED, both platforms — "Workplan" is a top-level nav item on both. */
export class WorkplanPage implements ClaimSectionPage<WorkplanItemData[]> {
  readonly sectionKey = 'workplan';

  async isPresent(_page: Page): Promise<boolean> {
    return true;
  }

  async navigate(page: Page): Promise<void> {
    if (!(await clickNavItem(page, 'Workplan', 'WorkplanPage.navigate'))) {
      logger.warn('WorkplanPage.navigate: no Workplan nav item found — extraction will report an empty list');
      return;
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1000);
  }

  async extract(ctx: ExtractionContext): Promise<WorkplanItemData[]> {
    return extractWorkplan(ctx);
  }
}
