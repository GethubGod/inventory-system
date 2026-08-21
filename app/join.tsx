// Deep-link entry for invite links: babytunasystems://join?token=<token>
// (see web /join/[token]). Thin route — normalizes the token and forwards
// into the invited onboarding flow (Hello -> Secure your app -> Ready).
// Already-authenticated users are bounced home by that screen's auth guard.

import { Redirect, useLocalSearchParams } from 'expo-router';
import type { Href } from 'expo-router';
import { parseJoinToken } from '@/services/inviteLinks';

export default function JoinDeepLink() {
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const raw = Array.isArray(params.token) ? params.token[0] : params.token;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  // Tolerate a whole join link pasted where the bare token belongs.
  const token = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? (parseJoinToken(trimmed) ?? '')
    : trimmed;

  if (!token) {
    // No token — land on the welcome screen (invite link or sign in).
    return <Redirect href={'/(auth)/welcome' as Href} />;
  }

  return (
    <Redirect
      href={{ pathname: '/(auth)/invite-hello', params: { token } } as unknown as Href}
    />
  );
}
