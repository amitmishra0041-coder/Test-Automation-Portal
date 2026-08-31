import { ExtractionContext } from '../ExtractionContext';
import { PartyData, ContactData } from '../../models/PartyData';
import { FieldObservation, ok, notPresent } from '../FieldObservation';
import { normalizeBoolean } from '../../normalization/normalizers/booleanNormalizer';
import { readAllPages } from '../pagination';
import { readAllContactDetails } from './contactDetailExtractor';
import { clickNavItem } from '../../navigation/clickNavItem';

/**
 * CONFIRMED, both platforms — live pass against "Parties Involved" →
 * "Contacts" (`PeopleInvolvedDetailedLV`). On-prem labels columns by header
 * TEXT ("Contact Prohibited?", "ZIP Code"); cloud labels the same columns
 * by grid-internal NAME ("ContactProhibited", "PostalCode", "Phone_Work").
 */
function mapColumnKey(raw: string): string | null {
  const key = raw.replace(/\s+/g, '');
  switch (key) {
    case 'Name': return 'Name';
    case 'Roles': return 'Roles';
    case 'ContactProhibited?':
    case 'ContactProhibited': return 'ContactProhibited';
    case 'Phone':
    case 'Phone_Work': return 'Phone';
    case 'Address': return 'Address';
    case 'City': return 'City';
    case 'State': return 'State';
    case 'ZIPCode':
    case 'PostalCode': return 'Zip';
    default: return null;
  }
}

