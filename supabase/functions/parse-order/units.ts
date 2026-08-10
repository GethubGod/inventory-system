import type { CatalogItem, ItemAllowedUnitRule } from './types.ts';

export const DEFAULT_UNIT_ALIASES: Record<string, string> = {
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

export type UnitAliasMap = Record<string, string>;

function normalizeUnitKey(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\.$/, '');
}

export function buildUnitAliases(extraAliases: Record<string, unknown> | null | undefined): UnitAliasMap {
  const aliases: UnitAliasMap = { ...DEFAULT_UNIT_ALIASES };
  if (!extraAliases) return aliases;

  for (const [rawAlias, rawUnit] of Object.entries(extraAliases)) {
    if (typeof rawUnit !== 'string' || !rawAlias.trim() || !rawUnit.trim()) continue;
    const normalizedUnit = aliases[normalizeUnitKey(rawUnit)] ?? normalizeUnitKey(rawUnit);
    aliases[normalizeUnitKey(rawAlias)] = normalizedUnit;
  }
  return aliases;
}

export function getUnitWords(unitAliases: UnitAliasMap = DEFAULT_UNIT_ALIASES): string[] {
  return Object.keys(unitAliases).sort((a, b) => b.length - a.length);
}

export function normalizeUnit(
  value: string | null | undefined,
  unitAliases: UnitAliasMap = DEFAULT_UNIT_ALIASES,
): string | null {
  if (!value) return null;
  const key = normalizeUnitKey(value);
  return unitAliases[key] ?? null;
}

export function normalizeUnitForComparison(
  value: string | null | undefined,
  unitAliases: UnitAliasMap = DEFAULT_UNIT_ALIASES,
): string | null {
  return normalizeUnit(value, unitAliases) ?? (value?.trim().toLowerCase() || null);
}

export function isKnownUnit(
  value: string | null | undefined,
  unitAliases: UnitAliasMap = DEFAULT_UNIT_ALIASES,
): boolean {
  return normalizeUnit(value, unitAliases) != null;
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

/**
 * The single unit an item can be ordered in, or null when it has zero or more
 * than one. When there is exactly one choice there is nothing for the employee
 * to pick, so callers fill it in automatically instead of prompting.
 */
export function singleAllowedUnit(item: CatalogItem | null | undefined): string | null {
  const units = deriveAllowedUnits(item);
  return units.length === 1 ? units[0] : null;
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

export function filterAllowedUnitRulesForEmployee(rules: ItemAllowedUnitRule[], employeeNames: string[]): ItemAllowedUnitRule[] {
  if (employeeNames.length === 0) {
    return rules.filter(r => !r.employee_names || !r.employee_names.trim());
  }
  
  const normalizedEmployeeNames = employeeNames
    .map(name => name.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' '))
    .filter((name): name is string => Boolean(name));
    
  // Step 1: Identify all rules that explicitly match this employee.
  const employeeMatchedRules = rules.filter(rule => {
    const rawNames = rule.employee_names;
    if (!rawNames || !rawNames.trim()) return false;
    
    const allowedNames = rawNames
      .split(',')
      .map(name => name.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' '))
      .filter((name): name is string => Boolean(name));
      
    return normalizedEmployeeNames.some(empName => {
      const empFirst = empName.split(' ')[0];
      return allowedNames.some(allowedName => {
        const allowedFirst = allowedName.split(' ')[0];
        return empFirst === allowedFirst;
      });
    });
  });
  
  // Get the set of item IDs that have at least one employee-specific rule matching this employee.
  const itemsWithEmployeeRules = new Set(employeeMatchedRules.map(r => r.item_id));
  
  // Step 2: Keep only employee-specific rules for those items, and global rules for everything else.
  const finalRules: ItemAllowedUnitRule[] = [...employeeMatchedRules];
  
  for (const rule of rules) {
    const rawNames = rule.employee_names;
    const isGlobal = !rawNames || !rawNames.trim();
    if (isGlobal && !itemsWithEmployeeRules.has(rule.item_id)) {
      finalRules.push(rule);
    }
  }
  
  return finalRules;
}
