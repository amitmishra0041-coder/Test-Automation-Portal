import { ExtractionContext } from '../ExtractionContext';
import { FinancialsData } from '../../models/FinancialsData';
import { FieldObservation, ok, notPresent } from '../FieldObservation';

async function readSummaryCloud(ctx: ExtractionContext): Promise<Record<string, string>> {
  return ctx.page.evaluate(() => {
    const out: Record<string, string> = {};
    for (const el of Array.from(document.querySelectorAll('[id*="FinancialsSummaryLV-"]'))) {
      const m = el.id.match(/FinancialsSummaryLV-(\d+)-([A-Za-z]+)$/);
      if (!m || m[1] !== '0' || !(el as HTMLElement).offsetParent) continue; // row 0 = "Claim Total" (grand total) — see readSummaryOnPrem's doc comment for why only this row is read
      const text = ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
      if (!/^\$?[\d,.-]+$/.test(text)) continue;
      out[m[2]] = text;
    }
    return out;
  }).catch(() => ({}));
}

/**
 * ON-PREM: CONFIRMED 2026-08-20 — the grid is a hierarchical rollup (Claim
 * Total → per-exposure → per-cost-type → …, confirmed live via nested ids
 * like "…FinancialsSummaryLV:0:0:0:RemainingReserves") that only this
 * top-level "Claim Total" row (id path "…FinancialsSummaryLV:0:<Col>", a
 * SINGLE numeric segment) is read here — the deeper per-exposure/per-
 * category breakdown rows are a real gap, not modeled, since their nesting
 * semantics aren't understood well enough yet to extract without guessing.
 * Column names are discovered dynamically (not hardcoded): confirmed live
 * that a $0.00 column gets NO id-addressable cell at all on-prem (unlike
 * cloud, which renders one even for $0.00) — hardcoding the 6 known column
 * names would have produced false "not found" reads for the ones that
 * happen to be non-zero on a given claim, and false gaps for the ones that
 * are zero. Keyed by the SAME bare column name readSummaryCloud uses
 * (RemainingReserves, TotalIncurredNet, …) so the two compare directly with
 * no alias table needed.
 */
async function readSummaryOnPrem(ctx: ExtractionContext): Promise<Record<string, string>> {
  return ctx.page.evaluate(() => {
    const out: Record<string, string> = {};
    const root = document.querySelector('[id$=":FinancialsSummaryLV"]');
    if (!root) return out;
    for (const el of Array.from(root.querySelectorAll('[id]'))) {
      const m = el.id.match(/FinancialsSummaryLV:0:([A-Za-z]+)$/); // exactly one numeric segment = the top-level "Claim Total" row
      if (!m || !(el as HTMLElement).offsetParent) continue;
      const text = (el.textContent || '').trim();
      if (!/^\$?[\d,.-]+$/.test(text)) continue;
      out[m[1]] = text;
    }
    return out;
  }).catch(() => ({}));
}

/**
 * CLOUD: CONFIRMED — ported from readFinancialsCloud in claimSnapshot.js.
 * ON-PREM: NOT IMPLEMENTED — the prototype's own notCaptured list says so
 * explicitly ("financials (on-prem financials grid reader not
 * implemented)"). Reported here the same honest way: `loaded: false` with a
 * reason, never a silently empty object that a comparer could read as
 * agreement (Section 16).
 */
export async function extractFinancials(ctx: ExtractionContext): Promise<FinancialsData> {
  const raw = ctx.environment === 'cloud' ? await readSummaryCloud(ctx) : await readSummaryOnPrem(ctx);
  const loaded = Object.keys(raw).length > 0;
  const cells: Record<string, FieldObservation> = {};
  for (const [key, text] of Object.entries(raw)) {
    cells[key] = ok({
      path: `claim.financials.summary.${key}`, field: key, value: text, rawText: text,
      type: 'currency', environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Financials',
    });
  }
  if (!loaded) {
    cells.__note = notPresent(
      { path: 'claim.financials.summary', field: 'Financials Summary', type: 'string', environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Financials' },
      'Financials page was not open at capture time, or the "Claim Total" row rendered zero non-zero cells',
    );
  }

  const stubTotal = (field: string, path: string): FieldObservation<number | null> =>
    notPresent({ path, field, type: 'currency', environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Financials' }, 'TODO: totals extractor not yet built');
  const fromCell = (key: string, field: string, path: string): FieldObservation<number | null> => {
    const c = cells[key];
    if (!c) return stubTotal(field, path);
    return ok({ ...c, path, field, type: 'currency' }) as FieldObservation<number | null>;
  };

  return {
    summary: { cells, loaded },
    transactions: [],
    checksPayments: [],
    recoveryChecks: [],
    totals: {
      paidTotal: fromCell('TotalPayments', 'Paid Total', 'claim.financials.totals.paidTotal'),
      outstandingTotal: stubTotal('Outstanding Total', 'claim.financials.totals.outstandingTotal'),
      remainingReserve: fromCell('RemainingReserves', 'Remaining Reserve', 'claim.financials.totals.remainingReserve'),
    },
  };
}
