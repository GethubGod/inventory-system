// Invite-link signup (Phase 2b) — accept-invite edge function wrappers plus
// the pure deep-link/token helpers behind the babytunasystems://join?token=…
// flow. The access-code path (services/accessCodes.ts) stays fully intact;
// invites are an alternative entry into the same signup screen.

import { supabase } from '@/lib/supabase';
import { UserRole } from '@/types';
import {
  classifyInviteFailure,
  describeInviteFailure,
  type InviteFailureReason,
} from '@/services/inviteLinks';

export {
  classifyInviteFailure,
  describeInviteFailure,
  parseJoinToken,
  type InviteFailureReason,
} from '@/services/inviteLinks';

export type InviteLocationGroup = 'sushi' | 'poki' | 'both';

export interface InvitePreview {
  invitedName: string | null;
  role: UserRole | null;
  locationGroup: InviteLocationGroup;
}

export interface AcceptInviteInput {
  token: string;
  email: string;
  password: string;
  name: string;
}

export interface CreateInviteInput {
  invitedName: string;
  role: 'employee' | 'manager';
  expiresInHours: number;
  modulePreset: Record<string, boolean>;
  locationGroup: InviteLocationGroup;
}

export interface CreatedInvite {
  inviteId: string;
  token: string;
  joinUrl: string;
  locationGroup: InviteLocationGroup;
}

export interface OnboardingAcceptResult {
  role: UserRole;
  locationGroup: InviteLocationGroup;
  /** One-shot magiclink token hash; exchange via auth.verifyOtp for a session. */
  tokenHash: string;
}

interface FunctionErrorDetails {
  message: string | null;
  /** Structured reason from the error body, when the backend sent one. */
  reason: InviteFailureReason | null;
}

async function getFunctionErrorDetails(error: unknown): Promise<FunctionErrorDetails> {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: any }).context;

    if (context) {
      // Newer supabase-js: context is the already-parsed JSON body
      if (typeof context === 'object' && !(context instanceof Response) && typeof context.error === 'string') {
        return { message: context.error, reason: readReason(context.reason) };
      }

      // Older supabase-js: context is a Response object
      if (typeof context.json === 'function') {
        try {
          const payload = await context.json();
          if (typeof payload?.error === 'string') {
            return { message: payload.error, reason: readReason(payload?.reason) };
          }
        } catch {
          // body already consumed or not JSON – fall through
        }
      }
    }
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (
      typeof message === 'string' &&
      !message.toLowerCase().includes('edge function returned a non-2xx')
    ) {
      return { message, reason: null };
    }
  }

  return { message: null, reason: null };
}

function readRole(value: unknown): UserRole | null {
  return value === 'employee' || value === 'manager' ? value : null;
}

function readReason(value: unknown): InviteFailureReason | null {
  return value === 'used' || value === 'expired' || value === 'revoked' || value === 'invalid'
    ? value
    : null;
}

