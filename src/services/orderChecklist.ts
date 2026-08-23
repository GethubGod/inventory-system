import { supabase } from '@/lib/supabase';
import {
  buildLocationGroupHeading,
  buildSendAllMessage,
  type InventoryUnitInfo,
  type SendAllRegularItem,
} from '@/features/fulfillment/sendAll/sendAllMessage';
import { DEFAULT_EXPORT_FORMAT_SETTINGS } from '@/types/settings';
import { generateUUID, submitOrder } from './orderSubmission';
import { listSupplierContacts, type SupplierContact } from './supplierContacts';
import {
  loadSupplierLookup,
  resolveOrderItemSupplier,
  type SupplierLookupMaps,
} from './supplierResolver';

export interface ChecklistItem {
  id: string;
  itemId: string | null;
  itemName: string;
  unit: string;
  defaultChecked: boolean;
  recommendedQty: number | null;
  stalenessBucket: 'frequent' | 'occasional' | 'rare';
  lastOrderedAt: string | null;
  sortOrder: number;
}

export interface Checklist {
  id: string;
  locationGroup: 'sushi' | 'poki';
  generatedAt: string;
  items: ChecklistItem[];
}

export interface ChecklistSendLine {
  itemId: string | null;
  itemName: string;
  unit: string;
  quantity: number;
}

/** One checked line of the current selection, for save-as-default. */
export interface ChecklistDefaultLine {
  /** order_checklist_items row id when the line came from the checklist. */
  checklistItemId: string | null;
  itemId: string | null;
  itemName: string;
  unit: string;
  quantity: number;
}

export interface DirectSendGroup {
  supplierId: string | null;
  supplierName: string;
  contact: SupplierContact | null;
  lines: ChecklistSendLine[];
  messageText: string;
  /** Free-text note the employee attached to this send (already appended to messageText). */
  orderNote?: string | null;
  /**
   * Location group of the checklist the send originated from. Optional for
   * backward compatibility; when present it is archived on the history rows
   * so generate_order_checklist can see direct-send orders (F4).
   */
  locationGroup?: Checklist['locationGroup'] | null;
}

type LocationGroup = Checklist['locationGroup'];

type ChecklistItemRow = {
  id: string;
  item_id: string | null;
  item_name: string;
  unit: string;
  default_checked: boolean;
  recommended_qty: number | string | null;
  staleness_bucket: ChecklistItem['stalenessBucket'];
  last_ordered_at: string | null;
  sort_order: number | string;
};

type ChecklistRow = {
  id: string;
  location_group: LocationGroup;
  generated_at: string;
  order_checklist_items: ChecklistItemRow[] | null;
};

type InventoryUnitRow = {
  id: string;
  base_unit: string | null;
  pack_unit: string | null;
};

type InventoryDirectSendRow = InventoryUnitRow & Record<string, unknown>;

type PastOrderInsertRow = {
  id: string;
  created_at: string | null;
};

const UNASSIGNED_SUPPLIER_NAME = 'Unassigned';
// past_order_items.supplier_id is non-null for historical lookup indexing.
// Keep parent supplier_id null (the DirectSendGroup contract) and use this
// stable bucket only for the required child-column value.
const UNASSIGNED_HISTORY_SUPPLIER_ID = 'unassigned';

function toNumberOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function toSortOrder(value: number | string): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function mapChecklistItem(row: ChecklistItemRow): ChecklistItem {
  return {
    id: row.id,
    itemId: row.item_id,
    itemName: row.item_name,
    unit: row.unit,
    defaultChecked: row.default_checked,
    recommendedQty: toNumberOrNull(row.recommended_qty),
    stalenessBucket: row.staleness_bucket,
    lastOrderedAt: row.last_ordered_at,
    sortOrder: toSortOrder(row.sort_order),
  };
}

function mapChecklist(row: ChecklistRow): Checklist {
  return {
    id: row.id,
    locationGroup: row.location_group,
    generatedAt: row.generated_at,
    items: (row.order_checklist_items ?? [])
      .map(mapChecklistItem)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.itemName.localeCompare(right.itemName)),
  };
}

