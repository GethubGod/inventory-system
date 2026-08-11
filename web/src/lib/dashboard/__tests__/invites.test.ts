import { describe, expect, it } from "vitest";
import {
  buildJoinUrl,
  deriveInviteStatus,
  DEFAULT_EXPIRY_HOURS,
  EXPIRY_OPTIONS,
} from "../invites";

const NOW = new Date("2026-08-11T12:00:00Z");

function invite(overrides: {
  used_at?: string | null;
  revoked_at?: string | null;
  expires_at?: string | null;
}) {
  return {
    used_at: overrides.used_at ?? null,
    revoked_at: overrides.revoked_at ?? null,
    expires_at: overrides.expires_at ?? null,
  };
}

describe("deriveInviteStatus", () => {
  it("is pending when unused, unrevoked, and not yet expired", () => {
    expect(
      deriveInviteStatus(invite({ expires_at: "2026-08-18T12:00:00Z" }), NOW),
    ).toBe("pending");
  });

  it("is pending when there is no expiry at all", () => {
    expect(deriveInviteStatus(invite({}), NOW)).toBe("pending");
  });

  it("is expired once expires_at has passed", () => {
    expect(
      deriveInviteStatus(invite({ expires_at: "2026-08-10T12:00:00Z" }), NOW),
    ).toBe("expired");
  });

  it("treats the exact expiry instant as expired", () => {
    expect(
      deriveInviteStatus(invite({ expires_at: "2026-08-11T12:00:00Z" }), NOW),
    ).toBe("expired");
  });

  it("is used when used_at is set, even if also expired", () => {
    expect(
      deriveInviteStatus(
        invite({ used_at: "2026-08-01T00:00:00Z", expires_at: "2026-08-05T00:00:00Z" }),
        NOW,
      ),
    ).toBe("used");
  });

  it("used wins over revoked (the invite already did its job)", () => {
    expect(
      deriveInviteStatus(
        invite({ used_at: "2026-08-01T00:00:00Z", revoked_at: "2026-08-02T00:00:00Z" }),
        NOW,
      ),
    ).toBe("used");
  });

  it("is revoked when revoked_at is set and unused, even before expiry", () => {
    expect(
      deriveInviteStatus(
        invite({ revoked_at: "2026-08-10T00:00:00Z", expires_at: "2026-08-20T00:00:00Z" }),
        NOW,
      ),
    ).toBe("revoked");
  });

  it("revoked wins over expired for unused invites", () => {
    expect(
      deriveInviteStatus(
        invite({ revoked_at: "2026-08-01T00:00:00Z", expires_at: "2026-08-05T00:00:00Z" }),
        NOW,
      ),
    ).toBe("revoked");
  });

  it("ignores an unparseable expires_at instead of expiring the invite", () => {
    expect(
      deriveInviteStatus(invite({ expires_at: "not-a-date" }), NOW),
    ).toBe("pending");
  });
});

describe("buildJoinUrl", () => {
  it("builds the personalized join link on the pinned domain", () => {
    expect(buildJoinUrl("abc123")).toBe(
      "https://tips.babytunasystems.com/join/abc123",
    );
  });

  it("URL-encodes unusual token characters", () => {
    expect(buildJoinUrl("a/b+c")).toBe(
      "https://tips.babytunasystems.com/join/a%2Fb%2Bc",
    );
  });
});

describe("expiry options", () => {
  it("offers 24h / 72h / 7d / 30d with a 7-day default", () => {
    expect(EXPIRY_OPTIONS.map((o) => o.hours)).toEqual([24, 72, 168, 720]);
    expect(DEFAULT_EXPIRY_HOURS).toBe(168);
    expect(
      EXPIRY_OPTIONS.some((o) => o.hours === DEFAULT_EXPIRY_HOURS),
    ).toBe(true);
  });
});
