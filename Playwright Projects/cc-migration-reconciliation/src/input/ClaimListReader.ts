import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';

/**
 * Section 3: claimNumber is the only required column; everything else is
 * optional metadata used for filtering/reporting. `claimType` doubles as
 * LOB for the by-LOB consolidated summary (Section 19) — it's read from
 * this input file, not extracted live, since claim-type extraction
 * (`claimDetails` in navigationCatalog.ts) is still a stub.
 */
export interface ClaimListEntry {
  claimNumber: string; // the on-prem claim number
  cloudClaimNumber?: string; // optional — a different claim number for the cloud side (asymmetric pair, e.g. while a real migrated pair isn't available yet); defaults to claimNumber when absent
  policyNumber?: string;
  expectedMigrationStatus?: string;
  claimType?: string;
  priority?: string;
  testGroup?: string;
  migrationBatch?: string;
}

function normalizeRow(r: Record<string, unknown>): ClaimListEntry | null {
  const claimNumber = r.claimNumber != null ? String(r.claimNumber).trim() : '';
  if (!claimNumber) return null;
  const str = (v: unknown): string | undefined => {
    if (v === undefined || v === null) return undefined;
    const s = String(v).trim();
    return s || undefined;
  };
  return {
    claimNumber,
    cloudClaimNumber: str(r.cloudClaimNumber),
    policyNumber: str(r.policyNumber),
    expectedMigrationStatus: str(r.expectedMigrationStatus),
    claimType: str(r.claimType),
    priority: str(r.priority),
    testGroup: str(r.testGroup),
    migrationBatch: str(r.migrationBatch),
  };
}

function readCsvClaimList(filePath: string): ClaimListEntry[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const rows: Record<string, string>[] = parse(content, { columns: true, skip_empty_lines: true, trim: true });
  return rows.map(normalizeRow).filter((r): r is ClaimListEntry => r !== null);
}

/** Same column names as the CSV form, first sheet only — the claims list is expected to be a single flat table, not a workbook with multiple purposes. */
function readExcelClaimList(filePath: string): ClaimListEntry[] {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return rows.map(normalizeRow).filter((r): r is ClaimListEntry => r !== null);
}

export function readClaimList(filePath: string): ClaimListEntry[] {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.xlsx' || ext === '.xls') return readExcelClaimList(filePath);
  return readCsvClaimList(filePath);
}

export interface ClaimFilter {
  claim?: string;      // --claim 123456789 — a single claim, overrides everything else
  batch?: string;       // --batch B3 — matches migrationBatch column
  group?: string;        // --group smoke — matches testGroup column
}

export function filterClaims(entries: ClaimListEntry[], filter: ClaimFilter): ClaimListEntry[] {
  if (filter.claim) {
    const match = entries.find((e) => e.claimNumber === filter.claim);
    return match ? [match] : [{ claimNumber: filter.claim }]; // allow a claim not in the file — Section 3: "one claim" mode shouldn't require it to be pre-listed
  }
  let out = entries;
  if (filter.batch) out = out.filter((e) => e.migrationBatch === filter.batch);
  if (filter.group) out = out.filter((e) => e.testGroup === filter.group);
  return out;
}
