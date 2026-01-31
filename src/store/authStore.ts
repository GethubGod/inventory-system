import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session } from '@supabase/supabase-js';
import { User, Location, UserRole } from '@/types';
import { supabase } from '@/lib/supabase';

interface AuthState {
  session: Session | null;
  user: User | null;
  location: Location | null;
  locations: Location[];
  isLoading: boolean;
  isInitialized: boolean;

  // Actions
  setSession: (session: Session | null) => void;
  setUser: (user: User | null) => void;
  setLocation: (location: Location | null) => void;
  setIsLoading: (isLoading: boolean) => void;
  initialize: () => Promise<void>;
  fetchUser: () => Promise<User | null>;
  fetchLocations: () => Promise<Location[]>;
  signIn: (email: string, password: string) => Promise<User>;
  signUp: (
    email: string,
    password: string,
    name: string,
    role: UserRole,
    locationId?: string
  ) => Promise<User>;
  signOut: () => Promise<void>;
  updateDefaultLocation: (locationId: string) => Promise<void>;
  updateUserRole: (role: UserRole) => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      session: null,
      user: null,
      location: null,
      locations: [],
      isLoading: true,
      isInitialized: false,

      setSession: (session) => set({ session }),
      setUser: (user) => set({ user }),
      setLocation: (location) => set({ location }),
      setIsLoading: (isLoading) => set({ isLoading }),

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
            await get().fetchUser();
          }

          // Listen for auth changes
          supabase.auth.onAuthStateChange(async (event, session) => {
            set({ session });

            if (event === 'SIGNED_IN' && session?.user) {
              // Small delay to ensure the trigger has created the user profile
              await new Promise((resolve) => setTimeout(resolve, 500));
              await get().fetchUser();
            } else if (event === 'SIGNED_OUT') {
              set({ user: null, location: null });
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

          // Fetch user profile
          const { data: user } = await supabase
            .from('users')
            .select('*')
            .eq('id', data.user.id)
            .single();

          if (!user) throw new Error('User profile not found');

          set({ user, session: data.session });

          // Fetch location if set
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

          return user;
        } finally {
          set({ isLoading: false });
        }
      },

      signUp: async (email, password, name, role, locationId) => {
        set({ isLoading: true });
        try {
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

          // Update the user profile with role and location
          const { error: updateError } = await supabase
            .from('users')
            .update({
              role,
              default_location_id: locationId || null,
            })
            .eq('id', data.user.id);

          if (updateError) {
            console.error('Failed to update user profile:', updateError);
          }

          // Fetch the updated user
          const { data: user } = await supabase
            .from('users')
            .select('*')
            .eq('id', data.user.id)
            .single();

          if (!user) throw new Error('User profile not found');

          set({ user, session: data.session });

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

      signOut: async () => {
        set({ isLoading: true });
        try {
          const { error } = await supabase.auth.signOut();
          if (error) throw error;
          set({ session: null, user: null, location: null });
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
        const { user } = get();
        if (!user) return;

        const { error } = await supabase
          .from('users')
          .update({ role })
          .eq('id', user.id);

        if (error) throw error;

        set({ user: { ...user, role } });
      },
    }),
    {
      name: 'babytuna-auth',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        location: state.location,
        user: state.user,
      }),
    }
  )
);
