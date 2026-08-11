import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { corsHeadersForRequest } from "../_shared/cors.ts";
import { getRequesterFromToken } from "../_shared/reminders.ts";
import {
  createInviteToken,
  parseCreateInviteInput,
} from "../_shared/invites.ts";

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
        module_preset: parsed.value.modulePreset,
        expires_at: expiresAt,
        created_by: requester.userId,
      })
      .select("id")
      .single();

    if (!error && data?.id) {
      return jsonResponse(req, {
        inviteId: data.id,
        token,
        joinUrl: `https://tips.babytunasystems.com/join/${token}`,
      });
    }

    if (!isUniqueViolation(error)) {
      console.error("Unable to create invite", error);
      return jsonResponse(req, { error: "Unable to create invite" }, 500);
    }
  }

  return jsonResponse(req, { error: "Unable to create invite" }, 500);
});
