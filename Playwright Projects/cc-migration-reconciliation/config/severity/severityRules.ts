export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export interface SeverityRule {
  pathPattern: RegExp;
  severity: Severity;
  reason: string;
}

/**
 * Section 15/25: severity by path, configurable without touching the
 * comparison engine. Order matters — first match wins, so put narrower
 * patterns before broader ones.
 */
export const severityRules: SeverityRule[] = [
  { pathPattern: /financials\..*\.amount$/, severity: 'CRITICAL', reason: 'financial transaction amount mismatch' },
  { pathPattern: /exposures\[.*\]$/, severity: 'CRITICAL', reason: 'missing/extra exposure' },
  { pathPattern: /header\.status$/, severity: 'HIGH', reason: 'claim status mismatch' },
  { pathPattern: /exposureStatus/, severity: 'HIGH', reason: 'exposure status mismatch' },
  { pathPattern: /activities\[.*\]$/, severity: 'HIGH', reason: 'missing/extra activity' },
  { pathPattern: /notes\[.*\]$/, severity: 'MEDIUM', reason: 'missing/extra note' },
  { pathPattern: /parties\[.*\]\.address/, severity: 'MEDIUM', reason: 'party address mismatch' },
];

const DEFAULT_SEVERITY: Severity = 'LOW';

export function severityForPath(path: string): { severity: Severity; reason: string } {
  const rule = severityRules.find((r) => r.pathPattern.test(path));
  return rule ? { severity: rule.severity, reason: rule.reason } : { severity: DEFAULT_SEVERITY, reason: 'default severity — no specific rule configured for this path' };
}
