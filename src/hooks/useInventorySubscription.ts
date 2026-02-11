import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useAuthStore, useInventoryStore } from '@/store';

export function useInventorySubscription() {
  const { user } = useAuthStore();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    if (!user?.id) return;

    const scheduleRefresh = () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }

      refreshTimeoutRef.current = setTimeout(() => {
        useInventoryStore
          .getState()
          .fetchItems({ force: true })
          .catch(() => {
            // Keep subscription alive even if one refresh fails.
          });
      }, 250);
    };

    // Subscribe to realtime changes on inventory_items
    const channel = supabase
      .channel(`inventory-changes-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'inventory_items',
        },
        scheduleRefresh
      )
      .subscribe();

    channelRef.current = channel;

    // Refresh inventory when app comes back to foreground
    const appStateSubscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (
          appStateRef.current.match(/inactive|background/) &&
          nextState === 'active'
        ) {
          useInventoryStore
            .getState()
            .fetchItems({ force: true })
            .catch(() => {});
        }
        appStateRef.current = nextState;
      }
    );

    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }

      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }

      appStateSubscription.remove();
    };
  }, [user?.id]);

  const refreshItems = async () => {
    await useInventoryStore.getState().fetchItems({ force: true });
  };

  return { refreshItems };
}
