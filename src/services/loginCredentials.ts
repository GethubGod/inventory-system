// Name + PIN/password credentials (onboarding/auth phase).
//
// Secrets are bcrypt-hashed inside Postgres (see
// supabase/migrations/20260820123000_login_credentials.sql) and verified by
// the login-with-name edge function, which is rate limited per name and per
// client. Sign-in yields a real Supabase session: the function returns a
// one-shot magiclink token hash and this service exchanges it via verifyOtp,
// then hydrates the auth store. Session persistence is unchanged
// (SecureStore via the shared supabase client).

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';

export type CredentialKind = 'pin' | 'password';

export type LoginFailureCode = 'invalid' | 'rate_limited' | 'suspended';

export const PIN_LENGTH = 4;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 256;

const LOGIN_FAILURE_MESSAGES: Record<LoginFailureCode, string> = {
  invalid: "That name and PIN or password don't match",
  rate_limited: 'Too many tries. Wait a few minutes, then try again',
  suspended: 'This account is suspended. Ask the manager',
};

export class LoginCredentialError extends Error {
  code: LoginFailureCode;

  constructor(code: LoginFailureCode, message?: string) {
    super(message ?? LOGIN_FAILURE_MESSAGES[code]);
    this.code = code;
  }
}

export function getLoginFailureCode(error: unknown): LoginFailureCode | null {
  return error instanceof LoginCredentialError ? error.code : null;
}

export function isValidPin(secret: string): boolean {
  return /^[0-9]{4}$/.test(secret);
}

export function isValidPassword(secret: string): boolean {
  return secret.length >= MIN_PASSWORD_LENGTH && secret.length <= MAX_PASSWORD_LENGTH;
}

function readFailureCode(value: unknown): LoginFailureCode | null {
  return value === 'invalid' || value === 'rate_limited' || value === 'suspended' ? value : null;
}

interface FunctionErrorBody {
  message: string | null;
  code: LoginFailureCode | null;
}

async function getFunctionErrorBody(error: unknown): Promise<FunctionErrorBody> {
  if (error && typeof error === 'object' && 'context' in error) {
    const context: unknown = error.context;
    if (context && typeof context === 'object') {
      if ('error' in context && typeof context.error === 'string') {
        return { message: context.error, code: readFailureCode('code' in context ? context.code : null) };
      }
      if ('json' in context && typeof context.json === 'function') {
        try {
          const payload: unknown = await context.json();
          if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
            return { message: payload.error, code: readFailureCode('code' in payload ? payload.code : null) };
          }
        } catch {
          // The response body may have already been consumed.
        }
      }
    }
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const message = error.message;
    if (typeof message === 'string') {
      const normalized = message.toLowerCase();
      if (normalized.includes('failed to send a request') || normalized.includes('network request failed') || normalized.includes('failed to fetch')) {
        return { message: 'Unable to connect. Check your connection and try again.', code: null };
      }
      if (!normalized.includes('edge function')) return { message, code: null };
    }
  }

  return { message: null, code: null };
}

function friendlyRpcMessage(error: { message?: string }, fallback: string): string {
  const message = typeof error.message === 'string' ? error.message : '';
  // Postgres RAISE messages in this feature are written for people; pass the
  // useful ones through and hide internals.
  if (
    message &&
    !message.toLowerCase().includes('function') &&
    !message.toLowerCase().includes('schema')
  ) {
    return message;
  }
  return fallback;
}

/** Reads public credential metadata only. A missing identity is a legacy email account. */
export async function getMyCredentialKind(userId: string): Promise<CredentialKind | null> {
  if (!userId) throw new Error('Sign in again to change your sign-in details.');
  const { data, error } = await supabase
    .from('login_identities')
    .select('credential_kind')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error('Unable to load your sign-in settings. Check your connection and try again.');
  if (!data) return null;
  const kind: unknown = data.credential_kind;
  if (kind !== 'pin' && kind !== 'password') throw new Error('Unable to read your sign-in settings. Contact support.');
  return kind;
}

/**
 * Stores the signed-in user's own credential (onboarding step 2). The account
 * must already exist and have a session — accept-invite creates it first.
 */
export async function setMyCredential(kind: CredentialKind, secret: string): Promise<void> {
  if (kind === 'pin' && !isValidPin(secret)) {
    throw new Error('PIN must be exactly 4 digits');
  }
  if (kind === 'password' && !isValidPassword(secret)) {
    throw new Error(
      `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`,
    );
  }

  const { error } = await supabase.rpc('set_my_login_credential', {
    p_kind: kind,
    p_secret: secret,
  });

  if (error) {
    throw new Error(friendlyRpcMessage(error, 'Unable to save your sign-in details. Try again.'));
  }
}

/**
 * Name + PIN/password sign-in. Establishes a real Supabase session (persisted
 * exactly like every other sign-in path) and hydrates the auth store.
 * Throws LoginCredentialError with a code for inline error rendering.
 */
export async function signInWithName(name: string, secret: string): Promise<void> {
  const trimmedName = name.trim();
  if (!trimmedName || !secret) {
    throw new LoginCredentialError('invalid');
  }

  const { data, error } = await supabase.functions.invoke('login-with-name', {
    body: { name: trimmedName, secret },
  });

  if (error) {
    const { message, code } = await getFunctionErrorBody(error);
    if (code) throw new LoginCredentialError(code, message ?? undefined);
    throw new Error(message ?? 'Unable to sign in right now. Check your connection.');
  }

  const payload = data as { ok?: unknown; tokenHash?: unknown; error?: unknown } | null;
  const tokenHash =
    payload?.ok === true && typeof payload.tokenHash === 'string' && payload.tokenHash
      ? payload.tokenHash
      : null;
  if (!tokenHash) {
    const message = typeof payload?.error === 'string' ? payload.error : null;
    throw new Error(message ?? 'Unexpected response while signing in.');
  }

  const { data: verified, error: verifyError } = await supabase.auth.verifyOtp({
    type: 'magiclink',
    token_hash: tokenHash,
  });
  if (verifyError || !verified.session) {
    throw new Error(verifyError?.message ?? 'Unable to start your session. Try again.');
  }

  await useAuthStore.getState().adoptExternalSession(verified.session);
}

/**
 * Manager reset (employee detail screen). Always resets to a 4-digit PIN;
 * suspended targets are refused server-side.
 */
export async function resetUserCredential(userId: string, newPin: string): Promise<void> {
  if (!isValidPin(newPin)) {
    throw new Error('PIN must be exactly 4 digits');
  }

  const { error } = await supabase.rpc('reset_login_credential', {
    p_user_id: userId,
    p_pin: newPin,
  });

  if (error) {
    throw new Error(friendlyRpcMessage(error, 'Unable to reset the PIN. Try again.'));
  }
}
