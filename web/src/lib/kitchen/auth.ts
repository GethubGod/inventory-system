// Sign-in for /kitchen. Employees have a name + PIN (or password) set up in
// the app; that goes through the login-with-name edge function, which
// verifies the credential in Postgres and returns a one-shot magic-link
// token hash we exchange for a real session. Managers can also use their
// email + password. Both end in the same Supabase session.

import { getSupabase } from "@/lib/supabase";

export type SignInErrorCode =
  "invalid" | "rate_limited" | "suspended" | "network" | "unknown";

export class SignInError extends Error {
  readonly code: SignInErrorCode;

  constructor(code: SignInErrorCode, message: string) {
    super(message);
    this.name = "SignInError";
    this.code = code;
  }
}

const FALLBACK_MESSAGES: Record<SignInErrorCode, string> = {
  invalid: "That name and PIN or password don't match",
  rate_limited: "Too many tries. Wait a few minutes, then try again",
  suspended: "This account is suspended. Ask the manager",
  network: "Couldn't reach smelter. Check your connection and try again",
  unknown: "Unable to sign in right now",
};

async function readFunctionError(
  error: unknown,
): Promise<{ message: string | null; code: SignInErrorCode | null }> {
  const context = (error as { context?: Response }).context;
  if (context && typeof context.json === "function") {
    try {
      const body = (await context.json()) as {
        error?: unknown;
        code?: unknown;
      };
      const code =
        body.code === "invalid" ||
        body.code === "rate_limited" ||
        body.code === "suspended"
          ? body.code
          : null;
      return {
        message: typeof body.error === "string" ? body.error : null,
        code,
      };
    } catch {
      // fall through
    }
  }
  return { message: error instanceof Error ? error.message : null, code: null };
}

export async function signInWithName(
  name: string,
  secret: string,
): Promise<void> {
  const trimmedName = name.trim();
  if (!trimmedName || !secret) {
    throw new SignInError("invalid", FALLBACK_MESSAGES.invalid);
  }
  const supabase = getSupabase();
  const { data, error } = await supabase.functions.invoke("login-with-name", {
    body: { name: trimmedName, secret },
  });
  if (error) {
    const { message, code } = await readFunctionError(error);
    if (code) throw new SignInError(code, message ?? FALLBACK_MESSAGES[code]);
    // supabase-js raises FunctionsFetchError when the request never left the
    // device; its message does not say "network", so check the class name.
    const isNetwork =
      (error as { name?: unknown }).name === "FunctionsFetchError" ||
      /fetch|network|load failed/i.test(message ?? "");
    throw new SignInError(
      isNetwork ? "network" : "unknown",
      isNetwork
        ? FALLBACK_MESSAGES.network
        : (message ?? FALLBACK_MESSAGES.unknown),
    );
  }
  const payload = data as {
    ok?: unknown;
    tokenHash?: unknown;
    error?: unknown;
  } | null;
  const tokenHash =
    payload?.ok === true &&
    typeof payload.tokenHash === "string" &&
    payload.tokenHash
      ? payload.tokenHash
      : null;
  if (!tokenHash) {
    throw new SignInError(
      "unknown",
      typeof payload?.error === "string"
        ? payload.error
        : FALLBACK_MESSAGES.unknown,
    );
  }
  const { data: verified, error: verifyError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (verifyError || !verified.session) {
    throw new SignInError(
      "unknown",
      verifyError?.message ?? "Unable to start your session. Try again",
    );
  }
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<void> {
  const { error } = await getSupabase().auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) {
    const isNetwork = /fetch|network|load failed/i.test(error.message);
    throw new SignInError(
      isNetwork ? "network" : "invalid",
      isNetwork ? FALLBACK_MESSAGES.network : error.message,
    );
  }
}