function readName(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readLocationGroup(value: unknown): InviteLocationGroup {
  return value === 'sushi' || value === 'poki' || value === 'both' ? value : 'both';
}

class InviteError extends Error {
  reason: InviteFailureReason;

  constructor(reason: InviteFailureReason, message?: string) {
    super(message ?? describeInviteFailure(reason));
    this.reason = reason;
  }
}

export function getInviteFailureReason(error: unknown): InviteFailureReason | null {
  return error instanceof InviteError ? error.reason : null;
}

/**
 * Dry-run validation ({token, validateOnly: true}) — shows the invitee their
 * name/role before they fill anything in. Throws InviteError on bad tokens.
 */
export async function fetchInvitePreview(token: string): Promise<InvitePreview> {
  const trimmed = token.trim();
  if (!trimmed) throw new InviteError('invalid');

  const { data, error } = await supabase.functions.invoke('accept-invite', {
    body: { token: trimmed, validateOnly: true },
  });

  if (error) {
    const { message, reason } = await getFunctionErrorDetails(error);
    throw new InviteError(reason ?? classifyInviteFailure(message), message ?? undefined);
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
        locationGroup?: unknown;
      }
    | null;

  // Backend dry-run responds {valid, invitedName, role, reason}; tolerate {ok}.
  if (payload?.ok !== true && payload?.valid !== true) {
    const structured = readReason(payload?.reason);
    const message = typeof payload?.error === 'string' ? payload.error : null;
    throw new InviteError(structured ?? classifyInviteFailure(message), message ?? undefined);
  }

  return {
    invitedName: readName(payload.invitedName) ?? readName(payload.invited_name),
    role: readRole(payload.role),
    locationGroup: readLocationGroup(payload.locationGroup),
  };
}

/**
 * Full accept: the edge function creates/claims the account server-side with
 * the service role, marks the invite used, and returns {ok, role}. The caller
 * then signs in with the same credentials.
 */
export async function acceptInvite(input: AcceptInviteInput): Promise<{ role: UserRole }> {
  const { data, error } = await supabase.functions.invoke('accept-invite', {
    body: {
      token: input.token.trim(),
      email: input.email,
      password: input.password,
      name: input.name,
    },
  });

  if (error) {
    // Prefer the structured reason from the 409 body (mirrors the dry-run
    // handling); keyword classification is only the fallback for older
    // backends that send just an error string.
    const { message, reason: structuredReason } = await getFunctionErrorDetails(error);
    if (message || structuredReason) {
      const reason = structuredReason ?? classifyInviteFailure(message);
      if (reason !== 'invalid') {
        throw new InviteError(reason, message ?? undefined);
      }
      throw new Error(message ?? describeInviteFailure(reason));
    }
    throw new Error('Unable to accept the invite. Please try again.');
  }

  const payload = data as { ok?: unknown; role?: unknown; error?: unknown } | null;
  if (payload?.ok !== true) {
    const message = typeof payload?.error === 'string' ? payload.error : null;
    throw new Error(message ?? 'Unable to accept the invite. Please try again.');
  }

  const role = readRole(payload.role);
  if (!role) {
    throw new Error('Unexpected response from accept-invite.');
  }

  return { role };
}

/**
 * Onboarding accept ({token, mode: 'onboarding'}): the edge function mints the
 * account without email/password and returns a one-shot session token hash.
 * The caller exchanges it with supabase.auth.verifyOtp, then stores the chosen
 * credential via setMyCredential.
 */
export async function acceptInviteOnboarding(
  token: string,
  credentialKind: 'pin' | 'password',
  credentialSecret: string,
): Promise<OnboardingAcceptResult> {
  const trimmed = token.trim();
  if (!trimmed) throw new InviteError('invalid');

  const { data, error } = await supabase.functions.invoke('accept-invite', {
    body: { token: trimmed, mode: 'onboarding', credentialKind, credentialSecret },
  });

  if (error) {
    const { message, reason: structuredReason } = await getFunctionErrorDetails(error);
    if (message || structuredReason) {
      const reason = structuredReason ?? classifyInviteFailure(message);
      if (reason !== 'invalid' || structuredReason === 'invalid') {
        throw new InviteError(reason, message ?? undefined);
      }
      throw new Error(message ?? describeInviteFailure(reason));
    }
    throw new Error('Unable to accept the invite. Check your connection and try again.');
  }

  const payload = data as
    | { ok?: unknown; role?: unknown; locationGroup?: unknown; tokenHash?: unknown; error?: unknown }
    | null;
  if (payload?.ok !== true) {
    const message = typeof payload?.error === 'string' ? payload.error : null;
    throw new Error(message ?? 'Unable to accept the invite. Try again.');
  }

  const role = readRole(payload.role);
  const tokenHash = typeof payload.tokenHash === 'string' && payload.tokenHash ? payload.tokenHash : null;
  if (!role || !tokenHash) {
    throw new Error('Unexpected response from accept-invite.');
  }

  return { role, locationGroup: readLocationGroup(payload.locationGroup), tokenHash };
}

/**
 * Manager-side invite creation (mirrors web/src/lib/dashboard/invites.ts).
 * Duplicate sign-in names come back as a 409 with a clear message.
 */
export async function createInvite(input: CreateInviteInput): Promise<CreatedInvite> {
  const { data, error } = await supabase.functions.invoke('create-invite', {
    body: {
      invitedName: input.invitedName.trim(),
      role: input.role,
      expiresInHours: input.expiresInHours,
      modulePreset: input.modulePreset,
      locationGroup: input.locationGroup,
    },
  });

  if (error) {
    const { message } = await getFunctionErrorDetails(error);
    throw new Error(message ?? 'Unable to create the invite. Try again.');
  }

  const payload = data as
    | { inviteId?: unknown; token?: unknown; joinUrl?: unknown; locationGroup?: unknown; error?: unknown }
    | null;
  if (
    typeof payload?.inviteId !== 'string' ||
    typeof payload?.token !== 'string' ||
    typeof payload?.joinUrl !== 'string'
  ) {
    const message = typeof payload?.error === 'string' ? payload.error : null;
    throw new Error(message ?? 'Unexpected response from create-invite.');
  }

  return {
    inviteId: payload.inviteId,
    token: payload.token,
    joinUrl: payload.joinUrl,
    locationGroup: readLocationGroup(payload.locationGroup),
  };
}

/** Manager-side revoke (mirrors the dashboard's revokeInvite). */
export async function revokeInvite(inviteId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('revoke-invite', {
    body: { inviteId },
  });

  if (error) {
    const { message } = await getFunctionErrorDetails(error);
    throw new Error(message ?? 'Unable to revoke the invite.');
  }

  const payload = data as { ok?: unknown; error?: unknown } | null;
  if (payload?.ok !== true) {
    const message = typeof payload?.error === 'string' ? payload.error : null;
    throw new Error(message ?? 'Unable to revoke the invite.');
  }
}
