import { Page } from '@playwright/test';
import { ClaimSectionPage } from '../ClaimSectionPage';
import { ExtractionContext } from '../../extraction/ExtractionContext';
import { extractParties } from '../../extraction/extractors/partiesExtractor';
import { PartyData } from '../../models/PartyData';
import { clickNavItem } from '../../navigation/clickNavItem';
import { logger } from '../../logging/logger';

/**
 * CONFIRMED, both platforms. "Parties Involved" is a PARENT nav item on
 * both platforms — its real content is the "Contacts" sub-item. On-prem's
 * single click on "Parties Involved" already lands directly on Contacts
 * (confirmed live); cloud's click only expands the sub-menu, so a second
 * click on "Contacts" is required. Clicking both unconditionally is safe on
 * on-prem too — the second click just lands on the same already-open page.
 *
 * Tracks navigation success — see LossDetailsPage's doc comment for why
 * (extracting after a failed navigate() silently reads whatever page was
 * left on screen and mislabels it as this section's data, confirmed live
 * as a real bug elsewhere). Especially important here since extractParties
 * now ALSO re-navigates internally for its per-contact detail pass — an
 * empty array is a much safer failure mode than clicking into rows of an
 * unrelated grid.
 */
export class PartiesPage implements ClaimSectionPage<PartyData[]> {
  readonly sectionKey = 'parties';
  private navigated = false;

  async isPresent(_page: Page): Promise<boolean> {
    return true;
  }

  async navigate(page: Page): Promise<void> {
    this.navigated = await clickNavItem(page, 'Parties Involved', 'PartiesPage.navigate');
    if (!this.navigated) {
      logger.warn('PartiesPage.navigate: no Parties Involved nav item found — extraction will report an empty list');
      return;
    }
    await page.waitForTimeout(800);
    await clickNavItem(page, 'Contacts', 'PartiesPage.navigate');
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1000);
  }

  async extract(ctx: ExtractionContext): Promise<PartyData[]> {
    if (!this.navigated) return [];
    return extractParties(ctx);
  }
}
