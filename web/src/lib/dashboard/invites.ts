// Invite links (Phase 2b) — pure status/link helpers plus thin wrappers over
// the create-invite / revoke-invite edge functions and RLS-scoped reads of the
// `invites` table (managers only). Request/response shapes follow
// docs/phases/phase2-contract.md ("2b scope").

import { getSupabase } from "@/lib/supabase";

export type InviteRole = "employee" | "manager";

export type InviteStatus = "pending" | "used" | "expired" | "revoked";

/** Row shape of the `invites` table (see the 2b migration in the contract). */
export interface InviteRow {
  id: string;
  token: string;
  invited_name: string;
  role: InviteRole;
  expires_at: string | null;
  created_at: string;
  used_at: string | null;
  revoked_at: string | null;
}

export const JOIN_LINK_BASE = "https://tips.babytunasystems.com/join";

/** Personalized join link for a token: https://tips.babytunasystems.com/join/<token> */
export function buildJoinUrl(token: string): string {
  return `${JOIN_LINK_BASE}/${encodeURIComponent(token)}`;
}

/**
 * Derive the display status of an invite. Precedence: a consumed invite stays
 * "used" (it did its job, even if later revoked or past expiry); an
 * unconsumed revoked invite is "revoked" regardless of expiry.
 */
export function deriveInviteStatus(
  invite: Pick<InviteRow, "used_at" | "revoked_at" | "expires_at">,
  now: Date = new Date(),
): InviteStatus {
  if (invite.used_at) return "used";
  if (invite.revoked_at) return "revoked";
  if (invite.expires_at) {
    const expires = new Date(invite.expires_at);
    if (!Number.isNaN(expires.getTime()) && expires.getTime() <= now.getTime()) {
      return "expired";
    }
  }
  return "pending";
}

export interface ExpiryOption {
  label: string;
  hours: number;
}

export const EXPIRY_OPTIONS: ExpiryOption[] = [
  { label: "24 hours", hours: 24 },
  { label: "3 days", hours: 72 },
  { label: "7 days", hours: 168 },
  { label: "30 days", hours: 720 },
];

export const DEFAULT_EXPIRY_HOURS = 168;

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

export interface CreatedInvite {
  token: string;
  joinUrl: string;
}

export async function createInvite(input: {
  invitedName: string;
  role: InviteRole;
  expiresInHours: number;
}): Promise<CreatedInvite> {
  const { data, error } = await getSupabase().functions.invoke("create-invite", {
    body: {
      invitedName: input.invitedName,
      role: input.role,
      expiresInHours: input.expiresInHours,
    },
  });
  if (error) throw new Error(await describeFunctionsError(error));
  const payload = data as { token?: unknown; joinUrl?: unknown } | null;
  if (typeof payload?.token !== "string" || !payload.token) {
    throw new Error("Unexpected response from create-invite");
  }
  return {
    token: payload.token,
    joinUrl:
      typeof payload.joinUrl === "string" && payload.joinUrl
        ? payload.joinUrl
        : buildJoinUrl(payload.token),
  };
}

export async function revokeInvite(inviteId: string): Promise<void> {
  const { error } = await getSupabase().functions.invoke("revoke-invite", {
    body: { inviteId },
  });
  if (error) throw new Error(await describeFunctionsError(error));
}

/** Managers read invites directly via RLS (contract: managers full access). */
export async function fetchInvites(): Promise<InviteRow[]> {
  const { data, error } = await getSupabase()
    .from("invites")
    .select("id, token, invited_name, role, expires_at, created_at, used_at, revoked_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as InviteRow[];
}
