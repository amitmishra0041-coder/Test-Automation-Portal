import { Page } from '@playwright/test';
import { ClaimSectionPage } from '../ClaimSectionPage';
import { ExtractionContext } from '../../extraction/ExtractionContext';
import { extractHistory } from '../../extraction/extractors/historyExtractor';
import { HistoryEventData } from '../../models/ContentData';
import { clickNavItem } from '../../navigation/clickNavItem';
import { logger } from '../../logging/logger';

/**
 * CONFIRMED, both platforms — "History" is a top-level nav item on both
 * (the real per-event audit trail, HistoryLV — NOT "Claim History", a
 * different page — see historyExtractor.ts's doc comment).
 */
export class HistoryPage implements ClaimSectionPage<HistoryEventData[]> {
  readonly sectionKey = 'history';

  async isPresent(_page: Page): Promise<boolean> {
    return true;
  }

  async navigate(page: Page): Promise<void> {
    if (!(await clickNavItem(page, 'History', 'HistoryPage.navigate'))) {
      logger.warn('HistoryPage.navigate: no History nav item found — extraction will report an empty list');
      return;
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.locator('[id*="HistoryLV"]').first().waitFor({ timeout: 8000 }).catch(() => {
      logger.warn('HistoryPage.navigate: HistoryLV did not appear within 8s — extraction may report an empty list');
    });
  }

  async extract(ctx: ExtractionContext): Promise<HistoryEventData[]> {
    return extractHistory(ctx);
  }
}
