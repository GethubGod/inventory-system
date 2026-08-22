import {
  createInviteToken,
  DEFAULT_INVITE_EXPIRY_HOURS,
  inspectInviteState,
  INVITE_TOKEN_LENGTH,
  mergeInviteModulePreset,
  parseAcceptInviteInput,
  parseCreateInviteInput,
  resolveLocationGroupToLocationId,
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
  if (result.value.modulePreset !== null) {
    throw new Error("Expected a null (unset) module preset");
  }
  if (result.value.locationGroup !== "both") {
    throw new Error("Expected locationGroup to default to both");
  }
});

Deno.test("parseCreateInviteInput validates locationGroup", () => {
  const valid = parseCreateInviteInput({
    invitedName: "Alex",
    role: "employee",
    locationGroup: "sushi",
  });
  if (!valid.ok || valid.value.locationGroup !== "sushi") {
    throw new Error("Expected sushi locationGroup to parse");
  }

  const invalid = parseCreateInviteInput({
    invitedName: "Alex",
    role: "employee",
    locationGroup: "downtown",
  });
  if (invalid.ok) {
    throw new Error("Expected an unknown locationGroup to be rejected");
  }
});

Deno.test("parseAcceptInviteInput validates the onboarding credential", () => {
  const token = "A".repeat(INVITE_TOKEN_LENGTH);
  const onboarding = parseAcceptInviteInput({
    token,
    mode: "onboarding",
    credentialKind: "pin",
    credentialSecret: "1234",
  });
  if (
    !onboarding.ok ||
    onboarding.value.mode !== "onboarding" ||
    onboarding.value.email !== null ||
    onboarding.value.password !== null ||
    onboarding.value.credentialKind !== "pin" ||
    onboarding.value.credentialSecret !== "1234"
  ) {
    throw new Error("Expected onboarding mode with an app credential");
  }

  const missing = parseAcceptInviteInput({ token, mode: "onboarding" });
  if (missing.ok) throw new Error("Expected a missing onboarding credential to be rejected");

  const weakPassword = parseAcceptInviteInput({
    token,
    mode: "onboarding",
    credentialKind: "password",
    credentialSecret: "short",
  });
  if (weakPassword.ok) throw new Error("Expected a weak onboarding password to be rejected");

  const bogus = parseAcceptInviteInput({ token, mode: "magic" });
  if (bogus.ok) throw new Error("Expected an unknown mode to be rejected");
});

Deno.test("resolveLocationGroupToLocationId follows the short_code convention", () => {
  const locations = [
    { id: "loc-sushi", short_code: "S1" },
    { id: "loc-poki", short_code: "p2" },
  ];

  if (resolveLocationGroupToLocationId("sushi", locations) !== "loc-sushi") {
    throw new Error("Expected sushi to resolve via the s-prefix");
  }
  if (resolveLocationGroupToLocationId("poki", locations) !== "loc-poki") {
    throw new Error("Expected poki to resolve via the p-prefix");
  }
  if (resolveLocationGroupToLocationId("both", locations) !== null) {
    throw new Error("Expected both to resolve to null (all locations)");
  }
  if (resolveLocationGroupToLocationId("sushi", []) !== null) {
    throw new Error("Expected a missing match to resolve to null");
  }
});

Deno.test("mergeInviteModulePreset seeds employee invites from org defaults", () => {
  const defaults = {
    ordering_simple: true,
    stock_check: false,
    junk: "yes",
  };

  const seeded = mergeInviteModulePreset("employee", null, defaults);
  if (seeded.ordering_simple !== true || seeded.stock_check !== false) {
    throw new Error("Expected employee defaults to seed the preset");
  }
  if ("junk" in seeded) {
    throw new Error("Expected non-boolean defaults to be dropped");
  }

  const explicit = mergeInviteModulePreset("employee", { tips: true }, defaults);
  if (explicit.tips !== true || "ordering_simple" in explicit) {
    throw new Error("Expected an explicit preset to win untouched");
  }

  const manager = mergeInviteModulePreset("manager", null, defaults);
  if (Object.keys(manager).length !== 0) {
    throw new Error("Expected manager invites to skip employee defaults");
  }

  const malformed = mergeInviteModulePreset("employee", null, ["nope"]);
  if (Object.keys(malformed).length !== 0) {
    throw new Error("Expected malformed defaults to yield an empty preset");
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
      locationGroup: "both",
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
