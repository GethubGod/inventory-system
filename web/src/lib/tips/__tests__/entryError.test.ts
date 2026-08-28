import { describe, expect, it } from "vitest";
import { TipApiError } from "../api";
import { entrySignInErrorMessage } from "../entryError";

describe("entrySignInErrorMessage", () => {
  it("reserves inactive wording for a token the server rejected", () => {
    expect(
      entrySignInErrorMessage(new TipApiError("invalid", "invalid", 401)),
    ).toContain("no longer active");
  });

  it("reports browser/CORS failures as connectivity problems", () => {
    expect(
      entrySignInErrorMessage(new TipApiError("offline", "network", 0)),
    ).toBe("Couldn’t reach smelter. Check your connection and try again.");
  });

  it("preserves the server's rate-limit guidance", () => {
    const message = "Too many attempts. Wait a few minutes and try again.";
    expect(
      entrySignInErrorMessage(new TipApiError(message, "rate_limited", 429)),
    ).toBe(message);
  });

  it("uses a retryable message for unexpected server failures", () => {
    expect(
      entrySignInErrorMessage(new TipApiError("internal", "error", 500)),
    ).toBe("Couldn’t verify this QR code. Try again.");
  });
});
