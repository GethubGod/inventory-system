// Wildcard origin keeps React Native / Expo clients working (no fixed web origin).
// Set ALLOWED_ORIGINS to a comma-separated list to restrict browser callers; mobile is unchanged.
const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function resolveAllowOrigin(req?: Request): string {
  if (allowedOrigins.length === 0) return '*';
  const requestOrigin = req?.headers.get('Origin')?.trim();
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }
  return allowedOrigins[0];
}

export function corsHeadersForRequest(req?: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': resolveAllowOrigin(req),
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
  };
}

/** Default headers; use corsHeadersForRequest when the incoming Request is available. */
export const corsHeaders = corsHeadersForRequest();