async function getCurrentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();

  if (error) throw error;

  const userId = data.user?.id;
  if (!userId) {
    throw new Error('You must be signed in to use an order checklist.');
  }

  return userId;
}

async function fetchChecklist(userId: string, locationGroup: LocationGroup): Promise<Checklist | null> {
  const { data, error } = await supabase
    .from('order_checklists')
    .select(`
      id,
      location_group,
      generated_at,
      order_checklist_items(
        id,
        item_id,
        item_name,
        unit,
        default_checked,
        recommended_qty,
        staleness_bucket,
        last_ordered_at,
        sort_order
      )
    `)
    .eq('user_id', userId)
    .eq('location_group', locationGroup)
    .maybeSingle();

  if (error) throw error;
  return data ? mapChecklist(data as ChecklistRow) : null;
}

async function generateChecklist(userId: string, locationGroup: LocationGroup): Promise<void> {
  const { error } = await supabase.rpc('generate_order_checklist', {
    p_user_id: userId,
    p_location_group: locationGroup,
  });

  if (error) throw error;
}

async function requireChecklistAfterGeneration(
  userId: string,
  locationGroup: LocationGroup,
): Promise<Checklist> {
  const checklist = await fetchChecklist(userId, locationGroup);
  if (!checklist) {
    throw new Error('Your order checklist could not be loaded after generation.');
  }
  return checklist;
}

export async function getOrGenerateMyChecklist(locationGroup: LocationGroup): Promise<Checklist> {
  const userId = await getCurrentUserId();
  const existing = await fetchChecklist(userId, locationGroup);
  if (existing) return existing;

  await generateChecklist(userId, locationGroup);
  return requireChecklistAfterGeneration(userId, locationGroup);
}

export async function regenerateMyChecklist(locationGroup: LocationGroup): Promise<Checklist> {
  const userId = await getCurrentUserId();
  await generateChecklist(userId, locationGroup);
  return requireChecklistAfterGeneration(userId, locationGroup);
}

function normalizeUnit(value: string | null | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase();
}

/**
 * Normalizes an order note for sending: trimmed, empty → null.
 */
