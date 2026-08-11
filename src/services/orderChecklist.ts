import { supabase } from '@/lib/supabase';
import { generateUUID, submitOrder } from './orderSubmission';

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

function unitTypeForLine(line: ChecklistSendLine, inventoryItem: InventoryUnitRow): 'base' | 'pack' {
  const lineUnit = normalizeUnit(line.unit);
  const packUnit = normalizeUnit(inventoryItem.pack_unit);

  return lineUnit.length > 0 && packUnit.length > 0 && lineUnit === packUnit
    ? 'pack'
    : 'base';
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
): Promise<{ orderId: string }> {
  if (!checklistId.trim()) {
    throw new Error('Missing checklist ID.');
  }
  validateSendLines(lines);

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

  const items = lines.map((line) => {
    const inventoryItem = inventoryById.get(line.itemId);
    if (!inventoryItem) {
      throw new Error(`Checklist item "${line.itemName}" is no longer available in inventory.`);
    }

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
      note: null,
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

  return { orderId: result.order.id };
}
