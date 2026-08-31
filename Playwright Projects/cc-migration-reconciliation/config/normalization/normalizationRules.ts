import { EnumMap } from '../../src/normalization/normalizers/enumNormalizer';

export interface NormalizationRule {
  /** Matches the end of a FieldObservation.path — e.g. "status" matches "...exposures[0].status". */
  pathSuffix: string | RegExp;
  whitespace?: boolean;      // default true for string/enum types
  caseInsensitive?: boolean; // default false — case is business-meaningful unless a field says otherwise
  emptyAsNull?: boolean;     // default false
  enumMap?: EnumMap;
}

/**
 * Section 12/25: every normalization decision lives here, not in code.
 * Empty by design at launch — date/currency/boolean normalization is always
 * on (Section F treats those as structural, not business-meaningful
 * formatting), everything else defaults to whitespace-only until a real
 * enum/status transform is confirmed against live data (Section H/33 Q12-13).
 */
export const normalizationRules: NormalizationRule[] = [
  // Example, disabled until a real transform is confirmed:
  // { pathSuffix: 'status', enumMap: { OPEN: 'Open', CLOSED: 'Closed' } },
];

export function findNormalizationRule(path: string): NormalizationRule | undefined {
  return normalizationRules.find((r) =>
    (typeof r.pathSuffix === 'string' ? path.endsWith(r.pathSuffix) : r.pathSuffix.test(path)));
}
