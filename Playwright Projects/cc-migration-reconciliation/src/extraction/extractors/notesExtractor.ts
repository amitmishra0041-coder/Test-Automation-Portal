import { ExtractionContext } from '../ExtractionContext';
import { NoteData } from '../../models/ContentData';
import { FieldObservation, ok, notPresent } from '../FieldObservation';
import { readAllPages } from '../pagination';
import { fixPartyLabelSpacing } from '../../normalization/normalizers/stringNormalizer';

/**
 * ON-PREM: CONFIRMED 2026-08-20 — live pass against a real note on
 * PA-GA-10-20-0000016 (`ClaimNotesLV:<row>:<field>`, a repeating
 * id-addressed card, not a plain `.x-grid-row` table — see NoteData's doc
 * comment). CLOUD: id pattern inferred by the same convention every other
 * grid this session uses (`ClaimNotesLV-<row>-<field>`) — no cloud test
 * claim had a real note, so this is UNVALIDATED against real cloud data.
 */
function mapColumnKey(raw: string): string | null {
  switch (raw) {
    case 'Author': return 'Author';
    case 'Topic': return 'Topic';
    case 'RelatedTo': return 'RelatedTo';
    case 'AuthoringDate': return 'AuthoringDate';
    case 'Body': return 'Body';
    default: return null;
  }
}

async function readOnPrem(ctx: ExtractionContext): Promise<Record<string, string>[]> {
  return readAllPages(ctx.page, 'onprem', 'ClaimNotesLV', () => ctx.page.evaluate(() => {
    const rows: Record<string, Record<string, string>> = {};
    for (const el of Array.from(document.querySelectorAll('[id*="ClaimNotesLV:"]'))) {
      const m = el.id.match(/ClaimNotesLV:(\d+):([A-Za-z]+)$/);
      if (!m) continue;
      const [, idx, col] = m;
      if (col === 'EditLink' || col === 'PrintLink' || col.startsWith('SpacerLink')) continue;
      const text = ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      rows[idx] = rows[idx] || {};
      rows[idx][col] = text;
    }
    return Object.keys(rows).sort((a, b) => Number(a) - Number(b)).map((k) => rows[k]);
  }).catch(() => []));
}

async function readCloud(ctx: ExtractionContext): Promise<Record<string, string>[]> {
  return readAllPages(ctx.page, 'cloud', 'ClaimNotesLV', () => ctx.page.evaluate(() => {
    const rows: Record<string, Record<string, string>> = {};
    for (const el of Array.from(document.querySelectorAll('[id*="ClaimNotesLV-"]'))) {
      const m = el.id.match(/ClaimNotesLV-(\d+)-([A-Za-z]+)$/);
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

export async function extractNotes(ctx: ExtractionContext): Promise<NoteData[]> {
  const rawRows = ctx.environment === 'onprem' ? await readOnPrem(ctx) : await readCloud(ctx);

  return rawRows.map((row) => {
    const canonical: Record<string, string> = {};
    for (const [rawKey, text] of Object.entries(row)) {
      const mapped = mapColumnKey(rawKey);
      if (mapped) canonical[mapped] = text;
    }
    // On-prem-only template quirk — see fixPartyLabelSpacing's doc comment.
    if (canonical.RelatedTo) canonical.RelatedTo = fixPartyLabelSpacing(canonical.RelatedTo) ?? canonical.RelatedTo;

    const field = (name: string, fieldLabel: string, type: FieldObservation['type'] = 'string'): FieldObservation => {
      const text = canonical[name];
      const path = `claim.notes[].${name}`;
      const base = { path, field: fieldLabel, type, environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Notes' };
      return text
        ? ok({ ...base, value: text, rawText: text })
        : notPresent(base, `TODO: "${fieldLabel}" not found in this row's captured columns`);
    };

    const author = field('Author', 'Author');
    const subject = field('Topic', 'Topic');
    const createdDate = field('AuthoringDate', 'Authoring Date', 'date');

    return {
      businessKey: `${author.value}|${subject.value}|${createdDate.value}`,
      noteType: notPresent(
        { path: 'claim.notes[].noteType', field: 'Note Type', type: 'string', environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Notes' },
        'No distinct "type" field confirmed on the Notes card on either platform — see subject (Topic) instead',
      ),
      subject,
      body: field('Body', 'Body'),
      author,
      createdDate,
      relatedTo: field('RelatedTo', 'Related To'),
    };
  });
}
