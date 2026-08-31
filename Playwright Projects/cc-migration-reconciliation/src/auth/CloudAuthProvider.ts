import { Page } from '@playwright/test';
import { AuthProvider, Credentials } from './AuthProvider';
import { EnvironmentConfig } from '../../config/environments';
import { logger } from '../logging/logger';

/**
 * CONFIRMED — ported near-verbatim from loginToClaimCenter's cloud branch:
 * "Cloud (Jutro/React): login fields have no stable id/name/type attributes
 * - only exposed via accessible role + name, confirmed via Playwright's own
 * page snapshot (textbox "Username", textbox "Password", button "Log In")."
 */
export class CloudAuthProvider implements AuthProvider {
  readonly platform = 'cloud' as const;

  constructor(private readonly env: EnvironmentConfig) {}

  async login(page: Page, credentials: Credentials): Promise<void> {
    await logger.timed({ environment: 'cloud', section: 'auth', operation: 'login' }, async () => {
      await page.goto(this.env.baseUrl, { waitUntil: 'domcontentloaded' });

      const usernameField = page.getByRole('textbox', { name: this.env.loginFieldLabels.username });
      const passwordField = page.getByRole('textbox', { name: this.env.loginFieldLabels.password });

      await usernameField.waitFor({ state: 'visible', timeout: 30_000 });
      await usernameField.fill(credentials.username);
      await passwordField.fill(credentials.password);
      await page.getByRole('button', { name: 'Log In' }).click();
      await page.getByRole(this.env.postLoginSignal.role, { name: this.env.postLoginSignal.name })
        .waitFor({ state: 'visible', timeout: 30_000 });
    });
  }

  async isAuthenticated(page: Page): Promise<boolean> {
    return page
      .getByRole(this.env.postLoginSignal.role, { name: this.env.postLoginSignal.name })
      .first()
      .waitFor({ state: 'visible', timeout: 1500 })
      .then(() => true)
      .catch(() => false);
  }
}
