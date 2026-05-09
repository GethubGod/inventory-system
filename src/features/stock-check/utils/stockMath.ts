/**
 * Pure math helpers for the wheel-picker stock-entry flow. All functions are
 * side-effect free, defensively guard against `null`/`undefined`/`NaN`
 * inputs, and never throw. They power three call sites:
 *   1. The card right-side display string ("4 lb · 2 pcs").
 *   2. The bottom-sheet Summary box live calculations.
 *   3. The store's `commitStockEntry` action that writes back to the row.
 *
 * Keeping the math here (rather than inlined in components) lets us unit test
 * the model independently of any Reanimated / @gorhom plumbing.
 */
import type { UnitType } from '@/types';
import type { StockCheckItem } from '../types';

/* ──────────────────────────────────────────────────────────────────────────
 * Unit options for the UNIT wheel.
 * ──────────────────────────────────────────────────────────────────────── */

export interface UnitOption {
  /** Internal key used by the store + cart wiring. */
  key: UnitType;
  /** Short human label rendered in the wheel (e.g. "lb", "case", "pk"). */
  label: string;
}

/**
 * Returns the unit options available for a given item, in display order.
 * If only one of pack/base is configured, the wheel degenerates to a single,
 * non-scrolling row instead of throwing or rendering empty space.
 */
export function getUnitOptionsForItem(item: {
  unitType: UnitType;
  packUnit: string;
  baseUnit: string;
}): UnitOption[] {
  const opts: UnitOption[] = [];
  // Order: prefer the configured `unitType` first so the wheel opens with
  // that row centered, matching the user's existing per-item preference.
  if (item.unitType === 'pack') {
    if (item.packUnit) opts.push({ key: 'pack', label: item.packUnit });
    if (item.baseUnit) opts.push({ key: 'base', label: item.baseUnit });
  } else {
    if (item.baseUnit) opts.push({ key: 'base', label: item.baseUnit });
    if (item.packUnit) opts.push({ key: 'pack', label: item.packUnit });
  }
  if (opts.length === 0) {
    // Defensive fallback so the wheel always has at least one row.
    opts.push({ key: item.unitType, label: 'each' });
  }
  return opts;
}

export function findUnitOptionIndex(
  options: UnitOption[],
  unit: UnitType,
): number {
  const idx = options.findIndex((o) => o.key === unit);
  return idx < 0 ? 0 : idx;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Stock totals + deficit (the "NEED TO ORDER" number).
 * ──────────────────────────────────────────────────────────────────────── */

/** Safe non-negative integer cast used everywhere we accept wheel input. */
function clampInt(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const i = Math.trunc(n);
  return i < 0 ? 0 : i;
}

/**
 * Converts a wheel-picker entry (`stockUnit`/`stockAmount`/`stockPieces`)
 * into the equivalent count expressed in **base** units. Pack-mode entries
 * multiply by `packSize` (which falls back to 1 when not configured so the
 * math degrades gracefully rather than collapsing to zero). Pieces are
 * always treated as base units.
 */
export function totalStockInBase(input: {
  stockUnit: UnitType;
  stockAmount: number;
  stockPieces: number;
  packSize: number;
}): number {
  const amt = clampInt(input.stockAmount);
  const pcs = clampInt(input.stockPieces);
  const ps = clampInt(input.packSize) || 1;
  if (input.stockUnit === 'pack') {
    return amt * ps + pcs;
  }
  return amt + pcs;
}

/**
 * Converts the configured par level into base units, mirroring the
 * unit-type stored on the inventory row. This keeps the deficit math
 * meaningful regardless of which unit the inventory team configured par in.
 */
export function parInBase(input: {
  parLevel: number;
  unitType: UnitType;
  packSize: number;
}): number {
  const par = clampInt(input.parLevel);
  const ps = clampInt(input.packSize) || 1;
  return input.unitType === 'pack' ? par * ps : par;
}

/**
 * Computes the order deficit (in `unitType` units) for a given stock entry.
 *
 * Returns an integer. Negative results (over-stocked) are clamped to 0 to
 * match the design — surplus stock never produces a negative order number.
 */
export function computeNeedToOrder(item: {
  parLevel: number;
  unitType: UnitType;
  packSize: number;
  stockUnit: UnitType;
  stockAmount: number;
  stockPieces: number;
}): number {
  const total = totalStockInBase(item);
  const par = parInBase(item);
  const deficitBase = Math.max(0, par - total);
  if (item.unitType === 'pack') {
    const ps = clampInt(item.packSize) || 1;
    // Round up so a partial pack still triggers a full pack order — the
    // safer side of the deficit when the chef is ordering by case.
    return Math.ceil(deficitBase / ps);
  }
  return deficitBase;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Display helpers.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Resolves the visible label for the user-selected stock unit, falling back
 * across pack ↔ base when one isn't configured (matches the legacy
 * `getActiveUnitLabel` behavior in the card).
 */
export function getStockUnitLabel(item: {
  stockUnit: UnitType;
  packUnit: string;
  baseUnit: string;
}): string {
  if (item.stockUnit === 'pack') {
    return item.packUnit || item.baseUnit || 'each';
  }
  return item.baseUnit || item.packUnit || 'each';
}

/**
 * Formats the right-side stock display string for the item card and the
 * sheet's Summary box, e.g. `"3 pk"`, `"4 lb · 2 pcs"`. When the row is
 * unchecked (no stock entry yet) we surface a discoverable placeholder so
 * the card still reads as a tap target.
 */
export function formatStockDisplay(item: StockCheckItem): string {
  if (!item.checked) {
    // Show "—" rather than "0 lb" so the row clearly reads as untouched.
    return '—';
  }
  const unitLabel = getStockUnitLabel(item);
  const amount = clampInt(item.stockAmount);
  const pieces = clampInt(item.stockPieces);
  const head = `${amount} ${unitLabel}`;
  if (pieces > 0) {
    return `${head} · ${pieces} pcs`;
  }
  return head;
}

/**
 * Builds the small "par 3 lb · 1 case ≈ 50 lb" subtitle for the bottom
 * sheet header. Omits the conversion clause when pack metadata is missing.
 */
export function formatParSubtitle(item: {
  parLevel: number;
  unitType: UnitType;
  packUnit: string;
  baseUnit: string;
  packSize: number;
}): string {
  const par = clampInt(item.parLevel);
  const parUnit =
    item.unitType === 'pack'
      ? item.packUnit || item.baseUnit || 'each'
      : item.baseUnit || item.packUnit || 'each';
  const head = `par ${par} ${parUnit}`;
  const ps = clampInt(item.packSize);
  if (ps > 0 && item.packUnit && item.baseUnit) {
    return `${head} · 1 ${item.packUnit} ≈ ${ps} ${item.baseUnit}`;
  }
  return head;
}
