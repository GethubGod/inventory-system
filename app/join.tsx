// Deep-link entry for invite links: babytunasystems://join?token=<token>
// (see web /join/[token]). Thin route — normalizes the token and forwards
// into the signup screen's invite mode. Already-authenticated users are
// bounced home by the signup screen's auth guard.

import { Redirect, useLocalSearchParams } from 'expo-router';
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
    // No token — fall back to the normal signup (access-code) flow.
    return <Redirect href="/(auth)/signup" />;
  }

  return (
    <Redirect
      href={{ pathname: '/(auth)/signup', params: { inviteToken: token } }}
    />
  );
}
