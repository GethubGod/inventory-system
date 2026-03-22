import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const memoryStorage = new Map<string, string>();
const SECURE_STORE_CHUNK_PREFIX = '__chunked__:';
const SECURE_STORE_CHUNK_SIZE = 1024;

function getChunkMetadata(value: string): { count: number } | null {
  if (!value.startsWith(SECURE_STORE_CHUNK_PREFIX)) {
    return null;
  }

  const count = Number.parseInt(value.slice(SECURE_STORE_CHUNK_PREFIX.length), 10);
  if (!Number.isFinite(count) || count <= 0) {
    return null;
  }

  return { count };
}

function getChunkKey(key: string, index: number): string {
  return `${key}.chunk.${index}`;
}

function splitSecureStoreValue(value: string): string[] {
  const chunks: string[] = [];

  for (let start = 0; start < value.length; start += SECURE_STORE_CHUNK_SIZE) {
    chunks.push(value.slice(start, start + SECURE_STORE_CHUNK_SIZE));
  }

  return chunks;
}

async function removeSecureStoreChunks(key: string, count: number) {
  await Promise.all(
    Array.from({ length: count }, (_, index) =>
      SecureStore.deleteItemAsync(getChunkKey(key, index)),
    ),
  );
}

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

    const storedValue = await SecureStore.getItemAsync(key);
    if (!storedValue) {
      return storedValue;
    }

    const metadata = getChunkMetadata(storedValue);
    if (!metadata) {
      return storedValue;
    }

    const chunkValues = await Promise.all(
      Array.from({ length: metadata.count }, (_, index) =>
        SecureStore.getItemAsync(getChunkKey(key, index)),
      ),
    );

    if (chunkValues.some((value) => typeof value !== 'string')) {
      await SecureStore.deleteItemAsync(key);
      await removeSecureStoreChunks(key, metadata.count);
      return null;
    }

    return chunkValues.join('');
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

    const existingValue = await SecureStore.getItemAsync(key);
    const existingMetadata = existingValue ? getChunkMetadata(existingValue) : null;
    if (existingMetadata) {
      await removeSecureStoreChunks(key, existingMetadata.count);
    }

    if (value.length <= SECURE_STORE_CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      return;
    }

    const chunks = splitSecureStoreValue(value);
    await Promise.all(
      chunks.map((chunk, index) =>
        SecureStore.setItemAsync(getChunkKey(key, index), chunk),
      ),
    );
    await SecureStore.setItemAsync(key, `${SECURE_STORE_CHUNK_PREFIX}${chunks.length}`);
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

    const storedValue = await SecureStore.getItemAsync(key);
    const metadata = storedValue ? getChunkMetadata(storedValue) : null;

    await SecureStore.deleteItemAsync(key);
    if (metadata) {
      await removeSecureStoreChunks(key, metadata.count);
    }
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