export function normalizeOrderNote(note: string | null | undefined): string | null {
  const trimmed = (note ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Appends the employee's order note to a supplier message body. */
export function appendNoteToMessage(message: string, note: string | null | undefined): string {
  const normalized = normalizeOrderNote(note);
  if (!normalized) return message;
  return `${message.trimEnd()}\n\nNote: ${normalized}`;
}

export interface LineUnitMeta {
  /** Per-item note surfaced in today's fulfillment UI when the unit is overridden. */
  itemNote: string | null;
  /** Authoritative override recorded on order_items.unit_label. */
  override: { inventory_item_id: string; unit_label: string } | null;
}

/**
 * Unit metadata for a review-mode send line. A line whose unit matches the
 * inventory item's base or pack unit needs nothing (unit_type already carries
 * it); any other unit is a per-line override — recorded on the order line and
 * echoed as an item note so the manager sees it in the existing fulfillment
 * screens. The inventory item's own units are never modified.
 */
export function buildLineUnitMeta(
  line: ChecklistSendLine,
  inventoryItem: InventoryUnitRow | undefined,
): LineUnitMeta {
  if (!line.itemId || !inventoryItem) {
    return { itemNote: null, override: null };
  }
  const lineUnit = normalizeUnit(line.unit);
  if (
    lineUnit.length === 0 ||
    lineUnit === normalizeUnit(inventoryItem.base_unit) ||
    lineUnit === normalizeUnit(inventoryItem.pack_unit)
  ) {
    return { itemNote: null, override: null };
  }
  return {
    itemNote: `Ordered as ${formatMetaQuantity(line.quantity)} ${line.unit.trim()}`,
    override: { inventory_item_id: line.itemId, unit_label: line.unit.trim() },
  };
}

function formatMetaQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

/**
 * Upserts the current checked selection as the user's stored checklist default
 * (quantities into recommended_qty; unchecked rows keep their row but start
 * unchecked). Returns the number of saved lines.
 */
export async function saveChecklistAsDefault(
  locationGroup: LocationGroup,
  lines: ChecklistDefaultLine[],
): Promise<number> {
  if (lines.length === 0) {
    throw new Error('Check at least one item before saving it as your default.');
  }
  const payload = lines.map((line, index) => {
    const itemName = line.itemName?.trim();
    const unit = line.unit?.trim();
    if (!itemName || !unit) {
      throw new Error(`Checklist item ${index + 1} is missing a name or unit.`);
    }
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new Error(`Checklist item ${index + 1} has an invalid quantity.`);
    }
    return {
      id: line.checklistItemId,
      item_id: line.itemId,
      item_name: itemName,
      unit,
      quantity: line.quantity,
    };
  });

  const { data, error } = await supabase.rpc('save_my_checklist_default', {
    p_location_group: locationGroup,
    p_items: payload,
  });

  if (error) throw error;
  return typeof data === 'number' ? data : lines.length;
}

function unitTypeForLine(line: ChecklistSendLine, inventoryItem: InventoryUnitRow): 'base' | 'pack' {
  const lineUnit = normalizeUnit(line.unit);
  const packUnit = normalizeUnit(inventoryItem.pack_unit);

  return lineUnit.length > 0 && packUnit.length > 0 && lineUnit === packUnit
    ? 'pack'
    : 'base';
}

function normalizedDirectSendLine(line: ChecklistSendLine, index: number): ChecklistSendLine {
  const itemName = line.itemName?.trim();
  const unit = line.unit?.trim();
  const itemId = line.itemId?.trim() || null;

  if (!itemName) {
    throw new Error(`Checklist item ${index + 1} is missing a name.`);
  }
  if (!unit) {
    throw new Error(`Checklist item ${index + 1} is missing a unit.`);
  }
  if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
    throw new Error(`Checklist item ${index + 1} has an invalid quantity.`);
  }

  return { itemId, itemName, unit, quantity: line.quantity };
}

function normalizeDirectSendLines(lines: ChecklistSendLine[]): ChecklistSendLine[] {
  if (lines.length === 0) {
    throw new Error('Select at least one checklist item to send.');
  }

  return lines.map(normalizedDirectSendLine);
}

function emptySupplierLookup(): SupplierLookupMaps {
  return {
    suppliers: [],
    supplierById: new Map(),
    supplierByNameNormalized: new Map(),
  };
}

function toInventoryUnitInfo(inventoryItem: InventoryDirectSendRow): InventoryUnitInfo {
  return {
    id: inventoryItem.id,
    base_unit: inventoryItem.base_unit?.trim() || '',
    pack_unit: inventoryItem.pack_unit?.trim() || '',
    pack_size: 0,
  };
}

function buildDirectSendMessage(params: {
  supplierName: string;
  lines: ChecklistSendLine[];
  inventoryById: Map<string, InventoryDirectSendRow>;
}): string {
  const unitInfoById: Record<string, InventoryUnitInfo> = {};
  const regularItems: SendAllRegularItem[] = params.lines.map((line, index) => {
    const inventoryItem = line.itemId ? params.inventoryById.get(line.itemId) : undefined;
    const inventoryItemId = line.itemId || `unassigned-${index}`;

    if (inventoryItem) {
      unitInfoById[inventoryItemId] = toInventoryUnitInfo(inventoryItem);
    }

    return {
      id: `direct-${inventoryItemId}-${index}`,
      inventoryItemId,
      name: line.itemName,
      category: 'direct_send',
      // ChecklistSendLine intentionally has no location group. The Phase 1
      // builder needs one only to order sections; we remove its synthetic
      // single-group heading below, leaving its canonical item formatting.
      locationGroup: 'sushi',
      quantity: line.quantity,
      unitType: inventoryItem ? unitTypeForLine(line, inventoryItem) : 'base',
      unitLabel: line.unit,
      notes: [],
      sourceOrderItemIds: [],
      sourceOrderIds: [],
      sourceDraftItemIds: [],
    };
  });

  const message = buildSendAllMessage({
    template: DEFAULT_EXPORT_FORMAT_SETTINGS.template,
    supplierLabel: params.supplierName,
    regularItems,
    remainingItems: [],
    unitInfoById,
  });

  // Strip the builder's single synthetic group heading using the exported
  // heading format, so a heading change upstream cannot silently leave a
  // bogus section header in direct-send messages.
  return message.replace(`${buildLocationGroupHeading('sushi')}\n`, '');
}

