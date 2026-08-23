import {
  deriveReceiptStatus,
  type ReceiptDetail,
  type ReceiptLineInput,
  type ReceiptStatus,
} from '@/services/orderReceiving';

/**
 * Pure line-state logic for the delivery receiving screen (Phase 7a). Every
 * line starts checked ("arrived in full"); tapping unchecks it ("didn't
 * arrive") and reveals a stepper for a short quantity plus an optional note.
 * Kept free of React/React Native imports so plain Jest can cover it
 * (src/__tests__/receiveDeliveryLineState.test.ts).
 */

export interface ReceiveLine {
  pastOrderItemId: string;
  itemName: string;
  unit: string;
  orderedQty: number;
  /** true = arrived in full. Unchecked lines use shortQty for partial arrivals. */
  checked: boolean;
  /** Arrived quantity while unchecked; null/0 means nothing arrived. */
  shortQty: number | null;
  note: string;
}

export interface ReceiveState {
  receiptId: string | null;
  lines: ReceiveLine[];
}

export type ReceiveAction =
  | { type: 'init'; receipt: ReceiptDetail }
  | { type: 'toggle'; pastOrderItemId: string }
  | { type: 'adjustShortQty'; pastOrderItemId: string; delta: number }
  | { type: 'setNote'; pastOrderItemId: string; note: string };

export const EMPTY_RECEIVE_STATE: ReceiveState = {
  receiptId: null,
  lines: [],
};

/** Avoid float noise like 2.5000000000000004 from repeated stepping. */
function roundQty(value: number): number {
  return Math.round(value * 100) / 100;
}

export function clampShortQty(value: number, orderedQty: number): number {
  if (!Number.isFinite(value)) return 0;
  const max = Number.isFinite(orderedQty) && orderedQty > 0 ? orderedQty : 0;
  return roundQty(Math.min(max, Math.max(0, value)));
}

/**
 * Rebuilds UI state from a receipt's saved lines so resuming an in-progress
 * receipt restores earlier flags: a saved partial line (received with a short
 * quantity) reopens as unchecked + stepper, a saved missing line as unchecked.
 */
export function initReceiveState(receipt: ReceiptDetail): ReceiveState {
  return {
    receiptId: receipt.id,
    lines: receipt.lines.map((line) => {
      const orderedQty = Number.isFinite(line.orderedQty) ? line.orderedQty : 0;
      const savedQty =
        typeof line.receivedQty === 'number' && Number.isFinite(line.receivedQty)
          ? line.receivedQty
          : null;
      const fullyReceived =
        line.received && (savedQty === null || savedQty >= orderedQty);

      return {
        pastOrderItemId: line.pastOrderItemId,
        itemName: line.itemName,
        unit: line.unit,
        orderedQty,
        checked: fullyReceived,
        shortQty: fullyReceived ? null : clampShortQty(savedQty ?? 0, orderedQty) || null,
        note: fullyReceived ? '' : line.note ?? '',
      } satisfies ReceiveLine;
    }),
  };
}

function updateLine(
  state: ReceiveState,
  pastOrderItemId: string,
  update: (line: ReceiveLine) => ReceiveLine,
): ReceiveState {
  let changed = false;
  const lines = state.lines.map((line) => {
    if (line.pastOrderItemId !== pastOrderItemId) return line;
    changed = true;
    return update(line);
  });
  return changed ? { ...state, lines } : state;
}

export function receiveReducer(state: ReceiveState, action: ReceiveAction): ReceiveState {
  switch (action.type) {
    case 'init':
      return initReceiveState(action.receipt);

    case 'toggle':
      return updateLine(state, action.pastOrderItemId, (line) =>
        line.checked
          ? { ...line, checked: false, shortQty: null }
          : // Re-checking means "it did arrive after all" — the flag details
            // (short quantity + note) are no longer meaningful, so clear them.
            { ...line, checked: true, shortQty: null, note: '' },
      );

    case 'adjustShortQty':
      return updateLine(state, action.pastOrderItemId, (line) => {
        if (line.checked) return line;
        return {
          ...line,
          shortQty: clampShortQty((line.shortQty ?? 0) + action.delta, line.orderedQty),
        };
      });

    case 'setNote':
      return updateLine(state, action.pastOrderItemId, (line) =>
        line.checked ? line : { ...line, note: action.note },
      );

    default:
      return state;
  }
}

/**
 * True when the line will be saved as a discrepancy: unchecked with nothing
 * or only part of the order arrived. Stepping the short quantity all the way
 * back up to the ordered quantity means it actually arrived in full.
 */
export function isLineFlagged(line: ReceiveLine): boolean {
  if (line.checked) return false;
  return line.shortQty === null || line.shortQty < line.orderedQty;
}

export function countFlaggedLines(state: ReceiveState): number {
  return state.lines.filter(isLineFlagged).length;
}

/**
 * Maps UI state onto the backend's save shape. Matches the service's
 * discrepancy semantics: a short arrival is saved as received with a short
 * quantity, a missing line as not received, and a stepper walked back up to
 * the full ordered quantity as a plain full arrival.
 */
export function buildSaveLines(state: ReceiveState): ReceiptLineInput[] {
  return state.lines.map((line) => {
    if (!isLineFlagged(line)) {
      return {
        pastOrderItemId: line.pastOrderItemId,
        received: true,
        receivedQty: null,
        note: null,
      };
    }

    const arrivedQty = line.shortQty ?? 0;
    const note = line.note.trim().length > 0 ? line.note.trim() : null;

    if (arrivedQty > 0) {
      return {
        pastOrderItemId: line.pastOrderItemId,
        received: true,
        receivedQty: arrivedQty,
        note,
      };
    }

    return {
      pastOrderItemId: line.pastOrderItemId,
      received: false,
      receivedQty: null,
      note,
    };
  });
}

/** Status the receipt will land in when saved right now. */
export function deriveSaveStatus(
  state: ReceiveState,
): Extract<ReceiptStatus, 'complete' | 'partial'> {
  const orderedByItemId = new Map(
    state.lines.map((line) => [line.pastOrderItemId, line.orderedQty]),
  );
  return deriveReceiptStatus(
    buildSaveLines(state).map((line) => ({
      received: line.received,
      receivedQty: line.receivedQty,
      orderedQty: orderedByItemId.get(line.pastOrderItemId),
    })),
  );
}

/**
 * Short human label for a saved discrepancy line, shared with the manager's
 * "Delivery issues" section: "Missing" or "Short: 2 of 5 lb".
 */
export function describeDiscrepancyLine(line: {
  received: boolean;
  receivedQty: number | null;
  orderedQty: number;
  unit: string;
}): string {
  const arrived =
    typeof line.receivedQty === 'number' && Number.isFinite(line.receivedQty)
      ? line.receivedQty
      : null;

  if (!line.received && (arrived === null || arrived === 0)) return 'Missing';

  const unitSuffix = line.unit.trim().length > 0 ? ` ${line.unit.trim()}` : '';
  return `Short: ${arrived ?? 0} of ${line.orderedQty}${unitSuffix}`;
}
