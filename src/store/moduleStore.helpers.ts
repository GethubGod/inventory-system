// Phase 3 — pure module-access logic. Role defaults here MUST mirror the SQL
// defaults in get_effective_modules (supabase/migrations/20260812110000_user_modules.sql):
// employee → ordering_simple=false, ordering_advanced=false, stock_check=true,
// tips=false, fulfillment=false; manager → all true. They exist client-side only
// as the fallback when the RPC cannot be reached, so nobody gets locked out of
// the tab bar by a network failure.

import type { ModuleKey, ModuleState } from '@/services/userModules';
import type { UserRole } from '@/types';

export type EffectiveModules = Record<ModuleKey, boolean>;

export const MODULE_KEYS: readonly ModuleKey[] = [
  'ordering_simple',
  'ordering_advanced',
  'stock_check',
  'tips',
  'fulfillment',
] as const;

export const MODULE_LABELS: Record<ModuleKey, string> = {
  ordering_simple: 'Simple ordering',
  ordering_advanced: 'Advanced ordering (Beta)',
  stock_check: 'Stock check',
  tips: 'Tips',
  fulfillment: 'Fulfillment',
};

/**
 * Module keys a manager can toggle for a given user. Fulfillment is a
 * manager-side surface, so employee rows never expose it.
 */
export function getManageableModuleKeys(role: UserRole): ModuleKey[] {
  return role === 'manager'
    ? [...MODULE_KEYS]
    : MODULE_KEYS.filter((key) => key !== 'fulfillment');
}

export function getRoleDefaultModules(role: UserRole | null): EffectiveModules {
  const isManager = role === 'manager';
  return {
    ordering_simple: isManager,
    ordering_advanced: isManager,
    stock_check: true,
    tips: isManager,
    fulfillment: isManager,
  };
}

/**
 * Effective module map for a user: role defaults overlaid with whatever the
 * server returned. `fetched: null` (nothing loaded / fetch failed) yields the
 * pure role defaults.
 */
export function resolveEffectiveModules(
  role: UserRole | null,
  fetched: ModuleState[] | null,
): EffectiveModules {
  const effective = getRoleDefaultModules(role);
  for (const state of fetched ?? []) {
    if (MODULE_KEYS.includes(state.key)) {
      effective[state.key] = state.enabled;
    }
  }
  return effective;
}

/**
 * Employee tab-bar entries, in display order, for a given module map.
 * Screens that are hidden by design (stock check opens from Settings, voice,
 * drafts, …) never appear here — they are module-guarded at the route level.
 *
 * TODO-PHASE4: append a 'tips' tab (gated by modules.tips) once the tips
 * surface ships. The gate exists today but must never show a broken screen,
 * so no tab is rendered yet.
 */
export function getVisibleEmployeeTabs(modules: EffectiveModules): string[] {
  const tabs: string[] = ['index'];
  if (modules.ordering_simple) tabs.push('simple-order');
  if (modules.ordering_advanced) tabs.push('quick-order');
  tabs.push('cart');
  tabs.push('settings');
  return tabs;
}

/** Manager tab-bar entries, in display order, for a given module map. */
export function getVisibleManagerTabs(modules: EffectiveModules): string[] {
  const tabs: string[] = ['index'];
  if (modules.ordering_advanced) tabs.push('quick-order');
  if (modules.fulfillment) tabs.push('fulfillment');
  tabs.push('profile');
  return tabs;
}
