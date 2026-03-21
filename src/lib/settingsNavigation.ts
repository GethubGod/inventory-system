import { type Href } from 'expo-router';

export type SettingsOrigin = 'employee' | 'manager';

export const EMPLOYEE_SETTINGS_ROOT = '/(tabs)/settings' as const;
export const MANAGER_SETTINGS_ROOT = '/(manager)/profile' as const;

export function isSettingsOrigin(value: unknown): value is SettingsOrigin {
  return value === 'employee' || value === 'manager';
}

export function getSettingsRootPath(origin: SettingsOrigin) {
  return origin === 'manager' ? MANAGER_SETTINGS_ROOT : EMPLOYEE_SETTINGS_ROOT;
}

export function buildSettingsPath(
  pathname: string,
  options?: {
    origin?: SettingsOrigin;
    backTo?: string | Href;
  },
): Href {
  const params = new URLSearchParams();

  if (options?.origin) {
    params.set('origin', options.origin);
  }

  if (options?.backTo) {
    params.set('backTo', String(options.backTo));
  }

  const query = params.toString();
  return (query ? `${pathname}?${query}` : pathname) as Href;
}
