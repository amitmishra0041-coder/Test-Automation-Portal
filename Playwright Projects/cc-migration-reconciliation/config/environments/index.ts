import { EnvironmentConfig, Tier } from './types';
import { getOnPremConfig } from './onprem.config';
import { getCloudConfig } from './cloud.config';

export type { EnvironmentConfig, Platform, Tier } from './types';

/**
 * Resolves BOTH environment configs for a run (Section A/L decision: one
 * process, two BrowserContexts per claim — not the sister repo's two-pass
 * CC_ENV switch). CC_TIER still picks which instance of each platform.
 */
export function resolveEnvironments(tier: Tier = (process.env.CC_TIER as Tier) || 'test'): {
  onprem: EnvironmentConfig;
  cloud: EnvironmentConfig;
} {
  return {
    onprem: getOnPremConfig(tier),
    cloud: getCloudConfig(tier),
  };
}
