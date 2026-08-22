const acceptInviteOnboarding = jest.fn();
const signInWithName = jest.fn();
const verifyOtp = jest.fn();
const adoptExternalSession = jest.fn();

jest.mock('@/services/invites', () => ({
  acceptInviteOnboarding: (...args: unknown[]) => acceptInviteOnboarding(...args),
}));

jest.mock('@/services/loginCredentials', () => ({
  signInWithName: (...args: unknown[]) => signInWithName(...args),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { verifyOtp: (...args: unknown[]) => verifyOtp(...args) } },
}));

jest.mock('@/store/authStore', () => ({
  useAuthStore: { getState: () => ({ adoptExternalSession }) },
}));

import { useOnboardingStore } from '@/features/auth/onboardingStore';

const preview = {
  invitedName: 'Nate',
  role: 'employee' as const,
  locationGroup: 'sushi' as const,
};

beforeEach(() => {
  jest.clearAllMocks();
  useOnboardingStore.getState().reset();
  useOnboardingStore.getState().setInvite('invite-token', preview);
});

it('installs the chosen credential as part of invite acceptance', async () => {
  acceptInviteOnboarding.mockResolvedValue({
    role: 'employee',
    locationGroup: 'sushi',
    tokenHash: 'token-hash',
  });
  verifyOtp.mockResolvedValue({
    data: { session: { access_token: 'session-token' } },
    error: null,
  });
  adoptExternalSession.mockResolvedValue(undefined);

  await useOnboardingStore.getState().completeOnboarding('pin', '4321');

  expect(acceptInviteOnboarding).toHaveBeenCalledWith(
    'invite-token',
    'pin',
    '4321',
  );
  expect(adoptExternalSession).toHaveBeenCalledWith({
    access_token: 'session-token',
  });
  expect(useOnboardingStore.getState().accepted).toBe(true);
});

it('recovers by credential sign-in when an accept response is interrupted', async () => {
  const interrupted = new Error('Network request failed');
  acceptInviteOnboarding.mockRejectedValue(interrupted);
  signInWithName.mockResolvedValue(undefined);

  await useOnboardingStore.getState().completeOnboarding('password', 'password123');

  expect(signInWithName).toHaveBeenCalledWith('Nate', 'password123');
  expect(verifyOtp).not.toHaveBeenCalled();
  expect(useOnboardingStore.getState().accepted).toBe(true);
});

it('recovers by credential sign-in when the first-session exchange fails', async () => {
  acceptInviteOnboarding.mockResolvedValue({
    role: 'employee',
    locationGroup: 'poki',
    tokenHash: 'token-hash',
  });
  verifyOtp.mockResolvedValue({
    data: { session: null },
    error: new Error('OTP exchange interrupted'),
  });
  signInWithName.mockResolvedValue(undefined);

  await useOnboardingStore.getState().completeOnboarding('pin', '4321');

  expect(signInWithName).toHaveBeenCalledWith('Nate', '4321');
  expect(useOnboardingStore.getState().locationGroup).toBe('poki');
});

it('preserves the original invite error when recovery is not possible', async () => {
  const expired = new Error('This invite has expired');
  acceptInviteOnboarding.mockRejectedValue(expired);
  signInWithName.mockRejectedValue(new Error('No account'));

  await expect(
    useOnboardingStore.getState().completeOnboarding('pin', '4321'),
  ).rejects.toBe(expired);
});
