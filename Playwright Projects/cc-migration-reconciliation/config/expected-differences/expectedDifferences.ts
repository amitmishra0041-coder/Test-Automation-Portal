export interface ExpectedDifferenceRule {
  id: string;
  description: string;
  pathPattern: RegExp;
  matchType: 'ALWAYS' | 'CONDITIONAL';
  /** Required when matchType is CONDITIONAL. Return true if this specific difference is expected. */
  predicate?: (onpremValue: unknown, cloudValue: unknown) => boolean;
}

/**
 * Section 13/25: the only place migration-expected differences are
 * declared. Empty at launch (Section S question 12-13 — no migration
 * mapping document is available yet) so nothing is silently excused before
 * you've confirmed it should be. Populate this as real transforms are
 * confirmed against live data; every entry here is shown in the report next
 * to the finding it excuses (Section H), so the audit trail stays intact.
 *
 * Two rules ship enabled because they're true by construction, not because
 * they were confirmed against this migration specifically: a technical ID
 * regenerating across a data migration isn't a judgment call, it's how
 * Guidewire's own id assignment works.
 */
export const expectedDifferenceRules: ExpectedDifferenceRule[] = [
  {
    id: 'technical-id-remap',
    description: 'CC regenerates internal technical IDs on migration (Section 8/9) — never compared as business data.',
    pathPattern: /technicalId$/,
    matchType: 'ALWAYS',
  },
  {
    id: 'claim-number-format',
    description: 'Claim number PREFIX format may legitimately differ by environment/tier (confirmed pattern in compareEnvironments.js).',
    pathPattern: /header\.claimNumber$/,
    matchType: 'ALWAYS',
  },
  {
    id: 'locations-class-codes-number-padding',
    description: 'Policy: Locations and Class Codes\' row "Number"/"LocationNumber" columns may be zero-padded on one platform ("001") but not the other ("1") — confirmed live 2026-08-27, same value, formatting only. Covers both canonical columns this grid has (see registry.ts\'s policyLocationsClassCodes alias comment for why there are two).',
    pathPattern: /policyLocationsClassCodes\.rows\[\]\.(Number|LocationNumber)$/,
    matchType: 'CONDITIONAL',
    predicate: (onprem, cloud) => String(onprem ?? '').replace(/^0+(?=\d)/, '') === String(cloud ?? '').replace(/^0+(?=\d)/, ''),
  },
  {
    id: 'phone-number-digit-grouping',
    description: 'Phone-type fields (Phone/Work/Home/Mobile/Fax) may render digit grouping differently between platforms — confirmed live 2026-08-27, same digits, different spacing (e.g. "+91 99 48 199481" vs "+91 99481 99481").',
    pathPattern: /\.(Phone|Work|Home|Mobile|Fax)$/,
    matchType: 'CONDITIONAL',
    predicate: (onprem, cloud) => {
      const digitsOnly = (v: unknown) => String(v ?? '').replace(/\D+/g, '');
      const a = digitsOnly(onprem);
      const b = digitsOnly(cloud);
      return a !== '' && a === b;
    },
  },

  // Examples — left disabled (commented) until confirmed against a real
  // migration mapping document (Section S question 25):
  // {
  //   id: 'status-code-transform',
  //   description: 'On-prem status codes map to cloud display labels per the migration mapping doc.',
  //   pathPattern: /exposures\[.*\]\.columns\.Status$/,
  //   matchType: 'CONDITIONAL',
  //   predicate: (onprem, cloud) => STATUS_MAP[String(onprem)] === cloud,
  // },
];

export function findExpectedDifferenceRule(path: string): ExpectedDifferenceRule | undefined {
  return expectedDifferenceRules.find((r) => r.pathPattern.test(path));
}
