import { supabase } from '@/lib/supabase';

/** Verify the current email credential before replacing it. */
export async function changeEmailPassword(currentPassword: string, newPassword: string): Promise<void> {
  if (!currentPassword) throw new Error('Enter your current password.');
  if (newPassword.length < 8) throw new Error('New password must be at least 8 characters.');

  const { data: current, error: userError } = await supabase.auth.getUser();
  if (userError || !current.user?.email) {
    throw new Error('Unable to verify your account. Sign in again and retry.');
  }

  const { data: verified, error: passwordError } = await supabase.auth.signInWithPassword({
    email: current.user.email,
    password: currentPassword,
  });
  if (passwordError) {
    if (passwordError.message.toLowerCase().includes('invalid login credentials')) {
      throw new Error('Current password is incorrect.');
    }
    throw new Error(passwordError.message || 'Unable to verify your current password.');
  }
  if (verified.user?.id !== current.user.id) {
    throw new Error('Unable to verify your account. Sign in again and retry.');
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message || 'Unable to update your password.');
}
