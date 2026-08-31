import { ExtractionContext } from '../ExtractionContext';
import { TransactionData, transactionBusinessKey } from '../../models/FinancialsData';
import { FieldObservation, ok, notPresent } from '../FieldObservation';
import { normalizeCurrency } from '../../normalization/normalizers/currencyNormalizer';
import { fixPartyLabelSpacing } from '../../normalization/normalizers/stringNormalizer';
import { readAllPages } from '../pagination';

/**
 * CONFIRMED, both platforms — live pass against "Financials > Transactions"
 * (a distinct sub-nav item under Financials, reached by clicking Financials
 * then Transactions — see TransactionsPage.navigate()). Column headers
 * confirmed live: Type, Date, Amount, Exposure, Exposure Name, Coverage,
 * Cost Type, Cost Category, Status, User. On-prem labels these by header
 * TEXT ("Type", "Exposure Name"); cloud labels the same columns by
 * grid-internal column NAME ("TType", "ExposureName") baked into its cell
 * ids — mapColumnKey() reconciles the two onto one canonical key set so a
 * single mapping below builds both platforms' TransactionData.
 */
function mapColumnKey(raw: string): string | null {
  const key = raw.replace(/\s+/g, '');
  switch (key) {
    case 'Type':
    case 'TType': return 'Type';
    case 'Date': return 'Date';
    case 'Amount': return 'Amount';
    case 'Exposure': return 'Exposure';
    case 'ExposureName': return 'ExposureName';
    case 'Coverage':
    case 'CoverageType': return 'Coverage';
    case 'CostType': return 'CostType';
    case 'CostCategory': return 'CostCategory';
    case 'Status': return 'Status';
    case 'User': return 'User';
    default: return null;
  }
}

/**
 * On-prem: ExtJS grid, same shape as exposuresExtractor's readOnPrem —
 * header TEXT + `.x-grid-cell` position mapping, scoped to the
 * `TransactionsLV` grid specifically (unscoped `tr.x-grid-row` also matches
 * the claim's left-nav tree, per exposuresExtractor's own confirmed note).
 */
async function readOnPrem(ctx: ExtractionContext): Promise<Record<string, string>[]> {
  return readAllPages(ctx.page, 'onprem', 'TransactionsLV', () => ctx.page.evaluate(() => {
    // The outer panel — id ending exactly in ":TransactionsLV", no
    // "-body"/"_columnsMenu" suffix — contains both the header row and the
    // body as descendants (confirmed live it also carries one bogus
    // whitespace-only header, a spacer/icon column, that the trim+
    // filter(Boolean) below already strips). Found by id+visibility alone —
    // NOT requiring it to already contain rows (a real, empty grid still
    // exists in the DOM and must be told apart from "not on this page at
    // all"). Falling back to `document` for either headers or rows scrapes
    // the left-nav tree instead — it renders as `tr.x-grid-row` too,
    // confirmed live 2026-08-20 on a claim with zero real documents (same
    // bug, different grid — see documentsExtractor.ts).
    const grid = document.querySelector('[id$=":TransactionsLV"]')
      || Array.from(document.querySelectorAll('[id*="TransactionsLV"]')).find((g) => (g as HTMLElement).offsetParent)
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
      // A real transaction row always carries Type + Amount; guards against
      // stray non-grid rows the same way exposuresExtractor guards on
      // Claimant/Coverage/Type.
      if (!('Type' in rec && 'Amount' in rec)) continue;
      if (Object.keys(rec).length) out.push(rec);
    }
    return out;
  }).catch(() => []));
}

/** Cloud: id-addressed cells, same shape as exposuresExtractor's readCloud / financialsExtractor's readSummaryCloud. */
async function readCloud(ctx: ExtractionContext): Promise<Record<string, string>[]> {
  return readAllPages(ctx.page, 'cloud', 'TransactionsLV', () => ctx.page.evaluate(() => {
    const rows: Record<string, Record<string, string>> = {};
    for (const el of Array.from(document.querySelectorAll('[id*="TransactionsLV-"]'))) {
      const m = el.id.match(/TransactionsLV-(\d+)-([A-Za-z]+)$/);
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

export async function extractTransactions(ctx: ExtractionContext): Promise<TransactionData[]> {
  const rawRows = ctx.environment === 'onprem' ? await readOnPrem(ctx) : await readCloud(ctx);

  return rawRows.map((row) => {
    const canonical: Record<string, string> = {};
    for (const [rawKey, text] of Object.entries(row)) {
      const mapped = mapColumnKey(rawKey);
      if (mapped) canonical[mapped] = text;
    }
    // On-prem-only template quirk — see fixPartyLabelSpacing's doc comment.
    if (canonical.ExposureName) canonical.ExposureName = fixPartyLabelSpacing(canonical.ExposureName) ?? canonical.ExposureName;

    const field = (name: string, fieldLabel: string, type: FieldObservation['type'] = 'string'): FieldObservation => {
      const text = canonical[name];
      const path = `claim.financials.transactions[].${name}`;
      const base = { path, field: fieldLabel, type, environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Financials: Transactions' };
      return text
        ? ok({ ...base, value: text, rawText: text })
        : notPresent(base, `TODO: "${fieldLabel}" not found in this row's captured columns`);
    };

    const notOnGrid = (fieldLabel: string, path: string): FieldObservation => notPresent(
      { path, field: fieldLabel, type: 'string', environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Financials: Transactions' },
      'Not shown on the Transactions grid — confirmed via live DOM pass (see TransactionData doc comment); may live on a different, still-stub sub-page.',
    );

    const amountText = canonical.Amount;
    const amountPath = 'claim.financials.transactions[].amount';
    const amountBase = { path: amountPath, field: 'Amount', type: 'currency' as const, environment: ctx.environment, claimNumber: ctx.claimNumber, section: 'Financials: Transactions' };
    const amount: FieldObservation<number | null> = amountText
      ? ok({ ...amountBase, value: normalizeCurrency(amountText), rawText: amountText })
      : notPresent(amountBase, 'TODO: "Amount" not found in this row\'s captured columns');

    const transactionType = field('Type', 'Transaction Type');
    const transactionDate = field('Date', 'Transaction Date', 'date');
    const exposureNumber = field('Exposure', 'Exposure #');
    const user = field('User', 'User');

    const data: TransactionData = {
      businessKey: transactionBusinessKey({ transactionType, transactionDate, amount, exposureNumber, user }),
      transactionType,
      transactionDate,
      amount,
      status: field('Status', 'Status'),
      exposureNumber,
      exposureName: field('ExposureName', 'Exposure Name'),
      coverage: field('Coverage', 'Coverage'),
      costType: field('CostType', 'Cost Type'),
      costCategory: field('CostCategory', 'Cost Category'),
      user,
      transactionSubtype: notOnGrid('Transaction Subtype', 'claim.financials.transactions[].transactionSubtype'),
      reserveLine: notOnGrid('Reserve Line', 'claim.financials.transactions[].reserveLine'),
      claimant: notOnGrid('Claimant', 'claim.financials.transactions[].claimant'),
      payee: notOnGrid('Payee', 'claim.financials.transactions[].payee'),
      technicalId: notOnGrid('Technical ID', 'claim.financials.transactions[].technicalId'),
    };
    return data;
  });
}
