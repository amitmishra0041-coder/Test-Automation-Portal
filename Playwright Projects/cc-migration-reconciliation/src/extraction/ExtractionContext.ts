import { Page } from '@playwright/test';
import { Platform } from './FieldObservation';

/**
 * Handed to every extractor so none of them re-derive claim/environment
 * metadata or duplicate frame/dialog resolution. `root` defaults to the
 * page itself; Section 17's modal/frame handling attaches a narrower root
 * here once a section that actually needs it is built (none of the
 * currently-confirmed sections do).
 */
export interface ExtractionContext {
  page: Page;
  claimNumber: string;
  environment: Platform;
  tier: string;
}
