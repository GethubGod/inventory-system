import { describe, expect, it } from "vitest";
import { formatPhoneDisplay, phoneForStore } from "../phone";

describe("phoneForStore", () => {
  it("trims whitespace but keeps the value as typed", () => {
    expect(phoneForStore("  (408) 555-0133 ")).toBe("(408) 555-0133");
  });

  it("returns null for empty / whitespace-only input", () => {
    expect(phoneForStore("")).toBeNull();
    expect(phoneForStore("   ")).toBeNull();
  });
});

describe("formatPhoneDisplay", () => {
  it("formats bare 10-digit US numbers", () => {
    expect(formatPhoneDisplay("4085550133")).toBe("(408) 555-0133");
  });

  it("formats 1-prefixed and +1-prefixed US numbers", () => {
    expect(formatPhoneDisplay("14085550133")).toBe("(408) 555-0133");
    expect(formatPhoneDisplay("+14085550133")).toBe("(408) 555-0133");
  });

  it("reformats already-punctuated US numbers", () => {
    expect(formatPhoneDisplay("408-555-0133")).toBe("(408) 555-0133");
  });

  it("leaves non-US or unusual numbers exactly as stored", () => {
    expect(formatPhoneDisplay("+44 20 7946 0958")).toBe("+44 20 7946 0958");
    expect(formatPhoneDisplay("555-0133")).toBe("555-0133");
    expect(formatPhoneDisplay("ext. 204")).toBe("ext. 204");
  });

  it("renders empty for null / undefined / empty", () => {
    expect(formatPhoneDisplay(null)).toBe("");
    expect(formatPhoneDisplay(undefined)).toBe("");
    expect(formatPhoneDisplay("")).toBe("");
  });
});
