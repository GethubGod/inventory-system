import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RealtimeChannel, Session } from '@supabase/supabase-js';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { User, Location, UserRole, Profile, AuthProvider } from '@/types';
import { clearSupabaseStoredSession, supabase } from '@/lib/supabase';
import { deleteSelfAccountRequest, registerSessionGetter } from '@/lib/api/client';
import { validateAccessCode } from '@/services/accessCodes';

type ViewMode = 'employee' | 'manager';
type OAuthProvider = 'google' | 'apple';

WebBrowser.maybeCompleteAuthSession();

const OAUTH_REDIRECT_URI = AuthSession.makeRedirectUri({
  path: 'auth/callback',
  native: 'babytunasystems://auth/callback',
});

let profileRealtimeChannel: RealtimeChannel | null = null;
let authStateSubscription: { unsubscribe: () => void } | null = null;
let warnedMissingLastActiveColumn = false;
let warnedMissingEmailColumn = false;
const warnedMissingProfileColumns = new Set<string>();
const SUSPENDED_ACCOUNT_MESSAGE = 'Account suspended. Contact a manager.';
let activeSessionUserId: string | null = null;
let userScopedResetPromise: Promise<void> | null = null;
let authStateTransitionId = 0;
let identityRepairRpcAvailable: boolean | null = null;
let warnedIdentityRepairRpcUnavailable = false;
let explicitSignOutInProgress = false;
const pendingDeferredAuthTaskTimeouts = new Set<ReturnType<typeof setTimeout>>();
const SIGN_OUT_TIMEOUT_MS = 5_000;
const DELETE_SELF_NETWORK_TIMEOUT_MS = 20_000;
const DELETE_SELF_CLEANUP_TIMEOUT_MS = 8_000;
const AUTH_TRANSITION_STALE_MESSAGE = '__AUTH_TRANSITION_STALE__';

type SignUpResult =
  | { status: 'authenticated'; user: User }
  | { status: 'confirmation_required'; email: string };

type SessionBootstrapInput = {
  email?: string | null;
  fullName?: string | null;
  role?: UserRole | null;
  locationId?: string | null;
  provider?: AuthProvider | null;
  profileCompleted?: boolean;
};

type ResolvedSessionBootstrapInput = {
  email: string | null;
  fullName: string | null;
  role: UserRole | null;
  locationId: string | null;
  provider: AuthProvider;
  profileCompleted: boolean;
};

function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function normalizeName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeLocationId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function getSessionMetadataString(
  sessionUser: Session['user'] | null | undefined,
  key: string
): string | null {
  const userValue = sessionUser?.user_metadata?.[key];
  if (typeof userValue === 'string' && userValue.trim()) {
    return userValue.trim();
  }

  const appValue = sessionUser?.app_metadata?.[key];
  if (typeof appValue === 'string' && appValue.trim()) {
    return appValue.trim();
  }

  return null;
}

function getSessionMetadataRole(sessionUser: Session['user'] | null | undefined): UserRole | null {
  const rawRole = getSessionMetadataString(sessionUser, 'role');
  return rawRole === 'employee' || rawRole === 'manager' ? rawRole : null;
}

function getSessionAuthProvider(sessionUser: Session['user'] | null | undefined): AuthProvider {
  const rawProvider = getSessionMetadataString(sessionUser, 'provider');
  return rawProvider === 'google' || rawProvider === 'apple' || rawProvider === 'email'
    ? rawProvider
    : 'email';
}

function resolveProfileCompleted(
  fullName: string | null,
  role: UserRole | null,
  explicitValue?: boolean
): boolean {
  if (typeof explicitValue === 'boolean') {
    return explicitValue;
  }

  return Boolean(fullName && role);
}

function resolveSessionBootstrapInput(
  sessionUser: Session['user'] | null | undefined,
  input?: SessionBootstrapInput
): ResolvedSessionBootstrapInput {
  const fullName = normalizeName(
    input?.fullName ??
      getSessionMetadataString(sessionUser, 'full_name') ??
      getSessionMetadataString(sessionUser, 'name')
  );
  const role = input?.role ?? getSessionMetadataRole(sessionUser);

  return {
    email: normalizeEmail(input?.email ?? sessionUser?.email ?? null),
    fullName,
    role,
    locationId: normalizeLocationId(
      input?.locationId ?? getSessionMetadataString(sessionUser, 'default_location_id')
    ),
    provider: input?.provider ?? getSessionAuthProvider(sessionUser),
    profileCompleted: resolveProfileCompleted(fullName, role, input?.profileCompleted),
  };
}

function deriveFallbackName(email: string | null, fullName: string | null): string {
  if (fullName) {
    return fullName;
  }

  if (email) {
    const [localPart] = email.split('@');
    if (localPart) {
      return localPart;
    }
  }

  return 'User';
}

function isTransitionStaleError(error: unknown): boolean {
  return error instanceof Error && error.message === AUTH_TRANSITION_STALE_MESSAGE;
}

function getAuthErrorMessage(error: unknown, fallbackMessage: string): string {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : fallbackMessage;
  const message = rawMessage.trim();
  const lower = message.toLowerCase();

  if (!message) {
    return fallbackMessage;
  }

  if (lower.includes('invalid login credentials')) {
    return 'Invalid email or password.';
  }

  if (lower.includes('email not confirmed')) {
    return 'Please confirm your email before signing in.';
  }

  if (lower.includes('user already registered') || lower.includes('already been registered')) {
    return 'An account with this email already exists.';
  }

  if (lower.includes('password should be at least')) {
    return message;
  }

  if (lower.includes('signup is disabled')) {
    return 'Account creation is currently unavailable.';
  }

  if (lower.includes('network request failed')) {
    return 'Unable to reach the server. Please check your connection and try again.';
  }

  return message;
}

function getSupabaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  return 'code' in error && typeof (error as { code?: unknown }).code === 'string'
    ? ((error as { code?: string }).code ?? null)
    : null;
}

function getSupabaseErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  return 'message' in error && typeof (error as { message?: unknown }).message === 'string'
    ? ((error as { message?: string }).message ?? null)
    : null;
}

function isMissingRpcError(error: unknown): boolean {
  const code = getSupabaseErrorCode(error);
  const message = (getSupabaseErrorMessage(error) ?? '').toLowerCase();

  // PGRST202: PostgREST "function not found"
  // 42883:   PostgreSQL "undefined_function"
  if (code === 'PGRST202' || code === '42883') {
    return true;
  }

  // Only match messages that indicate the *function* itself is missing,
  // not errors from inside the function body (e.g. missing columns).
  if (message.includes('function') && message.includes('does not exist')) {
    return true;
  }

  return false;
}

function isPermissionDeniedError(error: unknown): boolean {
  const code = getSupabaseErrorCode(error);
  const message = (getSupabaseErrorMessage(error) ?? '').toLowerCase();

  return code === '42501' || message.includes('permission denied');
}

function isIdentityRepairUnavailableError(error: unknown): boolean {
  return isMissingRpcError(error) || isPermissionDeniedError(error);
}

function markIdentityRepairRpcUnavailable(error: unknown) {
  identityRepairRpcAvailable = false;

  if (warnedIdentityRepairRpcUnavailable) {
    return;
  }

  warnedIdentityRepairRpcUnavailable = true;
  console.warn(
    'Identity repair RPC is unavailable in this environment. Continuing with client-side auth hydration fallback.',
    error
  );
}

