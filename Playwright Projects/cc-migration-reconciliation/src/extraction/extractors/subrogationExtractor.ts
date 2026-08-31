import { ExtractionContext } from '../ExtractionContext';
import { SectionRecord, SectionRow } from '../../models/common';
import { FieldObservation, ok, notPresent } from '../FieldObservation';
import { readDynamicFields } from '../genericFieldReader';
import { readAllPages } from '../pagination';

/**
 * CONFIRMED, both platforms — live pass against the "Subrogation" nav
 * item's default "Summary" sub-page: a General field block (label→value,
 * read dynamically via readDynamicFields — see lossDetailsExtractor's doc
 * comment for why a hardcoded label list isn't used) plus a "Responsible
 * Parties" grid (`EditableAdverseGeneralLV`, same header-text/id-addressed-
 * cell pattern as Documents/Workplan/Litigation). Both test claims had zero
 * responsible parties, so the grid's STRUCTURE is confirmed but row-level
 * parsing is not validated against real data — see navigationCatalog.ts's
 * 'partial' status note for this key.
 */

function mapColumnKey(raw: string): string | null {
  const key = raw.replace(/\s+/g, '');
  switch (key) {
    case 'Party':
    case 'AdverseParty': return 'Party';
    case 'Classification':
    case 'Classification1': return 'Classification';
    case 'Strategy':
    case 'Strategy1': return 'Strategy';
    case 'Liability%':
    case 'LiabilityPercentage': return 'LiabilityPct';
    case 'ExpectedRecovery%':
    case 'ExpectedRecoveryPercentage': return 'ExpectedRecoveryPct';
    case 'ExpectedRecovery': return 'ExpectedRecovery';
    case 'Recovered': return 'Recovered';
    case 'PendingRecovery':
    case 'Pending': return 'PendingRecovery';
    default: return null;
  }
}

async function readGridOnPrem(ctx: ExtractionContext): Promise<Record<string, string>[]> {
  return readAllPages(ctx.page, 'onprem', 'EditableAdverseGeneralLV', () => ctx.page.evaluate(() => {
    // Find the real grid panel by id+visibility alone — NOT requiring it to
    // already contain rows (a real, empty grid still exists in the DOM and
    // must be told apart from "not on this page at all"). Falling back to
    // `document` for either headers or rows scrapes the left-nav tree
    // instead — it renders as `tr.x-grid-row` too, confirmed live
    // 2026-08-20 on a claim with zero real documents (same bug, different
    // grid — see documentsExtractor.ts).
    const grid = document.querySelector('[id$=":EditableAdverseGeneralLV"]')
      || Array.from(document.querySelectorAll('[id*="EditableAdverseGeneralLV"]')).find((g) => (g as HTMLElement).offsetParent)
      || null;
    if (!grid) return [];

    const headers = Array.from(grid.querySelectorAll('.x-column-header-text'))
      .map((h) => (h.textContent || '').trim()).filter(Boolean);

    const out: Record<string, string>[] = [];
    for (const row of Array.from(grid.querySelectorAll('tr.x-grid-row'))) {
      if (!(row as HTMLElement).offsetParent) continue;
      const cells = Array.from(row.querySelectorAll('.x-grid-cell')).map((c) => ((c as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim());
      if (!cells.some(Boolean)) continue;
      // The grid renders a "Claim Total:" summary footer as its own
      // .x-grid-row (confirmed live 2026-08-20) — not a real responsible
      // party, so it must not become a fake row with businessKey "Claim Total:".
      if (cells.some((c) => /total:?$/i.test(c))) continue;
      const rec: Record<string, string> = {};
      const offset = cells.length - headers.length;
      headers.forEach((h, i) => {
        const v = cells[i + (offset > 0 ? offset : 0)];
        if (v) rec[h.replace(/\s+/g, '')] = v;
      });
      if (Object.keys(rec).length) out.push(rec);
    }
    return out;
  }).catch(() => []));
}

async function readGridCloud(ctx: ExtractionContext): Promise<Record<string, string>[]> {
  return readAllPages(ctx.page, 'cloud', 'EditableAdverseGeneralLV', () => ctx.page.evaluate(() => {
    const rows: Record<string, Record<string, string>> = {};
    for (const el of Array.from(document.querySelectorAll('[id*="EditableAdverseGeneralLV-"]'))) {
      const m = el.id.match(/EditableAdverseGeneralLV-(\d+)-([A-Za-z0-9]+)$/);
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

export async function extractSubrogation(ctx: ExtractionContext): Promise<SectionRecord> {
  const fields = await readDynamicFields(ctx, 'Subrogation', 'claim.specialty.subrogation.fields');

  const rawRows = ctx.environment === 'onprem' ? await readGridOnPrem(ctx) : await readGridCloud(ctx);
  const rows: SectionRow[] = rawRows.map((row) => {
    const canonical: Record<string, string> = {};
    for (const [rawKey, text] of Object.entries(row)) {
      const mapped = mapColumnKey(rawKey);
      if (mapped) canonical[mapped] = text;
    }
    const rowField = (name: string, fieldLabel: string, type: FieldObservation['type'] = 'string'): FieldObservation => {
      const text = canonical[name];
      const path = `claim.specialty.subrogation.rows[].${name}`;
      const base = { path, field: fieldLabel, type, environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Subrogation' };
      return text
        ? ok({ ...base, value: text, rawText: text })
        : notPresent(base, `TODO: "${fieldLabel}" not found in this row's captured columns`);
    };
    const party = rowField('Party', 'Party');
    return {
      businessKey: `${party.value}`,
      party,
      classification: rowField('Classification', 'Classification'),
      strategy: rowField('Strategy', 'Strategy'),
      liabilityPct: rowField('LiabilityPct', 'Liability %'),
      expectedRecoveryPct: rowField('ExpectedRecoveryPct', 'Expected Recovery %'),
      expectedRecovery: rowField('ExpectedRecovery', 'Expected Recovery', 'currency'),
      recovered: rowField('Recovered', 'Recovered', 'currency'),
      pendingRecovery: rowField('PendingRecovery', 'Pending Recovery', 'currency'),
    };
  });

  return {
    sectionKey: 'subrogation',
    fields,
    rows,
  };
}
