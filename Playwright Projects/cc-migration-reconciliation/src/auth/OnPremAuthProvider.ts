import { Page } from '@playwright/test';
import { AuthProvider, Credentials } from './AuthProvider';
import { EnvironmentConfig } from '../../config/environments';
import { logger } from '../logging/logger';

/**
 * CONFIRMED — ported near-verbatim from loginToClaimCenter's on-prem branch
 * in claimCenterBase.js: "Confirmed via live codegen recording against the
 * on-prem env: despite being ExtJS, the login fields ARE addressable by
 * accessible role/name."
 */
export class OnPremAuthProvider implements AuthProvider {
  readonly platform = 'onprem' as const;

  constructor(private readonly env: EnvironmentConfig) {}

  async login(page: Page, credentials: Credentials): Promise<void> {
    await logger.timed({ environment: 'onprem', section: 'auth', operation: 'login' }, async () => {
      await page.goto(this.env.baseUrl, { waitUntil: 'domcontentloaded' });

      const usernameField = page.getByRole('textbox', { name: this.env.loginFieldLabels.username });
      const passwordField = page.getByRole('textbox', { name: this.env.loginFieldLabels.password });

      await usernameField.waitFor({ state: 'visible', timeout: 30_000 });
      await usernameField.fill(credentials.username);
      await passwordField.fill(credentials.password);
      await passwordField.press('Enter');
      await usernameField.waitFor({ state: 'hidden', timeout: 30_000 });
    });
  }

  async isAuthenticated(page: Page): Promise<boolean> {
    return page
      .locator('a')
      .filter({ hasText: this.env.postLoginSignal.name })
      .first()
      .waitFor({ state: 'visible', timeout: 1500 })
      .then(() => true)
      .catch(() => false);
  }
}
