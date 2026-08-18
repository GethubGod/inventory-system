import type {
  Checklist,
  ChecklistItem,
  ChecklistSendLine,
} from '@/services/orderChecklist';
import type { InventoryItem } from '@/types';

/**
 * Pure selection-state logic for the simplified ordering checklist screen.
 * Kept free of React/React Native imports so it is unit-testable in plain Jest.
 */

export type LocationGroup = Checklist['locationGroup'];

export type SelectionBucket = 'frequent' | 'occasional' | 'rare' | 'added';

export interface SelectionLine {
  /** Stable row key: checklist item id, or `added:<inventoryItemId>` for search adds. */
  key: string;
  source: 'checklist' | 'search';
  itemId: string | null;
  itemName: string;
  unit: string;
  checked: boolean;
  quantity: number;
  recommendedQty: number | null;
  bucket: SelectionBucket;
  lastOrderedAt: string | null;
}

export interface SelectionState {
  checklistId: string | null;
  lines: SelectionLine[];
}

export type SelectionAction =
  | { type: 'init'; checklist: Checklist }
  | { type: 'toggle'; key: string }
  | { type: 'setQuantity'; key: string; quantity: number }
  | { type: 'adjustQuantity'; key: string; delta: number }
  | { type: 'addInventoryItem'; item: InventoryItem }
  | { type: 'removeLine'; key: string };

export const MIN_QUANTITY = 0.25;
export const MAX_QUANTITY = 999;

export const EMPTY_SELECTION_STATE: SelectionState = {
  checklistId: null,
  lines: [],
};

export function clampQuantity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  const bounded = Math.min(MAX_QUANTITY, Math.max(MIN_QUANTITY, value));
  // Avoid float noise like 2.5000000000000004 from repeated stepping.
  return Math.round(bounded * 100) / 100;
}

export function defaultQuantityFor(item: Pick<ChecklistItem, 'recommendedQty'>): number {
  const recommended = item.recommendedQty;
  if (typeof recommended === 'number' && Number.isFinite(recommended) && recommended > 0) {
    return clampQuantity(recommended);
  }
  return 1;
}

function lineFromChecklistItem(item: ChecklistItem): SelectionLine {
  return {
    key: item.id,
    source: 'checklist',
    itemId: item.itemId,
    itemName: item.itemName,
    unit: item.unit,
    checked: item.defaultChecked,
    quantity: defaultQuantityFor(item),
    recommendedQty: item.recommendedQty,
    bucket: item.stalenessBucket,
    lastOrderedAt: item.lastOrderedAt,
  };
}

export function addedLineKey(inventoryItemId: string): string {
  return `added:${inventoryItemId}`;
}

export function unitForInventoryItem(
  item: Pick<InventoryItem, 'base_unit' | 'pack_unit' | 'default_order_unit'>,
): string {
  const preferred = item.default_order_unit?.trim();
  if (preferred) return preferred;
  const base = item.base_unit?.trim();
  if (base) return base;
  return item.pack_unit?.trim() || 'unit';
}

export function initSelection(checklist: Checklist): SelectionState {
  return {
    checklistId: checklist.id,
    lines: checklist.items.map(lineFromChecklistItem),
  };
}

function updateLine(
  state: SelectionState,
  key: string,
  update: (line: SelectionLine) => SelectionLine,
): SelectionState {
  let changed = false;
  const lines = state.lines.map((line) => {
    if (line.key !== key) return line;
    const next = update(line);
    if (next !== line) changed = true;
    return next;
  });
  return changed ? { ...state, lines } : state;
}

