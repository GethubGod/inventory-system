import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session } from '@supabase/supabase-js';
import { User, Location } from '@/types';
import { supabase } from '@/lib/supabase';

interface AuthState {
  session: Session | null;
  user: User | null;
  location: Location | null;
  isLoading: boolean;
  isInitialized: boolean;

  // Actions
  setSession: (session: Session | null) => void;
  setUser: (user: User | null) => void;
  setLocation: (location: Location | null) => void;
  setIsLoading: (isLoading: boolean) => void;
  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateDefaultLocation: (locationId: string) => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      session: null,
      user: null,
      location: null,
      isLoading: true,
      isInitialized: false,

      setSession: (session) => set({ session }),
      setUser: (user) => set({ user }),
      setLocation: (location) => set({ location }),
      setIsLoading: (isLoading) => set({ isLoading }),

      initialize: async () => {
        try {
          set({ isLoading: true });

          // Get current session
          const { data: { session } } = await supabase.auth.getSession();
          set({ session });

          if (session?.user) {
            // Fetch user profile
            const { data: user } = await supabase
              .from('users')
              .select('*')
              .eq('id', session.user.id)
              .single();

            set({ user });

            // Fetch default location if set
            if (user?.default_location_id) {
              const { data: location } = await supabase
                .from('locations')
                .select('*')
                .eq('id', user.default_location_id)
                .single();

              set({ location });
            }
          }

          // Listen for auth changes
          supabase.auth.onAuthStateChange(async (event, session) => {
            set({ session });

            if (session?.user) {
              const { data: user } = await supabase
                .from('users')
                .select('*')
                .eq('id', session.user.id)
                .single();

              set({ user });

              if (user?.default_location_id) {
                const { data: location } = await supabase
                  .from('locations')
                  .select('*')
                  .eq('id', user.default_location_id)
                  .single();

                set({ location });
              }
            } else {
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
          const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          if (error) throw error;
        } finally {
          set({ isLoading: false });
        }
      },

      signUp: async (email, password, name) => {
        set({ isLoading: true });
        try {
          const { error } = await supabase.auth.signUp({
            email,
            password,
            options: {
              data: { name },
            },
          });
          if (error) throw error;
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
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        // Only persist location preference
        location: state.location,
      }),
    }
  )
);
