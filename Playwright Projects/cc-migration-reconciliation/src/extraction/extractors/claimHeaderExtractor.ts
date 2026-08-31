import { ExtractionContext } from '../ExtractionContext';
import { ClaimHeaderData } from '../../models/ClaimData';
import { FieldObservation, ok, notPresent } from '../FieldObservation';

/**
 * CONFIRMED, both platforms — ported from readClaimHeader in claimSnapshot.js.
 * Reads the header ledger line ("Pol: … Claim: … Ins: … DoL: … St: … Adj: …")
 * by LABEL POSITION across the whole-page text with whitespace collapsed to
 * single spaces — deliberately NOT line-based, which is exactly what makes
 * it work on cloud too, where the labels are separate DOM elements that
 * don't share one innerText "line" the way on-prem's do.
 */
export async function extractClaimHeader(ctx: ExtractionContext): Promise<ClaimHeaderData> {
  const { page, claimNumber, environment } = ctx;

  const raw = await page.evaluate(() => {
    const LABELS = ['Pol', 'Claim', 'Ins', 'Clmt', 'DoL', 'St', 'Adj'];
    const run = (document.body.innerText || '').replace(/\s+/g, ' ');
    const out: Record<string, string | null> = {};
    for (const L of LABELS) out[L] = null;
    const start = run.indexOf('Pol:');
    if (start < 0) return out;
    const found: Array<{ label: string; at: number }> = [];
    for (const L of LABELS) {
      const i = run.indexOf(`${L}:`, start);
      if (i >= 0 && i < start + 400) found.push({ label: L, at: i });
    }
    found.sort((x, y) => x.at - y.at);
    for (let k = 0; k < found.length; k++) {
      const { label, at } = found[k];
      let end = k + 1 < found.length ? found[k + 1].at : run.length;
      let value = run.slice(at + label.length + 1, end).trim();
      if (k + 1 === found.length) {
        const stops = ['Summary', 'Exposures', 'Workplan', 'Basics', 'Actions']
          .map((w) => value.indexOf(w)).filter((i) => i > 0).sort((a, b) => a - b);
        if (stops.length) value = value.slice(0, stops[0]).trim();
        const paren = value.indexOf(')');
        if (paren > 0) value = value.slice(0, paren + 1);
        value = value.slice(0, 60).trim();
      }
      out[label] = value || null;
    }
    return out;
  }).catch(() => ({} as Record<string, string | null>));

  const field = (label: string, key: string, humanName: string): FieldObservation => {
    const v = raw[label] ?? null;
    const base = { path: `claim.header.${key}`, field: humanName, type: 'string' as const, environment, claimNumber, section: 'Claim Summary' };
    return v === null
      ? notPresent(base, 'label not found in header ledger — see readClaimHeader positional scan')
      : ok({ ...base, value: v, rawText: v });
  };

  return {
    policyNumber: field('Pol', 'policyNumber', 'Policy Number'),
    claimNumber: field('Claim', 'claimNumber', 'Claim Number'),
    insured: field('Ins', 'insured', 'Insured'),
    claimant: field('Clmt', 'claimant', 'Claimant'), // absent on non-WC-style claims — legitimately NOT_PRESENT
    lossDate: field('DoL', 'lossDate', 'Date of Loss'),
    status: field('St', 'status', 'Claim Status'),
    adjuster: field('Adj', 'adjuster', 'Adjuster'),
  };
}
