import { Page } from '@playwright/test';
import { readAllPages } from './pagination';

/**
 * Shared on-prem/cloud grid reader — the same pattern hand-copied into
 * documentsExtractor/litigationExtractor/partiesExtractor/workplanExtractor/
 * transactionsExtractor/subrogationExtractor/exposuresExtractor/
 * historyExtractor/notesExtractor before this file existed. Extracted here
 * once there were too many copies to keep safely in sync — new grid
 * extractors should call this instead of re-copying the pattern.
 *
 * On-prem: finds the grid panel by id+visibility alone — NOT requiring it
 * to already contain rows (a real, empty grid still exists in the DOM and
 * must be told apart from "not on this page at all"). Falling back to
 * `document` for either headers or rows scrapes the left-nav tree instead
 * — it renders as `tr.x-grid-row` too, confirmed live 2026-08-20 on
 * several claims with zero real rows in a given grid.
 * Cloud: id-addressed cells `<idSubstring>-<row>-<col>`.
 *
 * Both readers page through EVERY page of the grid (see pagination.ts) —
 * confirmed live 2026-08-21 that both platforms paginate large grids (a
 * "Planned Activities"/Workplan grid with enough rows shows "Page 1 of 2"
 * on-prem and a real Jutro "Next" control on cloud); reading only the
 * first page would silently undercount rows on any claim with more data
 * than fits on one page.
 */
async function readOnePageOnPrem(page: Page, idSubstring: string): Promise<Record<string, string>[]> {
  return page.evaluate((sub) => {
    const grid = document.querySelector(`[id$=":${sub}"]`)
      || Array.from(document.querySelectorAll(`[id*="${sub}"]`)).find((g) => (g as HTMLElement).offsetParent)
      || null;
    if (!grid) return [];

    const headers = Array.from(grid.querySelectorAll('.x-column-header-text'))
      .map((h) => (h.textContent || '').trim()).filter(Boolean);

    const out: Record<string, string>[] = [];
    for (const row of Array.from(grid.querySelectorAll('tr.x-grid-row'))) {
      if (!(row as HTMLElement).offsetParent) continue;
      // Canonicalizes spacing around commas ("A,B" / "A , B" / "A,  B" all
      // become "A, B") in addition to collapsing whitespace runs — confirmed
      // live 2026-08-27 on Loss Details: Associations, where a comma-joined
      // multi-value cell renders with NO space around the comma on-prem but
      // WITH one on cloud, splitting one real row's businessKey into a false
      // EXTRA_ON_PREM + NEW_IN_CLOUD pair instead of matching it. Safe for
      // grid cell text generally — structured grid data doesn't depend on
      // exact comma spacing for meaning.
      const cells = Array.from(row.querySelectorAll('.x-grid-cell')).map((c) => ((c as HTMLElement).innerText || '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim());
      if (!cells.some(Boolean)) continue;
      const rec: Record<string, string> = {};
      const offset = cells.length - headers.length;
      headers.forEach((h, i) => {
        const v = cells[i + (offset > 0 ? offset : 0)];
        if (v) rec[h.replace(/\s+/g, '')] = v;
      });
      if (Object.keys(rec).length) out.push(rec);
    }
    return out;
  }, idSubstring).catch(() => []);
}

async function readOnePageCloud(page: Page, idSubstring: string): Promise<Record<string, string>[]> {
  return page.evaluate((sub) => {
    const rows: Record<string, Record<string, string>> = {};
    const re = new RegExp(`${sub}-(\\d+)-([A-Za-z]+)$`);
    for (const el of Array.from(document.querySelectorAll(`[id*="${sub}-"]`))) {
      const m = el.id.match(re);
      if (!m || !(el as HTMLElement).offsetParent) continue;
      const [, idx, col] = m;
      const text = ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
      if (!text) continue;
      rows[idx] = rows[idx] || {};
      rows[idx][col] = text;
    }
    return Object.keys(rows).sort((a, b) => Number(a) - Number(b)).map((k) => rows[k]);
  }, idSubstring).catch(() => []);
}

export async function readGridOnPrem(page: Page, idSubstring: string): Promise<Record<string, string>[]> {
  return readAllPages(page, 'onprem', idSubstring, () => readOnePageOnPrem(page, idSubstring));
}

export async function readGridCloud(page: Page, idSubstring: string): Promise<Record<string, string>[]> {
  return readAllPages(page, 'cloud', idSubstring, () => readOnePageCloud(page, idSubstring));
}

export async function readGrid(page: Page, environment: 'onprem' | 'cloud', idSubstring: string): Promise<Record<string, string>[]> {
  return environment === 'onprem' ? readGridOnPrem(page, idSubstring) : readGridCloud(page, idSubstring);
}
