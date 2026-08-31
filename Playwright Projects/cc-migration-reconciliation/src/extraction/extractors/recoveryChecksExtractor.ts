import { ExtractionContext } from '../ExtractionContext';
import { RecoveryCheckData } from '../../models/FinancialsData';
import { FieldObservation, ok, notPresent } from '../FieldObservation';
import { normalizeCurrency } from '../../normalization/normalizers/currencyNormalizer';

/**
 * CONFIRMED, both platforms 2026-08-20 — live pass against "Financials >
 * Recovery Checks" (a distinct nested nav item under Financials, same
 * 2-step reach pattern as Transactions/Checks-Payments). Columns confirmed
 * live on both platforms: Payer, Payer Check Number, Gross Amount, Status,
 * Comments, Received Date. Both test claims had zero rows (no recovery
 * posted yet), so row-level parsing is structurally confirmed but not
 * validated against real data. On-prem's grid id is "RecoveryChecksExtLV"
 * (not "RecoveryChecksLV") — confirmed live, not a typo.
 */
function mapColumnKey(raw: string): string | null {
  const key = raw.replace(/\s+/g, '');
  switch (key) {
    case 'Payer': return 'Payer';
    case 'PayerCheckNumber': return 'PayerCheckNumber';
    case 'GrossAmount': return 'GrossAmount';
    case 'Status': return 'Status';
    case 'Comments': return 'Comments';
    // 'IssueDate' CONFIRMED live 2026-08-27 as cloud's actual internal
    // column name for the "Received Date" header — same class of bug as
    // checksPaymentsExtractor.ts's 'CheckNumber': missing this dropped the
    // date on cloud only, corrupting this row's businessKey (which includes
    // it) enough that a real, identical recovery check was reported as a
    // false EXTRA_ON_PREM + NEW_IN_CLOUD pair instead of one clean match.
    case 'ReceivedDate':
    case 'IssueDate': return 'ReceivedDate';
    default: return null;
  }
}

async function readOnPrem(ctx: ExtractionContext): Promise<Record<string, string>[]> {
  return ctx.page.evaluate(() => {
    const grid = document.querySelector('[id$=":RecoveryChecksExtLV"]')
      || Array.from(document.querySelectorAll('[id*="RecoveryChecksExtLV"]')).find((g) => (g as HTMLElement).offsetParent)
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
      if (Object.keys(rec).length) out.push(rec);
    }
    return out;
  }).catch(() => []);
}

async function readCloud(ctx: ExtractionContext): Promise<Record<string, string>[]> {
  return ctx.page.evaluate(() => {
    const rows: Record<string, Record<string, string>> = {};
    for (const el of Array.from(document.querySelectorAll('[id*="RecoveryChecksExtLV-"]'))) {
      const m = el.id.match(/RecoveryChecksExtLV-(\d+)-([A-Za-z]+)$/);
      if (!m || !(el as HTMLElement).offsetParent) continue;
      const [, idx, col] = m;
      const text = ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      rows[idx] = rows[idx] || {};
      rows[idx][col] = text;
    }
    return Object.keys(rows).sort((a, b) => Number(a) - Number(b)).map((k) => rows[k]);
  }).catch(() => []);
}

export async function extractRecoveryChecks(ctx: ExtractionContext): Promise<RecoveryCheckData[]> {
  const rawRows = ctx.environment === 'onprem' ? await readOnPrem(ctx) : await readCloud(ctx);

  return rawRows.map((row) => {
    const canonical: Record<string, string> = {};
    for (const [rawKey, text] of Object.entries(row)) {
      const mapped = mapColumnKey(rawKey);
      if (mapped) canonical[mapped] = text;
    }

    const field = (name: string, fieldLabel: string, type: FieldObservation['type'] = 'string'): FieldObservation => {
      const text = canonical[name];
      const path = `claim.financials.recoveryChecks[].${name}`;
      const base = { path, field: fieldLabel, type, environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Financials: Recovery Checks' };
      return text
        ? ok({ ...base, value: text, rawText: text })
        : notPresent(base, `TODO: "${fieldLabel}" not found in this row's captured columns`);
    };

    const payer = field('Payer', 'Payer');
    const payerCheckNumber = field('PayerCheckNumber', 'Payer Check Number');
    const receivedDate = field('ReceivedDate', 'Received Date', 'date');

    const grossAmountText = canonical.GrossAmount;
    const grossAmountPath = 'claim.financials.recoveryChecks[].GrossAmount';
    const grossAmountBase = { path: grossAmountPath, field: 'Gross Amount', type: 'currency' as const, environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Financials: Recovery Checks' };
    const grossAmount: FieldObservation<number | null> = grossAmountText
      ? ok({ ...grossAmountBase, value: normalizeCurrency(grossAmountText), rawText: grossAmountText })
      : notPresent(grossAmountBase, 'TODO: "Gross Amount" not found in this row\'s captured columns');

    return {
      businessKey: `${payer.value}|${payerCheckNumber.value}|${receivedDate.value}`,
      payer,
      payerCheckNumber,
      grossAmount,
      status: field('Status', 'Status'),
      comments: field('Comments', 'Comments'),
      receivedDate,
    };
  });
}
