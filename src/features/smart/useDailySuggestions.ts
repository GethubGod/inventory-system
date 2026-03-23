import { useCallback, useEffect, useState } from 'react';
import {
  createEmptySuggestions,
  fetchSmartOrderData,
  type RecentOrder,
  type SmartOrderData,
  type SuggestionsData,
} from '@/features/ordering/dailySuggestions';

export function useDailySuggestions(locationId: string | null) {
  const [suggestions, setSuggestions] = useState<SuggestionsData>(createEmptySuggestions);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (locationId) {
      return;
    }

    setSuggestions(createEmptySuggestions());
    setRecentOrders([]);
    setError(null);
    setLoading(false);
  }, [locationId]);

  const reload = useCallback(async (): Promise<SmartOrderData> => {
    if (!locationId) {
      setSuggestions(createEmptySuggestions());
      setRecentOrders([]);
      setError(null);
      setLoading(false);
      return {
        suggestions: createEmptySuggestions(),
        recentOrders: [],
      };
    }

    setLoading(true);
    setError(null);

    try {
      const nextData = await fetchSmartOrderData(locationId);
      setSuggestions(nextData.suggestions);
      setRecentOrders(nextData.recentOrders);
      return nextData;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load daily suggestions.';
      setSuggestions(createEmptySuggestions());
      setRecentOrders([]);
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  return {
    suggestions,
    recentOrders,
    loading,
    error,
    reload,
  };
}
