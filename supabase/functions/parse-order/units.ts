import type { CatalogItem } from './types.ts';

const DEFAULT_UNIT_ALIASES: Record<string, string> = {
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
  ea: 'pc',
  each: 'pc',
  box: 'box',
  boxes: 'box',
  bag: 'bag',
  bags: 'bag',
  tray: 'tray',
  trays: 'tray',
  pack: 'pack',
  packs: 'pack',
  pk: 'pack',
  pkg: 'pack',
  package: 'pack',
  packages: 'pack',
};

let configuredUnitAliases: Record<string, string> = { ...DEFAULT_UNIT_ALIASES };

function normalizeUnitKey(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\.$/, '');
}

export function configureUnitAliases(extraAliases: Record<string, unknown> | null | undefined): void {
  configuredUnitAliases = { ...DEFAULT_UNIT_ALIASES };
  if (!extraAliases) return;

  for (const [rawAlias, rawUnit] of Object.entries(extraAliases)) {
    if (typeof rawUnit !== 'string' || !rawAlias.trim() || !rawUnit.trim()) continue;
    const normalizedUnit = normalizeUnit(rawUnit) ?? normalizeUnitKey(rawUnit);
    configuredUnitAliases[normalizeUnitKey(rawAlias)] = normalizedUnit;
  }
}

export function getUnitAliases(): Record<string, string> {
  return { ...configuredUnitAliases };
}

export function getUnitWords(): string[] {
  return Object.keys(configuredUnitAliases).sort((a, b) => b.length - a.length);
}

export const UNIT_WORDS = getUnitWords();

export function normalizeUnit(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = normalizeUnitKey(value);
  return configuredUnitAliases[key] ?? null;
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
    ...(Array.isArray(item.unit_options) ? item.unit_options : []),
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
