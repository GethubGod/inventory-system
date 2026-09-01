import { describe, expect, it } from "vitest";
import {
  describeRequest,
  formatAge,
  formatTag,
  isOldRequest,
  undoSecondsLeft,
} from "../format";
import { toServerRequest } from "../types";

describe("formatAge", () => {
  it("renders m:ss and clamps negatives from clock skew", () => {
    expect(formatAge(0)).toBe("0:00");
    expect(formatAge(59_999)).toBe("0:59");
    expect(formatAge(60_000)).toBe("1:00");
    expect(formatAge(250_000)).toBe("4:10");
    expect(formatAge(-4_000)).toBe("0:00");
  });

  it("flags requests older than three minutes", () => {
    expect(isOldRequest(180_000)).toBe(false);
    expect(isOldRequest(180_001)).toBe(true);
  });

  it("counts undo seconds down to zero and never above the window", () => {
    expect(undoSecondsLeft(10_000, 4_100)).toBe(6);
    expect(undoSecondsLeft(10_000, 10_000)).toBe(0);
    expect(undoSecondsLeft(10_000, 12_000)).toBe(0);
    // A stale one-second clock right after the tap must not read 7s.
    expect(undoSecondsLeft(10_000, 3_200)).toBe(6);
  });

  it("describes requests and tags", () => {
    expect(describeRequest(2, "Fried Shrimp")).toBe("2 fried shrimp");
    expect(formatTag("minh")).toBe("@minh");
    expect(formatTag("@minh")).toBe("@minh");
  });
});

describe("toServerRequest", () => {
  const row = {
    id: "r1",
    client_key: "k1",
    location_id: "loc",
    item_id: "i1",
    item_name: "Unagi",
    unit: "portions",
    quantity: 3,
    requested_by: "u1",
    requested_by_name: "Ana",
    requested_by_tag: "ana",
    status: "ready",
    created_at: "2026-08-31T20:00:00.000Z",
    ready_at: "2026-08-31T20:01:00.000Z",
    ready_by: "u2",
    ready_by_name: "Kitchen",
    closed_at: null,
    updated_at: "2026-08-31T20:01:00.000Z",
  };

  it("converts timestamps to epoch ms", () => {
    const request = toServerRequest(row);
    expect(request).toMatchObject({
      kind: "server",
      id: "r1",
      status: "ready",
      createdAt: Date.parse("2026-08-31T20:00:00.000Z"),
      readyAt: Date.parse("2026-08-31T20:01:00.000Z"),
      updatedAt: Date.parse("2026-08-31T20:01:00.000Z"),
      closedAt: null,
      readyByName: "Kitchen",
    });
  });

  it("rejects unknown statuses and unparsable timestamps", () => {
    expect(toServerRequest({ ...row, status: "sending" })).toBeNull();
    expect(toServerRequest({ ...row, created_at: "not a date" })).toBeNull();
  });
});
