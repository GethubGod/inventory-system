export const INVITE_TOKEN_LENGTH = 32;
export const DEFAULT_INVITE_EXPIRY_HOURS = 168;
export const MAX_INVITE_EXPIRY_HOURS = 24 * 365;

export type InviteRole = "employee" | "manager";
export type InviteInvalidReason = "invalid" | "used" | "expired" | "revoked";
export type InviteLocationGroup = "sushi" | "poki" | "both";

export interface CreateInviteInput {
  invitedName: string;
  role: InviteRole;
  /** null = caller did not supply one; employee invites then seed from app_config. */
  modulePreset: Record<string, unknown> | null;
  expiresInHours: number;
  locationGroup: InviteLocationGroup;
}

export type AcceptInviteMode = "credentials" | "onboarding";
export type OnboardingCredentialKind = "pin" | "password";

export interface AcceptInviteInput {
  token: string;
  validateOnly: boolean;
  /** onboarding = invited setup flow: the server mints a synthetic account,
   * installs the chosen app credential, then returns a one-shot session hash. */
  mode: AcceptInviteMode;
  email: string | null;
  password: string | null;
  name: string | null;
  credentialKind: OnboardingCredentialKind | null;
  credentialSecret: string | null;
}

export interface InviteState {
  invitedName: string;
  role: InviteRole;
  locationGroup: InviteLocationGroup;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
}

export type ParseResult<T> = { ok: true; value: T } | {
  ok: false;
  error: string;
};

export type InviteValidity =
  | {
    valid: true;
    invitedName: string;
    role: InviteRole;
    locationGroup: InviteLocationGroup;
  }
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

export function isInviteLocationGroup(
  value: unknown,
): value is InviteLocationGroup {
  return value === "sushi" || value === "poki" || value === "both";
}

/**
 * Resolves a works-at group to a location id using the same short_code
 * convention the schema derives location groups from
 * (20260205090000_stock_management.sql: s% -> sushi, p% -> poki).
 * 'both' (and an unmatched group) resolve to null = all locations.
 */
export function resolveLocationGroupToLocationId(
  group: InviteLocationGroup,
  locations: Array<{ id: string; short_code: string | null }>,
): string | null {
  if (group === "both") return null;
  const prefix = group === "sushi" ? "s" : "p";
  const match = locations.find((location) =>
    (location.short_code ?? "").trim().toLowerCase().startsWith(prefix)
  );
  return match?.id ?? null;
}

/**
 * The module preset a new invite starts from: the caller's explicit preset
 * when given, otherwise the org-wide employee defaults (employee invites
 * only — manager invites fall through to role defaults, i.e. everything on).
 */
export function mergeInviteModulePreset(
  role: InviteRole,
  explicitPreset: Record<string, unknown> | null,
  employeeDefaults: unknown,
): Record<string, unknown> {
  if (explicitPreset !== null) return explicitPreset;
  if (role !== "employee") return {};
  if (
    employeeDefaults === null ||
    typeof employeeDefaults !== "object" ||
    Array.isArray(employeeDefaults)
  ) {
    return {};
  }

  const defaults: Record<string, unknown> = {};
  for (
    const [key, value] of Object.entries(
      employeeDefaults as Record<string, unknown>,
    )
  ) {
    if (typeof value === "boolean") defaults[key] = value;
  }
  return defaults;
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

  const modulePreset = payload.modulePreset === undefined ||
      payload.modulePreset === null
    ? null
    : payload.modulePreset;
  if (modulePreset !== null && !isRecord(modulePreset)) {
    return { ok: false, error: "modulePreset must be an object" };
  }

  const locationGroup = payload.locationGroup === undefined
    ? "both"
    : payload.locationGroup;
  if (!isInviteLocationGroup(locationGroup)) {
    return { ok: false, error: "locationGroup must be sushi, poki, or both" };
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
      locationGroup,
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
        mode: "credentials",
        email: null,
        password: null,
        name: null,
        credentialKind: null,
        credentialSecret: null,
      },
    };
  }

  if (payload.mode !== undefined && payload.mode !== "credentials" && payload.mode !== "onboarding") {
    return { ok: false, error: "mode must be credentials or onboarding" };
  }

  if (payload.mode === "onboarding") {
    const credentialKind = payload.credentialKind;
    if (credentialKind !== "pin" && credentialKind !== "password") {
      return { ok: false, error: "credentialKind must be pin or password" };
    }

    const credentialSecret = typeof payload.credentialSecret === "string"
      ? payload.credentialSecret
      : null;
    if (credentialKind === "pin" && !/^[0-9]{4}$/.test(credentialSecret ?? "")) {
      return { ok: false, error: "PIN must be exactly 4 digits" };
    }
    if (
      credentialKind === "password" &&
      (credentialSecret === null || credentialSecret.length < 8 || credentialSecret.length > 256)
    ) {
      return { ok: false, error: "Password must be between 8 and 256 characters" };
    }

    return {
      ok: true,
      value: {
        token,
        validateOnly: false,
        mode: "onboarding",
        email: null,
        password: null,
        name: null,
        credentialKind,
        credentialSecret,
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
    value: {
      token,
      validateOnly: false,
      mode: "credentials",
      email,
      password,
      name,
      credentialKind: null,
      credentialSecret: null,
    },
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

  return {
    valid: true,
    invitedName: invite.invitedName,
    role: invite.role,
    locationGroup: invite.locationGroup,
  };
}
