// Wildcard origin keeps React Native / Expo clients working (no fixed web origin).
// Set ALLOWED_ORIGINS to a comma-separated list to restrict browser callers; mobile is unchanged.
const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

/** Browser origins used by the public tip-entry flow during the domain migration. */
export const TIP_WEB_ORIGINS = [
  "https://tips.smelterpos.com",
  "https://dashboard.smelterpos.com",
  "https://tips.babytunasystems.com",
] as const;

export function resolveAllowOrigin(
  requestOrigin: string | null,
  configuredOrigins: readonly string[],
  additionalOrigins: readonly string[] = [],
): string {
  // No configured allowlist means local/mobile-compatible wildcard mode.
  // Product-specific additions only extend an explicit production allowlist.
  if (configuredOrigins.length === 0) return "*";
  const effectiveOrigins = [
    ...new Set([...configuredOrigins, ...additionalOrigins]),
  ];
  const normalizedOrigin = requestOrigin?.trim();
  if (normalizedOrigin && effectiveOrigins.includes(normalizedOrigin)) {
    return normalizedOrigin;
  }
  // Deliberately return a non-matching allow-origin for unknown browser
  // callers; their browser blocks the response without reflecting the origin.
  return effectiveOrigins[0];
}

export function corsHeadersForRequest(
  req?: Request,
  additionalOrigins: readonly string[] = [],
): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": resolveAllowOrigin(
      req?.headers.get("Origin") ?? null,
      allowedOrigins,
      additionalOrigins,
    ),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** CORS policy for the staff tip-entry browser endpoints. */
export function tipCorsHeadersForRequest(
  req?: Request,
): Record<string, string> {
  return corsHeadersForRequest(req, TIP_WEB_ORIGINS);
}

/** Default headers; use corsHeadersForRequest when the incoming Request is available. */
export const corsHeaders = corsHeadersForRequest();
