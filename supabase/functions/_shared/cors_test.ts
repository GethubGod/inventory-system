import {
  corsHeadersForRequest,
  resolveAllowOrigin,
  TIP_WEB_ORIGINS,
  tipCorsHeadersForRequest,
} from "./cors.ts";

function requestFrom(origin: string): Request {
  return new Request(
    "https://example.supabase.co/functions/v1/tip-entry-auth",
    {
      headers: { Origin: origin },
    },
  );
}

function assertEqual(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

Deno.test("generic functions keep wildcard CORS when ALLOWED_ORIGINS is unset", () => {
  assertEqual(
    corsHeadersForRequest(
      requestFrom("http://localhost:3000"),
    )["Access-Control-Allow-Origin"],
    "*",
  );
});

Deno.test("tip endpoints keep wildcard CORS for local development", () => {
  assertEqual(
    tipCorsHeadersForRequest(
      requestFrom("http://localhost:3000"),
    )["Access-Control-Allow-Origin"],
    "*",
  );
});

for (const origin of TIP_WEB_ORIGINS) {
  Deno.test(`an explicit production allowlist includes ${origin}`, () => {
    assertEqual(
      resolveAllowOrigin(
        origin,
        ["https://tips.babytunasystems.com"],
        TIP_WEB_ORIGINS,
      ),
      origin,
    );
  });
}

Deno.test("tip endpoints do not reflect an unknown browser origin", () => {
  assertEqual(
    resolveAllowOrigin(
      "https://attacker.example",
      ["https://tips.babytunasystems.com"],
      TIP_WEB_ORIGINS,
    ),
    "https://tips.babytunasystems.com",
  );
});

Deno.test("preflight headers allow the entry POST and vary by origin", () => {
  const headers = tipCorsHeadersForRequest(
    requestFrom("https://tips.smelterpos.com"),
  );
  assertEqual(headers["Access-Control-Allow-Methods"], "POST, OPTIONS");
  assertEqual(headers["Access-Control-Max-Age"], "86400");
  assertEqual(headers.Vary, "Origin");
});
