import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session } from '@supabase/supabase-js';
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
  updateDefaultLocation: (locationId: string) => Promise<void>;
  updateUserRole: (role: UserRole) => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
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
        if (!session?.user) return null;

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
        }

        return user;
      },

      initialize: async () => {
        try {
          set({ isLoading: true });

          // Fetch locations
          await get().fetchLocations();

          // Get current session
          const {
            data: { session },
          } = await supabase.auth.getSession();
          set({ session });

          if (session?.user) {
            await get().fetchProfile();
            await get().fetchUser();
          } else {
            set({ profile: null });
          }

          // Listen for auth changes
          supabase.auth.onAuthStateChange(async (event, session) => {
            set({ session });

            if (event === 'SIGNED_IN' && session?.user) {
              // Small delay to ensure the trigger has created the user profile
              await new Promise((resolve) => setTimeout(resolve, 500));
              await get().fetchProfile();
              await get().fetchUser();
            } else if (event === 'SIGNED_OUT') {
              set({ user: null, profile: null, location: null });
            }
          });
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
          await get().fetchProfile();
          const user = await get().fetchUser();
          return user;
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
            throw new Error(errorDescription);
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

          await get().fetchProfile();
          await get().fetchUser();
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

          const { error: profileUpsertError } = await supabase
            .from('profiles')
            .upsert({
              id: data.user.id,
              full_name: normalizedName,
              role,
              profile_completed: true,
              provider: 'email',
            });

          if (profileUpsertError) throw profileUpsertError;

          set({ session: data.session });
          await get().fetchProfile();

          const fetchedUser = await get().fetchUser();
          const user: User =
            fetchedUser ??
            ({
              id: data.user.id,
              email: data.user.email ?? email.trim(),
              name: normalizedName,
              role,
              default_location_id: locationId || null,
              created_at: new Date().toISOString(),
            } as User);

          if (!fetchedUser) {
            set({ user });
          }

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

          const { error: profileUpsertError } = await supabase
            .from('profiles')
            .upsert({
              id: session.user.id,
              full_name: normalizedName,
              role,
              profile_completed: true,
              provider,
            });

          if (profileUpsertError) throw profileUpsertError;

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

            if (updateUserError) {
              console.error('Failed to update user row:', updateUserError);
            }
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

            if (insertUserError) {
              console.error('Failed to insert user row:', insertUserError);
            }
          }

          await get().fetchProfile();
          const fetchedUser = await get().fetchUser();
          const user: User =
            fetchedUser ??
            ({
              id: session.user.id,
              email: session.user.email ?? '',
              name: normalizedName,
              role,
              default_location_id: null,
              created_at: new Date().toISOString(),
            } as User);

          if (!fetchedUser) {
            set({ user });
          }

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
          set({ session: null, user: null, profile: null, location: null, viewMode: 'employee' });
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
    }),
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
