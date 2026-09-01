import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2?no-dts";
import { corsHeadersForRequest } from "../_shared/cors.ts";
import { getRequesterFromToken } from "../_shared/reminders.ts";

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
      error: "Suspended accounts cannot revoke invites",
    }, 403);
  }
  if (requester.role !== "manager") {
    return jsonResponse(
      req,
      { error: "Only managers can revoke invites" },
      403,
    );
  }

  let inviteId = "";
  try {
    const payload = await req.json();
    inviteId = typeof payload?.inviteId === "string"
      ? payload.inviteId.trim()
      : "";
  } catch {
    return jsonResponse(req, { error: "Invalid request body" }, 400);
  }

  if (!inviteId) {
    return jsonResponse(req, { error: "inviteId is required" }, 400);
  }

  const { data, error } = await supabaseAdmin
    .from("invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", inviteId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Unable to revoke invite", error);
    return jsonResponse(req, { error: "Unable to revoke invite" }, 500);
  }
  if (!data) return jsonResponse(req, { error: "Invite not found" }, 404);

  return jsonResponse(req, { ok: true });
});
