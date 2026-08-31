/**
 * Maps an on-prem code/label to its cloud equivalent (or vice versa) using
 * an explicit, per-field map — never a fuzzy/heuristic match, which could
 * paper over a genuine migration defect (Section 12's core rule: every
 * normalization must be explicit and configurable, never silently applied).
 */
export type EnumMap = Record<string, string>;

export function normalizeEnum(raw: string | null, map: EnumMap): string | null {
  if (raw === null) return null;
  return map[raw] ?? raw; // unmapped values pass through unchanged — surfaced as a real difference, not hidden
}
