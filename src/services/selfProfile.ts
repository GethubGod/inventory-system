import { supabase } from '@/lib/supabase';

/**
 * Self-service profile edits for the employee Profile screen.
 */

/** Accounts minted by invite onboarding get a synthetic address on this domain. */
const SYNTHETIC_EMAIL_DOMAIN = '@members.babytunasystems.com';

/** True when the account has a real, user-facing email (not the invite-minted one). */
export function isRealAccountEmail(email: string | null | undefined): boolean {
  const trimmed = (email ?? '').trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@')) return false;
  return !trimmed.endsWith(SYNTHETIC_EMAIL_DOMAIN);
}

/**
 * Renames the signed-in user. Goes through one RPC so users.name and the
 * name-sign-in identity (login_identities) stay in sync; the server enforces
 * sign-in-name uniqueness and surfaces a clear error when taken.
 */
export async function updateMyDisplayName(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Enter a name.');
  }
  const { error } = await supabase.rpc('update_my_display_name', { p_name: trimmed });
  if (error) throw error;
}

/**
 * Sets or changes the account's recovery email. Supabase sends a confirmation
 * link to the new address; the change applies once confirmed.
 */
export async function updateMyEmail(email: string): Promise<void> {
  const trimmed = email.trim();
  if (!/^\S+@\S+\.\S+$/.test(trimmed)) {
    throw new Error('Enter a valid email address.');
  }
  const { error } = await supabase.auth.updateUser({ email: trimmed });
  if (error) throw error;
}
