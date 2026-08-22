import { create } from 'zustand';
import type { ReorderItem } from '@/features/simpleOrder/checklistSelection';

/**
 * Cross-screen UI signals for the checklist surface:
 * - The floating pill toolbar's dots button lives outside SimpleOrderScreen,
 *   so it requests the quick-actions sheet through here.
 * - History's Reorder button stages lines here, then the Order tab applies
 *   them on focus.
 * Ephemeral by design — never persisted.
 */

export interface PendingReorder {
  items: ReorderItem[];
  /** e.g. "Tuesday, Aug 18" — used for the confirmation toast. */
  sourceLabel: string;
}

interface SimpleOrderUiState {
  /** Monotonic token; each bump asks the Order screen to open quick actions. */
  quickActionsToken: number;
  requestQuickActions: () => void;

  pendingReorder: PendingReorder | null;
  setPendingReorder: (reorder: PendingReorder) => void;
  /** Reads and clears the staged reorder in one step. */
  consumePendingReorder: () => PendingReorder | null;
}

export const useSimpleOrderUiStore = create<SimpleOrderUiState>((set, get) => ({
  quickActionsToken: 0,
  requestQuickActions: () =>
    set((state) => ({ quickActionsToken: state.quickActionsToken + 1 })),

  pendingReorder: null,
  setPendingReorder: (pendingReorder) => set({ pendingReorder }),
  consumePendingReorder: () => {
    const staged = get().pendingReorder;
    if (staged) set({ pendingReorder: null });
    return staged;
  },
}));
