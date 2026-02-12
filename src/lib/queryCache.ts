/**
 * Simple TTL cache + in-flight deduplication for Supabase queries.
 * Prevents redundant network requests within a short window.
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

const DEFAULT_TTL_MS = 15_000; // 15 seconds

/** Get a cached value if still fresh. */
export function getCached<T>(key: string, ttlMs = DEFAULT_TTL_MS): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttlMs) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

/** Store a value in cache. */
export function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
}

/** Invalidate a specific cache key. */
export function invalidateCache(key: string): void {
  cache.delete(key);
}

/** Invalidate all cache entries matching a prefix. */
export function invalidateCachePrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/**
 * Deduplicated + cached async fetch.
 * If a fetch with the same key is already in-flight, reuses that promise.
 * If cached data exists within TTL, returns it immediately.
 */
export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS
): Promise<T> {
  // Check cache first
  const cached = getCached<T>(key, ttlMs);
  if (cached !== null) return cached;

  // Deduplicate in-flight requests
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = fetcher()
    .then((result) => {
      setCache(key, result);
      return result;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}
