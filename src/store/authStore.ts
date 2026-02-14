import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RealtimeChannel, Session } from '@supabase/supabase-js';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { User, Location, UserRole, Profile, AuthProvider } from '@/types';
import { supabase } from '@/lib/supabase';
import { validateAccessCode } from '@/services/accessCodes';

type ViewMode = 'employee' | 'manager';
type OAuthProvider = 'google' | 'apple';

WebBrowser.maybeCompleteAuthSession();

const OAUTH_REDIRECT_URI = AuthSession.makeRedirectUri({
  scheme: 'babytuna',
  path: 'auth/callback',
});

let profileRealtimeChannel: RealtimeChannel | null = null;
let authStateSubscription: { unsubscribe: () => void } | null = null;
let warnedMissingLastActiveColumn = false;
let warnedMissingEmailColumn = false;
const warnedMissingProfileColumns = new Set<string>();
const SUSPENDED_ACCOUNT_MESSAGE = 'Account suspended. Contact a manager.';
let activeSessionUserId: string | null = null;
let userScopedResetPromise: Promise<void> | null = null;

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
  ) => Promise<User>;
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
      import('./stock.store'),
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

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => {
      const clearSessionState = () => {
        set({
          session: null,
          user: null,
          profile: null,
          location: null,
          viewMode: 'employee',
        });
      };

      const forceSignOutSuspended = async (message = SUSPENDED_ACCOUNT_MESSAGE) => {
        try {
          const { error } = await supabase.auth.signOut();
          if (error) {
            console.warn('Failed to sign out suspended session cleanly', error);
          }
        } finally {
          clearProfileSubscription();
          clearSessionState();
          activeSessionUserId = null;
          await clearUserScopedClientState();
        }

        throw new Error(message);
      };

      const refreshProfileAndHandleSuspension = async (params?: {
        userId?: string;
        shouldThrowOnSuspended?: boolean;
      }) => {
        const profile = await get().fetchProfile();
        const userId = params?.userId;

        if (profile?.is_suspended) {
          if (params?.shouldThrowOnSuspended === false) {
            await supabase.auth.signOut();
            clearProfileSubscription();
            clearSessionState();
            activeSessionUserId = null;
            await clearUserScopedClientState();
            return { profile, suspended: true };
          }

          await forceSignOutSuspended();
        }

        if (userId) {
          await syncProfileEmail(userId, get().session?.user?.email ?? null);
          await touchLastActive(userId);
        }

        return { profile, suspended: false };
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

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .maybeSingle();

        if (error) {
          console.error('Failed to fetch profile:', error);
          set({ profile: null });
          return null;
        }

        set({ profile: profile ?? null });
        return profile ?? null;
      },

      fetchUser: async () => {
        const { session } = get();
        if (!session?.user) {
          set({ user: null, location: null });
          return null;
        }

        const { data: user } = await supabase
          .from('users')
          .select('*')
          .eq('id', session.user.id)
          .single();

        if (user) {
          set({ user });

          // Fetch default location if set
          if (user.default_location_id) {
            const { data: location } = await supabase
              .from('locations')
              .select('*')
              .eq('id', user.default_location_id)
              .single();

            if (location) {
              set({ location });
            }
          }
        } else {
          set({ user: null, location: null });
        }

        return user;
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
          activeSessionUserId = sessionUserId;

          if (session?.user) {
            const { suspended } = await refreshProfileAndHandleSuspension({
              userId: session.user.id,
              shouldThrowOnSuspended: false,
            });

            if (!suspended) {
              await get().fetchUser();
              subscribeToProfileChanges(session.user.id, async () => {
                await refreshProfileAndHandleSuspension({ shouldThrowOnSuspended: false });
              });
            }
          } else {
            clearProfileSubscription();
            clearSessionState();
            activeSessionUserId = null;
            await clearUserScopedClientState();
          }

          // Listen for auth changes (ensure exactly one active listener).
          clearAuthStateSubscription();
          const authListener = supabase.auth.onAuthStateChange(async (event: any, session: Session | null) => {
            try {
              const nextUserId = session?.user?.id ?? null;
              const persistedStoreUserId = get().user?.id ?? null;
              const trackedUserId = activeSessionUserId;
              set({ session });

              if (
                (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') &&
                session?.user
              ) {
                if (
                  (trackedUserId && trackedUserId !== nextUserId) ||
                  (persistedStoreUserId && persistedStoreUserId !== nextUserId)
                ) {
                  await clearUserScopedClientState();
                }
                activeSessionUserId = nextUserId;

                if (event === 'SIGNED_IN') {
                  // Small delay to ensure the trigger has created the user profile.
                  await new Promise((resolve) => setTimeout(resolve, 500));
                }

                const { suspended } = await refreshProfileAndHandleSuspension({
                  userId: session.user.id,
                  shouldThrowOnSuspended: false,
                });

                if (suspended) return;

                await get().fetchUser();
                subscribeToProfileChanges(session.user.id, async () => {
                  await refreshProfileAndHandleSuspension({ shouldThrowOnSuspended: false });
                });
              } else if (event === 'SIGNED_OUT') {
                clearProfileSubscription();
                clearSessionState();
                activeSessionUserId = null;
                await clearUserScopedClientState();
              } else if (!session) {
                clearProfileSubscription();
                clearSessionState();
                activeSessionUserId = null;
                await clearUserScopedClientState();
              }
            } catch (error) {
              console.error('Failed to handle auth state change:', error);
            }
          });
          authStateSubscription = authListener.data.subscription;
        } finally {
          set({ isLoading: false, isInitialized: true });
        }
      },

      signIn: async (email, password) => {
        set({ isLoading: true });
        try {
          const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          if (error) throw error;

          set({ session: data.session });

          const sessionUserId = data.session?.user?.id ?? null;
          if (sessionUserId) {
            const previousUserId = activeSessionUserId ?? get().user?.id ?? null;
            if (previousUserId && previousUserId !== sessionUserId) {
              await clearUserScopedClientState();
            }
            activeSessionUserId = sessionUserId;

            await refreshProfileAndHandleSuspension({
              userId: sessionUserId,
            });
            subscribeToProfileChanges(sessionUserId, async () => {
              await refreshProfileAndHandleSuspension({ shouldThrowOnSuspended: false });
            });
          }

          return await get().fetchUser();
        } finally {
          set({ isLoading: false });
        }
      },

      signInWithOAuth: async (provider) => {
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
          set({ session: activeSession });

          if (activeSession?.user?.id) {
            const previousUserId = activeSessionUserId ?? get().user?.id ?? null;
            if (previousUserId && previousUserId !== activeSession.user.id) {
              await clearUserScopedClientState();
            }
            activeSessionUserId = activeSession.user.id;

            await refreshProfileAndHandleSuspension({
              userId: activeSession.user.id,
            });
            await get().fetchUser();
            subscribeToProfileChanges(activeSession.user.id, async () => {
              await refreshProfileAndHandleSuspension({ shouldThrowOnSuspended: false });
            });
          }
        } finally {
          set({ isLoading: false });
        }
      },

      signUp: async (email, password, name, accessCode, locationId) => {
        set({ isLoading: true });
        try {
          const role = await validateAccessCode(accessCode);

          // Create auth user
          const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
              data: { name, role, default_location_id: locationId },
            },
          });
          if (error) throw error;
          if (!data.user) throw new Error('Failed to create user');

          // Wait for trigger to create profile
          await new Promise((resolve) => setTimeout(resolve, 1000));

          const normalizedName = name.trim();

          // Update the user profile with role and location
          const { error: updateError } = await supabase
            .from('users')
            .update({
              name: normalizedName,
              role,
              default_location_id: locationId || null,
            })
            .eq('id', data.user.id);

          if (updateError) {
            console.error('Failed to update user profile:', updateError);
          }

          await upsertProfileResilient({
            id: data.user.id,
            email: email.trim(),
            full_name: normalizedName,
            role,
            is_suspended: false,
            suspended_at: null,
            suspended_by: null,
            last_active_at: new Date().toISOString(),
            profile_completed: true,
            provider: 'email',
          });

          set({ session: data.session });
          const previousUserId = activeSessionUserId ?? get().user?.id ?? null;
          if (previousUserId && previousUserId !== data.user.id) {
            await clearUserScopedClientState();
          }
          activeSessionUserId = data.user.id;

          await get().fetchProfile();
          subscribeToProfileChanges(data.user.id, async () => {
            await refreshProfileAndHandleSuspension({ shouldThrowOnSuspended: false });
          });

          const user = await get().fetchUser();
          if (!user) throw new Error('User profile not found');

          // Fetch location if set
          if (locationId) {
            const { data: location } = await supabase
              .from('locations')
              .select('*')
              .eq('id', locationId)
              .single();

            if (location) {
              set({ location });
            }
          }

          return user;
        } finally {
          set({ isLoading: false });
        }
      },

      completeProfile: async (fullName, accessCode) => {
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
          const provider = (session.user.app_metadata?.provider as AuthProvider | undefined) ?? 'email';

          await upsertProfileResilient({
            id: session.user.id,
            email: session.user.email ?? null,
            full_name: normalizedName,
            role,
            is_suspended: false,
            suspended_at: null,
            suspended_by: null,
            last_active_at: new Date().toISOString(),
            profile_completed: true,
            provider,
          });

          const {
            data: existingUser,
            error: existingUserError,
          } = await supabase
            .from('users')
            .select('id')
            .eq('id', session.user.id)
            .maybeSingle();

          if (existingUserError) {
            console.error('Failed to check user row:', existingUserError);
          }

          if (existingUser) {
            const { error: updateUserError } = await supabase
              .from('users')
              .update({
                name: normalizedName,
                role,
              })
              .eq('id', session.user.id);

            if (updateUserError) throw updateUserError;
          } else {
            const { error: insertUserError } = await supabase
              .from('users')
              .insert({
                id: session.user.id,
                email: session.user.email ?? '',
                name: normalizedName,
                role,
                default_location_id: null,
              } as any);

            if (insertUserError) throw insertUserError;
          }

          await get().fetchProfile();
          await touchLastActive(session.user.id);
          activeSessionUserId = session.user.id;
          subscribeToProfileChanges(session.user.id, async () => {
            await refreshProfileAndHandleSuspension({ shouldThrowOnSuspended: false });
          });
          const user = await get().fetchUser();
          if (!user) throw new Error('User profile not found');

          return user;
        } finally {
          set({ isLoading: false });
        }
      },

      signOut: async () => {
        set({ isLoading: true });
        try {
          const { error } = await supabase.auth.signOut();
          if (error) throw error;
          clearProfileSubscription();
          clearSessionState();
          activeSessionUserId = null;
          await clearUserScopedClientState();
        } finally {
          set({ isLoading: false });
        }
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
          // Refresh session to ensure valid tokens before the destructive call.
          const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
          if (refreshError || !refreshed?.session) {
            throw new Error('Unable to verify your session. Please sign out, sign in again, and retry.');
          }

          // Let the Supabase client attach the freshly-refreshed token automatically.
          let { error } = await supabase.functions.invoke('delete-self', {
            body: { confirm: 'DELETE' },
          });

          // Single retry on 401 — refresh once more in case of a race.
          const initialStatus = (error as any)?.context?.status as number | undefined;
          if (error && initialStatus === 401) {
            const { data: retryRefreshed, error: retryRefreshError } = await supabase.auth.refreshSession();
            if (retryRefreshError || !retryRefreshed?.session) {
              throw new Error('Your session has expired. Please sign out, sign in again, and retry.');
            }
            ({ error } = await supabase.functions.invoke('delete-self', {
              body: { confirm: 'DELETE' },
            }));
          }

          if (error) {
            const status = (error as any)?.context?.status as number | undefined;
            if (status === 404) {
              throw new Error(
                'Delete account service is unavailable. Please contact support.'
              );
            }
            if (status === 401) {
              throw new Error('Your session has expired. Please sign out, sign in again, and retry.');
            }

            let serverMessage: string | null = null;
            const response = (error as any)?.context;
            if (response && typeof response.clone === 'function') {
              if (typeof response.json === 'function') {
                try {
                  const payload = await response.clone().json();
                  if (payload && typeof payload.error === 'string') {
                    serverMessage =
                      typeof payload.details === 'string'
                        ? `${payload.error}: ${payload.details}`
                        : payload.error;
                  }
                } catch {
                  // Ignore JSON parsing failures and try plain text fallback next.
                }
              }

              if (!serverMessage && typeof response.text === 'function') {
                try {
                  const text = (await response.clone().text())?.trim();
                  if (text) {
                    serverMessage = text.length > 240 ? `${text.slice(0, 240)}...` : text;
                  }
                } catch {
                  // Ignore parsing failures and fall back to generic error text.
                }
              }
            }

            throw new Error(serverMessage || error.message || 'Unable to delete account.');
          }

          const signOutResult = await supabase.auth.signOut();
          if (signOutResult.error) {
            console.warn('Sign-out after delete-self failed; clearing local session anyway.', signOutResult.error);
          }

          clearProfileSubscription();
          await clearUserScopedClientState();
          await AsyncStorage.removeItem('babytuna-auth');
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
