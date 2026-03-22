// Supplier-draft and order-later queue helper functions for orderStore.

import { UnitType } from '@/types';
import type {
  FulfillmentLocationGroup,
  OrderLaterItem,
  SupplierDraftItem,
  SupplierDraftsBySupplier,
} from '../orderStore.types';
import {
  createFulfillmentId,
  normalizeLocationGroup,
  normalizeSupplierId,
  toIsoString,
  toJsonObject,
  toStringArray,
} from './sharedHelpers';
import { normalizeNote, toValidNumber } from './cartHelpers';

// ---------------------------------------------------------------------------
// Supplier draft normalization
// ---------------------------------------------------------------------------

export function normalizeSupplierDraftItem(raw: unknown): SupplierDraftItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const supplierId = normalizeSupplierId(value.supplierId);
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!supplierId || name.length === 0) return null;

  const unitType: UnitType = value.unitType === 'pack' ? 'pack' : 'base';
  const quantity = toValidNumber(value.quantity);
  if (quantity === null || quantity <= 0) return null;

  return {
    id:
      typeof value.id === 'string' && value.id.trim().length > 0
        ? value.id
        : createFulfillmentId('draft'),
    supplierId,
    inventoryItemId:
      typeof value.inventoryItemId === 'string' && value.inventoryItemId.trim().length > 0
        ? value.inventoryItemId
        : null,
    name,
    category:
      typeof value.category === 'string' && value.category.trim().length > 0
        ? value.category
        : 'dry',
    quantity: Math.max(0, quantity),
    unitType,
    unitLabel:
      typeof value.unitLabel === 'string' && value.unitLabel.trim().length > 0
        ? value.unitLabel
        : unitType === 'pack'
          ? 'pack'
          : 'unit',
    locationGroup: normalizeLocationGroup(value.locationGroup) ?? 'sushi',
    locationId:
      typeof value.locationId === 'string' && value.locationId.trim().length > 0
        ? value.locationId
        : null,
    locationName:
      typeof value.locationName === 'string' && value.locationName.trim().length > 0
        ? value.locationName
        : null,
    note: normalizeNote(value.note),
    createdAt: toIsoString(value.createdAt),
    sourceOrderLaterItemId:
      typeof value.sourceOrderLaterItemId === 'string' && value.sourceOrderLaterItemId.trim().length > 0
        ? value.sourceOrderLaterItemId
        : null,
  };
}

export function normalizeSupplierDrafts(raw: unknown): SupplierDraftsBySupplier {
  if (!raw || typeof raw !== 'object') return {};
  const source = raw as Record<string, unknown>;
  const next: SupplierDraftsBySupplier = {};

  Object.entries(source).forEach(([supplierId, rows]) => {
    const normalizedSupplierId = normalizeSupplierId(supplierId);
    if (!normalizedSupplierId || !Array.isArray(rows)) return;
    const normalizedRows = rows
      .map((row) => normalizeSupplierDraftItem(row))
      .filter((row): row is SupplierDraftItem => Boolean(row));
    if (normalizedRows.length > 0) {
      next[normalizedSupplierId] = normalizedRows;
    }
  });

  return next;
}

// ---------------------------------------------------------------------------
// Order-later queue normalization
// ---------------------------------------------------------------------------

export function normalizeOrderLaterItem(raw: unknown): OrderLaterItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const itemName = typeof value.item_name === 'string'
    ? value.item_name.trim()
    : typeof value.itemName === 'string'
      ? value.itemName.trim()
      : '';
  const createdBy = typeof value.created_by === 'string'
    ? value.created_by
    : typeof value.createdBy === 'string'
      ? value.createdBy
      : '';
  if (!itemName || !createdBy) return null;

  const statusValue =
    value.status === 'added' || value.status === 'cancelled' ? value.status : 'queued';

  return {
    id:
      typeof value.id === 'string' && value.id.trim().length > 0
        ? value.id
        : createFulfillmentId('later'),
    createdBy,
    createdAt: toIsoString(value.created_at ?? value.createdAt),
    scheduledAt: toIsoString(value.scheduled_at ?? value.scheduledAt),
    quantity: Math.max(
      0,
      toValidNumber(value.qty ?? value.quantity ?? (toJsonObject(value.payload).quantity as unknown) ?? 1) ?? 1
    ),
    itemId:
      typeof value.item_id === 'string' && value.item_id.trim().length > 0
        ? value.item_id
        : typeof value.itemId === 'string' && value.itemId.trim().length > 0
          ? value.itemId
          : null,
    itemName,
    unit:
      typeof value.unit === 'string' && value.unit.trim().length > 0
        ? value.unit.trim()
        : 'unit',
    locationId:
      typeof value.location_id === 'string' && value.location_id.trim().length > 0
        ? value.location_id
        : typeof value.locationId === 'string' && value.locationId.trim().length > 0
          ? value.locationId
          : null,
    locationName:
      typeof value.location_name === 'string' && value.location_name.trim().length > 0
        ? value.location_name.trim()
        : typeof value.locationName === 'string' && value.locationName.trim().length > 0
          ? value.locationName.trim()
          : null,
    notes: normalizeNote(value.notes),
    suggestedSupplierId: normalizeSupplierId(
      value.suggested_supplier_id ?? value.suggestedSupplierId
    ),
    preferredSupplierId: normalizeSupplierId(value.preferred_supplier_id ?? value.preferredSupplierId),
    preferredLocationGroup: normalizeLocationGroup(
      value.preferred_location_group ?? value.preferredLocationGroup
    ),
    sourceOrderItemId:
      typeof value.source_order_item_id === 'string' && value.source_order_item_id.trim().length > 0
        ? value.source_order_item_id
        : typeof value.sourceOrderItemId === 'string' && value.sourceOrderItemId.trim().length > 0
          ? value.sourceOrderItemId
          : null,
    sourceOrderItemIds: (() => {
      const fromArray = Array.isArray(value.original_order_item_ids)
        ? toStringArray(value.original_order_item_ids)
        : Array.isArray(value.sourceOrderItemIds)
          ? toStringArray(value.sourceOrderItemIds)
          : [];
      if (fromArray.length > 0) return fromArray;
      const single =
        typeof value.source_order_item_id === 'string' && value.source_order_item_id.trim().length > 0
          ? value.source_order_item_id
          : typeof value.sourceOrderItemId === 'string' && value.sourceOrderItemId.trim().length > 0
            ? value.sourceOrderItemId
            : null;
      return single ? [single] : [];
    })(),
    sourceOrderId:
      typeof value.source_order_id === 'string' && value.source_order_id.trim().length > 0
        ? value.source_order_id
        : typeof value.sourceOrderId === 'string' && value.sourceOrderId.trim().length > 0
          ? value.sourceOrderId
          : null,
    notificationId:
      typeof value.notification_id === 'string' && value.notification_id.trim().length > 0
        ? value.notification_id
        : typeof value.notificationId === 'string' && value.notificationId.trim().length > 0
          ? value.notificationId
          : null,
    status: statusValue,
    payload: toJsonObject(value.payload),
  };
}

export function normalizeOrderLaterQueue(raw: unknown): OrderLaterItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => normalizeOrderLaterItem(item))
    .filter((item): item is OrderLaterItem => Boolean(item))
    .filter((item) => item.status === 'queued')
    .sort((a, b) => {
      const aTime = new Date(a.scheduledAt).getTime();
      const bTime = new Date(b.scheduledAt).getTime();
      return aTime - bTime;
    });
}
