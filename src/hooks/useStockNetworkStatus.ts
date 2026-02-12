import { useEffect } from 'react';
import { useStockStore } from '@/store';

export function useStockNetworkStatus() {
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    try {
      // Lazy require so the app can still boot if the dependency isn't installed yet.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const NetInfo = require('@react-native-community/netinfo');
      unsubscribe = NetInfo.addEventListener((state: any) => {
        const isOnline = Boolean(state.isConnected && state.isInternetReachable !== false);
        useStockStore.getState().setOnlineStatus(isOnline);
      });
    } catch {
      useStockStore.getState().setOnlineStatus(true);
    }

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);
}
