import * as fs from 'fs';
import * as path from 'path';
import { ReconciliationReport } from '../ReportAggregator';

export function generateJsonReport(report: ReconciliationReport, outDir: string): string {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `reconciliation-${report.tier}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
  return file;
}
