import type { InventoryItem, ParserExampleRow, UnitType } from '@/types';

export type ConfigTab = 'aliases' | 'examples' | 'learning';

export type ConflictPayload = {
  existing_text: string;
  input_text: string;
  question: string;
};

export type DerivedExampleType = 'mapping' | 'conflict_resolution';

// We encode conflict-resolution examples inside the existing `structured_output` jsonb column
// (no schema migration required) by placing a single marker element at the head of the array.
export const CONFLICT_MARKER_KEY = '_meta_conflict';

export type ConflictMarkerElement = {
  _meta_conflict: true;
  existing_text: string;
  input_text: string;
  question: string;
  resolution: 'add' | 'replace' | null;
};

export function isConflictMarker(value: unknown): value is ConflictMarkerElement {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as Record<string, unknown>)[CONFLICT_MARKER_KEY] === true,
  );
}

export function getExampleType(example: ParserExampleRow): DerivedExampleType {
  const rows = Array.isArray(example.structured_output) ? example.structured_output : [];
  return rows.some(isConflictMarker) ? 'conflict_resolution' : 'mapping';
}

export function getConflictPayload(example: ParserExampleRow): ConflictPayload | null {
  const marker = (example.structured_output ?? []).find(isConflictMarker);
  if (!marker) return null;
  return {
    existing_text: marker.existing_text,
    input_text: marker.input_text,
    question: marker.question,
  };
}

export function getConflictResolution(example: ParserExampleRow): 'add' | 'replace' | null {
  const marker = (example.structured_output ?? []).find(isConflictMarker);
  return marker?.resolution ?? null;
}

export function encodeConflictStructuredOutput(
  payload: ConflictPayload,
  resolution: 'add' | 'replace' | null,
): Record<string, unknown>[] {
  return [
    {
      [CONFLICT_MARKER_KEY]: true,
      existing_text: payload.existing_text,
      input_text: payload.input_text,
      question: payload.question,
      resolution,
    },
  ];
}

export function getMappingRows(example: ParserExampleRow): Record<string, unknown>[] {
  const rows = Array.isArray(example.structured_output) ? example.structured_output : [];
  return rows.filter((row) => !isConflictMarker(row));
}

export type QuickOrderConfigItem = InventoryItem & {
  aliases: string[];
};

export type ExampleBuilderItem = {
  localId: string;
  item_id: string | null;
  item_name: string;
  itemSearch: string;
  quantity: string;
  unit: string;
  unit_type: UnitType;
};

export type ParserCorrectionRow = {
  raw_token: string | null;
  user_corrected_item_id: string | null;
  created_at: string;
};

export type ParserCorrectionIgnoreKey = {
  rawToken: string;
  correctedItemId: string;
};

export type LearningGroup = {
  key: string;
  rawToken: string;
  correctedItemId: string;
  correctedItemName: string;
  count: number;
  alreadyAlias: boolean;
};

export function normalizeAlias(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeAliasKey(value: string): string {
  return normalizeAlias(value).toLowerCase();
}

export function makeIgnoreKey(rawToken: string, correctedItemId: string): string {
  return `${normalizeAliasKey(rawToken)}::${correctedItemId}`;
}

const UNIT_LABELS: Record<string, { singular: string; plural: string }> = {
  cs: { singular: 'case', plural: 'cases' },
  case: { singular: 'case', plural: 'cases' },
  pk: { singular: 'pack', plural: 'packs' },
  pack: { singular: 'pack', plural: 'packs' },
  pc: { singular: 'piece', plural: 'pieces' },
  pcs: { singular: 'piece', plural: 'pieces' },
  piece: { singular: 'piece', plural: 'pieces' },
  ea: { singular: 'each', plural: 'each' },
  each: { singular: 'each', plural: 'each' },
  lb: { singular: 'lb', plural: 'lb' },
  lbs: { singular: 'lb', plural: 'lb' },
  oz: { singular: 'oz', plural: 'oz' },
  kg: { singular: 'kg', plural: 'kg' },
  g: { singular: 'g', plural: 'g' },
  qt: { singular: 'qt', plural: 'qt' },
  gal: { singular: 'gal', plural: 'gal' },
  l: { singular: 'L', plural: 'L' },
  ml: { singular: 'mL', plural: 'mL' },
};

export function formatUnitLabel(unit: string | null | undefined, quantity: number): string {
  if (!unit) return '';
  const key = unit.trim().toLowerCase();
  const entry = UNIT_LABELS[key];
  if (!entry) return unit.trim();
  return quantity === 1 ? entry.singular : entry.plural;
}

export function formatExampleQuantity(quantity: number, unit: string | null | undefined): string {
  const unitLabel = formatUnitLabel(unit, quantity);
  const qty = Number.isFinite(quantity) ? (Number.isInteger(quantity) ? String(quantity) : String(quantity)) : '0';
  return unitLabel ? `${qty} ${unitLabel}` : qty;
}

export function newBuilderItem(): ExampleBuilderItem {
  return {
    localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    item_id: null,
    item_name: '',
    itemSearch: '',
    quantity: '1',
    unit: '',
    unit_type: 'base',
  };
}

export function parseStructuredOutput(value: unknown): ExampleBuilderItem[] {
  if (!Array.isArray(value)) {
    return [newBuilderItem()];
  }

  const rows = value.map((entry) => {
    const row = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    const quantity = row.quantity;
    const unitType: UnitType = row.unit_type === 'pack' ? 'pack' : 'base';
    return {
      localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      item_id: typeof row.item_id === 'string' ? row.item_id : null,
      item_name: typeof row.item_name === 'string' ? row.item_name : '',
      itemSearch: typeof row.item_name === 'string' ? row.item_name : '',
      quantity:
        typeof quantity === 'number' && Number.isFinite(quantity)
          ? String(quantity)
          : typeof quantity === 'string'
            ? quantity
            : '1',
      unit: typeof row.unit === 'string' ? row.unit : '',
      unit_type: unitType,
    };
  });

  return rows.length > 0 ? rows : [newBuilderItem()];
}

export function mapInventoryRow(row: unknown): QuickOrderConfigItem {
  const item = row as Partial<QuickOrderConfigItem>;
  return {
    id: item.id ?? '',
    name: item.name ?? '',
    category: item.category ?? 'dry',
    supplier_category: item.supplier_category ?? 'main_distributor',
    supplier_id: item.supplier_id ?? null,
    base_unit: item.base_unit ?? '',
    pack_unit: item.pack_unit ?? '',
    pack_size: item.pack_size ?? 1,
    active: item.active !== false,
    aliases: Array.isArray(item.aliases)
      ? item.aliases.filter((alias): alias is string => typeof alias === 'string')
      : [],
    created_at: item.created_at ?? '',
    created_by: item.created_by ?? null,
  };
}

export const INVENTORY_SELECT =
  'id,name,category,supplier_category,supplier_id,base_unit,pack_unit,pack_size,active,aliases,created_at,created_by';

export function startOfWeekIso(now: Date = new Date()): string {
  const d = new Date(now);
  const day = d.getDay();
  const diff = (day + 6) % 7; // Monday-based week
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
