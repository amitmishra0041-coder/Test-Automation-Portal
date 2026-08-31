import { Page } from '@playwright/test';
import { UpdateResult } from '../models/DropdownValidation';

/**
 * Clicks the "Update" button (CONFIRMED live 2026-08-21 as the real label
 * on cloud, not "Save" — matches ClaimCenter's own terminology on both
 * platforms) and reports whether it succeeded. The whole point of this
 * step (per explicit instruction) is to verify old/pre-migration claim
 * data can still be saved without a validation error — so a failure here
 * is a genuine finding to report (with the claim number, for defect
 * logging), not a tool error to swallow.
 *
 * "Succeeded" is judged by whether the edit form actually closed (the
 * Update button itself disappears once the save completes and the page
 * returns to read-only view) — more reliable than pattern-matching a
 * specific error banner's text, which will vary by field/validation rule
 * and platform. When it does NOT close within the timeout, the on-screen
 * validation/error text (if any) is captured for the report.
 */
export async function clickUpdateAndCapture(page: Page, environment: 'onprem' | 'cloud'): Promise<UpdateResult> {
  const updateBtn = environment === 'cloud'
    ? page.getByRole('button', { name: 'Update', exact: true })
    : page.locator('a.x-btn').filter({ hasText: 'Update' });

  const found = await updateBtn.first().isVisible().catch(() => false);
  if (!found) {
    return { attempted: false, succeeded: false, errorMessage: 'No "Update" button found after opening Edit' };
  }

  await updateBtn.first().click({ timeout: 8000 }).catch(() => {});

  const closed = await updateBtn.first().waitFor({ state: 'hidden', timeout: 15000 }).then(() => true).catch(() => false);
  if (closed) {
    return { attempted: true, succeeded: true };
  }

  const errorMessage = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll(
      '.x-form-invalid-under, .x-message-box, [role="alert"], .gw-alert, .gw-InlineMessage, .gw-notification--error',
    )).filter((e) => (e as HTMLElement).offsetParent);
    const texts = candidates.map((e) => (e.textContent || '').trim()).filter(Boolean);
    return texts.length ? Array.from(new Set(texts)).join(' | ') : null;
  }).catch(() => null);

  return {
    attempted: true,
    succeeded: false,
    errorMessage: errorMessage ?? 'Update did not close the edit form within 15s and no specific error text was found',
  };
}
