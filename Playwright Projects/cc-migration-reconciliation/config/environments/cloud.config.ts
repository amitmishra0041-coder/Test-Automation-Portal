import { EnvironmentConfig, Tier } from './types';

const DEFAULT_URLS: Record<Tier, string> = {
  test: 'https://cc-test-dngldev.donegal.beta5-andromeda.guidewire.net/ClaimCenter.do',
  dev: 'https://cc-dev-dngldev.donegal.beta5-andromeda.guidewire.net/ClaimCenter.do',
};

export function getCloudConfig(tier: Tier): EnvironmentConfig {
  const envVar = `CC_BASE_URL_CLOUD_${tier.toUpperCase()}`;
  return {
    platform: 'cloud',
    tier,
    baseUrl: process.env[envVar] || DEFAULT_URLS[tier],
    // Confirmed live via claimCenterBase.js: cloud (Jutro/React) login
    // fields have no stable id/name/type — only accessible role + name.
    loginFieldLabels: { username: 'Username', password: 'Password' },
    postLoginSignal: { role: 'menuitem', name: /^Search$/ },
  };
}
