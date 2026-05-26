// Pure helpers for assembling the parser's global catalog from raw qo_items
// rows. Kept in its own module so unit tests can import it without dragging
// the Deno entrypoint (and its `_shared/*` Deno-specific imports) into the
// TypeScript program graph.

import type { CatalogItem } from './types.ts';

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getDefaultInventoryUnit(row: Record<string, unknown>): string | null {
  const candidates = [
    asNullableString(row.default_order_unit),
    asNullableString(row.base_unit),
    asNullableString(row.pack_unit),
  ];
  for (const candidate of candidates) {
    if (candidate && candidate.trim().length > 0) return candidate;
  }
  return null;
}

function parseAliases(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((alias): alias is string => typeof alias === 'string' && alias.trim().length > 0);
  }
  if (typeof value === 'string') {
    return value.split(',').map((alias) => alias.trim()).filter(Boolean);
  }
  return [];
}

export function buildGlobalCatalogFromQoItemRows(
  rows: Record<string, unknown>[],
  options?: { onUnlinked?: (info: { qo_items_id: string; name: string | null; location_scope: string | null }) => void },
): CatalogItem[] {
  const warnedUnlinkedQoItemIds = new Set<string>();
  const onUnlinked = options?.onUnlinked
    ?? ((info) => {
      console.warn('[parse-order] qo_items row has no inventory_item_id; excluding from catalog', info);
    });

  return rows
    .map((row): CatalogItem | null => {
      const inventoryRow = isRecord(row.inventory_items) ? row.inventory_items : {};
      const inventoryItemId = asTrimmedString(row.inventory_item_id);
      const qoItemsId = asTrimmedString(row.id);
      const name = asTrimmedString(row.name);

      if (!inventoryItemId && qoItemsId && !warnedUnlinkedQoItemIds.has(qoItemsId)) {
        warnedUnlinkedQoItemIds.add(qoItemsId);
        onUnlinked({
          qo_items_id: qoItemsId,
          name,
          location_scope: asNullableString(row.location_scope),
        });
      }

      const id = inventoryItemId ?? asTrimmedString(inventoryRow.id);
      if (!id || !name) return null;
      return {
        id,
        qo_item_id: qoItemsId,
        name,
        aliases: parseAliases(row.aliases),
        default_unit: asNullableString(row.order_unit) ?? getDefaultInventoryUnit(inventoryRow),
        order_unit: asNullableString(row.order_unit),
        base_unit: asNullableString(inventoryRow.base_unit),
        pack_unit: asNullableString(inventoryRow.pack_unit),
        supplier_id: asNullableString(row.supplier_id) ?? asNullableString(inventoryRow.supplier_id),
        location_id: asNullableString(row.location_id),
        allowed_units: Array.isArray(inventoryRow.allowed_units)
          ? inventoryRow.allowed_units.filter((unit): unit is string => typeof unit === 'string')
          : null,
        hard_cap: null,
        soft_cap: null,
        safety_stock: null,
        target_stock: row.target_stock != null ? Number(row.target_stock) : null,
        default_order_unit: asNullableString(row.order_unit) ?? asNullableString(inventoryRow.default_order_unit),
      };
    })
    .filter((item): item is CatalogItem => Boolean(item))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function buildCatalogFromInventoryItemRows(rows: Record<string, unknown>[]): CatalogItem[] {
  return rows
    .map((row): CatalogItem | null => {
      const id = asTrimmedString(row.id);
      const name = asTrimmedString(row.name);
      if (!id || !name) return null;
      const defaultUnit = getDefaultInventoryUnit(row);
      return {
        id,
        name,
        aliases: parseAliases(row.aliases),
        default_unit: defaultUnit,
        order_unit: asNullableString(row.default_order_unit) ?? defaultUnit,
        base_unit: asNullableString(row.base_unit),
        pack_unit: asNullableString(row.pack_unit),
        supplier_id: asNullableString(row.supplier_id),
        location_id: asNullableString(row.location_id),
        allowed_units: Array.isArray(row.allowed_units)
          ? row.allowed_units.filter((unit): unit is string => typeof unit === 'string')
          : null,
        hard_cap: row.hard_cap != null ? Number(row.hard_cap) : null,
        soft_cap: row.soft_cap != null ? Number(row.soft_cap) : null,
        safety_stock: row.safety_stock != null ? Number(row.safety_stock) : null,
        target_stock: row.target_stock != null ? Number(row.target_stock) : null,
        default_order_unit: asNullableString(row.default_order_unit) ?? defaultUnit,
      };
    })
    .filter((item): item is CatalogItem => Boolean(item))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function mergeCatalogWithInventoryFallback(
  preferred: CatalogItem[],
  fallback: CatalogItem[],
): CatalogItem[] {
  if (fallback.length === 0) return preferred;
  const byId = new Map<string, CatalogItem>();
  for (const item of fallback) byId.set(item.id, item);
  for (const item of preferred) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
