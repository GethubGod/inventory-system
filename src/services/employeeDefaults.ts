// Org-wide "new employee defaults" — the module preset every new employee
// invite starts from. One app_config JSON row
// (key employee_invite_module_defaults, seeded by
// 20260820122000_employee_invite_defaults.sql). Reads are plain selects
// (app_config is readable by authenticated users); writes go through the
// manager-gated set_employee_invite_defaults RPC. Applies to invites only —
// existing user_modules rows are never touched from here.

import { supabase } from '@/lib/supabase';
import type { ModuleKey } from '@/services/userModules';

export const EMPLOYEE_DEFAULTS_CONFIG_KEY = 'employee_invite_module_defaults';

/** Employee-manageable module keys, in display order (no manager-side fulfillment). */
export const EMPLOYEE_DEFAULT_KEYS: readonly ModuleKey[] = [
  'ordering_simple',
  'ordering_advanced',
  'stock_check',
  'tips',
] as const;

export type EmployeeInviteDefaults = Record<string, boolean>;

/** Matches the migration's seed row and the SQL role defaults. */
export function getBuiltInEmployeeDefaults(): EmployeeInviteDefaults {
  return {
    ordering_simple: true,
    ordering_advanced: false,
    stock_check: true,
    tips: false,
  };
}

/** Folds a stored JSON value over the built-ins, dropping malformed entries. */
export function parseEmployeeDefaults(value: unknown): EmployeeInviteDefaults {
  const defaults = getBuiltInEmployeeDefaults();
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return defaults;
  }
  for (const key of EMPLOYEE_DEFAULT_KEYS) {
    const entry = (value as Record<string, unknown>)[key];
    if (typeof entry === 'boolean') defaults[key] = entry;
  }
  return defaults;
}

export async function getEmployeeInviteDefaults(): Promise<EmployeeInviteDefaults> {
  const { data, error } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', EMPLOYEE_DEFAULTS_CONFIG_KEY)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return parseEmployeeDefaults(data?.value ?? null);
}

export async function setEmployeeInviteDefaults(v: EmployeeInviteDefaults): Promise<void> {
  const payload: Record<string, boolean> = {};
  for (const key of EMPLOYEE_DEFAULT_KEYS) {
    if (typeof v[key] === 'boolean') payload[key] = v[key];
  }

  const { error } = await supabase.rpc('set_employee_invite_defaults', {
    p_defaults: payload,
  });
  if (error) throw new Error(error.message);
}
