import { ExtractionContext } from '../ExtractionContext';
import { ExposureData, exposureBusinessKey } from '../../models/ExposureData';
import { FieldObservation, ok } from '../FieldObservation';
import { readAllPages } from '../pagination';

async function readOnPrem(ctx: ExtractionContext): Promise<Record<string, string>[]> {
  return readAllPages(ctx.page, 'onprem', 'ExposuresLV', () => ctx.page.evaluate(() => {
    // Find the real grid panel by id+visibility alone — NOT requiring it to
    // already contain rows (a real, empty grid still exists in the DOM and
    // must be told apart from "not on this page at all"). Falling back to
    // `document` for either headers or rows scrapes the left-nav tree
    // instead — `tr.x-grid-row` unscoped ALSO matches it (ExtJS renders
    // that as a grid too) — confirmed via live capture that this produced
    // 15-18 phantom "exposures" reading {"Name":"Summary"},
    // {"Name":"Workplan"}, ... before the real rows.
    const grid = document.querySelector('[id$=":ExposuresLV"]')
      || Array.from(document.querySelectorAll('[id*="ExposuresLV"]')).find((g) => (g as HTMLElement).offsetParent)
      || null;
    if (!grid) return [];

    const headers = Array.from(grid.querySelectorAll('.x-column-header-text'))
      .map((h) => (h.textContent || '').trim()).filter(Boolean);

    const out: Record<string, string>[] = [];
    for (const row of Array.from(grid.querySelectorAll('tr.x-grid-row'))) {
      if (!(row as HTMLElement).offsetParent) continue;
      const cells = Array.from(row.querySelectorAll('.x-grid-cell')).map((c) => ((c as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim());
      if (!cells.some(Boolean)) continue;
      const rec: Record<string, string> = {};
      const offset = cells.length - headers.length;
      headers.forEach((h, i) => {
        const v = cells[i + (offset > 0 ? offset : 0)];
        if (v) rec[h.replace(/\s+/g, '')] = v;
      });
      // Second guard: a real exposure row always carries a Claimant — a
      // nav-tree row yields only {Name: "..."}, and (confirmed live as a
      // real bug) an unrelated grid left open by an earlier-walked section
      // (e.g. Policy's "Policy-level Coverages" table) can ALSO carry a
      // "Type" or even "Coverage"-shaped column, so those alone aren't
      // enough to tell a real exposure row apart from a stray one.
      if (!('Claimant' in rec)) continue;
      if (Object.keys(rec).length) out.push(rec);
    }
    return out;
  }).catch(() => []));
}

async function readCloud(ctx: ExtractionContext): Promise<Record<string, string>[]> {
  return readAllPages(ctx.page, 'cloud', 'ExposuresLV', () => ctx.page.evaluate(() => {
    const rows: Record<string, Record<string, string>> = {};
    for (const el of Array.from(document.querySelectorAll('[id*="ExposuresLV-"]'))) {
      const m = el.id.match(/ExposuresLV-(\d+)-([A-Za-z]+)$/);
      if (!m || !(el as HTMLElement).offsetParent) continue;
      const [, idx, col] = m;
      const text = ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      rows[idx] = rows[idx] || {};
      rows[idx][col] = text;
    }
    return Object.keys(rows).sort((a, b) => Number(a) - Number(b)).map((k) => rows[k]);
  }).catch(() => []));
}

/**
 * Reconciles the handful of column names confirmed to differ per platform
 * for the SAME field — confirmed live 2026-08-25: on-prem's "#" (row
 * sequence number) and "Adjuster" line up with cloud's "Order" and
 * "Assignee" (same values/same slot, different header text), and were
 * showing as false MISSING_IN_CLOUD/MISSING_ON_PREM pairs instead of one
 * real value comparison. Unmapped column names pass through unchanged —
 * this is deliberately a small, grown-as-confirmed list, not an attempt to
 * enumerate every possible column (see genericFieldReader.ts's
 * CANONICAL_ALIASES for the same pattern elsewhere).
 */
const COLUMN_ALIASES: Record<string, string> = {
  '#': 'Order',
  Order: 'Order',
  Adjuster: 'Adjuster',
  Assignee: 'Adjuster',
  // Confirmed live 2026-08-27 on Workers' Comp claims (a 35-claim,
  // multi-LOB batch) — same pattern, two more columns that only appear once
  // there's real litigation/recovery data on an exposure.
  LitStatus: 'LitigationStatus',
  LitigationStatus: 'LitigationStatus',
  Recoveries: 'TotalRecoveries',
  TotalRecoveries: 'TotalRecoveries',
};

function canonicalColumn(raw: string): string {
  return COLUMN_ALIASES[raw] ?? raw;
}

/** CONFIRMED, both platforms — ported from readExposuresOnPrem / readExposuresCloud in claimSnapshot.js. */
export async function extractExposures(ctx: ExtractionContext): Promise<ExposureData[]> {
  const rows = ctx.environment === 'onprem' ? await readOnPrem(ctx) : await readCloud(ctx);

  return rows.map((row) => {
    const columns: Record<string, FieldObservation> = {};
    for (const [rawCol, text] of Object.entries(row)) {
      const col = canonicalColumn(rawCol);
      columns[col] = ok({
        path: `claim.exposures[].${col}`,
        field: col,
        value: text,
        rawText: text,
        type: 'string',
        environment: ctx.environment,
        claimNumber: ctx.claimNumber,
        section: 'Exposures',
      });
    }
    return { businessKey: exposureBusinessKey(columns), columns };
  });
}
