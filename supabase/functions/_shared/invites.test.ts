import {
  createInviteToken,
  DEFAULT_INVITE_EXPIRY_HOURS,
  inspectInviteState,
  INVITE_TOKEN_LENGTH,
  parseAcceptInviteInput,
  parseCreateInviteInput,
} from "./invites.ts";

Deno.test("createInviteToken creates a 32-character URL-safe token", () => {
  const token = createInviteToken();

  if (token.length !== INVITE_TOKEN_LENGTH) {
    throw new Error(
      `Expected ${INVITE_TOKEN_LENGTH} characters, got ${token.length}`,
    );
  }
  if (!/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("Expected a URL-safe token");
  }
});

Deno.test("parseCreateInviteInput applies the contract defaults", () => {
  const result = parseCreateInviteInput({
    invitedName: "Alex",
    role: "employee",
  });
  if (!result.ok) throw new Error(result.error);

  if (result.value.expiresInHours !== DEFAULT_INVITE_EXPIRY_HOURS) {
    throw new Error("Expected default invite expiry");
  }
  if (Object.keys(result.value.modulePreset).length !== 0) {
    throw new Error("Expected an empty module preset");
  }
});

Deno.test("parseAcceptInviteInput requires credentials only for full acceptance", () => {
  const token = "A".repeat(INVITE_TOKEN_LENGTH);
  const dryRun = parseAcceptInviteInput({ token, validateOnly: true });
  if (!dryRun.ok || !dryRun.value.validateOnly) {
    throw new Error("Expected a valid dry run");
  }

  const full = parseAcceptInviteInput({
    token,
    email: "alex@example.com",
    password: "password",
  });
  if (
    !full.ok || full.value.validateOnly ||
    full.value.email !== "alex@example.com"
  ) {
    throw new Error("Expected valid full acceptance credentials");
  }
});

Deno.test("inspectInviteState reports a clear terminal state", () => {
  const now = new Date("2026-08-12T00:00:00.000Z");
  const result = inspectInviteState(
    {
      invitedName: "Alex",
      role: "manager",
      expiresAt: "2026-08-13T00:00:00.000Z",
      usedAt: null,
      revokedAt: "2026-08-11T00:00:00.000Z",
    },
    now,
  );

  if (result.valid || result.reason !== "revoked") {
    throw new Error("Expected revoked state");
  }
});
