export type Platform = 'onprem' | 'cloud';
export type Tier = 'test' | 'dev';

export interface EnvironmentConfig {
  platform: Platform;
  tier: Tier;
  baseUrl: string;
  /** Login field strategy differs by platform (Section N) — kept in config
   *  so a future SSO rollout only edits data, not AuthProvider code. */
  loginFieldLabels: {
    username: string;
    password: string;
  };
  /** Element whose visibility confirms a successful login (Section N). */
  postLoginSignal: { role: 'menuitem' | 'link'; name: RegExp };
}
