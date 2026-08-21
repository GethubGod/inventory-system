// In-memory state for the invited onboarding flow (welcome -> hello ->
// secure -> ready). Deliberately not persisted: a half-finished onboarding
// should start over on relaunch, and the chosen secret must never touch disk.

import { create } from 'zustand';
import type { InviteLocationGroup, InvitePreview } from '@/services/invites';
import { acceptInviteOnboarding } from '@/services/invites';
import { setMyCredential, type CredentialKind } from '@/services/loginCredentials';
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
   * Finishes onboarding for the collected secret: accepts the invite
   * (once — retries skip straight to the credential step), establishes the
   * session, and stores the credential.
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
    const { token, accepted } = get();

    if (!accepted) {
      if (!token) throw new Error('This invite is no longer available. Start over from the link.');

      const result = await acceptInviteOnboarding(token);
      const { data, error } = await supabase.auth.verifyOtp({
        type: 'magiclink',
        token_hash: result.tokenHash,
      });
      if (error || !data.session) {
        throw new Error(error?.message ?? 'Unable to start your session. Try again.');
      }

      await useAuthStore.getState().adoptExternalSession(data.session);
      set({ accepted: true, locationGroup: result.locationGroup });
    }

    // Separate step so a failure here can be retried without a second accept.
    await setMyCredential(kind, secret);
  },

  reset: () =>
    set({ token: null, invitedName: null, locationGroup: 'both', accepted: false }),
}));
