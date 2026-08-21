// Name + PIN/password sign-in for the app.
//
// Anon-callable (like accept-invite): the caller has no session yet. The
// credential is verified inside Postgres (verify_login_credential — bcrypt
// compare + sliding-window rate limits per name and per client identifier);
// on success this function mints a one-shot magiclink token hash for the
// account and the client exchanges it with auth.verifyOtp for a real
// Supabase session. Secrets are never stored or logged here.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { corsHeadersForRequest } from "../_shared/cors.ts";
import { normalizeLoginName } from "../_shared/loginNames.ts";

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

const FAILURE_DELAY_MS = 350;

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

function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function failWithDelay(
  req: Request,
  code: "invalid" | "rate_limited" | "suspended",
): Promise<Response> {
  await delay(FAILURE_DELAY_MS);
  const messages: Record<string, string> = {
    invalid: "That name and PIN or password don't match",
    rate_limited: "Too many tries. Wait a few minutes, then try again",
    suspended: "This account is suspended. Ask the manager",
  };
  const status = code === "rate_limited" ? 429 : 401;
  return jsonResponse(req, { error: messages[code], code }, status);
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

  const record = payload as Record<string, unknown> | null;
  const name = typeof record?.name === "string" ? record.name : "";
  const secret = typeof record?.secret === "string" ? record.secret : "";

  if (!normalizeLoginName(name) || secret.length === 0) {
    return jsonResponse(req, { error: "Name and PIN or password are required" }, 400);
  }
  if (secret.length > 200) {
    return jsonResponse(req, { error: "Invalid credential" }, 400);
  }

  const clientHash = await sha256Hex(
    `${getClientIp(req)}:${req.headers.get("user-agent") ?? "unknown"}`,
  );

  const { data: verdict, error: verifyError } = await supabaseAdmin.rpc(
    "verify_login_credential",
    { p_login_name: name, p_secret: secret, p_client_hash: clientHash },
  );

  if (verifyError || !verdict || typeof verdict !== "object") {
    console.error("verify_login_credential failed", verifyError);
    return jsonResponse(req, { error: "Unable to sign in right now" }, 500);
  }

  const result = verdict as { ok?: boolean; code?: string; email?: string };
  if (result.ok !== true) {
    const code = result.code === "rate_limited" || result.code === "suspended"
      ? result.code
      : "invalid";
    return await failWithDelay(req, code);
  }

  if (!result.email) {
    console.error("verify_login_credential returned no email");
    return jsonResponse(req, { error: "Unable to sign in right now" }, 500);
  }

  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin
    .generateLink({ type: "magiclink", email: result.email });
  const tokenHash = linkData?.properties?.hashed_token ?? null;
  if (linkError || !tokenHash) {
    console.error("Unable to mint sign-in link", linkError);
    return jsonResponse(req, { error: "Unable to sign in right now" }, 500);
  }

  return jsonResponse(req, { ok: true, tokenHash });
});
