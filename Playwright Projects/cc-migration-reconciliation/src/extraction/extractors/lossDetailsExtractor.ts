import { ExtractionContext } from '../ExtractionContext';
import { SectionRecord } from '../../models/common';
import { FieldObservation, notPresent } from '../FieldObservation';
import { readDynamicFields } from '../genericFieldReader';

/**
 * CONFIRMED, both platforms — live pass against the "Loss Details" nav
 * item's default sub-page. This is also where `claim.claimType` /
 * `claim.lossType` / `claim.jurisdiction` / `claim.reportedDate` /
 * `claim.closeDate` live (see extractClaimDetailsScalars below) — there is
 * NO separate "Claim Details" nav item on either platform (confirmed
 * across two live sweeps), so both navigationCatalog keys land here.
 *
 * Uses readDynamicFields (see genericFieldReader.ts) rather than a
 * hardcoded per-LOB label list: this page's field set varies enormously by
 * LOB (Personal Auto, Property, Workers' Comp, and untested LOBs like
 * Commercial Auto/BOP/GL/Umbrella all show different fields here), and a
 * fixed vocabulary silently skips whatever the vocabulary-builder never
 * saw. The dynamic reader discovers whatever labels the current claim's
 * page actually renders, so coverage isn't bounded by which LOBs were
 * tested when this extractor was written.
 */
export async function extractLossDetails(ctx: ExtractionContext): Promise<SectionRecord> {
  const fields = await readDynamicFields(ctx, 'Loss Details', 'claim.lossDetails.fields');
  return { sectionKey: 'lossDetails', fields };
}

export interface ClaimDetailsScalars {
  claimType: FieldObservation;
  lossType: FieldObservation;
  jurisdiction: FieldObservation;
  reportedDate: FieldObservation;
  closeDate: FieldObservation;
}

/**
 * Same page as extractLossDetails, but returns the 5 top-level ClaimData
 * scalars the 'claimDetails' catalog key is responsible for — see that
 * key's own doc note about there being no separate "Claim Details" page.
 * Pulled from the same dynamic field map extractLossDetails uses; the alias
 * table in genericFieldReader.ts already reconciles the one confirmed
 * cross-platform label difference here (LossType/Loss Type).
 */
export async function extractClaimDetailsScalars(ctx: ExtractionContext): Promise<ClaimDetailsScalars> {
  const fields = await readDynamicFields(ctx, 'Claim Details', 'claim');
  const pick = (key: string, humanName: string, claimField: string): FieldObservation => {
    const found = fields[key];
    if (found) return { ...found, path: `claim.${claimField}`, field: humanName };
    return notPresent(
      { path: `claim.${claimField}`, field: humanName, type: 'string', environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Claim Details' },
      `"${humanName}" not found on Loss Details`,
    );
  };

  return {
    claimType: notPresent(
      { path: 'claim.claimType', field: 'Claim Type', type: 'string', environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Claim Details' },
      'No distinct "Claim Type" field confirmed on either platform — see claim.lossType and claim.policy.policyType instead',
    ),
    lossType: pick('Loss Type', 'Loss Type', 'lossType'),
    jurisdiction: pick('Jurisdiction', 'Jurisdiction', 'jurisdiction'),
    reportedDate: pick('Reported Date / Date Reported', 'Reported Date', 'reportedDate'),
    closeDate: pick('Close Date', 'Close Date', 'closeDate'),
  };
}
