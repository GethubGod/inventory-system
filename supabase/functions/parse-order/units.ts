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
  bottle: 'bottle',
  bottles: 'bottle',
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
  const values = allowedUnitSourceValues(item);
  const normalized = new Set<string>();
  for (const value of values) {
    const unit = normalizeUnitForComparison(value);
    if (unit) normalized.add(unit);
  }
  return [...normalized];
}

export function deriveAllowedUnitLabels(item: CatalogItem | null | undefined): string[] {
  if (!item) return [];
  const values = allowedUnitSourceValues(item);
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const normalized = normalizeUnitForComparison(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    labels.push(displayUnitLabel(value));
  }
  return labels;
}

export function formatAllowedUnitList(units: string[]): string {
  const cleaned = units.map(displayUnitLabel).filter(Boolean);
  const unique = [...new Set(cleaned)];
  if (unique.length === 0) return 'a valid unit';
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} or ${unique[1]}`;
  return `${unique.slice(0, -1).join(', ')}, or ${unique[unique.length - 1]}`;
}

export function displayUnitLabel(value: string | null | undefined): string {
  const raw = value?.trim();
  if (!raw) return '';
  const normalized = normalizeUnitForComparison(raw);
  return unitWord(normalized ?? raw, 1);
}

export function formatQuantityWithUnit(
  quantity: number | null | undefined,
  unit: string | null | undefined,
): string {
  if (quantity == null) return unit ? unitWord(unit, 1) : 'that quantity';
  return `${formatQuantityValue(quantity)}${unit ? ` ${unitWord(unit, quantity)}` : ''}`;
}

export function unitWord(value: string | null | undefined, quantity = 2): string {
  const raw = value?.trim();
  if (!raw) return '';
  const normalized = normalizeUnitForComparison(raw) ?? normalizeUnitKey(raw);
  const singular = UNIT_LABELS[normalized] ?? raw.toLowerCase();
  if (quantity === 1) return singular;
  return UNIT_PLURALS[singular] ?? `${singular}s`;
}

function allowedUnitSourceValues(item: CatalogItem): (string | null | undefined)[] {
  const explicitAllowed = Array.isArray(item.allowed_units)
    ? item.allowed_units.filter((unit): unit is string => typeof unit === 'string' && unit.trim().length > 0)
    : [];
  if (explicitAllowed.length > 0) return explicitAllowed;
  return [
    ...(Array.isArray(item.unit_options) ? item.unit_options : []),
    item.order_unit,
    item.default_unit,
    item.base_unit,
    item.pack_unit,
  ];
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

function formatQuantityValue(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : String(quantity);
}

const UNIT_LABELS: Record<string, string> = {
  cs: 'case',
  case: 'case',
  pc: 'piece',
  piece: 'piece',
  pack: 'pack',
  pk: 'pack',
  lb: 'pound',
  lbs: 'pound',
  oz: 'ounce',
  box: 'box',
  bottle: 'bottle',
  bag: 'bag',
  tray: 'tray',
};

const UNIT_PLURALS: Record<string, string> = {
  case: 'cases',
  piece: 'pieces',
  pack: 'packs',
  pound: 'pounds',
  ounce: 'ounces',
  box: 'boxes',
  bottle: 'bottles',
  bag: 'bags',
  tray: 'trays',
};
