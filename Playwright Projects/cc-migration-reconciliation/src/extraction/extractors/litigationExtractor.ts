import { ExtractionContext } from '../ExtractionContext';
import { SectionRecord } from '../../models/common';
import { FieldObservation, ok, notPresent } from '../FieldObservation';
import { readAllPages } from '../pagination';

/**
 * CONFIRMED structure, both platforms — live pass against the "Litigation"
 * nav item's default "Matters" grid (`MattersLV`). Both test claims had
 * zero matters, so row-level parsing is structurally confirmed (headers,
 * ids, column mapping) but not validated against real row data yet — see
 * navigationCatalog.ts's 'partial' status note for this key.
 */
function mapColumnKey(raw: string): string | null {
  const key = raw.replace(/\s+/g, '');
  switch (key) {
    case 'Name': return 'Name';
    case 'CaseNumber': return 'CaseNumber';
    case 'FinalSettlement':
    case 'EstSettleCost': return 'FinalSettlement';
    case 'TrialDate': return 'TrialDate';
    case 'AssignedTo':
    case 'AssignedUser': return 'AssignedTo';
    case 'Resolution':
    case 'resolution': return 'Resolution';
    default: return null;
  }
}

async function readOnPrem(ctx: ExtractionContext): Promise<Record<string, string>[]> {
  return readAllPages(ctx.page, 'onprem', 'MattersLV', () => ctx.page.evaluate(() => {
    // Find the real grid panel by id+visibility alone — NOT requiring it to
    // already contain rows (a real, empty grid still exists in the DOM and
    // must be told apart from "not on this page at all"). Falling back to
    // `document` for either headers or rows scrapes the left-nav tree
    // instead — it renders as `tr.x-grid-row` too, confirmed live
    // 2026-08-20 on a claim with zero real matters.
    const grid = document.querySelector('[id$=":MattersLV"]')
      || Array.from(document.querySelectorAll('[id*="MattersLV"]')).find((g) => (g as HTMLElement).offsetParent)
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
      if (!('Name' in rec)) continue;
      if (Object.keys(rec).length) out.push(rec);
    }
    return out;
  }).catch(() => []));
}

async function readCloud(ctx: ExtractionContext): Promise<Record<string, string>[]> {
  return readAllPages(ctx.page, 'cloud', 'MattersLV', () => ctx.page.evaluate(() => {
    const rows: Record<string, Record<string, string>> = {};
    for (const el of Array.from(document.querySelectorAll('[id*="MattersLV-"]'))) {
      const m = el.id.match(/MattersLV-(\d+)-([A-Za-z]+)$/);
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

export async function extractLitigation(ctx: ExtractionContext): Promise<SectionRecord> {
  const rawRows = ctx.environment === 'onprem' ? await readOnPrem(ctx) : await readCloud(ctx);

  const rows = rawRows.map((row) => {
    const canonical: Record<string, string> = {};
    for (const [rawKey, text] of Object.entries(row)) {
      const mapped = mapColumnKey(rawKey);
      if (mapped) canonical[mapped] = text;
    }

    const field = (name: string, fieldLabel: string, type: FieldObservation['type'] = 'string'): FieldObservation => {
      const text = canonical[name];
      const path = `claim.specialty.litigation.rows[].${name}`;
      const base = { path, field: fieldLabel, type, environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Litigation' };
      return text
        ? ok({ ...base, value: text, rawText: text })
        : notPresent(base, `TODO: "${fieldLabel}" not found in this row's captured columns`);
    };

    const name = field('Name', 'Name');
    const caseNumber = field('CaseNumber', 'Case Number');

    return {
      businessKey: `${name.value}|${caseNumber.value}`,
      name,
      caseNumber,
      finalSettlement: field('FinalSettlement', 'Final Settlement', 'currency'),
      trialDate: field('TrialDate', 'Trial Date', 'date'),
      assignedTo: field('AssignedTo', 'Assigned To'),
      resolution: field('Resolution', 'Resolution'),
    };
  });

  return { sectionKey: 'litigation', fields: {}, rows };
}
