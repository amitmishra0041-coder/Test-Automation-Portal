import { Page } from '@playwright/test';
import { ClaimSectionPage } from '../ClaimSectionPage';
import { ExtractionContext } from '../../extraction/ExtractionContext';
import { extractDocuments } from '../../extraction/extractors/documentsExtractor';
import { DocumentData } from '../../models/ContentData';
import { clickNavItem } from '../../navigation/clickNavItem';
import { logger } from '../../logging/logger';

/** CONFIRMED, both platforms — "Documents" is a top-level nav item on both. */
export class DocumentsPage implements ClaimSectionPage<DocumentData[]> {
  readonly sectionKey = 'documents';

  async isPresent(_page: Page): Promise<boolean> {
    return true;
  }

  async navigate(page: Page): Promise<void> {
    if (!(await clickNavItem(page, 'Documents', 'DocumentsPage.navigate'))) {
      logger.warn('DocumentsPage.navigate: no Documents nav item found — extraction will report an empty list');
      return;
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1000);
  }

  async extract(ctx: ExtractionContext): Promise<DocumentData[]> {
    return extractDocuments(ctx);
  }
}
