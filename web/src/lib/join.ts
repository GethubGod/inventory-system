// Public /join/[token] page helpers — no auth, dashboard-independent.
// Validates a token via the accept-invite edge fn dry-run mode
// ({token, validateOnly: true}) per docs/phases/phase2-contract.md.

import { getSupabase } from "@/lib/supabase";

export type JoinRole = "employee" | "manager";

export type InviteFailureReason = "used" | "expired" | "revoked" | "invalid";

export type InviteValidation =
  | { ok: true; invitedName: string | null; role: JoinRole | null }
  | { ok: false; reason: InviteFailureReason; message: string };

export const APP_DEEP_LINK_SCHEME = "babytunasystems";

/** Deep link that opens the app's join flow: babytunasystems://join?token=<token> */
export function buildAppDeepLink(token: string): string {
  return `${APP_DEEP_LINK_SCHEME}://join?token=${encodeURIComponent(token)}`;
}

/**
 * Map a server error message onto a display reason. The backend owns the
 * exact wording; we only look for the stable keywords (used/expired/revoked).
 */
export function classifyInviteFailure(message: string): InviteFailureReason {
  const lower = message.toLowerCase();
  if (lower.includes("used")) return "used";
  if (lower.includes("revok")) return "revoked";
  if (lower.includes("expir")) return "expired";
  return "invalid";
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readReason(value: unknown): InviteFailureReason | null {
  return value === "used" || value === "expired" || value === "revoked" || value === "invalid"
    ? value
    : null;
}

function readRole(value: unknown): JoinRole | null {
  return value === "employee" || value === "manager" ? value : null;
}

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

/** Dry-run accept-invite to check a token and greet the invitee by name. */
export async function validateInviteToken(
  token: string,
): Promise<InviteValidation> {
  let data: unknown = null;
  let error: unknown = null;
  try {
    const result = await getSupabase().functions.invoke("accept-invite", {
      body: { token, validateOnly: true },
    });
    data = result.data;
    error = result.error;
  } catch (err) {
    error = err;
  }

  if (error) {
    const message = await describeFunctionsError(error);
    return { ok: false, reason: classifyInviteFailure(message), message };
  }

  const payload = data as
    | {
        ok?: unknown;
        valid?: unknown;
        error?: unknown;
        reason?: unknown;
        invitedName?: unknown;
        invited_name?: unknown;
        role?: unknown;
      }
    | null;

  // Backend dry-run responds {valid, invitedName, role, reason} (see
  // supabase/functions/accept-invite); tolerate legacy {ok} too.
  if (payload?.ok !== true && payload?.valid !== true) {
    const structured = readReason(payload?.reason);
    const message = readString(payload?.error) ?? "This invite link is not valid.";
    return { ok: false, reason: structured ?? classifyInviteFailure(message), message };
  }

  return {
    ok: true,
    invitedName: readString(payload.invitedName) ?? readString(payload.invited_name),
    role: readRole(payload.role),
  };
}
