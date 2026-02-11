import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Database } from '@/types/database';

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => {
    return SecureStore.getItemAsync(key);
  },
  setItem: (key: string, value: string) => {
    SecureStore.setItemAsync(key, value);
  },
  removeItem: (key: string) => {
    SecureStore.deleteItemAsync(key);
  },
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';
const missingConfig = [
  !supabaseUrl ? 'EXPO_PUBLIC_SUPABASE_URL' : null,
  !supabaseAnonKey ? 'EXPO_PUBLIC_SUPABASE_ANON_KEY' : null,
].filter((entry): entry is string => Boolean(entry));

export const supabaseConfigError =
  missingConfig.length > 0
    ? `Missing environment variables: ${missingConfig.join(', ')}`
    : null;

if (__DEV__ && supabaseConfigError) {
  console.warn(
    `${supabaseConfigError}. Supabase features will be unavailable until these values are set.`
  );
}

// Keep app startup resilient if env vars are missing.
const resolvedSupabaseUrl = supabaseUrl || 'https://invalid.supabase.local';
const resolvedSupabaseAnonKey = supabaseAnonKey || 'invalid-anon-key';

export const supabase = createClient<Database>(resolvedSupabaseUrl, resolvedSupabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
