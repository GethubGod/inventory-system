// Per-user module toggles (Phase 3) — dashboard-side mirror of the app's
// src/services/userModules.ts. Reads go through rpc get_effective_modules
// (role defaults centralized in SQL); writes upsert user_modules rows with
// updated_by set to the signed-in manager, exactly like the app service.

import { getSupabase } from "@/lib/supabase";
import type { TeamRole } from "@/lib/dashboard/team";

export const MODULE_KEYS = [
  "ordering_simple",
  "ordering_advanced",
  "stock_check",
  "tips",
  "fulfillment",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export type ModuleMap = Record<ModuleKey, boolean>;

export const MODULE_LABELS: Record<ModuleKey, string> = {
  ordering_simple: "Simple ordering",
  ordering_advanced: "Advanced ordering (Beta)",
  stock_check: "Stock check",
  tips: "Tips",
  fulfillment: "Fulfillment",
};

export function isModuleKey(value: unknown): value is ModuleKey {
  return (
    typeof value === "string" && MODULE_KEYS.includes(value as ModuleKey)
  );
}

/**
 * Client-side mirror of the SQL role defaults in get_effective_modules
 * (employee → ordering_simple + stock_check; manager → everything; see
 * 20260820121000_ordering_simple_default_on.sql). Used to preset the
 * invite modal and as a safety net for missing keys — the RPC remains the
 * source of truth for effective values.
 */
export function getRoleDefaultModules(role: TeamRole): ModuleMap {
  const isManager = role === "manager";
  return {
    ordering_simple: true,
    ordering_advanced: isManager,
    stock_check: true,
    tips: isManager,
    fulfillment: isManager,
  };
}

/**
 * Module keys a manager can toggle for a user of the given role. Fulfillment
 * is a manager-side surface, so employee rows never expose it.
 */
export function moduleKeysForRole(role: TeamRole): ModuleKey[] {
  return role === "manager"
    ? [...MODULE_KEYS]
    : MODULE_KEYS.filter((key) => key !== "fulfillment");
}

/**
 * Fold RPC rows into a full module map. Unknown keys and malformed rows are
 * ignored; missing keys fall back to the role defaults.
 */
export function toModuleMap(
  rows: Array<{ module_key: string; enabled: unknown }> | null | undefined,
  role: TeamRole,
): ModuleMap {
  const map = getRoleDefaultModules(role);
  for (const row of rows ?? []) {
    if (isModuleKey(row.module_key) && typeof row.enabled === "boolean") {
      map[row.module_key] = row.enabled;
    }
  }
  return map;
}

/** Effective module set for any user (managers only, enforced by the RPC). */
export async function fetchModulesForUser(
  userId: string,
  role: TeamRole,
): Promise<ModuleMap> {
  const { data, error } = await getSupabase().rpc("get_effective_modules", {
    p_user_id: userId,
  });
  if (error) throw new Error(error.message);
  return toModuleMap(data, role);
}

/** Upsert one per-user module override, recording who changed it. */
export async function setUserModule(
  userId: string,
  key: ModuleKey,
  enabled: boolean,
): Promise<void> {
  const supabase = getSupabase();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) throw new Error(authError.message);
  const updatedBy = auth.user?.id;
  if (!updatedBy) {
    throw new Error("You must be signed in to manage modules.");
  }

  const { error } = await supabase.from("user_modules").upsert(
    {
      user_id: userId,
      module_key: key,
      enabled,
      updated_by: updatedBy,
    },
    { onConflict: "user_id,module_key" },
  );
  if (error) throw new Error(error.message);
}

/**
 * Build the invite modulePreset body ({module_key: boolean}) from a selection,
 * restricted to the keys valid for the invited role.
 */
export function buildModulePreset(
  role: TeamRole,
  selection: ModuleMap,
): Record<string, boolean> {
  const preset: Record<string, boolean> = {};
  for (const key of moduleKeysForRole(role)) {
    preset[key] = selection[key];
  }
  return preset;
}
