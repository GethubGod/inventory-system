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

export function buildSettingsHref(
  pathname: string,
  options?: {
    origin?: SettingsOrigin;
    backTo?: string | Href;
  },
): Href {
  const params: Record<string, string> = {};

  if (options?.origin) {
    params.origin = options.origin;
  }

  if (options?.backTo) {
    params.backTo = String(options.backTo);
  }

  if (Object.keys(params).length === 0) {
    return pathname as Href;
  }

  return {
    pathname: pathname as never,
    params,
  } as Href;
}
