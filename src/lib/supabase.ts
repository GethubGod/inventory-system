import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const memoryStorage = new Map<string, string>();

function getWebStorage():
  | {
      getItem: (key: string) => string | null;
      setItem: (key: string, value: string) => void;
      removeItem: (key: string) => void;
    }
  | null {
  const candidate = (globalThis as { localStorage?: unknown }).localStorage as
    | {
        getItem?: (key: string) => string | null;
        setItem?: (key: string, value: string) => void;
        removeItem?: (key: string) => void;
      }
    | undefined;

  if (
    candidate &&
    typeof candidate.getItem === 'function' &&
    typeof candidate.setItem === 'function' &&
    typeof candidate.removeItem === 'function'
  ) {
    return {
      getItem: candidate.getItem.bind(candidate),
      setItem: candidate.setItem.bind(candidate),
      removeItem: candidate.removeItem.bind(candidate),
    };
  }

  return null;
}

const ExpoSecureStoreAdapter = {
  getItem: async (key: string) => {
    if (Platform.OS === 'web') {
      const webStorage = getWebStorage();

      if (webStorage) {
        try {
          return webStorage.getItem(key);
        } catch {
          return memoryStorage.get(key) ?? null;
        }
      }

      return memoryStorage.get(key) ?? null;
    }

    return SecureStore.getItemAsync(key);
  },
  setItem: async (key: string, value: string) => {
    if (Platform.OS === 'web') {
      const webStorage = getWebStorage();

      if (webStorage) {
        try {
          webStorage.setItem(key, value);
          return;
        } catch {
          memoryStorage.set(key, value);
          return;
        }
      }

      memoryStorage.set(key, value);
      return;
    }

    await SecureStore.setItemAsync(key, value);
  },
  removeItem: async (key: string) => {
    if (Platform.OS === 'web') {
      const webStorage = getWebStorage();

      if (webStorage) {
        try {
          webStorage.removeItem(key);
          return;
        } catch {
          memoryStorage.delete(key);
          return;
        }
      }

      memoryStorage.delete(key);
      return;
    }

    await SecureStore.deleteItemAsync(key);
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

export const supabase = createClient(resolvedSupabaseUrl, resolvedSupabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
}) as any;
