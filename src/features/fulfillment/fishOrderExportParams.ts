export interface FishItemOrder {
  itemId: string;
  itemName: string;
  quantity: number;
  unit: string;
}

export interface LocationQuantity {
  name: string;
  shortCode: string;
  quantity: number;
}

export type FishOrderExportParams = {
  locationName?: string | string[];
  locationShortCode?: string | string[];
  fishItems?: string | string[];
  fishItemId?: string | string[];
  fishItemName?: string | string[];
  fishItemQuantity?: string | string[];
  fishItemUnit?: string | string[];
  fishItemLocations?: string | string[];
};

export type FishOrderExport =
  | { format: 'multi'; locationName: string; locationShortCode: string; items: FishItemOrder[] }
  | { format: 'legacy'; itemName: string; unit: string; locations: LocationQuantity[] };

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] ?? '' : value ?? '').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonemptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isFishItem(value: unknown): value is FishItemOrder {
  return isRecord(value) && isNonemptyText(value.itemId) && isNonemptyText(value.itemName)
    && isNonemptyText(value.unit) && isQuantity(value.quantity);
}

function isLocationQuantity(value: unknown): value is LocationQuantity {
  return isRecord(value) && isNonemptyText(value.name) && typeof value.shortCode === 'string'
    && isQuantity(value.quantity);
}

function parseRows<T extends { quantity: number }>(raw: string, validate: (value: unknown) => value is T): T[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(validate)) return null;
    const total = parsed.reduce((sum, row) => sum + row.quantity, 0);
    return total > 0 && Number.isFinite(total) ? parsed : null;
  } catch {
    return null;
  }
}

/** Reject the complete payload if any line is invalid; never silently omit order lines. */
export function parseFishOrderExportParams(params: FishOrderExportParams): FishOrderExport | null {
  if (params.fishItems !== undefined) {
    const items = parseRows(firstParam(params.fishItems), isFishItem);
    const locationName = firstParam(params.locationName);
    if (!items || !locationName) return null;
    return { format: 'multi', locationName, locationShortCode: firstParam(params.locationShortCode), items };
  }

  const locations = parseRows(firstParam(params.fishItemLocations), isLocationQuantity);
  const itemName = firstParam(params.fishItemName);
  const unit = firstParam(params.fishItemUnit);
  if (!locations || !itemName || !unit) return null;
  return { format: 'legacy', itemName, unit, locations };
}
