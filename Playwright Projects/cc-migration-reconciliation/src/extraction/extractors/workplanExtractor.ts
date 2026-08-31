import { ExtractionContext } from '../ExtractionContext';
import { WorkplanItemData } from '../../models/ActivityData';
import { FieldObservation, ok, notPresent } from '../FieldObservation';
import { readAllPages } from '../pagination';
import { fixPartyLabelSpacing } from '../../normalization/normalizers/stringNormalizer';

/**
 * CONFIRMED, both platforms — live pass against the "Workplan" grid
 * (`WorkplanLV`). Same on-prem header-text / cloud id-addressed-cell
 * pattern as exposuresExtractor and transactionsExtractor; mapColumnKey
 * reconciles on-prem's header TEXT ("Due", "Assigned By") against cloud's
 * grid-internal column NAMES ("DueDate", "Assigner").
 */
function mapColumnKey(raw: string): string | null {
  const key = raw.replace(/\s+/g, '');
  switch (key) {
    case 'Due':
    case 'DueDate': return 'DueDate';
    case 'Priority': return 'Priority';
    case 'Status': return 'Status';
    case 'Subject': return 'Subject';
    case 'Description': return 'Description';
    case 'Exposures':
    case 'Exposure': return 'Exposure';
    case 'AssignedBy':
    case 'Assigner': return 'AssignedBy';
    case 'AssignedTo':
    case 'AssignedUser': return 'AssignedTo';
    default: return null;
  }
}

async function readOnPrem(ctx: ExtractionContext): Promise<Record<string, string>[]> {
  return readAllPages(ctx.page, 'onprem', 'WorkplanLV', () => ctx.page.evaluate(() => {
    // Find the real grid panel by id+visibility alone — NOT requiring it to
    // already contain rows (a real, empty grid still exists in the DOM and
    // must be told apart from "not on this page at all"). Falling back to
    // `document` for either headers or rows scrapes the left-nav tree
    // instead — it renders as `tr.x-grid-row` too, confirmed live
    // 2026-08-20 on a claim with zero real documents (same bug, different
    // grid — see documentsExtractor.ts).
    const grid = document.querySelector('[id$=":WorkplanLV"]')
      || Array.from(document.querySelectorAll('[id*="WorkplanLV"]')).find((g) => (g as HTMLElement).offsetParent)
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
      if (!('Subject' in rec && 'Status' in rec)) continue;
      if (Object.keys(rec).length) out.push(rec);
    }
    return out;
  }).catch(() => []));
}

async function readCloud(ctx: ExtractionContext): Promise<Record<string, string>[]> {
  return readAllPages(ctx.page, 'cloud', 'WorkplanLV', () => ctx.page.evaluate(() => {
    const rows: Record<string, Record<string, string>> = {};
    for (const el of Array.from(document.querySelectorAll('[id*="WorkplanLV-"]'))) {
      const m = el.id.match(/WorkplanLV-(\d+)-([A-Za-z]+)$/);
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

export async function extractWorkplan(ctx: ExtractionContext): Promise<WorkplanItemData[]> {
  const rawRows = ctx.environment === 'onprem' ? await readOnPrem(ctx) : await readCloud(ctx);

  return rawRows.map((row) => {
    const canonical: Record<string, string> = {};
    for (const [rawKey, text] of Object.entries(row)) {
      const mapped = mapColumnKey(rawKey);
      if (mapped) canonical[mapped] = text;
    }
    // On-prem-only template quirk — see fixPartyLabelSpacing's doc comment.
    // Confirmed live 2026-08-27 on a 35-claim batch: this Exposure column
    // showed the identical "1st PartyVehicle" (no space) vs "1st Party
    // Vehicle" pattern already fixed in Transactions/History/Notes, just
    // not yet here.
    if (canonical.Exposure) canonical.Exposure = fixPartyLabelSpacing(canonical.Exposure) ?? canonical.Exposure;

    const field = (name: string, fieldLabel: string, type: FieldObservation['type'] = 'string'): FieldObservation => {
      const text = canonical[name];
      const path = `claim.workplan[].${name}`;
      const base = { path, field: fieldLabel, type, environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Workplan' };
      return text
        ? ok({ ...base, value: text, rawText: text })
        : notPresent(base, `TODO: "${fieldLabel}" not found in this row's captured columns`);
    };

    const subject = field('Subject', 'Subject');
    const dueDate = field('DueDate', 'Due Date', 'date');
    const assignedTo = field('AssignedTo', 'Assigned To');

    const data: WorkplanItemData = {
      // Subject + Due Date only — NOT Assigned To. Migration commonly
      // reassigns activities from a named individual to a queue/department
      // (e.g. "Kevin Burke" -> "FNOL - Bodily Injury Claims Division"),
      // which is a real, reportable difference but not a different
      // activity. Keying on Assigned To as well (the old behavior) made
      // every reassigned activity match nothing on either side, reporting
      // "entire activity missing" instead of "same activity, different
      // assignee" — confirmed live 2026-08-25.
      businessKey: `${subject.value}|${dueDate.value}`,
      itemType: notPresent(
        { path: 'claim.workplan[].itemType', field: 'Item Type', type: 'string', environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Workplan' },
        'No confirmed "type" column on the Workplan grid on either platform',
      ),
      subject,
      description: field('Description', 'Description'),
      status: field('Status', 'Status'),
      priority: field('Priority', 'Priority'),
      dueDate,
      assignedBy: field('AssignedBy', 'Assigned By'),
      assignedTo,
      exposure: field('Exposure', 'Exposure'),
    };
    return data;
  });
}
