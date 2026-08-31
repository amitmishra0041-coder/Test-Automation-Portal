import { ExtractionContext } from '../ExtractionContext';
import { PolicyData } from '../../models/PolicyData';
import { FieldObservation, notPresent } from '../FieldObservation';
import { readDynamicFields } from '../genericFieldReader';

/**
 * CONFIRMED, both platforms — live pass against the "Policy" nav item's
 * default ("General") sub-page. Field labels match closely between
 * platforms with one confirmed naming difference: on-prem calls the
 * modification-number field "Policy Mod", cloud calls the SAME field (same
 * value observed live, e.g. "01" on both) "Policy Term" — reconciled by
 * genericFieldReader's alias table, not here.
 *
 * Uses readDynamicFields rather than a hardcoded per-LOB label list (see
 * lossDetailsExtractor's doc comment for why) — the 6 named PolicyData
 * fields are pulled out of the dynamic map for typed access; everything
 * else the page renders (Effective/Expiration Date, Underwriting Company,
 * Deductible, …) still gets compared, via PolicyData.extra, instead of
 * being silently discovered-then-discarded the way the old LABELS-array
 * version did (it queried these into `lines` but never wired them into the
 * returned PolicyData at all).
 */
export async function extractPolicy(ctx: ExtractionContext): Promise<PolicyData> {
  const fields = await readDynamicFields(ctx, 'Policy', 'claim.policy.extra');

  const take = (key: string, path: string, humanName: string): FieldObservation => {
    const found = fields[key];
    if (found) { delete fields[key]; return { ...found, path, field: humanName }; }
    return notPresent({ path, field: humanName, type: 'string', environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Policy' }, `"${humanName}" not found on the Policy page`);
  };

  return {
    policyNumber: take('Policy Number', 'claim.policy.policyNumber', 'Policy Number'),
    policyType: take('Policy Type', 'claim.policy.policyType', 'Policy Type'),
    policyTerm: take('Policy Mod / Policy Term', 'claim.policy.policyTerm', 'Policy Term') as FieldObservation<string>,
    // "Name" is ambiguous on this page (Insured, then Agent, in DOM order —
    // confirmed live) — the first occurrence is the Insured's.
    namedInsured: take('Name', 'claim.policy.namedInsured', 'Named Insured'),
    jurisdiction: notPresent(
      { path: 'claim.policy.jurisdiction', field: 'Jurisdiction', type: 'string', environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Policy' },
      'Not shown on the Policy page on either platform — see claim.jurisdiction (Loss Details) instead',
    ),
    producerCode: take('Producer Code', 'claim.policy.producerCode', 'Producer Code'),
    extra: fields, // whatever's left after pulling the 6 named fields above
  };
}
