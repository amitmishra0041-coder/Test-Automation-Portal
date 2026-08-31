import { FieldObservation } from '../extraction/FieldObservation';
import { Classification, Finding } from './types';
import { severityForPath } from '../../config/severity/severityRules';
import { findExpectedDifferenceRule } from '../../config/expected-differences/expectedDifferences';
import { CURRENCY_TOLERANCE, DATE_TOLERANCE_DAYS } from '../../config/validation/arrayMatchKeys';

function valuesEqual(a: FieldObservation, b: FieldObservation): boolean {
  if (a.value === b.value) return true;
  if (a.value === null || b.value === null) return false;

  if (a.type === 'currency' && typeof a.value === 'number' && typeof b.value === 'number') {
    return Math.abs(a.value - b.value) <= CURRENCY_TOLERANCE;
  }
  if (a.type === 'date' && typeof a.value === 'string' && typeof b.value === 'string' && DATE_TOLERANCE_DAYS > 0) {
    const da = new Date(a.value).getTime();
    const db = new Date(b.value).getTime();
    if (!Number.isNaN(da) && !Number.isNaN(db)) {
      return Math.abs(da - db) <= DATE_TOLERANCE_DAYS * 86_400_000;
    }
  }
  return false;
}

/** Compares two OK observations at the same path. This is where MATCH / EXPECTED_DIFFERENCE / UNEXPECTED_DIFFERENCE gets decided. */
export function classifyPair(onprem: FieldObservation, cloud: FieldObservation): Finding {
  const base = { claimNumber: onprem.claimNumber, section: onprem.section, path: onprem.path, field: onprem.field, onprem: onprem.value, cloud: cloud.value };

  if (valuesEqual(onprem, cloud)) {
    return { ...base, classification: 'MATCH', severity: 'INFO' };
  }

  const rule = findExpectedDifferenceRule(onprem.path);
  if (rule && (rule.matchType === 'ALWAYS' || (rule.predicate?.(onprem.value, cloud.value) ?? false))) {
    return { ...base, classification: 'EXPECTED_DIFFERENCE', severity: 'INFO', note: rule.description, expectedDifferenceRuleId: rule.id };
  }

  const { severity, reason } = severityForPath(onprem.path);
  return { ...base, classification: 'UNEXPECTED_DIFFERENCE', severity, note: reason };
}

/** One side is present, the other isn't (Section 16 — always a real classification, never inferred from an empty read). */
export function classifyMissing(observation: FieldObservation, missingFrom: 'onprem' | 'cloud'): Finding {
  const classification: Classification = missingFrom === 'cloud' ? 'MISSING_IN_CLOUD' : 'MISSING_ON_PREM';
  const { severity, reason } = severityForPath(observation.path);
  return {
    claimNumber: observation.claimNumber, section: observation.section, path: observation.path, field: observation.field,
    onprem: missingFrom === 'onprem' ? null : observation.value,
    cloud: missingFrom === 'cloud' ? null : observation.value,
    classification, severity, note: reason,
  };
}

/** An unmatched array row — before the expected-difference check decides whether it's NEW_IN_CLOUD/EXTRA_ON_PREM (excused) or EXTRA_TRANSACTION (not). */
export function classifyUnmatchedRow(observation: FieldObservation, side: 'onprem' | 'cloud'): Finding {
  const rule = findExpectedDifferenceRule(observation.path);
  if (rule && rule.matchType === 'ALWAYS') {
    return {
      claimNumber: observation.claimNumber, section: observation.section, path: observation.path, field: observation.field,
      onprem: side === 'onprem' ? observation.value : null, cloud: side === 'cloud' ? observation.value : null,
      classification: 'EXPECTED_DIFFERENCE', severity: 'INFO', note: rule.description, expectedDifferenceRuleId: rule.id,
    };
  }
  const classification: Classification = side === 'cloud' ? 'NEW_IN_CLOUD' : 'EXTRA_ON_PREM';
  const { severity, reason } = severityForPath(observation.path);
  return {
    claimNumber: observation.claimNumber, section: observation.section, path: observation.path, field: observation.field,
    onprem: side === 'onprem' ? observation.value : null, cloud: side === 'cloud' ? observation.value : null,
    classification, severity, note: reason,
  };
}

/** Either side failed to extract — a technical automation failure, never presented as a migration finding (Section M). */
export function classifyExtractionFailure(observation: FieldObservation): Finding {
  return {
    claimNumber: observation.claimNumber, section: observation.section, path: observation.path, field: observation.field,
    onprem: observation.environment === 'onprem' ? observation.errorMessage : undefined,
    cloud: observation.environment === 'cloud' ? observation.errorMessage : undefined,
    classification: 'UNABLE_TO_COMPARE', severity: 'INFO',
    note: `extraction failed on ${observation.environment}: ${observation.errorMessage ?? 'unknown error'}`,
  };
}
