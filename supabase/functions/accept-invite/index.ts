import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { corsHeadersForRequest } from "../_shared/cors.ts";
import {
  inspectInviteState,
  type InviteInvalidReason,
  type InviteRole,
  type InviteState,
  isInviteRole,
  parseAcceptInviteInput,
} from "../_shared/invites.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

if (!supabaseUrl || !serviceRoleKey || !anonKey) {
  throw new Error(
    "Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_ANON_KEY",
  );
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface InviteRow {
  id: string;
  invited_name: string;
  role: string;
  module_preset: unknown;
  created_by: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}

const MODULE_KEYS = new Set([
  "ordering_simple",
  "ordering_advanced",
  "stock_check",
  "tips",
  "fulfillment",
]);

function jsonResponse(
  req: Request,
  body: Record<string, unknown>,
  status = 200,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeadersForRequest(req),
      "Content-Type": "application/json",
    },
  });
}

function hasAnonKey(req: Request): boolean {
  const apiKey = req.headers.get("apikey")?.trim();
  const authorization = req.headers.get("Authorization")?.trim();

  return apiKey === anonKey || authorization === `Bearer ${anonKey}`;
}

function inviteStateFromRow(invite: InviteRow | null): InviteState | null {
  if (!invite || !isInviteRole(invite.role)) return null;

  return {
    invitedName: invite.invited_name,
    role: invite.role,
    expiresAt: invite.expires_at,
    usedAt: invite.used_at,
    revokedAt: invite.revoked_at,
  };
}

function reasonMessage(reason: InviteInvalidReason): string {
  switch (reason) {
    case "used":
      return "This invite has already been used";
    case "expired":
      return "This invite has expired";
    case "revoked":
      return "This invite has been revoked";
    default:
      return "This invite is invalid";
  }
}

async function findInvite(
  token: string,
): Promise<{ invite: InviteRow | null; failed: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("invites")
    .select(
      "id, invited_name, role, module_preset, created_by, expires_at, used_at, revoked_at",
    )
    .eq("token", token)
    .maybeSingle();

  if (error) {
    console.error("Unable to read invite", error);
    return { invite: null, failed: true };
  }

  return { invite: (data as InviteRow | null) ?? null, failed: false };
}

function isModulePreset(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function applyInviteModulePreset(
  invite: InviteRow,
  userId: string,
): Promise<boolean> {
  if (!isModulePreset(invite.module_preset)) return true;

  const rows = Object.entries(invite.module_preset).flatMap(
    ([moduleKey, enabled]) => {
      if (!MODULE_KEYS.has(moduleKey) || typeof enabled !== "boolean") {
        return [];
      }

      return [{
        user_id: userId,
        module_key: moduleKey,
        enabled,
        updated_by: invite.created_by,
      }];
    },
  );

  if (rows.length === 0) return true;

  const { error } = await supabaseAdmin
    .from("user_modules")
    .upsert(rows, { onConflict: "user_id,module_key" });

  if (error) {
    console.error("Unable to apply invite module preset", error);
    return false;
  }

  return true;
}

async function removeUnclaimedUser(userId: string): Promise<void> {
  const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(
    userId,
  );
  if (authError) {
    console.error("Unable to delete unclaimed auth user", authError);
  }

  // Match the repository's auth-delete cleanup for environments without cascades.
  const [{ error: profileError }, { error: userError }] = await Promise.all([
    supabaseAdmin.from("profiles").delete().eq("id", userId),
    supabaseAdmin.from("users").delete().eq("id", userId),
  ]);
  if (profileError) {
    console.error("Unable to clean up unclaimed profile", profileError);
  }
  if (userError) {
    console.error("Unable to clean up unclaimed legacy user", userError);
  }
}

async function writeInviteeIdentity(input: {
  userId: string;
  email: string;
  fullName: string;
  role: InviteRole;
}): Promise<boolean> {
  const [{ error: profileError }, { error: userError }] = await Promise.all([
    supabaseAdmin.from("profiles").upsert({
      id: input.userId,
      email: input.email,
      full_name: input.fullName,
      role: input.role,
      provider: "email",
      profile_completed: true,
    }),
    supabaseAdmin.from("users").upsert({
      id: input.userId,
      email: input.email,
      name: input.fullName,
      role: input.role,
    }),
  ]);

  if (profileError) {
    console.error("Unable to set invited user profile", profileError);
  }
  if (userError) {
    console.error("Unable to set invited legacy user record", userError);
  }
  return !profileError && !userError;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersForRequest(req) });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  if (!hasAnonKey(req)) {
    return jsonResponse(req, { error: "Unauthorized" }, 401);
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(req, { error: "Invalid request body" }, 400);
  }

  const parsed = parseAcceptInviteInput(payload);
  if (!parsed.ok) return jsonResponse(req, { error: parsed.error }, 400);

  const lookup = await findInvite(parsed.value.token);
  if (lookup.failed) {
    return jsonResponse(req, { error: "Unable to validate invite" }, 500);
  }

  const validity = inspectInviteState(inviteStateFromRow(lookup.invite));
  if (parsed.value.validateOnly) {
    if (!validity.valid) {
      return jsonResponse(req, {
        valid: false,
        invitedName: null,
        role: null,
        reason: validity.reason,
      });
    }

    return jsonResponse(req, {
      valid: true,
      invitedName: validity.invitedName,
      role: validity.role,
    });
  }

  if (!validity.valid || !lookup.invite) {
    const reason = validity.valid ? "invalid" : validity.reason;
    return jsonResponse(req, { error: reasonMessage(reason), reason }, 409);
  }

  const fullName = parsed.value.name ?? validity.invitedName;
  const { data: created, error: createError } = await supabaseAdmin.auth.admin
    .createUser({
      email: parsed.value.email!,
      password: parsed.value.password!,
      email_confirm: true,
      user_metadata: {
        name: fullName,
        full_name: fullName,
        provider: "email",
      },
    });

  if (createError || !created.user) {
    console.error("Unable to create invited auth user", createError);
    return jsonResponse(req, {
      error: "Unable to create account with this email",
    }, 409);
  }

  const invitedUserId = created.user.id;
  const identityWritten = await writeInviteeIdentity({
    userId: invitedUserId,
    email: parsed.value.email!,
    fullName,
    role: validity.role,
  });
  if (!identityWritten) {
    await removeUnclaimedUser(invitedUserId);
    return jsonResponse(
      req,
      { error: "Unable to prepare invited account" },
      500,
    );
  }

  if (!await applyInviteModulePreset(lookup.invite, invitedUserId)) {
    await removeUnclaimedUser(invitedUserId);
    return jsonResponse(
      req,
      { error: "Unable to prepare invited account" },
      500,
    );
  }

  // This PostgREST call is a single SQL UPDATE ... WHERE ... RETURNING request.
  // The conditions make consumption atomic even when two clients submit the token together.
  const { data: consumed, error: consumeError } = await supabaseAdmin
    .from("invites")
    .update({ used_at: new Date().toISOString(), used_by: invitedUserId })
    .eq("token", parsed.value.token)
    .is("used_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id, role")
    .maybeSingle();

  if (consumeError || !consumed || !isInviteRole(consumed.role)) {
    if (consumeError) console.error("Unable to consume invite", consumeError);
    await removeUnclaimedUser(invitedUserId);
    return jsonResponse(
      req,
      { error: "This invite is no longer available", reason: "invalid" },
      409,
    );
  }

  return jsonResponse(req, { ok: true, role: consumed.role });
});
