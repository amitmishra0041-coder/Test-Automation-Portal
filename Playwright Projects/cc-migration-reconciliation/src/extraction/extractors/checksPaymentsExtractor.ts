import { ExtractionContext } from '../ExtractionContext';
import { CheckPaymentData } from '../../models/FinancialsData';
import { FieldObservation, ok, notPresent } from '../FieldObservation';
import { normalizeCurrency } from '../../normalization/normalizers/currencyNormalizer';

/**
 * CONFIRMED, both platforms 2026-08-20 — live pass against "Financials >
 * Checks/Payments" (a distinct nested nav item under Financials, reached by
 * clicking Financials then Checks/Payments — same 2-step pattern as
 * Transactions, see TransactionsPage.navigate()). Columns confirmed live on
 * both platforms: Check/Payment Number, Pay To, Gross Amount, Scheduled
 * Send Date, Status, Bulk Invoice, Service Period Start, Service Period
 * End. Both test claims had zero rows (no payment made yet), so row-level
 * parsing is structurally confirmed but not validated against real data.
 */
function mapColumnKey(raw: string): string | null {
  const key = raw.replace(/\s+/g, '');
  switch (key) {
    // 'CheckNumber' CONFIRMED live 2026-08-27 as cloud's actual internal
    // column name (`ChecksLV-{row}-CheckNumber`) — "Check/Payment Number"
    // is only the rendered HEADER text, not the column's own name, unlike
    // every other column here where header text and internal name match.
    // Missing this case silently dropped the field on cloud only, which
    // corrupted this row's businessKey (built from this field) enough that
    // the whole row failed to match its on-prem counterpart — 3 real,
    // identical payments were reported as 3 false EXTRA_ON_PREM + 3 false
    // NEW_IN_CLOUD instead of 3 clean matches.
    case 'Check/PaymentNumber':
    case 'CheckPaymentNumber':
    case 'CheckNumber': return 'CheckPaymentNumber';
    case 'PayTo': return 'PayTo';
    case 'GrossAmount': return 'GrossAmount';
    case 'ScheduledSendDate': return 'ScheduledSendDate';
    case 'Status': return 'Status';
    case 'BulkInvoice': return 'BulkInvoice';
    // Same confirmed live 2026-08-27: cloud abbreviates these to
    // 'ServicePdStart'/'ServicePdEnd' internally. Both test claims had
    // these blank on both platforms, so the gap produced no visible
    // mismatch yet — fixed proactively rather than waiting for a claim
    // where it would.
    case 'ServicePeriodStart':
    case 'ServicePdStart': return 'ServicePeriodStart';
    case 'ServicePeriodEnd':
    case 'ServicePdEnd': return 'ServicePeriodEnd';
    default: return null;
  }
}

async function readOnPrem(ctx: ExtractionContext): Promise<Record<string, string>[]> {
  return ctx.page.evaluate(() => {
    const grid = document.querySelector('[id$=":ChecksLV"]')
      || Array.from(document.querySelectorAll('[id*="ChecksLV"]')).find((g) => (g as HTMLElement).offsetParent)
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
    for (const el of Array.from(document.querySelectorAll('[id*="ChecksLV-"]'))) {
      const m = el.id.match(/ChecksLV-(\d+)-([A-Za-z]+)$/);
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

export async function extractChecksPayments(ctx: ExtractionContext): Promise<CheckPaymentData[]> {
  const rawRows = ctx.environment === 'onprem' ? await readOnPrem(ctx) : await readCloud(ctx);

  return rawRows.map((row) => {
    const canonical: Record<string, string> = {};
    for (const [rawKey, text] of Object.entries(row)) {
      const mapped = mapColumnKey(rawKey);
      if (mapped) canonical[mapped] = text;
    }

    const field = (name: string, fieldLabel: string, type: FieldObservation['type'] = 'string'): FieldObservation => {
      const text = canonical[name];
      const path = `claim.financials.checksPayments[].${name}`;
      const base = { path, field: fieldLabel, type, environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Financials: Checks/Payments' };
      return text
        ? ok({ ...base, value: text, rawText: text })
        : notPresent(base, `TODO: "${fieldLabel}" not found in this row's captured columns`);
    };

    const checkPaymentNumber = field('CheckPaymentNumber', 'Check/Payment Number');
    const payTo = field('PayTo', 'Pay To');
    const scheduledSendDate = field('ScheduledSendDate', 'Scheduled Send Date', 'date');

    const grossAmountText = canonical.GrossAmount;
    const grossAmountPath = 'claim.financials.checksPayments[].GrossAmount';
    const grossAmountBase = { path: grossAmountPath, field: 'Gross Amount', type: 'currency' as const, environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Financials: Checks/Payments' };
    const grossAmount: FieldObservation<number | null> = grossAmountText
      ? ok({ ...grossAmountBase, value: normalizeCurrency(grossAmountText), rawText: grossAmountText })
      : notPresent(grossAmountBase, 'TODO: "Gross Amount" not found in this row\'s captured columns');

    return {
      businessKey: `${checkPaymentNumber.value}|${payTo.value}|${scheduledSendDate.value}`,
      checkPaymentNumber,
      payTo,
      grossAmount,
      scheduledSendDate,
      status: field('Status', 'Status'),
      bulkInvoice: field('BulkInvoice', 'Bulk Invoice'),
      servicePeriodStart: field('ServicePeriodStart', 'Service Period Start', 'date'),
      servicePeriodEnd: field('ServicePeriodEnd', 'Service Period End', 'date'),
    };
  });
}
