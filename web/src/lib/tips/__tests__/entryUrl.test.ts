import { describe, expect, it } from "vitest";
import { entryUrlFor, TIPS_ENTRY_ORIGIN } from "../entryUrl";

describe("entryUrlFor", () => {
  it("always targets the staff tips host", () => {
    expect(entryUrlFor("poki_token_123456")).toBe(
      `${TIPS_ENTRY_ORIGIN}/e?t=poki_token_123456`,
    );
  });

  it("keeps each location token distinct and URL-safe", () => {
    const sushi = new URL(entryUrlFor("sushi_token_123456"));
    const poki = new URL(entryUrlFor("poki/token+123456"));

    expect(sushi.origin).toBe(TIPS_ENTRY_ORIGIN);
    expect(poki.origin).toBe(TIPS_ENTRY_ORIGIN);
    expect(sushi.searchParams.get("t")).toBe("sushi_token_123456");
    expect(poki.searchParams.get("t")).toBe("poki/token+123456");
    expect(sushi.href).not.toBe(poki.href);
  });
});
