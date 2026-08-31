/**
 * Structured logging (Section 23). Every entry carries the same shape so
 * log lines can be grepped/aggregated the same way regardless of what
 * produced them:
 *   timestamp | claim | environment | section | operation | result | duration | error
 *
 * Redaction (Section 5/31): never let a credential reach a log line. Values
 * are redacted by KEY NAME, not by trying to pattern-match secrets in free
 * text — reliable and impossible to forget per call site.
 */
const REDACTED_KEYS = /pass(word)?|secret|token|credential|apikey|api_key/i;

export function redact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = REDACTED_KEYS.test(k) ? '***REDACTED***' : v;
  }
  return out;
}

export interface LogFields {
  claimNumber?: string;
  environment?: 'onprem' | 'cloud';
  section?: string;
  operation?: string;
  result?: 'SUCCESS' | 'FAILURE' | 'SKIPPED';
  durationMs?: number;
  error?: string;
  [key: string]: unknown;
}

function format(level: string, message: string, fields: LogFields = {}): string {
  const ts = new Date().toISOString();
  const safe = redact(fields as Record<string, unknown>);
  const parts = [
    `${ts}`,
    `level=${level}`,
    ...Object.entries(safe)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`),
  ];
  return `${parts.join(' ')} ${message}`;
}

export const logger = {
  info(message: string, fields?: LogFields): void {
    // eslint-disable-next-line no-console
    console.log(format('INFO', message, fields));
  },
  warn(message: string, fields?: LogFields): void {
    // eslint-disable-next-line no-console
    console.warn(format('WARN', message, fields));
  },
  error(message: string, fields?: LogFields): void {
    // eslint-disable-next-line no-console
    console.error(format('ERROR', message, fields));
  },
  /** Wraps an async operation, logging SUCCESS/FAILURE with duration automatically. */
  async timed<T>(fields: Omit<LogFields, 'result' | 'durationMs'>, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      logger.info('operation complete', { ...fields, result: 'SUCCESS', durationMs: Date.now() - start });
      return result;
    } catch (err) {
      logger.error('operation failed', {
        ...fields, result: 'FAILURE', durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },
};