/**
 * Builds one Phase 1-compatible send card per resolved supplier without
 * creating an order-review queue entry. Supplier selection uses the same
 * supplierResolver used by fulfillment; unresolved mappings intentionally
 * become the share-sheet-only Unassigned card.
 */
export async function prepareDirectSend(
  lines: ChecklistSendLine[],
  locationGroup?: LocationGroup,
  orderNote?: string | null,
): Promise<DirectSendGroup[]> {
  const normalizedNote = normalizeOrderNote(orderNote);
  const normalizedLines = normalizeDirectSendLines(lines);
  const itemIds = Array.from(
    new Set(
      normalizedLines
        .map((line) => line.itemId)
        .filter((itemId): itemId is string => Boolean(itemId)),
    ),
  );

  let inventoryRows: InventoryDirectSendRow[] = [];
  if (itemIds.length > 0) {
    const { data, error } = await supabase
      .from('inventory_items')
      // Match fulfillment's resolver input rather than assuming optional
      // supplier-name columns are present in every environment.
      .select('*')
      .in('id', itemIds);

    if (error) throw error;
    inventoryRows = (data ?? []) as InventoryDirectSendRow[];
  }

  const inventoryById = new Map(
    inventoryRows
      .filter((inventoryItem) => typeof inventoryItem.id === 'string' && inventoryItem.id.trim().length > 0)
      .map((inventoryItem) => [inventoryItem.id, inventoryItem]),
  );

  // Fulfillment deliberately leaves items visible under unresolved suppliers
  // when a lookup is temporarily unavailable. Direct send follows that same
  // safe behavior, with a share-sheet fallback instead of dropping a line.
  const [supplierLookup, contacts] = await Promise.all([
    loadSupplierLookup().catch(() => emptySupplierLookup()),
    listSupplierContacts().catch(() => []),
  ]);
  const contactBySupplierId = new Map(contacts.map((contact) => [contact.supplierId, contact]));
  const groups = new Map<
    string,
    Omit<DirectSendGroup, 'messageText'>
  >();

  normalizedLines.forEach((line) => {
    const inventoryItem = line.itemId ? inventoryById.get(line.itemId) : undefined;
    const resolution = inventoryItem
      ? resolveOrderItemSupplier({
          inventoryItem,
          orderItem: null,
          lookup: supplierLookup,
        })
      : null;
    const supplierId = resolution?.primarySupplierId ?? null;
    const supplierName = resolution?.primarySupplierName ?? UNASSIGNED_SUPPLIER_NAME;
    const key = supplierId ?? UNASSIGNED_HISTORY_SUPPLIER_ID;

    const existing = groups.get(key);
    if (existing) {
      existing.lines.push(line);
      return;
    }

    groups.set(key, {
      supplierId,
      supplierName,
      contact: supplierId ? contactBySupplierId.get(supplierId) ?? null : null,
      lines: [line],
      locationGroup: locationGroup ?? null,
      orderNote: normalizedNote,
    });
  });

  return Array.from(groups.values()).map((group) => ({
    ...group,
    messageText: appendNoteToMessage(
      buildDirectSendMessage({
        supplierName: group.supplierName,
        lines: group.lines,
        inventoryById,
      }),
      normalizedNote,
    ),
  }));
}

