import { clientIdentifier } from "./tips.ts";

Deno.test("clientIdentifier uses the trusted proxy-appended XFF value", () => {
  const request = new Request("https://example.test", {
    headers: {
      "x-forwarded-for": "203.0.113.10, 198.51.100.24",
      "user-agent": "flood-test",
    },
  });

  const actual = clientIdentifier(request);
  if (actual !== "198.51.100.24:flood-test") {
    throw new Error(`Unexpected identifier: ${actual}`);
  }
});

Deno.test("clientIdentifier falls back without a forwarded chain", () => {
  const realIpRequest = new Request("https://example.test", {
    headers: { "x-real-ip": "192.0.2.42" },
  });
  if (clientIdentifier(realIpRequest) !== "192.0.2.42:") {
    throw new Error("Expected x-real-ip fallback");
  }

  const unknownRequest = new Request("https://example.test");
  if (clientIdentifier(unknownRequest) !== "unknown:") {
    throw new Error("Expected unknown fallback");
  }
});
