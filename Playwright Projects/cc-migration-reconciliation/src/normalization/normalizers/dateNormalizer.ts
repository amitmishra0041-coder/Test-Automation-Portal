/**
 * Normalizes common ClaimCenter date renderings to canonical ISO (YYYY-MM-DD).
 * Returns null (never throws) when the input doesn't parse — an
 * unparseable date is a finding for the comparison engine to surface, not
 * something normalization should hide.
 */
export function normalizeDate(raw: string | null): string | null {
  if (!raw) return raw;
  const s = raw.trim();
  if (!s) return s;

  // 2026-01-01 (already canonical)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // 01/01/2026 or 1/1/2026
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, mm, dd, yyyy] = slash;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  // "Jan 1 2026", "January 1, 2026"
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  return null; // unparseable — surfaced, not silently passed through
}
