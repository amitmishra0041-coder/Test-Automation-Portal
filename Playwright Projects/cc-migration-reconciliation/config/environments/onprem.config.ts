import { EnvironmentConfig, Tier } from './types';

// URLs confirmed against the ClaimCenter-Automation prototype's .env.example
// (CC_BASE_URL_ONPREM_TEST / _DEV). Overridable via env vars of the same
// names so this file never needs editing per-environment.
const DEFAULT_URLS: Record<Tier, string> = {
  test: 'http://test-claimcenter.donegalgroup.com/cc/ClaimCenter.do',
  dev: 'http://dev-claimcenter.donegalgroup.com:8080/cc/ClaimCenter.do',
};

export function getOnPremConfig(tier: Tier): EnvironmentConfig {
  const envVar = `CC_BASE_URL_ONPREM_${tier.toUpperCase()}`;
  return {
    platform: 'onprem',
    tier,
    baseUrl: process.env[envVar] || DEFAULT_URLS[tier],
    // Confirmed live via claimCenterBase.js: despite being ExtJS, the login
    // fields ARE addressable by accessible role/name.
    loginFieldLabels: { username: 'User name', password: 'Password' },
    postLoginSignal: { role: 'link', name: /^Search$/ },
  };
}