async function readOnPrem(ctx: ExtractionContext): Promise<Record<string, string>[]> {
  return readAllPages(ctx.page, 'onprem', 'PeopleInvolvedDetailedLV', () => ctx.page.evaluate(() => {
    // Find the real grid panel by id+visibility alone — NOT requiring it to
    // already contain rows (a real, empty grid still exists in the DOM and
    // must be told apart from "not on this page at all"). Falling back to
    // `document` for either headers or rows scrapes the left-nav tree
    // instead — it renders as `tr.x-grid-row` too, confirmed live
    // 2026-08-20 on a claim with zero real documents (same bug, different
    // grid — see documentsExtractor.ts).
    const grid = document.querySelector('[id$=":PeopleInvolvedDetailedLV"]')
      || Array.from(document.querySelectorAll('[id*="PeopleInvolvedDetailedLV"]')).find((g) => (g as HTMLElement).offsetParent)
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
  return readAllPages(ctx.page, 'cloud', 'PeopleInvolvedDetailedLV', () => ctx.page.evaluate(() => {
    const rows: Record<string, Record<string, string>> = {};
    for (const el of Array.from(document.querySelectorAll('[id*="PeopleInvolvedDetailedLV-"]'))) {
      const m = el.id.match(/PeopleInvolvedDetailedLV-(\d+)-([A-Za-z_]+)$/);
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

async function readRawRows(ctx: ExtractionContext): Promise<Record<string, string>[]> {
  return ctx.environment === 'onprem' ? readOnPrem(ctx) : readCloud(ctx);
}

function canonicalize(row: Record<string, string>): Record<string, string> {
  const canonical: Record<string, string> = {};
  for (const [rawKey, text] of Object.entries(row)) {
    const mapped = mapColumnKey(rawKey);
    if (mapped) canonical[mapped] = text;
  }
  return canonical;
}

/**
 * readAllContactDetails reads each contact's detail panel in THIS
 * PLATFORM'S OWN on-screen row order and zips it to `rawRows` by raw array
 * position — not by any cross-platform (or even same-platform) identity.
 * Confirmed live 2026-08-27 as a real bug, not hypothetical: a single
 * mid-loop row-select/tab-click failure (readOneContactDetail already logs
 * a warning and continues rather than aborting — see that function) shifts
 * every detail record AFTER it by one slot, so one contact's Basics/
 * Addresses data renders under a COMPLETELY DIFFERENT contact's row (e.g. a
 * vendor's Basics.Name showing up compared against a claimant's) even
 * though the row-level businessKey match (grid Name+Role) is itself
 * correct — because the shift can happen independently per platform, it
 * doesn't even need to land on the same row on both sides. Re-associating
 * each row's detail by the contact's OWN Basics.Name (already captured
 * inside the detail panel) instead of trusting position closes this. Falls
 * back to the old positional zip only when no confident, not-already-used
 * name match exists, so a row that genuinely lacks Basics.Name (or shares a
 * name with another row) never regresses below current behavior.
 */
function associateDetails(
  rawRows: Record<string, string>[],
  details: Record<string, FieldObservation>[],
): Record<string, FieldObservation>[] {
  const used = new Set<number>();
  return rawRows.map((row, rowIndex) => {
    const wantName = (row.Name ?? '').trim().toUpperCase();
    if (wantName) {
      const foundIndex = details.findIndex((d, j) => {
        if (used.has(j)) return false;
        const detailName = ((d['Basics.Name']?.value as string | null | undefined) ?? '').trim().toUpperCase();
        return detailName !== '' && detailName === wantName;
      });
      if (foundIndex !== -1) {
        used.add(foundIndex);
        return details[foundIndex];
      }
    }
    return details[rowIndex] ?? {};
  });
}

export async function extractParties(ctx: ExtractionContext): Promise<PartyData[]> {
  const rawRows = await readRawRows(ctx);

  // The flat-list read above (readAllPages) leaves the grid on its LAST
  // page — re-navigate to reset to page 1 before walking rows for detail.
  // See contactDetailExtractor.ts's doc comment for why this is a SEPARATE
  // pass rather than folded into the list read above.
  let details: Record<string, FieldObservation>[] = [];
  if (rawRows.length > 0) {
    await clickNavItem(ctx.page, 'Parties Involved', 'extractParties.detail');
    await ctx.page.waitForTimeout(600);
    await clickNavItem(ctx.page, 'Contacts', 'extractParties.detail');
    await ctx.page.waitForTimeout(1000);
    details = await readAllContactDetails(ctx, rawRows.length, 'Parties Involved', rawRows.map((r) => r.Name ?? null));

    // readAllContactDetails leaves the page on the LAST contact's detail
    // sub-panel (whichever tab it last clicked), not back on the flat
    // Contacts grid or the main claim view. Every section that runs after
    // 'parties' in navigationCatalog.ts just calls clickNavItem for its own
    // target and reads whatever's on screen — if that click doesn't
    // genuinely leave this stuck detail view, the section reads the
    // contact's leftover fields under its own name instead. Confirmed live
    // 2026-08-25: Reinsurance/FNOL Snapshot/Calendar's report entries were
    // all showing the SAME contact-detail field set (Mainframe Name, SPA
    // Status, Tax ID (EIN), …) rather than their own page's content.
    // Resetting back to the flat Contacts grid here — the same known-good
    // state this function starts from — closes that gap at the source.
    await clickNavItem(ctx.page, 'Parties Involved', 'extractParties.reset');
    await ctx.page.waitForTimeout(600);
    await clickNavItem(ctx.page, 'Contacts', 'extractParties.reset');
    await ctx.page.waitForTimeout(600);
  }

  const detailForRow = associateDetails(rawRows, details);

  return rawRows.map((row, rowIndex) => {
    const canonical = canonicalize(row);

    const field = (name: string, fieldLabel: string, type: FieldObservation['type'] = 'string'): FieldObservation => {
      const text = canonical[name];
      const path = `claim.parties[].${name}`;
      const base = { path, field: fieldLabel, type, environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Parties' };
      return text
        ? ok({ ...base, value: text, rawText: text })
        : notPresent(base, `TODO: "${fieldLabel}" not found in this row's captured columns`);
    };

    const name = field('Name', 'Name');
    const role = field('Roles', 'Role');
    const cpText = canonical['ContactProhibited'];
    const cpPath = 'claim.parties[].ContactProhibited';
    const cpBase = { path: cpPath, field: 'Contact Prohibited?', type: 'boolean' as const, environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Parties' };

    const data: PartyData = {
      businessKey: `${name.value}|${role.value}`,
      name,
      role,
      address: field('Address', 'Address'),
      city: field('City', 'City'),
      state: field('State', 'State'),
      zip: field('Zip', 'Zip'),
      phone: field('Phone', 'Phone'),
      email: notPresent(
        { path: 'claim.parties[].email', field: 'Email', type: 'string', environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Parties' },
        'Not a column on the summary grid — the real value (if any) is under detail["Basics.Main"/"Basics.Alternate"], captured separately below',
      ),
      detail: detailForRow[rowIndex] ?? {},
      contactProhibited: cpText
        ? ok({ ...cpBase, value: normalizeBoolean(cpText), rawText: cpText })
        : notPresent(cpBase, 'TODO: "Contact Prohibited?" not found in this row\'s captured columns'),
    };
    return data;
  });
}

/** Same confirmed grid as extractParties — see PartyData/ContactData's shared doc comment for why there's no separate "Contacts" data source. */
export async function extractContacts(ctx: ExtractionContext): Promise<ContactData[]> {
  const rawRows = await readRawRows(ctx);

  return rawRows.map((row) => {
    const canonical = canonicalize(row);

    const field = (name: string, fieldLabel: string): FieldObservation => {
      const text = canonical[name];
      const path = `claim.contacts[].${name}`;
      const base = { path, field: fieldLabel, type: 'string' as const, environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Contacts' };
      return text
        ? ok({ ...base, value: text, rawText: text })
        : notPresent(base, `TODO: "${fieldLabel}" not found in this row's captured columns`);
    };

    const name = field('Name', 'Name');
    const contactType = field('Roles', 'Contact Type');

    const data: ContactData = {
      businessKey: `${name.value}|${contactType.value}`,
      name,
      contactType,
      relatedTo: notPresent(
        { path: 'claim.contacts[].relatedTo', field: 'Related To', type: 'string', environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Contacts' },
        'Not shown on the Parties/Contacts grid on either platform',
      ),
    };
    return data;
  });
}
