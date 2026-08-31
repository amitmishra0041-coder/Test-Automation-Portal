import { Page } from '@playwright/test';
import { ClaimSectionPage } from '../ClaimSectionPage';
import { ExtractionContext } from '../../extraction/ExtractionContext';
import { extractPolicy } from '../../extraction/extractors/policyExtractor';
import { PolicyData } from '../../models/PolicyData';
import { clickNavItem } from '../../navigation/clickNavItem';
import { extractionFailed } from '../../extraction/FieldObservation';
import { logger } from '../../logging/logger';

/**
 * CONFIRMED, both platforms — "Policy" is a top-level nav item on both.
 * Tracks navigation success — see LossDetailsPage's doc comment for why
 * (extracting via readDynamicFields after a failed navigate() silently
 * reads whatever page was left on screen and mislabels it as this
 * section's data, confirmed live as a real bug elsewhere).
 */
export class PolicyPage implements ClaimSectionPage<PolicyData> {
  readonly sectionKey = 'policy';
  private navigated = false;

  async isPresent(_page: Page): Promise<boolean> {
    return true;
  }

  async navigate(page: Page): Promise<void> {
    this.navigated = await clickNavItem(page, 'Policy', 'PolicyPage.navigate');
    if (!this.navigated) {
      logger.warn('PolicyPage.navigate: no Policy nav item found — extraction will report EXTRACTION_FAILED');
      return;
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1000);
  }

  async extract(ctx: ExtractionContext): Promise<PolicyData> {
    if (!this.navigated) {
      const fail = (field: string, path: string) => extractionFailed<string>(
        { path, field, type: 'string' as const, environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Policy' },
        'Could not navigate to "Policy" — no data read, not comparable to the other platform',
      );
      return {
        policyNumber: fail('Policy Number', 'claim.policy.policyNumber'),
        policyType: fail('Policy Type', 'claim.policy.policyType'),
        policyTerm: fail('Policy Term', 'claim.policy.policyTerm'),
        namedInsured: fail('Named Insured', 'claim.policy.namedInsured'),
        jurisdiction: fail('Jurisdiction', 'claim.policy.jurisdiction'),
        producerCode: fail('Producer Code', 'claim.policy.producerCode'),
        extra: {},
      };
    }
    return extractPolicy(ctx);
  }
}