export function selectionReducer(
  state: SelectionState,
  action: SelectionAction,
): SelectionState {
  switch (action.type) {
    case 'init':
      return initSelection(action.checklist);

    case 'toggle':
      return updateLine(state, action.key, (line) => ({
        ...line,
        checked: !line.checked,
      }));

    case 'setQuantity': {
      const quantity = clampQuantity(action.quantity);
      return updateLine(state, action.key, (line) =>
        line.quantity === quantity && line.checked
          ? line
          : { ...line, quantity, checked: true },
      );
    }

    case 'adjustQuantity':
      return updateLine(state, action.key, (line) => {
        // Whole-unit stepping: fractional values snap to the nearest whole
        // step first so "+" from 2.5 goes to 3, not 3.5.
        const stepped =
          action.delta > 0
            ? Math.floor(line.quantity) + action.delta
            : Math.ceil(line.quantity) + action.delta;
        const quantity = clampQuantity(Math.max(1, stepped));
        // Stepping an unchecked row is an intent to order it: check it too,
        // so the always-visible steppers can activate rows in one tap.
        if (line.quantity === quantity && line.checked) return line;
        return { ...line, quantity, checked: true };
      });

    case 'addInventoryItem': {
      const existingByItemId = state.lines.find(
        (line) => line.itemId === action.item.id,
      );
      if (existingByItemId) {
        // Already on the checklist (or already added): just make sure it is checked.
        return existingByItemId.checked
          ? state
          : updateLine(state, existingByItemId.key, (line) => ({
              ...line,
              checked: true,
            }));
      }

      const newLine: SelectionLine = {
        key: addedLineKey(action.item.id),
        source: 'search',
        itemId: action.item.id,
        itemName: action.item.name,
        unit: unitForInventoryItem(action.item),
        checked: true,
        quantity: 1,
        recommendedQty: null,
        bucket: 'added',
        lastOrderedAt: null,
      };
      return { ...state, lines: [...state.lines, newLine] };
    }

    case 'removeLine': {
      const target = state.lines.find((line) => line.key === action.key);
      if (!target) return state;
      if (target.source === 'search') {
        return {
          ...state,
          lines: state.lines.filter((line) => line.key !== action.key),
        };
      }
      // Checklist-sourced lines are never removed from the list — "remove"
      // just unchecks them so the generated checklist stays intact.
      return target.checked
        ? updateLine(state, action.key, (line) => ({ ...line, checked: false }))
        : state;
    }

    default:
      return state;
  }
}

export interface SelectionSections {
  frequent: SelectionLine[];
  occasional: SelectionLine[];
  rare: SelectionLine[];
  added: SelectionLine[];
}

export function sectionizeLines(state: SelectionState): SelectionSections {
  const sections: SelectionSections = {
    frequent: [],
    occasional: [],
    rare: [],
    added: [],
  };
  for (const line of state.lines) {
    if (line.source === 'search') {
      sections.added.push(line);
    } else if (line.bucket === 'frequent') {
      sections.frequent.push(line);
    } else if (line.bucket === 'rare') {
      sections.rare.push(line);
    } else {
      sections.occasional.push(line);
    }
  }
  return sections;
}

export function countChecked(state: SelectionState): number {
  return state.lines.reduce((total, line) => total + (line.checked ? 1 : 0), 0);
}

export function getCheckedLines(state: SelectionState): SelectionLine[] {
  return state.lines.filter((line) => line.checked);
}

export interface BuiltSendLines {
  /** Lines that can actually be sent (matched to inventory, valid quantity). */
  lines: ChecklistSendLine[];
  /** Checked item names that cannot be sent because they never matched inventory. */
  unmatchedNames: string[];
}

export function buildSendLines(state: SelectionState): BuiltSendLines {
  const lines: ChecklistSendLine[] = [];
  const unmatchedNames: string[] = [];

  for (const line of getCheckedLines(state)) {
    if (!line.itemId) {
      unmatchedNames.push(line.itemName);
      continue;
    }
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      continue;
    }
    lines.push({
      itemId: line.itemId,
      itemName: line.itemName,
      unit: line.unit,
      quantity: line.quantity,
    });
  }

  return { lines, unmatchedNames };
}

/**
 * Maps an auth location to a checklist location group using the same
 * heuristic the fulfillment pipeline uses (see
 * `normalizeLocationGroup` in src/services/fulfillmentDataSource.ts).
 */
export function locationGroupForLocation(
  locationName?: string | null,
  shortCode?: string | null,
): LocationGroup {
  const name = (locationName || '').toLowerCase();
  const code = (shortCode || '').toLowerCase();

  if (name.includes('poki') || name.includes('poke') || code.startsWith('p')) {
    return 'poki';
  }

  return 'sushi';
}

export function formatQuantity(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}
