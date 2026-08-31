const TRUE_VALUES = new Set(['yes', 'y', 'true', '1', 'checked']);
const FALSE_VALUES = new Set(['no', 'n', 'false', '0', 'unchecked']);

/** Normalizes Yes/No, Y/N, true/false, 1/0 to a real boolean. Returns null (not false) when unrecognized. */
export function normalizeBoolean(raw: string | boolean | null): boolean | null {
  if (typeof raw === 'boolean') return raw;
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (TRUE_VALUES.has(s)) return true;
  if (FALSE_VALUES.has(s)) return false;
  return null;
}
