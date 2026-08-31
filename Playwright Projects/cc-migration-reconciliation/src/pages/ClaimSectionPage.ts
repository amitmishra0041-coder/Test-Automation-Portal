import { Page } from '@playwright/test';
import { ExtractionContext } from '../extraction/ExtractionContext';

/**
 * One interface, two implementations per section (Section D) — the same
 * pattern claimCenterBase.js already proved with IS_ON_PREM + L. A page
 * object under src/pages/onprem/ and one under src/pages/cloud/ both
 * implement this; ClaimNavigator picks the right one at runtime from the
 * environment's platform, and nothing above this layer ever branches on
 * platform again.
 */
export interface ClaimSectionPage<TSection> {
  readonly sectionKey: string;

  /** Positive check that the section genuinely doesn't apply to this claim/LOB (Section 6) — not just "I looked and found nothing". */
  isPresent(page: Page): Promise<boolean>;

  navigate(page: Page): Promise<void>;

  extract(ctx: ExtractionContext): Promise<TSection>;
}
