// In-memory state for the invited onboarding flow (welcome -> hello ->
// secure -> ready). Deliberately not persisted: a half-finished onboarding
// should start over on relaunch, and the chosen secret must never touch disk.

import { create } from 'zustand';
import type { InviteLocationGroup, InvitePreview } from '@/services/invites';
import { acceptInviteOnboarding } from '@/services/invites';
import { signInWithName, type CredentialKind } from '@/services/loginCredentials';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';

interface OnboardingState {
  token: string | null;
  invitedName: string | null;
  locationGroup: InviteLocationGroup;
  /** Set once accept-invite consumed the token and a session exists. */
  accepted: boolean;

  setInvite: (token: string, preview: InvitePreview) => void;
  /**
   * Finishes onboarding for the collected secret: prepares the account and
   * credential before consuming the invite, then establishes the session.
   */
  completeOnboarding: (kind: CredentialKind, secret: string) => Promise<void>;
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  token: null,
  invitedName: null,
  locationGroup: 'both',
  accepted: false,

  setInvite: (token, preview) =>
    set({
      token,
      invitedName: preview.invitedName,
      locationGroup: preview.locationGroup,
      accepted: false,
    }),

  completeOnboarding: async (kind, secret) => {
    const { token, accepted, invitedName } = get();

    if (!accepted) {
      if (!token) throw new Error('This invite is no longer available. Start over from the link.');

      const recoverWithCredential = async (): Promise<boolean> => {
        if (!invitedName) return false;
        try {
          await signInWithName(invitedName, secret);
          set({ accepted: true });
          return true;
        } catch {
          return false;
        }
      };

      let result;
      try {
        result = await acceptInviteOnboarding(token, kind, secret);
      } catch (acceptError) {
        // If the server finished but the response was interrupted, the invite
        // is consumed but the new credential is already usable. Recover using
        // the exact name and secret the user just chose.
        if (await recoverWithCredential()) return;
        throw acceptError;
      }
      const { data, error } = await supabase.auth.verifyOtp({
        type: 'magiclink',
        token_hash: result.tokenHash,
      });
      if (error || !data.session) {
        if (await recoverWithCredential()) {
          set({ locationGroup: result.locationGroup });
          return;
        }
        throw new Error(error?.message ?? 'Unable to start your session. Try again.');
      }

      await useAuthStore.getState().adoptExternalSession(data.session);
      set({ accepted: true, locationGroup: result.locationGroup });
    }
  },

  reset: () =>
    set({ token: null, invitedName: null, locationGroup: 'both', accepted: false }),
}));
