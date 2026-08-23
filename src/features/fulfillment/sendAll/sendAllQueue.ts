// Pure queue-advancement logic for the Rapid Send All card queue (Phase 1).
// No React/React Native imports — unit-tested in src/__tests__/sendAllQueue.test.ts.

export type SendAllCardStatus = 'pending' | 'sent' | 'skipped';

export interface SendAllQueueState {
  /** Supplier ids in queue order. */
  order: string[];
  statuses: Record<string, SendAllCardStatus>;
  /** Supplier id of the card currently in front, or null when the queue is finished. */
  activeId: string | null;
  /**
   * Supplier id of a card whose send launched via a deep link and is waiting for
   * the app to become active again before auto-advancing. Null otherwise.
   */
  awaitingReturnId: string | null;
}

export type SendAllQueueEvent =
  | { type: 'send-launched'; id: string; awaitReturn: boolean }
  | { type: 'send-completed'; id: string }
  | { type: 'send-cancelled'; id: string }
  | { type: 'skip'; id: string };

export function createSendAllQueue(supplierIds: string[]): SendAllQueueState {
  const order = supplierIds.filter(
    (id, index) => typeof id === 'string' && id.length > 0 && supplierIds.indexOf(id) === index
  );
  const statuses: Record<string, SendAllCardStatus> = {};
  order.forEach((id) => {
    statuses[id] = 'pending';
  });
  return {
    order,
    statuses,
    activeId: order.length > 0 ? order[0] : null,
    awaitingReturnId: null,
  };
}

/**
 * Next pending card after `fromId` in queue order, wrapping around to earlier
 * pending cards (e.g. a previously cancelled send). Null when nothing is pending.
 */
export function findNextPendingId(state: SendAllQueueState, fromId: string | null): string | null {
  const { order, statuses } = state;
  if (order.length === 0) return null;

  const fromIndex = fromId ? order.indexOf(fromId) : -1;
  for (let offset = 1; offset <= order.length; offset += 1) {
    const candidate = order[(fromIndex + offset + order.length) % order.length];
    if (candidate === fromId) continue;
    if (statuses[candidate] === 'pending') return candidate;
  }
  return null;
}

export function sendAllQueueReducer(
  state: SendAllQueueState,
  event: SendAllQueueEvent
): SendAllQueueState {
  switch (event.type) {
    case 'send-launched': {
      if (!(event.id in state.statuses)) return state;
      return {
        ...state,
        awaitingReturnId: event.awaitReturn ? event.id : null,
      };
    }
    case 'send-completed': {
      if (state.statuses[event.id] !== 'pending') {
        return state.awaitingReturnId === event.id
          ? { ...state, awaitingReturnId: null }
          : state;
      }
      const statuses: Record<string, SendAllCardStatus> = {
        ...state.statuses,
        [event.id]: 'sent',
      };
      const next: SendAllQueueState = {
        ...state,
        statuses,
        awaitingReturnId: null,
      };
      next.activeId = findNextPendingId(next, state.activeId ?? event.id);
      return next;
    }
    case 'send-cancelled': {
      if (state.awaitingReturnId !== event.id && !(event.id in state.statuses)) return state;
      return { ...state, awaitingReturnId: null };
    }
    case 'skip': {
      if (state.statuses[event.id] !== 'pending') return state;
      const statuses: Record<string, SendAllCardStatus> = {
        ...state.statuses,
        [event.id]: 'skipped',
      };
      const next: SendAllQueueState = {
        ...state,
        statuses,
        awaitingReturnId: state.awaitingReturnId === event.id ? null : state.awaitingReturnId,
      };
      next.activeId = findNextPendingId(next, state.activeId ?? event.id);
      return next;
    }
    default:
      return state;
  }
}

export interface SendAllQueueProgress {
  total: number;
  sent: number;
  skipped: number;
  pending: number;
  /** 1-based position of the active card among the queue, for "2 of 5" copy. */
  position: number;
  isComplete: boolean;
}

export function getSendAllQueueProgress(state: SendAllQueueState): SendAllQueueProgress {
  const total = state.order.length;
  let sent = 0;
  let skipped = 0;
  state.order.forEach((id) => {
    if (state.statuses[id] === 'sent') sent += 1;
    if (state.statuses[id] === 'skipped') skipped += 1;
  });
  const pending = total - sent - skipped;
  const activeIndex = state.activeId ? state.order.indexOf(state.activeId) : -1;
  return {
    total,
    sent,
    skipped,
    pending,
    position: activeIndex >= 0 ? activeIndex + 1 : total,
    isComplete: pending === 0 || state.activeId === null,
  };
}
