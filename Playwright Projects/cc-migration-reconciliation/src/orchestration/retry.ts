import { logger } from '../logging/logger';

/** Section M: retries are scoped per-operation (login, one section), never "re-run the whole claim". Exponential backoff, capped attempts. */
export async function withRetry<T>(
  label: string,
  attempts: number,
  fn: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        const delayMs = 1000 * 2 ** (attempt - 1);
        logger.warn(`${label}: attempt ${attempt}/${attempts} failed, retrying in ${delayMs}ms`, { error: err instanceof Error ? err.message : String(err) });
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
}
