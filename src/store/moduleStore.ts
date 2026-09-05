// Phase 3 — module access store. Holds the signed-in user's effective module
// set (rpc get_effective_modules) and keeps it live via the user_modules
// realtime subscription, so a manager flipping a toggle adds/removes tabs
// without re-login. Consumers read through useMyModules / useModuleAccessGuard.

import { create } from 'zustand';
import {
  getMyModules,
  subscribeToMyModules,
  type ModuleState,
} from '@/services/userModules';

export type ModuleFetchStatus = 'idle' | 'loading' | 'ready' | 'error';

interface ModuleStoreState {
  /** Auth user the current `fetched` data belongs to. */
  userId: string | null;
  /** Server-effective module states; null until the first successful load. */
  fetched: ModuleState[] | null;
  status: ModuleFetchStatus;
  load: (userId: string) => Promise<void>;
  reset: () => void;
}

let latestLoadId = 0;

export const useModuleStore = create<ModuleStoreState>((set, get) => ({
  userId: null,
  fetched: null,
  status: 'idle',

  load: async (userId: string) => {
    const loadId = ++latestLoadId;
    const sameUser = get().userId === userId;
    set({
      userId,
      fetched: sameUser ? get().fetched : null,
      // Keep showing last-known data during a refresh for the same user.
      status: sameUser && get().fetched ? 'ready' : 'loading',
    });

    try {
      const states = await getMyModules();
      if (get().userId !== userId || loadId !== latestLoadId) return; // user changed mid-flight
      set({ fetched: states, status: 'ready' });
    } catch (error) {
      console.error('[moduleStore] Failed to load module access:', error);
      if (get().userId !== userId || loadId !== latestLoadId) return;
      // Keep last-known data if we have it; with none, consumers fall back to
      // role defaults (see resolveEffectiveModules) so nobody is locked out.
      set({ status: 'error' });
    }
  },

  reset: () => {
    latestLoadId += 1;
    set({ userId: null, fetched: null, status: 'idle' });
  },
}));

// Refcounted realtime subscription shared by every layout/guard that needs
// live module flips. The first acquire loads and subscribes; the last release
// tears the channel down and clears the store.
let subscriberCount = 0;
let unsubscribeRealtime: (() => void) | null = null;
let subscribedUserId: string | null = null;

export function acquireModuleAccess(userId: string): () => void {
  subscriberCount += 1;

  if (subscribedUserId !== userId) {
    unsubscribeRealtime?.();
    subscribedUserId = userId;
    void useModuleStore.getState().load(userId);
    unsubscribeRealtime = subscribeToMyModules(() => {
      void useModuleStore.getState().load(userId);
    });
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    subscriberCount -= 1;
    if (subscriberCount <= 0) {
      subscriberCount = 0;
      unsubscribeRealtime?.();
      unsubscribeRealtime = null;
      subscribedUserId = null;
      useModuleStore.getState().reset();
    }
  };
}
