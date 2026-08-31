import { EnvironmentConfig } from '../../config/environments';
import { AuthProvider } from './AuthProvider';
import { OnPremAuthProvider } from './OnPremAuthProvider';
import { CloudAuthProvider } from './CloudAuthProvider';

export type { AuthProvider, Credentials } from './AuthProvider';

export function createAuthProvider(env: EnvironmentConfig): AuthProvider {
  return env.platform === 'onprem' ? new OnPremAuthProvider(env) : new CloudAuthProvider(env);
}

export function credentialsFromEnv(overrideUser?: string, overridePass?: string): { username: string; password: string } {
  const username = (overrideUser ?? process.env.CC_USER ?? '').trim();
  const password = (overridePass ?? process.env.CC_PASS ?? '').trim();
  if (!username || !password) {
    throw new Error('Set CC_USER and CC_PASS (or CC_ADMIN_USER/CC_ADMIN_PASS) in .env');
  }
  return { username, password };
}
