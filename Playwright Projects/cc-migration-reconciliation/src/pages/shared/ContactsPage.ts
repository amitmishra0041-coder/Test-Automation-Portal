import { Page } from '@playwright/test';
import { ClaimSectionPage } from '../ClaimSectionPage';
import { ExtractionContext } from '../../extraction/ExtractionContext';
import { extractContacts } from '../../extraction/extractors/partiesExtractor';
import { ContactData } from '../../models/PartyData';
import { clickNavItem } from '../../navigation/clickNavItem';
import { logger } from '../../logging/logger';

/** Same confirmed page as PartiesPage — see PartyData/ContactData's shared doc comment. */
export class ContactsPage implements ClaimSectionPage<ContactData[]> {
  readonly sectionKey = 'contacts';
  private navigated = false;

  async isPresent(_page: Page): Promise<boolean> {
    return true;
  }

  async navigate(page: Page): Promise<void> {
    this.navigated = await clickNavItem(page, 'Parties Involved', 'ContactsPage.navigate');
    if (!this.navigated) {
      logger.warn('ContactsPage.navigate: no Parties Involved nav item found — extraction will report an empty list');
      return;
    }
    await page.waitForTimeout(800);
    await clickNavItem(page, 'Contacts', 'ContactsPage.navigate');
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1000);
  }

  async extract(ctx: ExtractionContext): Promise<ContactData[]> {
    if (!this.navigated) return [];
    return extractContacts(ctx);
  }
}
