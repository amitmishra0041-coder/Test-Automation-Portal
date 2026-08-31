import { Page } from '@playwright/test';

export interface Credentials {
  username: string;
  password: string;
}

/**
 * One interface, two implementations (Section N) — kept deliberately thin
 * so that if SSO/MFA is introduced later, only a new provider is written;
 * nothing above this layer (navigation, extraction, orchestration) needs to
 * change or even know the difference.
 */
export interface AuthProvider {
  readonly platform: 'onprem' | 'cloud';
  login(page: Page, credentials: Credentials): Promise<void>;
  isAuthenticated(page: Page): Promise<boolean>;
}
