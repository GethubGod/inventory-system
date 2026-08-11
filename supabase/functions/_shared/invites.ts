export const INVITE_TOKEN_LENGTH = 32;
export const DEFAULT_INVITE_EXPIRY_HOURS = 168;
export const MAX_INVITE_EXPIRY_HOURS = 24 * 365;

export type InviteRole = "employee" | "manager";
export type InviteInvalidReason = "invalid" | "used" | "expired" | "revoked";

export interface CreateInviteInput {
  invitedName: string;
  role: InviteRole;
  modulePreset: Record<string, unknown>;
  expiresInHours: number;
}

export interface AcceptInviteInput {
  token: string;
  validateOnly: boolean;
  email: string | null;
  password: string | null;
  name: string | null;
}

export interface InviteState {
  invitedName: string;
  role: InviteRole;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
}

export type ParseResult<T> = { ok: true; value: T } | {
  ok: false;
  error: string;
};

export type InviteValidity =
  | { valid: true; invitedName: string; role: InviteRole }
  | { valid: false; reason: InviteInvalidReason };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function isInviteRole(value: unknown): value is InviteRole {
  return value === "employee" || value === "manager";
}

/** Generates 24 random bytes, encoded as exactly 32 URL-safe Base64 characters (192 bits). */
export function createInviteToken(): string {
  const raw = new Uint8Array(24);
  crypto.getRandomValues(raw);

  let binary = "";
  for (const byte of raw) binary += String.fromCharCode(byte);

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
}

export function isInviteToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_-]{22,128}$/.test(value)
  );
}

export function parseCreateInviteInput(
  payload: unknown,
): ParseResult<CreateInviteInput> {
  if (!isRecord(payload)) return { ok: false, error: "Invalid request body" };

  const invitedName = optionalTrimmedString(payload.invitedName);
  if (!invitedName) return { ok: false, error: "invitedName is required" };
  if (invitedName.length > 120) {
    return { ok: false, error: "invitedName must be 120 characters or fewer" };
  }

  if (!isInviteRole(payload.role)) {
    return { ok: false, error: "role must be employee or manager" };
  }

  const modulePreset = payload.modulePreset === undefined
    ? {}
    : payload.modulePreset;
  if (!isRecord(modulePreset)) {
    return { ok: false, error: "modulePreset must be an object" };
  }

  const expiresInHours = payload.expiresInHours ?? DEFAULT_INVITE_EXPIRY_HOURS;
  if (
    typeof expiresInHours !== "number" ||
    !Number.isSafeInteger(expiresInHours) ||
    expiresInHours < 1 ||
    expiresInHours > MAX_INVITE_EXPIRY_HOURS
  ) {
    return {
      ok: false,
      error:
        `expiresInHours must be an integer between 1 and ${MAX_INVITE_EXPIRY_HOURS}`,
    };
  }

  return {
    ok: true,
    value: {
      invitedName,
      role: payload.role,
      modulePreset,
      expiresInHours,
    },
  };
}

export function parseAcceptInviteInput(
  payload: unknown,
): ParseResult<AcceptInviteInput> {
  if (!isRecord(payload)) return { ok: false, error: "Invalid request body" };

  const token = optionalTrimmedString(payload.token);
  if (!isInviteToken(token)) {
    return { ok: false, error: "Invalid invite token" };
  }

  if (
    payload.validateOnly !== undefined &&
    typeof payload.validateOnly !== "boolean"
  ) {
    return { ok: false, error: "validateOnly must be a boolean" };
  }

  const validateOnly = payload.validateOnly === true;
  if (validateOnly) {
    return {
      ok: true,
      value: {
        token,
        validateOnly: true,
        email: null,
        password: null,
        name: null,
      },
    };
  }

  const email = optionalTrimmedString(payload.email)?.toLowerCase() ?? null;
  if (!email) return { ok: false, error: "email is required" };

  // Password whitespace is valid; only reject a missing or empty value here.
  const password =
    typeof payload.password === "string" && payload.password.length > 0
      ? payload.password
      : null;
  if (!password) return { ok: false, error: "password is required" };

  const name = optionalTrimmedString(payload.name);
  if (name && name.length > 120) {
    return { ok: false, error: "name must be 120 characters or fewer" };
  }

  return {
    ok: true,
    value: { token, validateOnly: false, email, password, name },
  };
}

/** Pure invite-state check used by dry-run validation and full acceptance. */
export function inspectInviteState(
  invite: InviteState | null,
  now = new Date(),
): InviteValidity {
  if (!invite) return { valid: false, reason: "invalid" };
  if (invite.revokedAt) return { valid: false, reason: "revoked" };
  if (invite.usedAt) return { valid: false, reason: "used" };

  const expiresAt = new Date(invite.expiresAt).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, invitedName: invite.invitedName, role: invite.role };
}
