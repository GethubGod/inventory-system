import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2?no-dts";
import { corsHeadersForRequest } from "../_shared/cors.ts";
import {
  inspectInviteState,
  type InviteInvalidReason,
  type InviteLocationGroup,
  type InviteRole,
  type InviteState,
  isInviteLocationGroup,
  isInviteRole,
  parseAcceptInviteInput,
  resolveLocationGroupToLocationId,
} from "../_shared/invites.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim() ?? "";
const publishableKeys = [
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY"),
  ...(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "").split(","),
].map((key) => key?.trim()).filter((key): key is string => Boolean(key));

if (!supabaseUrl || !serviceRoleKey || (!anonKey && publishableKeys.length === 0)) {
  throw new Error(
    "Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or a public API key",
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
  created_by: string | null;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  location_group: string | null;
}

const MODULE_KEYS = new Set([
  "ordering_simple",
  "ordering_advanced",
  "stock_check",
  "tips",
  "fulfillment",
  "kitchen_requests",
  "kitchen_display",
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

  if (apiKey && (apiKey === anonKey || publishableKeys.includes(apiKey))) {
    return true;
  }

  // Legacy anon JWTs may be bearer tokens. Publishable keys are not JWTs and
  // are deliberately accepted only through the apikey header.
  return Boolean(anonKey && authorization === `Bearer ${anonKey}`);
}

function inviteStateFromRow(invite: InviteRow | null): InviteState | null {
  if (!invite || !isInviteRole(invite.role)) return null;

  return {
    invitedName: invite.invited_name,
    role: invite.role,
    locationGroup: isInviteLocationGroup(invite.location_group)
      ? invite.location_group
      : "both",
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
      "id, invited_name, role, module_preset, created_by, expires_at, used_at, revoked_at, location_group",
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

async function installOnboardingCredential(input: {
  userId: string;
  kind: "pin" | "password";
  secret: string;
}): Promise<boolean> {
  const { error } = await supabaseAdmin.rpc(
    "set_onboarding_login_credential",
    {
      p_user_id: input.userId,
      p_kind: input.kind,
      p_secret: input.secret,
    },
  );

  if (error) {
    console.error("Unable to install onboarding credential", error);
    return false;
  }
  return true;
}

/** 32 random bytes, base64url — set once at account creation, never used again. */
function generateDiscardedPassword(): string {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  let binary = "";
  for (const byte of raw) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Resolves the invite's works-at group to users.default_location_id.
 * Best-effort: a resolution failure must not strand a created account, so
 * errors are logged and acceptance continues (location is manager-editable
 * from the employee detail screen at any time).
 */
async function applyInviteLocation(
  locationGroup: InviteLocationGroup,
  userId: string,
): Promise<void> {
  if (locationGroup === "both") return;

  const { data: locations, error: locationsError } = await supabaseAdmin
    .from("locations")
    .select("id, short_code")
    .eq("active", true);
  if (locationsError) {
    console.error("Unable to read locations for invite", locationsError);
    return;
  }

  const locationId = resolveLocationGroupToLocationId(
    locationGroup,
    locations ?? [],
  );
  if (!locationId) {
    console.error(`No active location matches invite group ${locationGroup}`);
    return;
  }

  const { error: updateError } = await supabaseAdmin
    .from("users")
    .update({ default_location_id: locationId })
    .eq("id", userId);
  if (updateError) {
    console.error("Unable to set invited user's location", updateError);
  }
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
      locationGroup: validity.locationGroup,
    });
  }

  if (!validity.valid || !lookup.invite) {
    const reason = validity.valid ? "invalid" : validity.reason;
    return jsonResponse(req, { error: reasonMessage(reason), reason }, 409);
  }

  // Onboarding mode (the in-app invited setup flow) has no email/password:
  // the account is minted under a synthetic address on a domain we own and a
  // discarded random password. The user signs in with name + PIN/password via
  // login-with-name from then on; this response's one-shot tokenHash gives the
  // client its first session so it can store that credential.
  const onboarding = parsed.value.mode === "onboarding";
  const accountEmail = onboarding
    ? `join-${lookup.invite.id}@members.babytunasystems.com`
    : parsed.value.email!;
  const accountPassword = onboarding
    ? generateDiscardedPassword()
    : parsed.value.password!;

  const fullName = parsed.value.name ?? validity.invitedName;
  const { data: created, error: createError } = await supabaseAdmin.auth.admin
    .createUser({
      email: accountEmail,
      password: accountPassword,
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
      error: onboarding
        ? "Unable to create the account for this invite"
        : "Unable to create account with this email",
    }, 409);
  }

  const invitedUserId = created.user.id;
  const identityWritten = await writeInviteeIdentity({
    userId: invitedUserId,
    email: accountEmail,
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

  if (
    onboarding &&
    !await installOnboardingCredential({
      userId: invitedUserId,
      kind: parsed.value.credentialKind!,
      secret: parsed.value.credentialSecret!,
    })
  ) {
    await removeUnclaimedUser(invitedUserId);
    return jsonResponse(
      req,
      { error: "Unable to save sign-in details for this account" },
      500,
    );
  }

  await applyInviteLocation(validity.locationGroup, invitedUserId);

  // Mint the onboarding session token BEFORE consuming the invite so a
  // failure here still leaves the invite reusable after cleanup.
  let sessionTokenHash: string | null = null;
  if (onboarding) {
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin
      .generateLink({ type: "magiclink", email: accountEmail });
    sessionTokenHash = linkData?.properties?.hashed_token ?? null;
    if (linkError || !sessionTokenHash) {
      console.error("Unable to mint onboarding session link", linkError);
      await removeUnclaimedUser(invitedUserId);
      return jsonResponse(
        req,
        { error: "Unable to prepare invited account" },
        500,
      );
    }
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

  if (onboarding) {
    return jsonResponse(req, {
      ok: true,
      role: consumed.role,
      locationGroup: validity.locationGroup,
      tokenHash: sessionTokenHash,
    });
  }

  return jsonResponse(req, { ok: true, role: consumed.role });
});
