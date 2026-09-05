import { parseJoinToken } from '@/services/inviteLinks';
import type { InviteLocationGroup } from '@/services/invites';

/** The shareable URL returned by create-invite, rather than arbitrary deep links. */
export function validateCreatedInviteUrl(value: string): string | null {
  const candidate = value.trim();
  if (!candidate || /\s/.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    if (url.origin !== 'https://tips.babytunasystems.com' || url.username || url.password || url.search || url.hash) return null;
    const token = parseJoinToken(candidate);
    if (!token || !/^[A-Za-z0-9_-]+$/.test(token) || !/^\/join\/[^/]+$/.test(url.pathname)) return null;
    return candidate;
  } catch {
    return null;
  }
}

/** Only show metadata supplied by the existing invite form; never infer access or expiry. */
export function parseInviteReadyMetadata(expiryLabel: string, locationGroup: string): {
  expiryLabel: string | null;
  locationGroup: InviteLocationGroup | null;
} {
  return {
    expiryLabel: ['1 day', '3 days', '7 days', '30 days'].includes(expiryLabel) ? expiryLabel : null,
    locationGroup: locationGroup === 'sushi' || locationGroup === 'poki' || locationGroup === 'both' ? locationGroup : null,
  };
}
