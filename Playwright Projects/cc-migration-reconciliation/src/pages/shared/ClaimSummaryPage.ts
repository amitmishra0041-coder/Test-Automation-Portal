import { Page } from '@playwright/test';
import { ClaimSectionPage } from '../ClaimSectionPage';
import { ExtractionContext } from '../../extraction/ExtractionContext';
import { extractClaimHeader } from '../../extraction/extractors/claimHeaderExtractor';
import { extractValidationState } from '../../extraction/extractors/validationExtractor';
import { ClaimHeaderData, ValidationState } from '../../models/ClaimData';

export interface ClaimSummarySection {
  header: ClaimHeaderData;
  validation: ValidationState;
}

/**
 * A SINGLE shared implementation, not one per platform (unlike Section D's
 * general pattern) — readClaimHeader and readValidation are both genuinely
 * platform-agnostic in the prototype (confirmed comment: the header reader
 * deliberately scans whitespace-collapsed body text rather than lines
 * specifically BECAUSE that's what makes it work on cloud's separate-element
 * labels too). Splitting this into onprem/cloud classes would just be two
 * copies of the same body — kept as one to avoid that duplication.
 */
export class ClaimSummaryPage implements ClaimSectionPage<ClaimSummarySection> {
  readonly sectionKey = 'claimSummary';

  async isPresent(_page: Page): Promise<boolean> {
    return true; // every claim has a summary/header — no LOB is known to omit it
  }

  async navigate(_page: Page): Promise<void> {
    // No-op: the header ledger is visible on whatever page openExistingClaim
    // lands on — confirmed by the prototype capturing it immediately after
    // opening a claim, with no separate tab click.
  }

  async extract(ctx: ExtractionContext): Promise<ClaimSummarySection> {
    const [header, validation] = await Promise.all([
      extractClaimHeader(ctx),
      extractValidationState(ctx),
    ]);
    return { header, validation };
  }
}