function withTimeout(promise: Promise<any>, timeoutMs: number, timeoutMessage: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function clearProfileSubscription() {
  if (!profileRealtimeChannel) return;
  supabase.removeChannel(profileRealtimeChannel);
  profileRealtimeChannel = null;
}

function clearAuthStateSubscription() {
  if (!authStateSubscription) return;
  authStateSubscription.unsubscribe();
  authStateSubscription = null;
}

async function signOutLocalSupabaseSession(warningMessage: string) {
  try {
    const { error } = await withTimeout(
      supabase.auth.signOut({ scope: 'local' }),
      SIGN_OUT_TIMEOUT_MS,
      'Supabase sign-out timed out.'
    );
    if (error) {
      console.warn(warningMessage, error);
    }
  } catch (error) {
    console.warn(warningMessage, error);
  }
}

function clearPendingDeferredAuthTasks() {
  for (const timeoutId of pendingDeferredAuthTaskTimeouts) {
    clearTimeout(timeoutId);
  }
  pendingDeferredAuthTaskTimeouts.clear();
}

function beginAuthTransition() {
  clearPendingDeferredAuthTasks();
  authStateTransitionId += 1;
  return authStateTransitionId;
}

function scheduleDeferredAuthTask(task: () => Promise<void>) {
  const timeoutId = setTimeout(() => {
    pendingDeferredAuthTaskTimeouts.delete(timeoutId);
    task().catch((error) => {
      if (isTransitionStaleError(error)) {
        return;
      }
      console.error('Deferred auth task failed:', error);
    });
  }, 0);

  pendingDeferredAuthTaskTimeouts.add(timeoutId);
}

function subscribeToProfileChanges(userId: string, onChange: () => Promise<unknown>) {
  clearProfileSubscription();
  profileRealtimeChannel = supabase
    .channel(`profile-updates-${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'profiles',
        filter: `id=eq.${userId}`,
      },
      () => {
        onChange().catch((error) => {
          console.error('Failed to refresh profile after realtime update', error);
        });
      }
    )
    .subscribe();
}

function isMissingColumnError(error: unknown, column: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? (error as { code?: unknown }).code : null;
  const message = 'message' in error ? (error as { message?: unknown }).message : null;

  if (code !== 'PGRST204' || typeof message !== 'string') return false;
  return message.includes(column) && message.toLowerCase().includes('schema cache');
}

async function touchLastActive(userId: string) {
  const { error } = await supabase
    .from('profiles')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', userId);

  if (error) {
    if (isMissingColumnError(error, 'last_active_at')) {
      if (!warnedMissingLastActiveColumn) {
        warnedMissingLastActiveColumn = true;
        console.warn(
          "profiles.last_active_at is unavailable. Skipping activity timestamp updates until migrations are applied."
        );
      }
      return;
    }

    console.error('Failed to update last_active_at', error);
  }
}

async function syncProfileEmail(userId: string, email: string | null | undefined) {
  const normalizedEmail = typeof email === 'string' ? email.trim() : '';
  if (!normalizedEmail) return;

  const { error } = await supabase
    .from('profiles')
    .update({ email: normalizedEmail })
    .eq('id', userId);

  if (error) {
    if (isMissingColumnError(error, 'email')) {
      if (!warnedMissingEmailColumn) {
        warnedMissingEmailColumn = true;
        console.warn(
          "profiles.email is unavailable. Skipping profile email sync until migrations are applied."
        );
      }
      return;
    }

    console.error('Failed to sync profiles.email', error);
  }
}

async function upsertProfileResilient(payload: Record<string, unknown>) {
  const nextPayload = { ...payload } as Record<string, unknown>;
  const fallbackColumns = [
    'email',
    'is_suspended',
    'suspended_at',
    'suspended_by',
    'last_active_at',
    'last_order_at',
  ] as const;

  while (true) {
    const { error } = await supabase.from('profiles').upsert(nextPayload as any);
    if (!error) return;

    const missingColumn = fallbackColumns.find(
      (column) => column in nextPayload && isMissingColumnError(error, column)
    );

    if (!missingColumn) {
      throw error;
    }

    delete nextPayload[missingColumn];

    if (!warnedMissingProfileColumns.has(missingColumn)) {
      warnedMissingProfileColumns.add(missingColumn);
      console.warn(
        `profiles.${missingColumn} is unavailable. Continuing signup/profile completion without it until migrations are applied.`
      );
    }
  }
}

function parseOAuthResultUrl(url: string) {
  const parsed = new URL(url);
  const hashParams = new URLSearchParams(parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash);

  return {
    code: parsed.searchParams.get('code'),
    errorDescription:
      parsed.searchParams.get('error_description') ??
      parsed.searchParams.get('error') ??
      hashParams.get('error_description') ??
      hashParams.get('error'),
    accessToken: hashParams.get('access_token'),
    refreshToken: hashParams.get('refresh_token'),
  };
}

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  location: Location | null;
  locations: Location[];
  isLoading: boolean;
  isInitialized: boolean;
  viewMode: ViewMode;

  // Actions
  setSession: (session: Session | null) => void;
  setUser: (user: User | null) => void;
  setProfile: (profile: Profile | null) => void;
  setLocation: (location: Location | null) => void;
  setIsLoading: (isLoading: boolean) => void;
  setViewMode: (mode: ViewMode) => void;
  initialize: () => Promise<void>;
  fetchUser: () => Promise<User | null>;
  fetchProfile: () => Promise<Profile | null>;
  fetchLocations: () => Promise<Location[]>;
  signIn: (email: string, password: string) => Promise<User | null>;
  signInWithOAuth: (provider: OAuthProvider) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    name: string,
    accessCode: string,
    locationId?: string
  ) => Promise<SignUpResult>;
  completeProfile: (fullName: string, accessCode: string) => Promise<User>;
  signOut: () => Promise<void>;
  deleteSelfAccount: (confirmText: string) => Promise<void>;
  updateDefaultLocation: (locationId: string) => Promise<void>;
  updateUserRole: (role: UserRole) => Promise<void>;
}

const USER_SCOPED_STORAGE_KEYS = [
  'order-storage',
  'draft-storage',
  'inventory-storage',
  'stock-storage',
  'babytuna-fulfillment',
  'tuna-specialist-storage',
  'home-insights-cache-v1',
] as const;

type PersistedStoreApi = {
  getInitialState: () => Record<string, unknown>;
  setState: (state: Record<string, unknown>, replace?: boolean) => void;
  persist?: {
    clearStorage?: () => Promise<void> | void;
  };
};

async function resetPersistedStore(label: string, store: PersistedStoreApi) {
  try {
    await store.persist?.clearStorage?.();
  } catch (error) {
    console.warn(`Failed to clear persisted storage for ${label}.`, error);
  }

  try {
    store.setState(store.getInitialState(), true);
  } catch (error) {
    console.warn(`Failed to reset in-memory state for ${label}.`, error);
  }
}

async function clearUserScopedClientState() {
  if (userScopedResetPromise) {
    return userScopedResetPromise;
  }

  userScopedResetPromise = (async () => {
    try {
      await AsyncStorage.multiRemove([...USER_SCOPED_STORAGE_KEYS]);
    } catch (error) {
      console.warn('Failed to remove user-scoped storage keys.', error);
    }

    try {
      const [
        { useOrderStore },
        { useDraftStore },
        { useInventoryStore },
        { useStockStore },
        { useFulfillmentStore },
        { useTunaSpecialistStore },
      ] = await Promise.all([
        import('./orderStore'),
        import('./draftStore'),
        import('./inventoryStore'),
        import('./stockStore'),
        import('./fulfillmentStore'),
        import('./tunaSpecialistStore'),
      ]);

      await Promise.all([
        resetPersistedStore('order-storage', useOrderStore as unknown as PersistedStoreApi),
        resetPersistedStore('draft-storage', useDraftStore as unknown as PersistedStoreApi),
        resetPersistedStore('inventory-storage', useInventoryStore as unknown as PersistedStoreApi),
        resetPersistedStore('stock-storage', useStockStore as unknown as PersistedStoreApi),
        resetPersistedStore('babytuna-fulfillment', useFulfillmentStore as unknown as PersistedStoreApi),
        resetPersistedStore('tuna-specialist-storage', useTunaSpecialistStore as unknown as PersistedStoreApi),
      ]);
    } catch (error) {
      console.warn('Failed to reset one or more user-scoped stores.', error);
    }
  })();

  try {
    await userScopedResetPromise;
  } finally {
    userScopedResetPromise = null;
  }
}

async function clearPersistedAuthState() {
  try {
    await AsyncStorage.removeItem('babytuna-auth');
  } catch (error) {
    console.warn('Failed to clear persisted auth storage.', error);
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => {
      const assertFreshTransition = (transitionId?: number) => {
        if (typeof transitionId === 'number' && transitionId !== authStateTransitionId) {
          throw new Error(AUTH_TRANSITION_STALE_MESSAGE);
        }
      };

      const clearSessionState = () => {
        set({
          session: null,
          user: null,
          profile: null,
          location: null,
          viewMode: 'employee',
        });
      };

      const applySignedOutState = () => {
        clearProfileSubscription();
        clearSessionState();
        activeSessionUserId = null;
      };

      const clearSignedOutClientStateForTransition = async (transitionId?: number) => {
        assertFreshTransition(transitionId);

        try {
          await clearUserScopedClientState();
        } catch (error) {
          console.warn('Failed to clear user-scoped client state.', error);
        }

        assertFreshTransition(transitionId);

        try {
          await clearPersistedAuthState();
        } catch (error) {
          console.warn('Failed to clear persisted auth state.', error);
        }

        assertFreshTransition(transitionId);

        try {
          await clearSupabaseStoredSession();
        } catch (error) {
          console.warn('Failed to clear persisted Supabase session storage.', error);
        }

        assertFreshTransition(transitionId);
      };

      const resetSignedOutClientState = async (transitionId?: number) => {
        applySignedOutState();
        clearExplicitSignOutFlag();
        await clearSignedOutClientStateForTransition(transitionId);
      };

      const forceSignOutSuspended = async (message = SUSPENDED_ACCOUNT_MESSAGE) => {
        explicitSignOutInProgress = true;
        const transitionId = beginAuthTransition();
        try {
          void signOutLocalSupabaseSession('Failed to sign out suspended session cleanly');
        } finally {
          await resetSignedOutClientState(transitionId);
        }

        throw new Error(message);
      };

      const clearExplicitSignOutFlag = () => {
        explicitSignOutInProgress = false;
      };

      const applyRecoveredSession = async (
        recoveredSession: Session,
        transitionId: number,
        recoverySource: string
      ) => {
        assertFreshTransition(transitionId);
        clearExplicitSignOutFlag();

        const currentState = get();
        const currentUserId = currentState.user?.id ?? null;
        const currentProfileId = currentState.profile?.id ?? null;

        set({ session: recoveredSession });
        activeSessionUserId = recoveredSession.user.id;

        const needsHydration =
          !currentState.user ||
          !currentState.profile ||
          currentUserId !== recoveredSession.user.id ||
          currentProfileId !== recoveredSession.user.id;

        if (!needsHydration) {
          return;
        }

        try {
          await hydrateAuthenticatedSession(recoveredSession, {
            transitionId,
            repairIfNeeded: true,
            bootstrapInput: {
              email: recoveredSession.user.email ?? null,
              profileCompleted: true,
            },
            shouldThrowOnSuspended: false,
          });
        } catch (error) {
          if (isTransitionStaleError(error)) {
            throw error;
          }
          console.warn(
            `Recovered auth session via ${recoverySource}, but full hydration failed (non-fatal).`,
            error
          );
        }
      };

      const recoverUnexpectedSignedOutSession = async (transitionId: number) => {
        let verifiedSession: Session | null = null;

        try {
          const {
            data: { session: latestSession },
          } = await supabase.auth.getSession();
          verifiedSession = latestSession ?? null;
        } catch (error) {
          console.warn('Failed to verify unexpected signed-out auth event.', error);
        }

        assertFreshTransition(transitionId);

        if (verifiedSession?.user) {
          await applyRecoveredSession(verifiedSession, transitionId, 'getSession');
          return true;
        }

        const preservedSession = get().session;

        if (!preservedSession?.user) {
          return false;
        }

        try {
          const { data: restoredData, error: restoredError } = await supabase.auth.setSession({
            access_token: preservedSession.access_token,
            refresh_token: preservedSession.refresh_token,
          });

          if (restoredError) {
            console.warn('Failed to restore auth session after unexpected signed-out event.', restoredError);
          } else if (restoredData.session?.user) {
            await applyRecoveredSession(restoredData.session, transitionId, 'setSession');
            return true;
          }
        } catch (error) {
          console.warn('Unexpected error while restoring auth session after signed-out event.', error);
        }

        assertFreshTransition(transitionId);

        try {
          const { data: refreshedData, error: refreshedError } = await supabase.auth.refreshSession();

          if (refreshedError) {
            console.warn(
              'Failed to refresh auth session after unexpected signed-out event.',
              refreshedError
            );
          } else if (refreshedData.session?.user) {
            await applyRecoveredSession(refreshedData.session, transitionId, 'refreshSession');
            return true;
          }
        } catch (error) {
          console.warn('Unexpected error while refreshing auth session after signed-out event.', error);
        }

        assertFreshTransition(transitionId);

        console.warn(
          'Ignoring unexpected signed-out auth event and preserving the current in-memory session.'
        );
        clearExplicitSignOutFlag();
        set({ session: preservedSession });
        activeSessionUserId = preservedSession.user.id;
        return true;
      };

      const resolveAndSetLocation = async (locationId: string | null, expectedUserId: string) => {
        if (get().session?.user?.id !== expectedUserId) {
          return null;
        }

        if (!locationId) {
          set({ location: null });
          return null;
        }

        const existingLocation =
          get().locations.find((candidate) => candidate.id === locationId) ?? null;

        if (existingLocation) {
          set({ location: existingLocation });
          return existingLocation;
        }

        const { data: location, error } = await supabase
          .from('locations')
          .select('*')
          .eq('id', locationId)
          .maybeSingle();

        if (error) {
          console.error('Failed to fetch default location:', error);
          if (get().session?.user?.id === expectedUserId) {
            set({ location: null });
          }
          return null;
        }

        if (get().session?.user?.id === expectedUserId) {
          set({ location: (location as Location | null) ?? null });
        }

        return (location as Location | null) ?? null;
      };

      const shouldRepairProfile = (
        profile: Profile | null,
        bootstrap: ResolvedSessionBootstrapInput
      ) => {
        if (!profile) {
          return true;
        }

        const nextEmail = bootstrap.email ?? normalizeEmail(profile.email);
        const nextFullName = bootstrap.fullName ?? normalizeName(profile.full_name);
        const nextRole = bootstrap.role ?? profile.role;
        const nextProvider = profile.provider ?? bootstrap.provider;
        const nextProfileCompleted = profile.profile_completed || bootstrap.profileCompleted;

        return (
          normalizeEmail(profile.email) !== nextEmail ||
          normalizeName(profile.full_name) !== nextFullName ||
          profile.role !== nextRole ||
          profile.provider !== nextProvider ||
          profile.profile_completed !== nextProfileCompleted
        );
      };

      const repairProfileRecord = async (
        session: Session,
        input?: SessionBootstrapInput,
        existingProfile?: Profile | null
      ) => {
        const bootstrap = resolveSessionBootstrapInput(session.user, input);
        const currentProfile =
          typeof existingProfile === 'undefined' ? await get().fetchProfile() : existingProfile;

        if (!shouldRepairProfile(currentProfile ?? null, bootstrap)) {
          return currentProfile ?? null;
        }

        if (identityRepairRpcAvailable === false) {
          return currentProfile ?? (await get().fetchProfile());
        }

        // Profile repair is best-effort — it must NEVER block sign-in.
        // Use only the server-side RPC (SECURITY DEFINER, bypasses RLS).
        // If the RPC fails for any reason, continue with whatever profile
        // data we already have. Never fall back to a client-side upsert
        // because RLS policies may block it.
        try {
          const { error: rpcError } = await supabase.rpc('ensure_current_user_identity');
          if (rpcError) {
            if (isIdentityRepairUnavailableError(rpcError)) {
              markIdentityRepairRpcUnavailable(rpcError);
            } else {
              console.warn('Profile repair RPC failed (non-fatal):', rpcError);
            }
            return currentProfile ?? (await get().fetchProfile());
          }
          identityRepairRpcAvailable = true;
        } catch (repairError) {
          if (isIdentityRepairUnavailableError(repairError)) {
            markIdentityRepairRpcUnavailable(repairError);
          } else {
            console.warn('Profile repair failed (non-fatal):', repairError);
          }
          return currentProfile ?? (await get().fetchProfile());
        }

        return get().fetchProfile();
      };

      const refreshProfileAndHandleSuspension = async (params?: {
        session?: Session | null;
        userId?: string;
        bootstrapInput?: SessionBootstrapInput;
        repairIfNeeded?: boolean;
        shouldThrowOnSuspended?: boolean;
      }) => {
        const activeSession = params?.session ?? get().session;
        let profile = await get().fetchProfile();
        const userId = params?.userId;

        if (activeSession?.user && params?.repairIfNeeded !== false) {
          profile = await repairProfileRecord(activeSession, params?.bootstrapInput, profile);
        }

        if (profile?.is_suspended) {
          if (params?.shouldThrowOnSuspended === false) {
            explicitSignOutInProgress = true;
            const transitionId = beginAuthTransition();
            void signOutLocalSupabaseSession('Failed to sign out suspended session cleanly');
            await resetSignedOutClientState(transitionId);
            return { profile, suspended: true };
          }

          await forceSignOutSuspended();
        }

        if (userId && get().session?.user?.id === userId) {
          await syncProfileEmail(userId, get().session?.user?.email ?? null);
          await touchLastActive(userId);
        }

        return { profile, suspended: false };
      };

      const buildResolvedUserRecord = (
        session: Session,
        input?: SessionBootstrapInput,
        existingUser?: User | null,
        existingProfile?: Profile | null
      ): User => {
        const bootstrap = resolveSessionBootstrapInput(session.user, input);
        const profileName =
          normalizeName(existingProfile?.full_name) ??
          (get().profile?.id === session.user.id ? normalizeName(get().profile?.full_name) : null);
        const profileRole =
          existingProfile?.role ??
          (get().profile?.id === session.user.id ? get().profile?.role : null);
        const nextRole = bootstrap.role ?? profileRole ?? existingUser?.role ?? 'employee';
        const nextName =
          bootstrap.fullName ??
          profileName ??
          existingUser?.name ??
          deriveFallbackName(bootstrap.email ?? session.user.email ?? null, bootstrap.fullName);
        const nextEmail = bootstrap.email ?? existingUser?.email ?? normalizeEmail(session.user.email) ?? '';
        const nextLocationId = bootstrap.locationId ?? existingUser?.default_location_id ?? null;

        return {
          id: session.user.id,
          email: nextEmail,
          name: nextName,
          role: nextRole,
          default_location_id: nextLocationId,
          created_at:
            existingUser?.created_at ??
            (typeof (session.user as { created_at?: unknown }).created_at === 'string'
              ? ((session.user as { created_at?: string }).created_at as string)
              : new Date().toISOString()),
        };
      };

      const repairUserRecord = async (
        session: Session,
        input?: SessionBootstrapInput,
        existingUserOverride?: User | null
      ) => {
        const existingUser =
          typeof existingUserOverride !== 'undefined'
            ? existingUserOverride
            : get().user?.id === session.user.id
              ? get().user
              : await get().fetchUser();
        const existingProfile =
          get().profile?.id === session.user.id ? get().profile : await get().fetchProfile();
        const resolvedUser = buildResolvedUserRecord(session, input, existingUser, existingProfile);

        const needsRepair =
          !existingUser ||
          existingUser.email !== resolvedUser.email ||
          existingUser.name !== resolvedUser.name ||
          existingUser.role !== resolvedUser.role ||
          existingUser.default_location_id !== resolvedUser.default_location_id;

        if (!needsRepair) {
          if (existingUser) {
            await resolveAndSetLocation(existingUser.default_location_id, session.user.id);
          }
          return existingUser ?? null;
        }

        let error: unknown = null;

        if (identityRepairRpcAvailable !== false) {
          const rpcResult = await supabase.rpc('ensure_current_user_identity');
          error = rpcResult.error;
          if (error) {
            if (isIdentityRepairUnavailableError(error)) {
              markIdentityRepairRpcUnavailable(error);
            } else {
              console.warn('Unable to repair user record via server-side identity sync.', error);
            }
          } else {
            identityRepairRpcAvailable = true;
          }
        }

        if (!error || isIdentityRepairUnavailableError(error)) {
          const repairedUser = await get().fetchUser();
          if (repairedUser) {
            const isRepaired =
              repairedUser.email === resolvedUser.email &&
              repairedUser.name === resolvedUser.name &&
              repairedUser.role === resolvedUser.role &&
              repairedUser.default_location_id === resolvedUser.default_location_id;

            if (isRepaired) {
              return repairedUser;
            }
          }
        }

        if (get().session?.user?.id === session.user.id) {
          set({ user: resolvedUser });
          await resolveAndSetLocation(resolvedUser.default_location_id, session.user.id);
        }

        return resolvedUser;
      };

      const hydrateAuthenticatedSession = async (
        session: Session,
        params?: {
          bootstrapInput?: SessionBootstrapInput;
          transitionId?: number;
          waitForTriggerMs?: number;
          repairIfNeeded?: boolean;
          shouldThrowOnSuspended?: boolean;
        }
      ) => {
        const nextUserId = session.user.id;
        const previousUserId = activeSessionUserId ?? get().user?.id ?? null;

        clearExplicitSignOutFlag();
        set({ session });

        if (previousUserId && previousUserId !== nextUserId) {
          await clearUserScopedClientState();
        }

        assertFreshTransition(params?.transitionId);
        activeSessionUserId = nextUserId;

        if (params?.waitForTriggerMs) {
          await new Promise((resolve) => setTimeout(resolve, params.waitForTriggerMs));
          assertFreshTransition(params.transitionId);
        }

        // --- Profile hydration (best-effort) ---
        let profile: Profile | null = null;
        let suspended = false;
        try {
          const result = await refreshProfileAndHandleSuspension({
            session,
            userId: nextUserId,
            bootstrapInput: params?.bootstrapInput,
            repairIfNeeded: params?.repairIfNeeded,
            shouldThrowOnSuspended: params?.shouldThrowOnSuspended,
          });
          profile = result.profile;
          suspended = result.suspended;
        } catch (profileError) {
          if (isTransitionStaleError(profileError)) throw profileError;
          console.warn('Profile hydration failed (non-fatal):', profileError);
          profile = get().profile;
        }
        assertFreshTransition(params?.transitionId);

        if (suspended) {
          return null;
        }

        // If profile is still null after fetch, build a minimal one from
        // session metadata so auth guards don't block the user forever.
        if (!profile && get().session?.user?.id === nextUserId) {
          const bootstrap = resolveSessionBootstrapInput(session.user, params?.bootstrapInput);
          const fallbackProfile: Profile = {
            id: nextUserId,
            email: bootstrap.email ?? session.user.email ?? null,
            full_name: bootstrap.fullName ?? deriveFallbackName(bootstrap.email, bootstrap.fullName),
            role: bootstrap.role ?? 'employee',
            provider: bootstrap.provider,
            profile_completed: bootstrap.profileCompleted || Boolean(bootstrap.fullName && bootstrap.role),
            is_suspended: false,
            suspended_at: null,
            suspended_by: null,
            notifications_enabled: true,
            last_active_at: new Date().toISOString(),
            last_order_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          console.warn('Using locally-resolved profile; DB record could not be loaded.');
          set({ profile: fallbackProfile });
          profile = fallbackProfile;
        }

        // --- User hydration (best-effort) ---
        let user: User | null = null;
        try {
          user = await get().fetchUser();
          if (params?.repairIfNeeded !== false) {
            try {
              user = await repairUserRecord(session, params?.bootstrapInput, user);
            } catch (repairError) {
              console.warn('User record repair failed (non-fatal):', repairError);
            }
          }
        } catch (userError) {
          if (isTransitionStaleError(userError)) throw userError;
          console.warn('User hydration failed (non-fatal):', userError);
        }
        assertFreshTransition(params?.transitionId);

        // If we still have no user after fetch + repair, build one from
        // session metadata so the user can still access the app.
        if (!user) {
          const fallbackUser = buildResolvedUserRecord(session, params?.bootstrapInput, null, profile);
          console.warn('Using locally-resolved user; DB record could not be loaded.');
          if (get().session?.user?.id === nextUserId) {
            set({ user: fallbackUser });
          }
          user = fallbackUser;
        }

        subscribeToProfileChanges(nextUserId, async () => {
          try {
            await refreshProfileAndHandleSuspension({
              shouldThrowOnSuspended: false,
              repairIfNeeded: true,
            });
          } catch (realtimeError) {
            console.warn('Profile refresh from realtime update failed:', realtimeError);
          }
        });

        return user;
      };

      return {
      session: null,
      user: null,
      profile: null,
      location: null,
      locations: [],
      isLoading: true,
      isInitialized: false,
      viewMode: 'employee',

      setSession: (session) => set({ session }),
      setUser: (user) => set({ user }),
      setProfile: (profile) => set({ profile }),
      setLocation: (location) => set({ location }),
      setIsLoading: (isLoading) => set({ isLoading }),
      setViewMode: (mode) => set({ viewMode: mode }),

      fetchLocations: async () => {
        const { data } = await supabase
          .from('locations')
          .select('*')
          .eq('active', true)
          .order('name');

        const locations = data || [];
        set({ locations });
        return locations;
      },

      fetchProfile: async () => {
        const { session } = get();
        if (!session?.user) {
          set({ profile: null });
          return null;
        }

        const sessionUserId = session.user.id;

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', sessionUserId)
          .maybeSingle();

        if (error) {
          console.error('Failed to fetch profile:', error);
          // Keep the existing profile on transient errors so auth guards
          // don't see a null profile and trigger premature redirects.
          return get().profile;
        }

        if (get().session?.user?.id !== sessionUserId) {
          return null;
        }

        if (profile) {
          set({ profile });
        } else {
          // DB returned no row. Keep the existing in-memory profile (which may
          // be a locally-built fallback) so auth guards aren't disrupted.
          // The profile will be overwritten once the RPC repair succeeds and a
          // subsequent fetch returns a real row.
          const existing = get().profile;
          if (!existing || existing.id !== sessionUserId) {
            set({ profile: null });
          }
        }

        return profile ?? get().profile ?? null;
      },

      fetchUser: async () => {
        const { session } = get();
        if (!session?.user) {
          set({ user: null, location: null });
          return null;
        }

        const sessionUserId = session.user.id;

        const { data: user, error } = await supabase
          .from('users')
          .select('*')
          .eq('id', sessionUserId)
          .maybeSingle();

        if (error) {
          console.error('Failed to fetch user:', error);
          // Keep existing user/location on transient errors to avoid
          // clearing state that auth guards and UI depend on.
          return get().user;
        }

        if (get().session?.user?.id !== sessionUserId) {
          return null;
        }

        if (user) {
          set({ user });
          await resolveAndSetLocation(user.default_location_id, sessionUserId);
        } else {
          // DB returned no row. Keep the existing in-memory user (which may be
          // a locally-built fallback) so the app isn't disrupted.
          const existing = get().user;
          if (!existing || existing.id !== sessionUserId) {
            set({ user: null, location: null });
          }
        }

        return user ?? get().user ?? null;
      },

      initialize: async () => {
        try {
          set({ isLoading: true });
          const persistedUserId = get().user?.id ?? null;

          // Fetch locations
          await get().fetchLocations();

          // Get current session
          const {
            data: { session },
          } = await supabase.auth.getSession();
          set({ session });
          const sessionUserId = session?.user?.id ?? null;

          if (persistedUserId && persistedUserId !== sessionUserId) {
            await clearUserScopedClientState();
          }

          if (session?.user) {
            await hydrateAuthenticatedSession(session, {
              bootstrapInput: {
                email: session.user.email ?? null,
                profileCompleted: true,
              },
              repairIfNeeded: true,
              shouldThrowOnSuspended: false,
            });
          } else {
            await resetSignedOutClientState(beginAuthTransition());
          }

          // Listen for auth changes (ensure exactly one active listener).
          clearAuthStateSubscription();
          const authListener = supabase.auth.onAuthStateChange((event: any, session: Session | null) => {
            if (event === 'INITIAL_SESSION') {
              return;
            }

            if (event === 'SIGNED_OUT') {
              const currentState = get();
              const isAlreadySignedOutLocally =
                !currentState.session?.user && !currentState.user && !currentState.profile;

              if (explicitSignOutInProgress || isAlreadySignedOutLocally) {
                clearExplicitSignOutFlag();
                return;
              }

              const transitionId = beginAuthTransition();

              scheduleDeferredAuthTask(async () => {
                const recovered = await recoverUnexpectedSignedOutSession(transitionId);
                assertFreshTransition(transitionId);

                if (recovered) {
                  return;
                }

                await resetSignedOutClientState(transitionId);
              });
              return;
            }

            const transitionId = beginAuthTransition();

            if (!session) {
              return;
            }

            set({ session });

            if (event !== 'SIGNED_IN' && event !== 'TOKEN_REFRESHED' && event !== 'USER_UPDATED') {
              return;
            }

            scheduleDeferredAuthTask(async () => {
              assertFreshTransition(transitionId);

              await hydrateAuthenticatedSession(session, {
                transitionId,
                waitForTriggerMs: event === 'SIGNED_IN' ? 500 : 0,
                repairIfNeeded: true,
                bootstrapInput: {
                  email: session.user.email ?? null,
                  profileCompleted: true,
                },
                shouldThrowOnSuspended: false,
              });
            });
          });
          authStateSubscription = authListener.data.subscription;
        } catch (error) {
          if (!isTransitionStaleError(error)) {
            console.error('Failed to initialize auth state:', error);
          }
        } finally {
          set({ isLoading: false, isInitialized: true });
        }
      },

      signIn: async (email, password) => {
        beginAuthTransition();
        set({ isLoading: true });
        try {
          const normalizedEmail = normalizeEmail(email) ?? email.trim();
          const { data, error } = await supabase.auth.signInWithPassword({
            email: normalizedEmail,
            password,
          });
          if (error) throw error;
          if (!data.session) {
            throw new Error('Missing session after sign in.');
          }

          return await hydrateAuthenticatedSession(data.session, {
            bootstrapInput: { email: normalizedEmail, profileCompleted: true },
            repairIfNeeded: true,
            shouldThrowOnSuspended: true,
          });
        } catch (error) {
          throw new Error(getAuthErrorMessage(error, 'Unable to sign in. Please try again.'));
        } finally {
          set({ isLoading: false });
        }
      },

      signInWithOAuth: async (provider) => {
        beginAuthTransition();
        set({ isLoading: true });
        try {
          const { data, error } = await supabase.auth.signInWithOAuth({
            provider,
            options: {
              redirectTo: OAUTH_REDIRECT_URI,
              skipBrowserRedirect: true,
              scopes: provider === 'google' ? 'email profile' : 'name email',
            },
          });

          if (error) throw error;
          if (!data?.url) throw new Error('OAuth failed to start.');

          const result = await WebBrowser.openAuthSessionAsync(data.url, OAUTH_REDIRECT_URI);

          if (result.type === 'cancel' || result.type === 'dismiss') {
            throw new Error('OAuth cancelled');
          }

          if (result.type !== 'success' || !result.url) {
            throw new Error('OAuth failed. Please try again.');
          }

          const { code, errorDescription, accessToken, refreshToken } = parseOAuthResultUrl(result.url);

          if (errorDescription) {
            throw new Error(decodeURIComponent(errorDescription));
          }

          if (code) {
            const { data: exchangeData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
            if (exchangeError) throw exchangeError;
            if (!exchangeData.session) {
              throw new Error('Missing session after redirect');
            }
          } else if (accessToken && refreshToken) {
            const { data: setSessionData, error: setSessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (setSessionError) throw setSessionError;
            if (!setSessionData.session) {
              throw new Error('Missing session after redirect');
            }
          } else {
            const {
              data: { session },
            } = await supabase.auth.getSession();
            if (!session) {
              throw new Error('Missing session after redirect');
            }
          }

          const {
            data: { session: activeSession },
          } = await supabase.auth.getSession();
          if (!activeSession) {
            throw new Error('Missing session after redirect.');
          }

          await hydrateAuthenticatedSession(activeSession, {
            bootstrapInput: { profileCompleted: true },
            repairIfNeeded: true,
            shouldThrowOnSuspended: true,
          });
        } catch (error) {
          throw new Error(getAuthErrorMessage(error, 'Unable to sign in. Please try again.'));
        } finally {
          set({ isLoading: false });
        }
      },

      signUp: async (email, password, name, accessCode, locationId) => {
        beginAuthTransition();
        set({ isLoading: true });
        try {
          const normalizedEmail = normalizeEmail(email) ?? email.trim().toLowerCase();
          const normalizedName = normalizeName(name);
          const normalizedLocationId = normalizeLocationId(locationId);
          const role = await validateAccessCode(accessCode);
          const bootstrapInput: SessionBootstrapInput = {
            email: normalizedEmail,
            fullName: normalizedName,
            role,
            locationId: normalizedLocationId,
            provider: 'email',
            profileCompleted: true,
          };

          const { data, error } = await supabase.auth.signUp({
            email: normalizedEmail,
            password,
            options: {
              data: {
                name: normalizedName,
                full_name: normalizedName,
                role,
                provider: 'email',
                default_location_id: normalizedLocationId,
              },
            },
          });
          if (error) throw error;
          if (!data.user) throw new Error('Failed to create user');

          if (!data.session) {
            applySignedOutState();
            return {
              status: 'confirmation_required',
              email: normalizedEmail,
            };
          }

          const user = await hydrateAuthenticatedSession(data.session, {
            bootstrapInput,
            waitForTriggerMs: 500,
            repairIfNeeded: true,
            shouldThrowOnSuspended: true,
          });

          if (!user) {
            throw new Error('Unable to load your new account. Please try signing in.');
          }

          return { status: 'authenticated', user };
        } catch (error) {
          throw new Error(getAuthErrorMessage(error, 'Unable to create your account. Please try again.'));
        } finally {
          set({ isLoading: false });
        }
      },

      completeProfile: async (fullName, accessCode) => {
        beginAuthTransition();
        set({ isLoading: true });
        try {
          const { session } = get();
          if (!session?.user) {
            throw new Error('Missing session. Please sign in again.');
          }

          const normalizedName = fullName.trim();
          if (!normalizedName) {
            throw new Error('Please enter your full name.');
          }

          const role = await validateAccessCode(accessCode);
          const provider = getSessionAuthProvider(session.user);

          const user = await hydrateAuthenticatedSession(session, {
            bootstrapInput: {
              email: session.user.email ?? null,
              fullName: normalizedName,
              role,
              provider,
              profileCompleted: true,
            },
            repairIfNeeded: true,
            shouldThrowOnSuspended: true,
          });

          if (!user) {
            throw new Error('Unable to complete your account setup. Please try again.');
          }

          return user;
        } catch (error) {
          throw new Error(getAuthErrorMessage(error, 'Unable to complete your profile. Please try again.'));
        } finally {
          set({ isLoading: false });
        }
      },

      signOut: async () => {
        explicitSignOutInProgress = true;
        const transitionId = beginAuthTransition();
        await Promise.all([
          signOutLocalSupabaseSession('Supabase sign-out failed; clearing local session anyway.'),
          resetSignedOutClientState(transitionId),
        ]);
      },

      deleteSelfAccount: async (confirmText) => {
        const { session } = get();
        if (!session?.user) {
          throw new Error('You must be signed in to delete your account.');
        }

        if (confirmText.trim().toUpperCase() !== 'DELETE') {
          throw new Error('Confirmation text must be DELETE.');
        }

        set({ isLoading: true });
        try {
          const { error } = await withTimeout(
            deleteSelfAccountRequest('DELETE'),
            DELETE_SELF_NETWORK_TIMEOUT_MS,
            'Delete request timed out. Please check your connection and try again.'
          );

          if (error) {
            const normalizedError = error.trim();
            if (normalizedError === 'Unexpected response (404)') {
              throw new Error(
                'Delete account service is unavailable. Please contact support.'
              );
            }
            if (normalizedError === 'Session expired. Please sign in again.') {
              throw new Error('Your session has expired. Please sign out, sign in again, and retry.');
            }

            throw new Error(normalizedError || 'Unable to delete account.');
          }

          try {
            explicitSignOutInProgress = true;
            await withTimeout(
              signOutLocalSupabaseSession(
                'Sign-out after delete-self failed; clearing local session anyway.'
              ),
              DELETE_SELF_CLEANUP_TIMEOUT_MS,
              'Sign-out timed out after account deletion.'
            );
          } catch (signOutError) {
            console.warn('Sign-out after delete-self timed out; clearing local session anyway.', signOutError);
          }

          clearProfileSubscription();
          const cleanupResults = await Promise.allSettled([
            withTimeout(
              clearUserScopedClientState(),
              DELETE_SELF_CLEANUP_TIMEOUT_MS,
              'Timed out clearing user-scoped client state.'
            ),
            withTimeout(
              clearPersistedAuthState(),
              DELETE_SELF_CLEANUP_TIMEOUT_MS,
              'Timed out clearing auth storage.'
            ),
            withTimeout(
              clearSupabaseStoredSession(),
              DELETE_SELF_CLEANUP_TIMEOUT_MS,
              'Timed out clearing Supabase auth storage.'
            ),
          ]);
          if (cleanupResults[0]?.status === 'rejected') {
            console.warn('Failed to clear user-scoped client state after delete-self.', cleanupResults[0].reason);
          }
          if (cleanupResults[1]?.status === 'rejected') {
            console.warn('Failed to clear auth storage after delete-self.', cleanupResults[1].reason);
          }
          if (cleanupResults[2]?.status === 'rejected') {
            console.warn('Failed to clear Supabase auth storage after delete-self.', cleanupResults[2].reason);
          }

          activeSessionUserId = null;
          set({
            session: null,
            user: null,
            profile: null,
            location: null,
            locations: [],
            viewMode: 'employee',
          });
        } finally {
          set({ isLoading: false });
        }
      },

      updateDefaultLocation: async (locationId) => {
        const { user } = get();
        if (!user) return;

        const { error } = await supabase
          .from('users')
          .update({ default_location_id: locationId })
          .eq('id', user.id);

        if (error) throw error;

        const { data: location } = await supabase
          .from('locations')
          .select('*')
          .eq('id', locationId)
          .single();

        set({
          user: { ...user, default_location_id: locationId },
          location,
        });
      },

      updateUserRole: async (role) => {
        const { user, profile } = get();
        if (!user) return;

        const { error } = await supabase
          .from('users')
          .update({ role })
          .eq('id', user.id);

        if (error) throw error;

        set({ user: { ...user, role } });

        if (profile) {
          set({ profile: { ...profile, role } });
        }
      },
    };
    },
    {
      name: 'babytuna-auth',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        location: state.location,
        user: state.user,
        profile: state.profile,
        viewMode: state.viewMode,
      }),
    }
  )
);

// Provide the API client with a synchronous token getter so it never calls
// supabase.auth.getSession() (which deadlocks on React Native).
registerSessionGetter(() => useAuthStore.getState().session);
