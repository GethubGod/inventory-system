import type { Session } from '@supabase/supabase-js';
import type { Href } from 'expo-router';
import { useAuthStore } from '@/store';
import type { Profile, User, UserRole } from '@/types';

type AuthGuardResult = {
  isChecking: boolean;
  redirectTo: Href | null;
  resolvedRole: UserRole | null;
};

type AuthScreenGuardResult = AuthGuardResult & {
  authenticatedRedirectTo: Href | null;
};

type AuthGuardSnapshot = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  viewMode: 'employee' | 'manager';
  isInitialized: boolean;
  isLoading: boolean;
};

function resolveAuthRole(
  session: Session | null,
  user: User | null,
  profile: Profile | null
): UserRole | null {
  const metadataRole =
    typeof session?.user?.user_metadata?.role === 'string'
      ? session.user.user_metadata.role
      : typeof session?.user?.app_metadata?.role === 'string'
        ? session.user.app_metadata.role
        : null;

  // Canonical role is profiles.role (DB); never prefer client-writable session metadata.
  return profile?.role ?? user?.role ?? (metadataRole === 'manager' ? 'manager' : metadataRole === 'employee' ? 'employee' : null);
}

export function getAuthenticatedHomeHref(
  resolvedRole: UserRole | null,
  viewMode: 'employee' | 'manager'
): Href {
  if (resolvedRole === 'manager' && viewMode === 'manager') {
    return '/(manager)';
  }

  return '/(tabs)';
}

export function resolveProtectedAuthGuard(
  snapshot: AuthGuardSnapshot,
  options?: {
    requireManager?: boolean;
    nonManagerRedirectTo?: Href;
    inactiveManagerRedirectTo?: Href;
  }
): AuthGuardResult {
  const { session, user, profile, viewMode, isInitialized, isLoading } = snapshot;
  const resolvedRole = resolveAuthRole(session, user, profile);

  if (!isInitialized) {
    return { isChecking: true, redirectTo: null, resolvedRole };
  }

  if (!session) {
    return { isChecking: false, redirectTo: '/(auth)/login', resolvedRole };
  }

  // Session exists but profile hasn't been fetched yet (transient state
  // during sign-in hydration or background re-hydration). Wait for the
  // profile to arrive before making any routing decisions.
  if (!profile) {
    return { isChecking: true, redirectTo: null, resolvedRole };
  }

  if (!profile.profile_completed) {
    // If an auth operation is in progress the profile may not have been
    // repaired yet. Treat this as "still loading" to avoid a premature
    // redirect to complete-profile that bounces back once hydration finishes.
    if (isLoading) {
      return { isChecking: true, redirectTo: null, resolvedRole };
    }
    return { isChecking: false, redirectTo: '/(auth)/complete-profile', resolvedRole };
  }

  if (profile.is_suspended) {
    return { isChecking: false, redirectTo: '/suspended', resolvedRole };
  }

  if (options?.requireManager && resolvedRole !== 'manager') {
    return {
      isChecking: false,
      redirectTo: options.nonManagerRedirectTo ?? '/(tabs)/settings',
      resolvedRole,
    };
  }

  if (options?.requireManager && viewMode !== 'manager') {
    return {
      isChecking: false,
      redirectTo: options.inactiveManagerRedirectTo ?? '/(tabs)',
      resolvedRole,
    };
  }

  return { isChecking: false, redirectTo: null, resolvedRole };
}

export function resolveAuthScreenGuard(
  snapshot: AuthGuardSnapshot
): AuthScreenGuardResult {
  const { session, user, profile, viewMode, isInitialized, isLoading } = snapshot;
  const resolvedRole = resolveAuthRole(session, user, profile);

  if (!isInitialized) {
    return {
      isChecking: true,
      redirectTo: null,
      resolvedRole,
      authenticatedRedirectTo: null,
    };
  }

  if (!session) {
    return {
      isChecking: false,
      redirectTo: null,
      resolvedRole,
      authenticatedRedirectTo: null,
    };
  }

  // Keep the current auth screen mounted while a just-submitted auth action
  // is still finalizing. This avoids a home redirect from the guard racing
  // with a second imperative navigation from the screen itself.
  if (isLoading) {
    return {
      isChecking: false,
      redirectTo: null,
      resolvedRole,
      authenticatedRedirectTo: null,
    };
  }

  // Session exists but profile is still null — hydration is in progress.
  // Stay on the current auth screen and let the sign-in button show its
  // own loading state. Do NOT redirect to complete-profile prematurely.
  if (!profile) {
    return {
      isChecking: false,
      redirectTo: null,
      resolvedRole,
      authenticatedRedirectTo: null,
    };
  }

  if (!profile.profile_completed) {
    return {
      isChecking: false,
      redirectTo: '/(auth)/complete-profile',
      resolvedRole,
      authenticatedRedirectTo: '/(auth)/complete-profile',
    };
  }

  if (profile.is_suspended) {
    return {
      isChecking: false,
      redirectTo: '/suspended',
      resolvedRole,
      authenticatedRedirectTo: '/suspended',
    };
  }

  const homeHref = getAuthenticatedHomeHref(resolvedRole, viewMode);

  return {
    isChecking: false,
    redirectTo: homeHref,
    resolvedRole,
    authenticatedRedirectTo: homeHref,
  };
}

export function useProtectedAuthGuard(options?: {
  requireManager?: boolean;
  nonManagerRedirectTo?: Href;
  inactiveManagerRedirectTo?: Href;
}): AuthGuardResult {
  const session = useAuthStore((state) => state.session);
  const user = useAuthStore((state) => state.user);
  const profile = useAuthStore((state) => state.profile);
  const viewMode = useAuthStore((state) => state.viewMode);
  const isInitialized = useAuthStore((state) => state.isInitialized);
  const isLoading = useAuthStore((state) => state.isLoading);

  return resolveProtectedAuthGuard(
    { session, user, profile, viewMode, isInitialized, isLoading },
    options
  );
}

export function useAuthScreenGuard(): AuthScreenGuardResult {
  const session = useAuthStore((state) => state.session);
  const user = useAuthStore((state) => state.user);
  const profile = useAuthStore((state) => state.profile);
  const viewMode = useAuthStore((state) => state.viewMode);
  const isInitialized = useAuthStore((state) => state.isInitialized);
  const isLoading = useAuthStore((state) => state.isLoading);

  return resolveAuthScreenGuard({
    session,
    user,
    profile,
    viewMode,
    isInitialized,
    isLoading,
  });
}
