import { normalizeLoginName } from "./loginNames.ts";

Deno.test("normalizeLoginName lowercases, trims, and collapses whitespace", () => {
  const cases: Array<[string, string | null]> = [
    ["Nate", "nate"],
    ["  NATE   Fixture ", "nate fixture"],
    ["Nate\tFixture", "nate fixture"],
    ["nate fixture", "nate fixture"],
    ["   ", null],
    ["", null],
  ];

  for (const [input, expected] of cases) {
    const actual = normalizeLoginName(input);
    if (actual !== expected) {
      throw new Error(`normalizeLoginName(${JSON.stringify(input)}) = ${actual}, expected ${expected}`);
    }
  }

  if (normalizeLoginName(null) !== null || normalizeLoginName(undefined) !== null) {
    throw new Error("Expected null passthrough for missing names");
  }
});
