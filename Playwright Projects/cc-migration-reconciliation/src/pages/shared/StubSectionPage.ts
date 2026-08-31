import { Page } from '@playwright/test';
import { ClaimSectionPage } from '../ClaimSectionPage';
import { ExtractionContext } from '../../extraction/ExtractionContext';
import { SectionRecord } from '../../models/common';
import { stubNotImplemented } from '../../extraction/FieldObservation';

/**
 * A SINGLE generic page object satisfies ClaimSectionPage for every section
 * still marked 'stub' in navigationCatalog.ts (Litigation, Subrogation,
 * Segmentation, Coverage, Notes, Documents, History, …) rather than ~20
 * hand-written, near-identical placeholder files. This is what "full
 * catalog wired in from day one" means concretely: every stub section still
 * has a real entry in the pipeline, a real (if empty) SectionRecord in the
 * report, and a clear TODO — it just doesn't yet pretend to know a DOM
 * shape nobody has verified (Section 28's explicit instruction).
 *
 * Replacing a stub: write a real ClaimSectionPage<T> for that section key
 * and swap it into the registry (src/pages/registry.ts) — nothing else
 * needs to change, since the registry is the only place that knows which
 * concrete class backs a given key.
 */
export class StubSectionPage implements ClaimSectionPage<SectionRecord> {
  constructor(readonly sectionKey: string, private readonly label: string) {}

  async isPresent(_page: Page): Promise<boolean> {
    // Cannot make a positive presence determination without a verified
    // selector — reported as such via the SectionRecord's own field below,
    // never silently assumed absent (which would misclassify as
    // MISSING_ON_PREM/MISSING_IN_CLOUD instead of UNABLE_TO_COMPARE).
    return true;
  }

  async navigate(_page: Page): Promise<void> {
    // Intentionally does nothing — see class doc comment.
  }

  async extract(ctx: ExtractionContext): Promise<SectionRecord> {
    return {
      sectionKey: this.sectionKey,
      fields: {
        __status: stubNotImplemented(this.label, `claim.${this.sectionKey}`, this.label, ctx.environment, ctx.claimNumber),
      },
    };
  }
}
