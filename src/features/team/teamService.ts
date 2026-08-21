// Team-screen data helpers: works-at group <-> location id mapping (same
// short_code convention as the backend resolver), roster location reads, the
// manager-gated works-at write, and login-credential metadata for the
// employee detail screen.

import { supabase } from '@/lib/supabase';
import type { Location } from '@/types';
import type { InviteLocationGroup } from '@/services/invites';
import type { ModuleKey } from '@/services/userModules';
import type { EffectiveModules } from '@/store/moduleStore.helpers';

/** Short display labels for roster subtitles ("Sushi · Ordering + Stock check"). */
const MODULE_SUMMARY_LABELS: Partial<Record<ModuleKey, string>> = {
  ordering_simple: 'Ordering',
  ordering_advanced: 'Advanced',
  stock_check: 'Stock check',
  tips: 'Tips',
  fulfillment: 'Fulfillment',
};

export function summarizeModules(modules: EffectiveModules | null): string {
  if (!modules) return 'Loading…';
  const enabled = (Object.keys(MODULE_SUMMARY_LABELS) as ModuleKey[])
    .filter((key) => modules[key])
    .map((key) => MODULE_SUMMARY_LABELS[key]);
  return enabled.length > 0 ? enabled.join(' + ') : 'Nothing enabled';
}

/** sushi -> the s-prefixed short_code location, poki -> p-prefixed, both -> null. */
export function locationIdForGroup(
  group: InviteLocationGroup,
  locations: Location[],
): string | null {
  if (group === 'both') return null;
  const prefix = group === 'sushi' ? 's' : 'p';
  const match = locations.find((location) =>
    (location.short_code ?? '').trim().toLowerCase().startsWith(prefix),
  );
  return match?.id ?? null;
}

export function groupForLocationId(
  locationId: string | null,
  locations: Location[],
): InviteLocationGroup {
  if (!locationId) return 'both';
  const match = locations.find((location) => location.id === locationId);
  const code = (match?.short_code ?? '').trim().toLowerCase();
  if (code.startsWith('s')) return 'sushi';
  if (code.startsWith('p')) return 'poki';
  return 'both';
}

/** default_location_id per user id (managers can select every users row). */
export async function fetchDefaultLocationIds(): Promise<Map<string, string | null>> {
  const { data, error } = await supabase
    .from('users')
    .select('id, default_location_id');
  if (error) throw new Error(error.message);

  const map = new Map<string, string | null>();
  for (const row of data ?? []) {
    if (typeof row.id === 'string') {
      map.set(row.id, typeof row.default_location_id === 'string' ? row.default_location_id : null);
    }
  }
  return map;
}

/** Works-at change (manager-gated RPC; users RLS only allows self-updates). */
export async function setUserDefaultLocation(
  userId: string,
  locationId: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('set_user_default_location', {
    p_user_id: userId,
    p_location_id: locationId,
  });
  if (error) throw new Error(error.message);
}

/**
 * Recipient-less Messages compose link with a prefilled body (same iOS/Android
 * body-separator quirk handling as services/supplierSendLink.ts, minus the
 * recipient — the manager picks the thread).
 */
export function buildInviteSmsUrl(body: string, platform: 'ios' | 'android' = 'ios'): string {
  const separator = platform === 'ios' ? '&body=' : '?body=';
  return `sms:${separator}${encodeURIComponent(body)}`;
}

/** The text handed to Messages for a fresh invite link. */
export function buildInviteMessageBody(name: string, joinUrl: string): string {
  const trimmed = name.trim();
  return trimmed
    ? `Hi ${trimmed}, here's your Babytuna Systems setup link: ${joinUrl}`
    : `Here's your Babytuna Systems setup link: ${joinUrl}`;
}

export interface LoginCredentialInfo {
  kind: 'pin' | 'password';
  updatedAt: string | null;
}

/** Credential metadata (never the hash — the column grant excludes it). */
export async function fetchLoginCredentialInfo(
  userId: string,
): Promise<LoginCredentialInfo | null> {
  const { data, error } = await supabase
    .from('login_identities')
    .select('credential_kind, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    kind: data.credential_kind === 'password' ? 'password' : 'pin',
    updatedAt: typeof data.updated_at === 'string' ? data.updated_at : null,
  };
}