function directSendHistoryItemId(line: ChecklistSendLine, index: number): string {
  if (line.itemId) return line.itemId;

  const normalizedName = line.itemName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `unassigned:${normalizedName || 'item'}:${index + 1}`;
}

/**
 * Archives a completed direct-send card as the employee who sent it. This
 * writes the same parent/line-item history tables as fulfillment finalization
 * and intentionally never creates a submitted order or review-queue entry.
 */
export async function archiveDirectSend(
  group: DirectSendGroup,
  shareMethod: 'share' | 'copy',
): Promise<void> {
  const lines = normalizeDirectSendLines(group.lines);
  const userId = await getCurrentUserId();
  const now = new Date().toISOString();
  const supplierIdForHistory = group.supplierId ?? UNASSIGNED_HISTORY_SUPPLIER_ID;
  const itemIds = Array.from(
    new Set(lines.map((line) => line.itemId).filter((itemId): itemId is string => Boolean(itemId))),
  );

  let inventoryRows: InventoryUnitRow[] = [];
  if (itemIds.length > 0) {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('id,base_unit,pack_unit')
      .in('id', itemIds);
    if (error) throw error;
    inventoryRows = (data ?? []) as InventoryUnitRow[];
  }

  const inventoryById = new Map(inventoryRows.map((inventoryItem) => [inventoryItem.id, inventoryItem]));
  const regularItems = lines.map((line, index) => {
    const inventoryItem = line.itemId ? inventoryById.get(line.itemId) : undefined;
    const unitType = inventoryItem ? unitTypeForLine(line, inventoryItem) : null;

    return {
      id: `direct-${directSendHistoryItemId(line, index)}`,
      inventoryItemId: line.itemId,
      name: line.itemName,
      category: 'direct_send',
      quantity: line.quantity,
      unitType,
      unitLabel: line.unit,
      notes: [],
      sourceOrderItemIds: [],
      sourceOrderIds: [],
      sourceDraftItemIds: [],
    };
  });

  const payload = {
    regularItems,
    remainingItems: [],
    locations: [],
    sourceOrderIds: [],
    source_order_ids: [],
    sourceOrderItemIds: [],
    source_order_item_ids: [],
    totalItemCount: regularItems.length,
    finalizedAt: now,
    entryMethod: 'simple_checklist_direct',
    // Employee note for this send; also already appended to message_text.
    orderNote: normalizeOrderNote(group.orderNote),
  };

  const { data: pastOrderData, error: pastOrderError } = await supabase
    .from('past_orders')
    .insert({
      supplier_id: group.supplierId,
      supplier_name: group.supplierName || UNASSIGNED_SUPPLIER_NAME,
      created_by: userId,
      payload,
      message_text: group.messageText,
      share_method: shareMethod,
    })
    .select('id,created_at')
    .single();

  if (pastOrderError) throw pastOrderError;
  const pastOrder = pastOrderData as PastOrderInsertRow | null;
  if (!pastOrder?.id) {
    throw new Error('Direct send archive did not return a past order ID.');
  }

  const orderedAt = pastOrder.created_at || now;
  const historyRows = lines.map((line, index) => {
    const inventoryItem = line.itemId ? inventoryById.get(line.itemId) : undefined;

    return {
      past_order_id: pastOrder.id,
      supplier_id: supplierIdForHistory,
      created_by: userId,
      item_id: directSendHistoryItemId(line, index),
      item_name: line.itemName,
      unit: line.unit,
      quantity: line.quantity,
      location_id: null,
      location_name: null,
      // generate_order_checklist filters history on location_group, so
      // direct-send rows must carry it for the 5a feedback loop to see them.
      location_group: group.locationGroup ?? null,
      unit_type: inventoryItem ? unitTypeForLine(line, inventoryItem) : null,
      ordered_at: orderedAt,
      note: null,
    };
  });

  const { error: historyError } = await supabase
    .from('past_order_items')
    .insert(historyRows);
  if (historyError) throw historyError;
}

