import { createCredentialClient, supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';

/** Verify and update in an isolated session so a delayed response cannot sign a user back in. */
export async function changeEmailPassword(
  currentPassword: string,
  newPassword: string,
  signal?: AbortSignal,
): Promise<void> {
  if (!currentPassword) throw new Error('Enter your current password.');
  if (newPassword.length < 8) throw new Error('New password must be at least 8 characters.');

  const originalSession = useAuthStore.getState().session;
  const assertCurrentSession = () => {
    const state = useAuthStore.getState();
    if (signal?.aborted || !originalSession || state.isLoading || state.session !== originalSession) {
      throw new Error('Sign in again to change your password.');
    }
  };
  assertCurrentSession();
  const { data: current, error: userError } = await supabase.auth.getUser();
  assertCurrentSession();
  if (userError || !current.user?.email || current.user.id !== originalSession?.user.id) {
    throw new Error('Unable to verify your account. Sign in again and retry.');
  }

  const credentialClient = createCredentialClient();
  const { data: verified, error: passwordError } = await credentialClient.auth.signInWithPassword({
    email: current.user.email,
    password: currentPassword,
  });
  assertCurrentSession();
  if (passwordError) {
    if (passwordError.message.toLowerCase().includes('invalid login credentials')) {
      throw new Error('Current password is incorrect.');
    }
    throw new Error('Unable to verify your current password. Check your connection and try again.');
  }
  if (verified.user?.id !== current.user.id) {
    throw new Error('Unable to verify your account. Sign in again and retry.');
  }

  // This client's token belongs only to the verified user, even if the app's
  // active account changes while the update request is already in flight.
  const { error } = await credentialClient.auth.updateUser({ password: newPassword });
  assertCurrentSession();
  if (error) throw new Error('Unable to update your password. Please try again.');
}
