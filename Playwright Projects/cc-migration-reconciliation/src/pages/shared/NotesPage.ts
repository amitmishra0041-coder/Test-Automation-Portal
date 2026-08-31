import { Page } from '@playwright/test';
import { ClaimSectionPage } from '../ClaimSectionPage';
import { ExtractionContext } from '../../extraction/ExtractionContext';
import { extractNotes } from '../../extraction/extractors/notesExtractor';
import { NoteData } from '../../models/ContentData';
import { clickNavItem } from '../../navigation/clickNavItem';
import { logger } from '../../logging/logger';

/** CONFIRMED on-prem, partial cloud — "Notes" is a top-level nav item on both. See notesExtractor.ts's doc comment. */
export class NotesPage implements ClaimSectionPage<NoteData[]> {
  readonly sectionKey = 'notes';

  async isPresent(_page: Page): Promise<boolean> {
    return true;
  }

  async navigate(page: Page): Promise<void> {
    if (!(await clickNavItem(page, 'Notes', 'NotesPage.navigate'))) {
      logger.warn('NotesPage.navigate: no Notes nav item found — extraction will report an empty list');
      return;
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1000);
  }

  async extract(ctx: ExtractionContext): Promise<NoteData[]> {
    return extractNotes(ctx);
  }
}
