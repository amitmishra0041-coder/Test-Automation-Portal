import { ExtractionContext } from '../ExtractionContext';
import { HistoryEventData } from '../../models/ContentData';
import { FieldObservation, ok, notPresent } from '../FieldObservation';
import { readAllPages } from '../pagination';
import { fixPartyLabelSpacing } from '../../normalization/normalizers/stringNormalizer';

/**
 * CONFIRMED, both platforms 2026-08-20 — live pass against the "History"
 * nav item (`HistoryLV` grid — the real per-event audit trail: Type,
 * Related To, User, Event Time Stamp, Description, Link). This is a
 * DIFFERENT page from "Claim History" (`PriorClaimHistoryLV`, other claims
 * by the insured) — the two nav labels are easy to confuse and were
 * confirmed live to be genuinely different content on both platforms; see
 * clickNavItem.ts's doc comment for the substring-matching bug that once
 * made them look identical. 8 real rows confirmed on-prem (WC test claim),
 * so row-level parsing IS validated against real data, unlike most other
 * sections built this session.
 */
function mapColumnKey(raw: string): string | null {
  const key = raw.replace(/\s+/g, '');
  switch (key) {
    case 'Type': return 'Type';
    case 'RelatedTo': return 'RelatedTo';
    case 'User': return 'User';
    case 'EventTimeStamp': return 'EventTimeStamp';
    case 'Description': return 'Description';
    case 'Link': return 'Link';
    default: return null;
  }
}

async function readOnPrem(ctx: ExtractionContext): Promise<Record<string, string>[]> {
  // "ClaimHistoryScreen:HistoryLV", not bare "HistoryLV" — the latter is
  // also a substring of "PriorClaimHistoryLV" (the different "Claim
  // History" grid this extractor deliberately does NOT read, see the grid-
  // finder's own exclusion below), which would make the pagination click
  // hit the same substring-collision bug just fixed in pagination.ts.
  return readAllPages(ctx.page, 'onprem', 'ClaimHistoryScreen:HistoryLV', () => ctx.page.evaluate(() => {
    const grid = document.querySelector('[id$=":HistoryLV"]')
      || Array.from(document.querySelectorAll('[id*="HistoryLV"]')).find((g) => (g as HTMLElement).offsetParent && !/PriorClaimHistoryLV/.test(g.id))
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
      if (!('Type' in rec)) continue;
      if (Object.keys(rec).length) out.push(rec);
    }
    return out;
  }).catch(() => []));
}

async function readCloud(ctx: ExtractionContext): Promise<Record<string, string>[]> {
  return readAllPages(ctx.page, 'cloud', 'ClaimHistoryScreen-HistoryLV', () => ctx.page.evaluate(() => {
    const rows: Record<string, Record<string, string>> = {};
    for (const el of Array.from(document.querySelectorAll('[id*="HistoryLV-"]'))) {
      const m = el.id.match(/HistoryLV-(\d+)-([A-Za-z]+)$/);
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

export async function extractHistory(ctx: ExtractionContext): Promise<HistoryEventData[]> {
  const rawRows = ctx.environment === 'onprem' ? await readOnPrem(ctx) : await readCloud(ctx);

  return rawRows.map((row) => {
    const canonical: Record<string, string> = {};
    for (const [rawKey, text] of Object.entries(row)) {
      const mapped = mapColumnKey(rawKey);
      if (mapped) canonical[mapped] = text;
    }
    // On-prem-only template quirk — see fixPartyLabelSpacing's doc comment.
    // RelatedTo also feeds this row's businessKey below, so a missing space
    // here doesn't just show as a field diff — it corrupts row-matching.
    if (canonical.RelatedTo) canonical.RelatedTo = fixPartyLabelSpacing(canonical.RelatedTo) ?? canonical.RelatedTo;

    const field = (name: string, fieldLabel: string, type: FieldObservation['type'] = 'string'): FieldObservation => {
      const text = canonical[name];
      const path = `claim.history[].${name}`;
      const base = { path, field: fieldLabel, type, environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'History' };
      return text
        ? ok({ ...base, value: text, rawText: text })
        : notPresent(base, `TODO: "${fieldLabel}" not found in this row's captured columns`);
    };

    const type = field('Type', 'Type');
    const relatedTo = field('RelatedTo', 'Related To');
    const user = field('User', 'User');
    const eventTimeStamp = field('EventTimeStamp', 'Event Time Stamp', 'date');

    return {
      businessKey: `${type.value}|${relatedTo.value}|${user.value}|${eventTimeStamp.value}`,
      type,
      relatedTo,
      user,
      eventTimeStamp,
      description: field('Description', 'Description'),
      link: field('Link', 'Link'),
    };
  });
}
