import { Page } from '@playwright/test';

/**
 * Generic "find a label, read the value that follows it" reader for
 * Guidewire's read-only detail/form pages (Policy, Loss Details, ...),
 * where fields render as a sequential "Label" then "Value" text run — the
 * same position-based approach claimHeaderExtractor.ts already uses for the
 * header ledger, generalized to arbitrary labels. Confirmed live on both
 * platforms: the underlying DOM tag/class differs (ExtJS "x-form" divs vs
 * Jutro "gw-field" divs), but body.innerText's LABEL-then-VALUE line
 * sequence is consistent on both — this reads text, not structure, so it
 * doesn't need to know which.
 *
 * Returns every occurrence of each label (in document order), since some
 * labels legitimately repeat in different sections on the same page (e.g.
 * "Name" appears under both Insured and Agent on the Policy page) — callers
 * pick the occurrence index they've confirmed live via `nth()` rather than
 * this module guessing which one they mean.
 */
export async function getBodyLines(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    return (document.body.innerText || '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }).catch(() => []);
}

/**
 * `labels` MUST be every label visible on the page, not just the ones the
 * caller wants values for — confirmed live as a real bug otherwise: a
 * BLANK field's "value" position is actually occupied by the NEXT label,
 * and any label missing from the set gets silently mistaken for a value
 * (e.g. querying only ['Loss Cause'] on a page where Loss Cause is blank
 * and the next real label is the unlisted "Cat Code" reads
 * `lossCause: "Cat Code"` — wrong value, not a missing one). Callers should
 * pass the full page's label inventory and simply not read the ones they
 * don't need via `nth()`.
 */
export function readLabeledFieldsFromLines(lines: string[], labels: string[]): Record<string, string[]> {
  const labelSet = new Set(labels);
  const result: Record<string, string[]> = {};
  for (const label of labels) result[label] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!labelSet.has(lines[i])) continue;
    for (let j = i + 1; j < lines.length && j < i + 6; j++) {
      if (labelSet.has(lines[j])) break; // next label reached with no value in between — leave unset
      if (lines[j]) {
        result[lines[i]].push(lines[j]);
        break;
      }
    }
  }
  return result;
}

export async function readLabeledFields(page: Page, labels: string[]): Promise<Record<string, string[]>> {
  const lines = await getBodyLines(page);
  return readLabeledFieldsFromLines(lines, labels);
}

export function nth(values: string[] | undefined, index: number): string | null {
  return values && values[index] ? values[index] : null;
}

/**
 * For labels that legitimately repeat on the same page in different
 * sections (e.g. "Name" under both Insured and Agent on the Policy page) —
 * finds `anchorLabel`'s line, then returns the first `fieldLabel` value
 * that appears strictly AFTER it (and, if `beforeLabel` is given, strictly
 * before that). Confirmed necessary live: raw occurrence-index alone picked
 * up an unrelated "Name" column header from a different grid on the same
 * page before reaching the Insured section's own Name field.
 */
export function readFieldAfterAnchor(
  lines: string[], labels: string[], anchorLabel: string, fieldLabel: string, beforeLabel?: string,
): string | null {
  const labelSet = new Set(labels);
  const anchorIndex = lines.indexOf(anchorLabel);
  if (anchorIndex === -1) return null;
  const boundIndex = beforeLabel ? lines.indexOf(beforeLabel, anchorIndex + 1) : -1;
  const searchEnd = boundIndex !== -1 ? boundIndex : lines.length;

  for (let i = anchorIndex + 1; i < searchEnd; i++) {
    if (lines[i] !== fieldLabel) continue;
    for (let j = i + 1; j < searchEnd && j < i + 6; j++) {
      if (labelSet.has(lines[j])) break;
      if (lines[j]) return lines[j];
    }
    return null;
  }
  return null;
}
