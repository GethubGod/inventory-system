import type { CatalogItem } from './types.ts';

const UNIT_ALIASES: Record<string, string> = {
  cs: 'cs',
  case: 'cs',
  cases: 'cs',
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
  oz: 'oz',
  ounce: 'oz',
  ounces: 'oz',
  pc: 'pc',
  pcs: 'pc',
  piece: 'pc',
  pieces: 'pc',
  ea: 'ea',
  each: 'ea',
  box: 'box',
  boxes: 'box',
  bag: 'bag',
  bags: 'bag',
  tray: 'tray',
  trays: 'tray',
  pack: 'pack',
  packs: 'pack',
};

export const UNIT_WORDS = Object.keys(UNIT_ALIASES).sort((a, b) => b.length - a.length);

export function normalizeUnit(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.trim().toLowerCase().replace(/\.$/, '');
  return UNIT_ALIASES[key] ?? null;
}

export function normalizeUnitForComparison(value: string | null | undefined): string | null {
  return normalizeUnit(value) ?? (value?.trim().toLowerCase() || null);
}

export function isKnownUnit(value: string | null | undefined): boolean {
  return normalizeUnit(value) != null;
}

export function deriveAllowedUnits(item: CatalogItem | null | undefined): string[] {
  if (!item) return [];
  const values = [
    ...(Array.isArray(item.allowed_units) ? item.allowed_units : []),
    item.order_unit,
    item.default_unit,
    item.base_unit,
    item.pack_unit,
  ];
  const normalized = new Set<string>();
  for (const value of values) {
    const unit = normalizeUnitForComparison(value);
    if (unit) normalized.add(unit);
  }
  return [...normalized];
}

export function isUnitAllowedForItem(
  item: CatalogItem | null | undefined,
  unit: string | null | undefined,
): boolean {
  const normalizedUnit = normalizeUnitForComparison(unit);
  if (!normalizedUnit) return false;
  const allowed = deriveAllowedUnits(item);
  return allowed.length === 0 || allowed.includes(normalizedUnit);
}

