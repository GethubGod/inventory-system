import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_REFRESH_TIMEOUT_MS = 8000;
const DEFAULT_REFRESH_MIN_VISIBLE_MS = 350;

class RefreshTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Refresh timed out after ${timeoutMs}ms`);
    this.name = 'RefreshTimeoutError';
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface UseManagedRefreshOptions {
  minVisibleMs?: number;
  onError?: (error: unknown) => void;
  onTimeout?: () => void;
  timeoutMs?: number;
}

export function useManagedRefresh(
  refreshAction: () => Promise<unknown>,
  {
    minVisibleMs = DEFAULT_REFRESH_MIN_VISIBLE_MS,
    onError,
    onTimeout,
    timeoutMs = DEFAULT_REFRESH_TIMEOUT_MS,
  }: UseManagedRefreshOptions = {},
) {
  const [refreshing, setRefreshing] = useState(false);
  const refreshActionRef = useRef(refreshAction);
  const onErrorRef = useRef(onError);
  const onTimeoutRef = useRef(onTimeout);
  const isMountedRef = useRef(true);
  const isRefreshingRef = useRef(false);

  useEffect(() => {
    refreshActionRef.current = refreshAction;
  }, [refreshAction]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const onRefresh = useCallback(async () => {
    if (isRefreshingRef.current) {
      return;
    }

    isRefreshingRef.current = true;
    if (isMountedRef.current) {
      setRefreshing(true);
    }

    const startedAt = Date.now();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      await Promise.race([
        Promise.resolve().then(() => refreshActionRef.current()),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new RefreshTimeoutError(timeoutMs));
          }, timeoutMs);
        }),
      ]);
    } catch (error) {
      if (error instanceof RefreshTimeoutError) {
        onTimeoutRef.current?.();
      } else {
        onErrorRef.current?.(error);
      }
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs < minVisibleMs) {
        await delay(minVisibleMs - elapsedMs);
      }

      isRefreshingRef.current = false;
      if (isMountedRef.current) {
        setRefreshing(false);
      }
    }
  }, [minVisibleMs, timeoutMs]);

  return {
    onRefresh,
    refreshing,
  };
}
