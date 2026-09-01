import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2?no-dts";
import { corsHeadersForRequest } from "../_shared/cors.ts";
import { getRequesterFromToken } from "../_shared/reminders.ts";
import {
  createInviteToken,
  mergeInviteModulePreset,
  parseCreateInviteInput,
} from "../_shared/invites.ts";
import { normalizeLoginName } from "../_shared/loginNames.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "23505",
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersForRequest(req) });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse(req, { error: "Unauthorized" }, 401);
  }

  const requester = await getRequesterFromToken(
    supabaseAdmin,
    authHeader.slice("Bearer ".length).trim(),
  );
  if (!requester) return jsonResponse(req, { error: "Unauthorized" }, 401);
  if (requester.suspended) {
    return jsonResponse(req, {
      error: "Suspended accounts cannot create invites",
    }, 403);
  }
  if (requester.role !== "manager") {
    return jsonResponse(
      req,
      { error: "Only managers can create invites" },
      403,
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(req, { error: "Invalid request body" }, 400);
  }

  const parsed = parseCreateInviteInput(payload);
  if (!parsed.ok) return jsonResponse(req, { error: parsed.error }, 400);

  // Sign-in names must stay unique (case/whitespace-insensitive) among
  // credential holders and open invites, so collisions surface here — at
  // creation, where the manager can adjust the name — not at accept time.
  const normalizedName = normalizeLoginName(parsed.value.invitedName);
  if (normalizedName) {
    const [identityLookup, openInvitesLookup] = await Promise.all([
      supabaseAdmin
        .from("login_identities")
        .select("user_id")
        .eq("login_name", normalizedName)
        .maybeSingle(),
      supabaseAdmin
        .from("invites")
        .select("invited_name")
        .is("used_at", null)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString()),
    ]);

    if (identityLookup.error || openInvitesLookup.error) {
      console.error(
        "Unable to check invite name uniqueness",
        identityLookup.error ?? openInvitesLookup.error,
      );
      return jsonResponse(req, { error: "Unable to create invite" }, 500);
    }

    const openInviteCollision = (openInvitesLookup.data ?? []).some(
      (invite) => normalizeLoginName(invite.invited_name) === normalizedName,
    );

    if (identityLookup.data || openInviteCollision) {
      return jsonResponse(req, {
        error:
          `Someone already signs in as "${parsed.value.invitedName}". Use a different name, like a last initial.`,
        reason: "name_taken",
      }, 409);
    }
  }

  // Seed employee invites from the org-wide defaults when the caller did not
  // pick modules explicitly. A missing config row just means no preset.
  let modulePreset: Record<string, unknown> = parsed.value.modulePreset ?? {};
  if (parsed.value.modulePreset === null) {
    const { data: defaultsRow, error: defaultsError } = await supabaseAdmin
      .from("app_config")
      .select("value")
      .eq("key", "employee_invite_module_defaults")
      .maybeSingle();
    if (defaultsError) {
      console.error("Unable to read employee invite defaults", defaultsError);
    }
    modulePreset = mergeInviteModulePreset(
      parsed.value.role,
      null,
      defaultsRow?.value ?? null,
    );
  }

  const expiresAt = new Date(
    Date.now() + parsed.value.expiresInHours * 60 * 60 * 1000,
  ).toISOString();

  // A collision is astronomically unlikely with 192 bits of entropy, but retry it
  // so a database uniqueness response never leaks through as a failed invite.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = createInviteToken();
    const { data, error } = await supabaseAdmin
      .from("invites")
      .insert({
        token,
        invited_name: parsed.value.invitedName,
        role: parsed.value.role,
        module_preset: modulePreset,
        expires_at: expiresAt,
        created_by: requester.userId,
        location_group: parsed.value.locationGroup,
      })
      .select("id")
      .single();

    if (!error && data?.id) {
      return jsonResponse(req, {
        inviteId: data.id,
        token,
        joinUrl: `https://tips.babytunasystems.com/join/${token}`,
        locationGroup: parsed.value.locationGroup,
      });
    }

    if (!isUniqueViolation(error)) {
      console.error("Unable to create invite", error);
      return jsonResponse(req, { error: "Unable to create invite" }, 500);
    }
  }

  return jsonResponse(req, { error: "Unable to create invite" }, 500);
});
