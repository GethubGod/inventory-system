// Pure invite-link helpers (no supabase import — unit-testable under jest):
// deep-link token parsing and failure-message classification for the Phase 2b
// invite flow. Network calls live in services/invites.ts.

export type InviteFailureReason = 'used' | 'expired' | 'revoked' | 'invalid';

/**
 * Pull the invite token out of a join link. Handles the app scheme in its
 * common shapes (babytunasystems://join?token=…, with an extra slash, or a
 * path-style token) and the public web link
 * (https://tips.babytunasystems.com/join/<token>). Returns null when the URL
 * is not a join link or carries no token.
 */
export function parseJoinToken(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const pathSegments = parsed.pathname.split('/').filter(Boolean);
  const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:';

  let pathToken: string | undefined;
  if (isHttp) {
    // Web link: must be our domain, /join/<token>.
    if (!host.endsWith('babytunasystems.com')) return null;
    if (pathSegments[0]?.toLowerCase() !== 'join') return null;
    pathToken = pathSegments[1];
  } else {
    // Scheme deep link: "join" lands in the host (scheme://join?token=…) or
    // the first path segment (scheme:///join?token=…) depending on slashes.
    if (host === 'join') {
      pathToken = pathSegments[0];
    } else if (pathSegments[0]?.toLowerCase() === 'join') {
      pathToken = pathSegments[1];
    } else {
      return null;
    }
  }

  const queryToken = parsed.searchParams.get('token');
  if (queryToken && queryToken.trim()) return queryToken.trim();

  // Path-style token: /join/<token>
  if (pathToken && pathToken.trim()) {
    try {
      return decodeURIComponent(pathToken.trim());
    } catch {
      return pathToken.trim();
    }
  }

  return null;
}

/** Map a server error message onto a stable failure reason for messaging. */
export function classifyInviteFailure(message: string | null | undefined): InviteFailureReason {
  const lower = (message ?? '').toLowerCase();
  if (lower.includes('used')) return 'used';
  if (lower.includes('revok')) return 'revoked';
  if (lower.includes('expir')) return 'expired';
  return 'invalid';
}

export function describeInviteFailure(reason: InviteFailureReason): string {
  switch (reason) {
    case 'used':
      return 'This invite link was already used. Ask your manager for a new one.';
    case 'expired':
      return 'This invite link has expired. Ask your manager for a new one.';
    case 'revoked':
      return 'This invite link was revoked. Ask your manager for a new one.';
    default:
      return 'This invite link is not valid. Ask your manager for a new one.';
  }
}
