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

export interface InvitePreview {
  invitedName: string | null;
  role: UserRole | null;
}

export interface AcceptInviteInput {
  token: string;
  email: string;
  password: string;
  name: string;
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
