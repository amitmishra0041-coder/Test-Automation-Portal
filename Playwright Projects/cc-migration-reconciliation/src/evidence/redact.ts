/** Section 18/31: evidence must never carry credentials. Same key-based approach as the logger, applied to any text blob before it's written to disk. */
const SECRET_PATTERNS: RegExp[] = [
  /CC_PASS\w*\s*[:=]\s*\S+/gi,
  /password["'\s:=]+\S+/gi,
];

export function redactText(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match) => match.split(/[:=]/)[0] + '=***REDACTED***');
  }
  return out;
}
