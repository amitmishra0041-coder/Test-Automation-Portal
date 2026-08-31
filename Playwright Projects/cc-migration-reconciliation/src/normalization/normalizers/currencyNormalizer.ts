/**
 * Parses $1,000.00 / 1000 / (1,000.00) into a signed number. Ported logic
 * from compareEnvironments.js's own `money()` helper — deliberately
 * conservative: only treats a value as money when it's UNAMBIGUOUSLY money
 * (a currency symbol or a bare number), because a Guidewire claim number
 * like "CA-OH-85-26-0001" will otherwise parse as a giant integer and get
 * reported as a monetary divergence (a real bug that helper fixed).
 */
export function normalizeCurrency(raw: string | null): number | null {
  if (typeof raw !== 'string') return null;
  const t = raw.replace(/,/g, '').trim();
  const paren = t.match(/^\(?\$?\s*(-?\d+(?:\.\d+)?)\)?$/);
  if (!paren) return null;
  const value = parseFloat(paren[1]);
  const isParenNegative = /^\(.*\)$/.test(t);
  return isParenNegative ? -Math.abs(value) : value;
}
