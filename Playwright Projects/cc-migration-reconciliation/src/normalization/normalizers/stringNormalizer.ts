/** Collapses whitespace runs and trims. Case-folding is opt-in per field (Section 12) — never applied here by default. */
export function normalizeWhitespace(raw: string | null): string | null {
  if (raw === null) return null;
  return raw.replace(/\s+/g, ' ').trim();
}

export function normalizeCase(raw: string | null): string | null {
  return raw === null ? null : raw.toLowerCase();
}

/** Treats "" and null as equivalent — only when a field explicitly opts in (Section 12). */
export function normalizeEmptyAsNull(raw: string | null): string | null {
  return raw === '' ? null : raw;
}

/**
 * On-prem's own composite exposure/related-to labels ("(1) 1st Party...")
 * render with NO space between the ordinal-party prefix and whatever
 * exposure type follows it — confirmed live 2026-08-27 as a genuine on-prem
 * TEMPLATE quirk, not a DOM-read artifact: it's 100% consistent (always
 * exactly "Nth Party" + next word, on-prem only) across every remaining
 * real UNEXPECTED_DIFFERENCE finding in Transactions' Exposure Name and
 * History/Notes' Related To once the textContent-vs-innerText and column-
 * alias bugs were fixed — cloud always renders the space correctly for the
 * exact same exposure. Idempotent: a no-op once the space is already there
 * (cloud, or a future on-prem fix), since the pattern only matches a letter
 * immediately following "Party" with nothing in between. Call this at
 * EXTRACTION time (not just as a later normalization pass) for any field
 * that also feeds a row's businessKey (e.g. History's Related To) — a
 * missing space there corrupts row-matching itself, not just the displayed
 * value.
 */
export function fixPartyLabelSpacing(raw: string | null): string | null {
  if (raw === null) return null;
  return raw.replace(/(\d(?:st|nd|rd|th) Party)(?=[A-Za-z])/g, '$1 ');
}
