import { Page } from '@playwright/test';
import { ClaimSectionPage } from '../ClaimSectionPage';
import { ExtractionContext } from '../../extraction/ExtractionContext';
import { extractExposures } from '../../extraction/extractors/exposuresExtractor';
import { ExposureData } from '../../models/ExposureData';
import { clickNavItem } from '../../navigation/clickNavItem';
import { logger } from '../../logging/logger';

export class ExposuresPage implements ClaimSectionPage<ExposureData[]> {
  readonly sectionKey = 'exposures';

  async isPresent(_page: Page): Promise<boolean> {
    // WC-style claims have NO distinct Exposures nav item at all (the grid
    // is a section of Summary) — confirmed via project_cc_e2e_close_rules
    // memory. Treating "no nav item" as absence here would be wrong; the
    // extractor itself scopes to whatever ExposuresLV grid it finds on the
    // CURRENT page, wherever that is, so presence is really "did navigate()
    // land somewhere with a grid" — checked by the extractor, not here.
    return true;
  }

  async navigate(page: Page): Promise<void> {
    // Was a raw, non-retrying click here for the "found" branch — confirmed
    // live as a real bug: when the transient `.gw-click-overlay` (see
    // clickNavItem's own doc comment) intercepts THIS specific click, it's
    // more likely to still be present here than at other sections' clicks,
    // since Exposures now typically runs after several other sections
    // (claimSummary/claimDetails/policy/parties/contacts) have already
    // triggered transitions. A raw click silently swallows the failure and
    // "succeeds" while leaving whichever earlier page was open (e.g.
    // Contacts), so extraction reads zero exposures with no error anywhere.
    // clickNavItem's force-retry fixes this the same way it already does
    // for every other section's nav click.
    if (await clickNavItem(page, 'Exposures', 'ExposuresPage.navigate')) {
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      // Confirmed live as a real bug: domcontentloaded fires for the page
      // shell well before ExtJS finishes async-rendering the grid itself —
      // extraction ran and found zero ExposuresLV elements despite the
      // click having genuinely succeeded. Every other page object in this
      // codebase (Documents/Workplan/Policy/LossDetails/Litigation) already
      // waits ~1s after its click for exactly this reason; this branch was
      // the one place that didn't, and it stayed dormant only because
      // on-prem's role-based match never used to succeed here (no role on
      // ExtJS nav items) until clickNavItem's loose-text fallback started
      // finding it.
      await page.waitForTimeout(1000);
      return;
    }
    // WC-style claims have no distinct Exposures tab — the grid is embedded
    // on Summary instead (confirmed via project_cc_e2e_close_rules memory).
    // Confirmed live as a real bug otherwise: "just read whatever page is
    // current" silently picked up an unrelated grid left open by a section
    // that ran earlier in navigationCatalog's order (e.g. Policy) once
    // sections that actually navigate away existed — the on-prem extractor's
    // unscoped fallback then matched the Policy-level Coverages grid (it
    // also has a "Type" column) and reported policy form names as missing
    // exposures. Explicitly returning to Summary makes this correct
    // regardless of what section ran before it.
    if (!(await clickNavItem(page, 'Summary', 'ExposuresPage.navigate'))) {
      logger.warn('ExposuresPage.navigate: no distinct Exposures tab AND no Summary nav item found — extraction may read the wrong page');
      return;
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(500);
  }

  async extract(ctx: ExtractionContext): Promise<ExposureData[]> {
    return extractExposures(ctx);
  }
}
