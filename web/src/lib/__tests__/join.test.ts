import { describe, expect, it } from "vitest";
import { buildAppDeepLink, classifyInviteFailure } from "../join";

describe("buildAppDeepLink", () => {
  it("builds the babytunasystems://join deep link", () => {
    expect(buildAppDeepLink("tok_123")).toBe(
      "babytunasystems://join?token=tok_123",
    );
  });

  it("URL-encodes token characters that would break the query string", () => {
    expect(buildAppDeepLink("a&b=c")).toBe(
      "babytunasystems://join?token=a%26b%3Dc",
    );
  });
});

describe("classifyInviteFailure", () => {
  it("detects used invites", () => {
    expect(classifyInviteFailure("This invite has already been used")).toBe(
      "used",
    );
  });

  it("detects revoked invites (revoke / revoked wording)", () => {
    expect(classifyInviteFailure("Invite was revoked")).toBe("revoked");
    expect(classifyInviteFailure("The manager revoked this invite")).toBe(
      "revoked",
    );
  });

  it("detects expired invites (expire / expired / expiry wording)", () => {
    expect(classifyInviteFailure("Invite expired")).toBe("expired");
    expect(classifyInviteFailure("This link is past its expiry")).toBe(
      "expired",
    );
  });

  it("falls back to invalid for unknown messages", () => {
    expect(classifyInviteFailure("Invite not found")).toBe("invalid");
    expect(classifyInviteFailure("")).toBe("invalid");
  });
});