function validateSendLines(lines: ChecklistSendLine[]): asserts lines is Array<ChecklistSendLine & { itemId: string }> {
  if (lines.length === 0) {
    throw new Error('Select at least one checklist item to send.');
  }

  lines.forEach((line, index) => {
    if (!line.itemId) {
      throw new Error(`Checklist item ${index + 1} is not matched to inventory and cannot be sent.`);
    }
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new Error(`Checklist item ${index + 1} has an invalid quantity.`);
    }
  });
}

export async function sendChecklistOrder(
  checklistId: string,
  lines: ChecklistSendLine[],
  options?: { note?: string | null },
): Promise<{ orderId: string }> {
  if (!checklistId.trim()) {
    throw new Error('Missing checklist ID.');
  }
  validateSendLines(lines);
  const orderNote = normalizeOrderNote(options?.note);

  const userId = await getCurrentUserId();
  const { data: checklistRow, error: checklistError } = await supabase
    .from('order_checklists')
    .select('id')
    .eq('id', checklistId)
    .eq('user_id', userId)
    .single();

  if (checklistError) throw checklistError;
  if (!checklistRow) throw new Error('Order checklist was not found.');

  // submit_order_rpc authorizes employees against their configured default
  // location. A checklist is per employee and group, but the schema does not
  // duplicate a location ID, so that authoritative assignment is used here.
  const { data: userRow, error: userError } = await supabase
    .from('users')
    .select('default_location_id')
    .eq('id', userId)
    .single();

  if (userError) throw userError;
  const locationId = (userRow as { default_location_id?: string | null } | null)?.default_location_id;
  if (!locationId) {
    throw new Error('Your account does not have a default location for ordering.');
  }

  const itemIds = Array.from(new Set(lines.map((line) => line.itemId)));
  const { data: inventoryRows, error: inventoryError } = await supabase
    .from('inventory_items')
    .select('id, base_unit, pack_unit')
    .in('id', itemIds);

  if (inventoryError) throw inventoryError;

  const inventoryById = new Map(
    ((inventoryRows ?? []) as InventoryUnitRow[]).map((inventoryItem) => [inventoryItem.id, inventoryItem]),
  );

  const unitOverrides: { inventory_item_id: string; unit_label: string }[] = [];
  const items = lines.map((line) => {
    const inventoryItem = inventoryById.get(line.itemId);
    if (!inventoryItem) {
      throw new Error(`Checklist item "${line.itemName}" is no longer available in inventory.`);
    }

    // A unit that is neither the item's base nor pack unit is a per-line
    // override: submit_order_rpc only knows base|pack, so the chosen unit is
    // echoed as an item note (visible in today's fulfillment screens) and
    // recorded on order_items.unit_label right after submit.
    const unitMeta = buildLineUnitMeta(line, inventoryItem);
    if (unitMeta.override) unitOverrides.push(unitMeta.override);

    return {
      inventory_item_id: line.itemId,
      quantity: line.quantity,
      unit_type: unitTypeForLine(line, inventoryItem),
      input_mode: 'quantity',
      quantity_requested: line.quantity,
      remaining_reported: null,
      decided_quantity: null,
      decided_by: null,
      decided_at: null,
      note: unitMeta.itemNote,
    };
  });

  const result = await submitOrder({
    orderId: generateUUID(),
    locationId,
    userId,
    status: 'submitted',
    items,
    entryMethod: 'simple_checklist',
    quickSessionId: null,
  });

  if (orderNote || unitOverrides.length > 0) {
    const { error: metaError } = await supabase.rpc('set_my_order_meta', {
      p_order_id: result.order.id,
      p_note: orderNote,
      p_unit_overrides: unitOverrides.length > 0 ? unitOverrides : null,
    });
    if (metaError) {
      // The order itself went through; surface the metadata failure without
      // pretending the send failed.
      console.warn('[Checklist] Order sent but its note/unit metadata failed to save.', metaError);
    }
  }

  return { orderId: result.order.id };
}
