import { FieldObservation, isFieldObservation } from '../extraction/FieldObservation';
import { normalizeDate } from './normalizers/dateNormalizer';
import { normalizeCurrency } from './normalizers/currencyNormalizer';
import { normalizeBoolean } from './normalizers/booleanNormalizer';
import { normalizeEnum } from './normalizers/enumNormalizer';
import { normalizeWhitespace, normalizeCase, normalizeEmptyAsNull } from './normalizers/stringNormalizer';
import { findNormalizationRule } from '../../config/normalization/normalizationRules';

/** Normalizes a single observation's `value`, leaving `rawText` untouched as the pre-normalization evidence trail. */
export function normalizeObservation(obs: FieldObservation): FieldObservation {
  if (obs.status !== 'OK') return obs; // nothing to normalize on a value that was never read

  const rule = findNormalizationRule(obs.path);
  let value: unknown = obs.value;

  switch (obs.type) {
    case 'date':
      value = normalizeDate(value === null ? null : String(value));
      break;
    case 'currency':
      value = normalizeCurrency(value === null ? null : String(value));
      break;
    case 'boolean':
      value = normalizeBoolean(value as string | boolean | null);
      break;
    case 'enum':
      if (rule?.enumMap) value = normalizeEnum(value === null ? null : String(value), rule.enumMap);
      break;
    case 'string':
    case 'integer':
    default:
      if (typeof value === 'string') {
        if (rule?.whitespace !== false) value = normalizeWhitespace(value);
        if (rule?.caseInsensitive) value = normalizeCase(value as string);
        if (rule?.emptyAsNull) value = normalizeEmptyAsNull(value as string);
      }
  }

  return { ...obs, value: value as typeof obs.value };
}

/**
 * Walks any ClaimData subtree (or the whole thing) and normalizes every
 * FieldObservation leaf found, however deeply nested — a generic walker
 * rather than hand-wiring 25 sections' worth of field-by-field calls, which
 * would need editing every time a stub section becomes real. Detection is
 * duck-typed on the FieldObservation shape (status+path+type), so it works
 * unchanged as new sections are added.
 */
export function normalizeTree<T>(node: T): T {
  if (Array.isArray(node)) {
    return node.map((item) => normalizeTree(item)) as unknown as T;
  }
  if (isFieldObservation(node)) {
    return normalizeObservation(node) as unknown as T;
  }
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = normalizeTree(v);
    }
    return out as T;
  }
  return node;
}
