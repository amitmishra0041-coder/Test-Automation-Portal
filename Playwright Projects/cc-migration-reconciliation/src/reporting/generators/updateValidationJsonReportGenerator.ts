import * as fs from 'fs';
import * as path from 'path';
import { UpdateValidationReport } from '../../models/DropdownValidation';

export function generateUpdateValidationJsonReport(report: UpdateValidationReport, outDir: string): string {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `update-validation-${report.tier}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
  return file;
}
