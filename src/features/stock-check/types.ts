import type { ItemCategory, UnitType } from '@/types';

export type StockCheckStatus = 'unchecked' | 'needs_order' | 'low' | 'at_par';

/**
 * Local row model that drives the Stock Check UI.
 *
 * Naming follows the spec:
 *  - `parLevel` = required par count (e.g., 4 cases)
 *  - `orderQuantity` = the value that drives the +/− stepper (the user's chosen
 *    order amount). When status is `needs_order` and the user hasn't entered a
 *    value yet, we surface `parLevel` as the suggested order in the subtitle.
 *  - `checked` flips to `true` the first time the user interacts with the row;
 *    `unchecked` rows render greyed-out controls and "not checked".
 *
 * Unit fields:
 *  - `unitType` — current user-selected `'pack' | 'base'`. Drives display +
 *    cart wiring; persisted offline per-item.
 *  - `packUnit` / `baseUnit` — labels (e.g. "case", "lb"). Either may be
 *    empty when the inventory item only configures one unit.
 *  - `packSize` — number of base units in one pack (for future conversion);
 *    not used by the UI today, but kept available so consumers can do
 *    quantity math without re-querying the inventory item.
 */
export interface StockCheckItem {
  id: string;
  name: string;
  category: ItemCategory;
  areaId: string;
  areaName: string;
  parLevel: number;
  unitType: UnitType;
  packUnit: string;
  baseUnit: string;
  packSize: number;
  /**
   * Computed deficit in `unitType` units, derived from the wheel-picker
   * stock entry on commit. Kept on the row so the existing cart pipeline
   * (`addLineItem(item.id, item.orderQuantity, item.unitType, …)`) and the
   * `computeAreaProgress` predicate keep working without surgery.
   */
  orderQuantity: number;
  checked: boolean;
  hasNote: boolean;
  noteText: string;
  status: StockCheckStatus;

  /* ── Wheel-picker stock entry ───────────────────────────────────────
   * The user records on-hand stock by spinning three wheels: a unit
   * selector, a whole-amount column, and a loose-pieces column. These are
   * the source of truth; `orderQuantity` is derived from them. They start
   * at sensible defaults (`unitType`, 0, 0) for unchecked rows so the sheet
   * always opens to a coherent state.
   * ──────────────────────────────────────────────────────────────────── */
  stockUnit: UnitType;
  stockAmount: number;
  stockPieces: number;
}

export interface StockCheckArea {
  id: string;
  name: string;
  sortOrder: number;
  itemIds: string[];
}

export interface StockCheckProgress {
  totalItems: number;
  checkedItems: number;
  itemsToOrder: number;
}

export interface AreaProgress extends StockCheckProgress {
  areaId: string;
  areaName: string;
}
