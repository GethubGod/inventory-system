// Team roster API — thin wrappers over the existing user-management edge
// functions. Both require the signed-in manager's JWT, which
// supabase.functions.invoke attaches automatically from the current session.

import { getSupabase } from "@/lib/supabase";

export type TeamRole = "manager" | "employee";

export interface TeamUser {
  id: string;
  email: string;
  full_name: string | null;
  role: TeamRole;
  is_suspended: boolean;
  last_active_at: string | null;
  last_order_at: string | null;
  created_at: string | null;
}

/** Pull a human-readable message out of a FunctionsError (edge fns return {error}). */
async function describeFunctionsError(err: unknown): Promise<string> {
  const context = (err as { context?: Response }).context;
  if (context && typeof context.json === "function") {
    try {
      const body = (await context.json()) as { error?: unknown };
      if (typeof body?.error === "string") return body.error;
    } catch {
      // fall through to generic message
    }
  }
  return err instanceof Error ? err.message : "Request failed";
}

export async function fetchTeam(): Promise<TeamUser[]> {
  const { data, error } = await getSupabase().functions.invoke("list-users", {
    body: {},
  });
  if (error) throw new Error(await describeFunctionsError(error));
  const users = (data as { users?: TeamUser[] } | null)?.users;
  if (!Array.isArray(users)) {
    throw new Error("Unexpected response from list-users");
  }
  return users;
}

export async function setUserSuspended(
  userId: string,
  isSuspended: boolean,
): Promise<void> {
  const { error } = await getSupabase().functions.invoke("set-user-suspended", {
    body: { userId, isSuspended },
  });
  if (error) throw new Error(await describeFunctionsError(error));
}
