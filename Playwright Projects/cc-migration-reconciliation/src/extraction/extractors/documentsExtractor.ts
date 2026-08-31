import { ExtractionContext } from '../ExtractionContext';
import { DocumentData } from '../../models/ContentData';
import { FieldObservation, ok, notPresent } from '../FieldObservation';
import { readAllPages } from '../pagination';

/**
 * CONFIRMED, both platforms — live pass against the "Documents" grid
 * (`DocumentsLV`). On-prem labels columns by header TEXT ("Document
 * Description", "Document Type", "Document Date"); cloud labels the same
 * columns by grid-internal NAME ("Name", "Type", "DateModified").
 * `relatedTo` stays NOT_PRESENT — "Related To" only appears as a search
 * filter above the grid, not as a grid column, on either platform.
 */
function mapColumnKey(raw: string): string | null {
  const key = raw.replace(/\s+/g, '');
  switch (key) {
    case 'DocumentDescription':
    case 'Name': return 'Name';
    case 'DocumentType':
    case 'Type': return 'Type';
    case 'Status': return 'Status';
    case 'Author': return 'Author';
    case 'DocumentDate':
    case 'DateModified': return 'Date';
    default: return null;
  }
}

// Both readers page through EVERY page of the grid (readAllPages, see
// pagination.ts) — confirmed live 2026-08-21 that both platforms paginate
// large grids; reading only the first page would silently undercount rows
// on any claim with more documents than fit on one page.
async function readOnPrem(ctx: ExtractionContext): Promise<Record<string, string>[]> {
  return readAllPages(ctx.page, 'onprem', 'DocumentsLV', () => ctx.page.evaluate(() => {
    // Find the real grid panel by id+visibility alone — NOT requiring it to
    // already contain rows (a real, empty grid still exists in the DOM and
    // must be told apart from "not on this page at all"). Falling back to
    // `document` for either headers or rows scrapes the left-nav tree
    // instead — it renders as `tr.x-grid-row` too, confirmed live
    // 2026-08-20 on a claim with zero real documents.
    const grid = document.querySelector('[id$=":DocumentsLV"]')
      || Array.from(document.querySelectorAll('[id*="DocumentsLV"]')).find((g) => (g as HTMLElement).offsetParent)
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
      if (!('DocumentDescription' in rec)) continue;
      if (Object.keys(rec).length) out.push(rec);
    }
    return out;
  }).catch(() => []));
}

async function readCloud(ctx: ExtractionContext): Promise<Record<string, string>[]> {
  return readAllPages(ctx.page, 'cloud', 'DocumentsLV', () => ctx.page.evaluate(() => {
    const rows: Record<string, Record<string, string>> = {};
    for (const el of Array.from(document.querySelectorAll('[id*="DocumentsLV-"]'))) {
      const m = el.id.match(/DocumentsLV-(\d+)-([A-Za-z]+)$/);
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

export async function extractDocuments(ctx: ExtractionContext): Promise<DocumentData[]> {
  const rawRows = ctx.environment === 'onprem' ? await readOnPrem(ctx) : await readCloud(ctx);

  return rawRows.map((row) => {
    const canonical: Record<string, string> = {};
    for (const [rawKey, text] of Object.entries(row)) {
      const mapped = mapColumnKey(rawKey);
      if (mapped) canonical[mapped] = text;
    }

    const field = (name: string, fieldLabel: string, type: FieldObservation['type'] = 'string'): FieldObservation => {
      const text = canonical[name];
      const path = `claim.documents[].${name}`;
      const base = { path, field: fieldLabel, type, environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Documents' };
      return text
        ? ok({ ...base, value: text, rawText: text })
        : notPresent(base, `TODO: "${fieldLabel}" not found in this row's captured columns`);
    };

    const documentName = field('Name', 'Document Description');
    const documentType = field('Type', 'Document Type');
    const documentDate = field('Date', 'Document Date', 'date');

    const data: DocumentData = {
      businessKey: `${documentName.value}|${documentType.value}|${documentDate.value}`,
      documentName,
      documentType,
      status: field('Status', 'Status'),
      documentDate,
      relatedTo: notPresent(
        { path: 'claim.documents[].relatedTo', field: 'Related To', type: 'string', environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Documents' },
        '"Related To" is a search filter above the grid, not a grid column, on either platform',
      ),
      metadata: {
        author: field('Author', 'Author'),
      },
    };
    return data;
  });
}
