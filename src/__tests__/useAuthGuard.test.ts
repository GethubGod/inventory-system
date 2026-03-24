jest.mock('@/store', () => ({
  useAuthStore: jest.fn(),
}));

import { resolveAuthScreenGuard } from '../hooks/useAuthGuard';

describe('resolveAuthScreenGuard', () => {
  const baseSnapshot = {
    session: null,
    user: null,
    profile: null,
    viewMode: 'employee' as const,
    isInitialized: true,
    isLoading: false,
  };

  test('does not redirect while an authenticated auth flow is still loading', () => {
    const result = resolveAuthScreenGuard({
      ...baseSnapshot,
      session: {
        user: {
          id: 'user-1',
          email: 'employee@example.com',
          user_metadata: {},
          app_metadata: {},
        },
      } as any,
      profile: {
        id: 'user-1',
        email: 'employee@example.com',
        full_name: 'Employee One',
        role: 'employee',
        provider: 'email',
        profile_completed: true,
        is_suspended: false,
      } as any,
      isLoading: true,
    });

    expect(result.isChecking).toBe(false);
    expect(result.redirectTo).toBeNull();
    expect(result.authenticatedRedirectTo).toBeNull();
  });

  test('redirects authenticated users to home after auth loading finishes', () => {
    const result = resolveAuthScreenGuard({
      ...baseSnapshot,
      session: {
        user: {
          id: 'user-1',
          email: 'employee@example.com',
          user_metadata: {},
          app_metadata: {},
        },
      } as any,
      profile: {
        id: 'user-1',
        email: 'employee@example.com',
        full_name: 'Employee One',
        role: 'employee',
        provider: 'email',
        profile_completed: true,
        is_suspended: false,
      } as any,
    });

    expect(result.redirectTo).toBe('/(tabs)');
    expect(result.authenticatedRedirectTo).toBe('/(tabs)');
  });

  test('redirects incomplete profiles to complete-profile once loading finishes', () => {
    const result = resolveAuthScreenGuard({
      ...baseSnapshot,
      session: {
        user: {
          id: 'user-1',
          email: 'employee@example.com',
          user_metadata: {},
          app_metadata: {},
        },
      } as any,
      profile: {
        id: 'user-1',
        email: 'employee@example.com',
        full_name: 'Employee One',
        role: 'employee',
        provider: 'email',
        profile_completed: false,
        is_suspended: false,
      } as any,
    });

    expect(result.redirectTo).toBe('/(auth)/complete-profile');
    expect(result.authenticatedRedirectTo).toBe('/(auth)/complete-profile');
  });
});
