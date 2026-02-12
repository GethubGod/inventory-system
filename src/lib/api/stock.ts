import { supabase } from '@/lib/supabase';
import {
  AreaItemWithDetails,
  CheckFrequency,
  InventoryItem,
  Location,
  StockCheckSession,
  StockScanMethod,
  StockUpdate,
  StockUpdateMethod,
  StorageArea,
  QuickSelectValue,
} from '@/types';

export interface StorageAreaWithCount extends StorageArea {
  item_count: number;
}

export type AreaItemWithInventory = Omit<AreaItemWithDetails, 'stock_level'>;

export interface InventoryWithStock {
  id: string;
  inventory_item: InventoryItem;
  location: Location;
  area_ids: string[];
  area_names: string[];
  areas: {
    id: string;
    name: string;
    check_frequency: CheckFrequency;
    last_checked_at: string | null;
  }[];
  current_quantity: number;
  min_quantity: number;
  max_quantity: number;
  unit_type: string;
  last_updated_at: string | null;
}

interface CreateSessionInput {
  area_id: string;
  user_id: string;
  scan_method: StockScanMethod;
  items_total?: number;
}

interface UpdateSessionInput {
  status?: StockCheckSession['status'];
  completed_at?: string | null;
  items_checked?: number;
  items_skipped?: number;
  items_total?: number;
}

interface SaveStockUpdateInput {
  area_id: string;
  inventory_item_id: string;
  previous_quantity: number | null;
  new_quantity: number;
  updated_by: string;
  update_method: StockUpdateMethod;
  quick_select_value?: QuickSelectValue | null;
  photo_url?: string | null;
  notes?: string | null;
  created_at?: string;
}

interface UpdateAreaItemQuantityOptions {
  updated_by?: string | null;
  updated_at?: string;
}

interface UpdateStorageAreaOptions {
  last_checked_by?: string | null;
  last_checked_at?: string;
}

function extractMissingSchemaColumn(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const err = error as { code?: string; message?: string };
  if (err.code !== 'PGRST204') return null;
  const message = typeof err.message === 'string' ? err.message : '';
  const matches = Array.from(message.matchAll(/'([^']+)'/g)).map((match) => match[1]);
  return matches.length > 0 ? matches[0] : null;
}

export async function getStorageAreas(locationId: string): Promise<StorageAreaWithCount[]> {
  const { data, error } = await supabase
    .from('storage_areas')
    .select(
      `
        *,
        area_items(count)
      `
    )
    .eq('location_id', locationId)
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw error;

  return (data || []).map((area: any) => {
    const { area_items, ...rest } = area;
    const count = Array.isArray(area_items) ? area_items[0]?.count ?? 0 : 0;
    return {
      ...(rest as StorageArea),
      item_count: count,
    };
  });
}

export async function getAreaItems(areaId: string): Promise<AreaItemWithInventory[]> {
  const { data, error } = await supabase
    .from('area_items')
    .select(
      `
        *,
        inventory_item:inventory_items(*)
      `
    )
    .eq('area_id', areaId)
    .eq('active', true);

  if (error) throw error;

  return (data || []) as AreaItemWithInventory[];
}

export async function createStockCheckSession(
  input: CreateSessionInput
): Promise<StockCheckSession> {
  const { data, error } = await supabase
    .from('stock_check_sessions')
    .insert({
      area_id: input.area_id,
      user_id: input.user_id,
      scan_method: input.scan_method,
      status: 'in_progress',
      items_checked: 0,
      items_skipped: 0,
      items_total: input.items_total ?? 0,
    })
    .select()
    .single();

  if (error) throw error;
  if (!data) throw new Error('Failed to create stock check session');

  return data as StockCheckSession;
}

export async function updateStockCheckSession(
  sessionId: string,
  updates: UpdateSessionInput
): Promise<StockCheckSession> {
  const { data, error } = await supabase
    .from('stock_check_sessions')
    .update(updates)
    .eq('id', sessionId)
    .select()
    .single();

  if (error) throw error;
  if (!data) throw new Error('Failed to update stock check session');

  return data as StockCheckSession;
}

export async function saveStockUpdate(input: SaveStockUpdateInput): Promise<StockUpdate> {
  const { data, error } = await supabase
    .from('stock_updates')
    .insert({
      area_id: input.area_id,
      inventory_item_id: input.inventory_item_id,
      previous_quantity: input.previous_quantity,
      new_quantity: input.new_quantity,
      updated_by: input.updated_by,
      update_method: input.update_method,
      quick_select_value: input.quick_select_value ?? null,
      photo_url: input.photo_url ?? null,
      notes: input.notes ?? null,
      created_at: input.created_at,
    })
    .select()
    .single();

  if (error) throw error;
  if (!data) throw new Error('Failed to save stock update');

  return data as StockUpdate;
}

export async function updateAreaItemQuantity(
  areaItemId: string,
  quantity: number,
  options: UpdateAreaItemQuantityOptions = {}
): Promise<void> {
  const payload: Record<string, unknown> = {
    current_quantity: quantity,
    last_updated_at: options.updated_at ?? new Date().toISOString(),
    last_updated_by: options.updated_by ?? null,
  };

  let attempts = 0;
  while (attempts < 3) {
    const { error } = await supabase
      .from('area_items')
      .update(payload as any)
      .eq('id', areaItemId);

    if (!error) return;

    const missingColumn = extractMissingSchemaColumn(error);
    if (
      missingColumn &&
      (missingColumn === 'last_updated_at' || missingColumn === 'last_updated_by') &&
      Object.prototype.hasOwnProperty.call(payload, missingColumn)
    ) {
      delete payload[missingColumn];
      attempts += 1;
      continue;
    }

    throw error;
  }

  throw new Error('Unable to update area item quantity with current schema.');
}

export async function updateStorageAreaLastChecked(
  areaId: string,
  options: UpdateStorageAreaOptions = {}
): Promise<void> {
  const payload: Record<string, unknown> = {
    last_checked_at: options.last_checked_at ?? new Date().toISOString(),
    last_checked_by: options.last_checked_by ?? null,
  };

  let attempts = 0;
  while (attempts < 3) {
    if (Object.keys(payload).length === 0) {
      return;
    }

    const { error } = await supabase
      .from('storage_areas')
      .update(payload as any)
      .eq('id', areaId);

    if (!error) return;

    const missingColumn = extractMissingSchemaColumn(error);
    if (
      missingColumn &&
      (missingColumn === 'last_checked_at' || missingColumn === 'last_checked_by') &&
      Object.prototype.hasOwnProperty.call(payload, missingColumn)
    ) {
      delete payload[missingColumn];
      attempts += 1;
      continue;
    }

    throw error;
  }

  throw new Error('Unable to update storage area check metadata with current schema.');
}

export async function getReorderSuggestions(
  locationId: string
): Promise<AreaItemWithDetails[]> {
  const { data: areas, error: areaError } = await supabase
    .from('storage_areas')
    .select('id')
    .eq('location_id', locationId)
    .eq('active', true);

  if (areaError) throw areaError;

  const areaIds = (areas || []).map((area) => area.id);
  if (areaIds.length === 0) return [];

  const { data, error } = await supabase
    .from('area_items')
    .select(
      `
        *,
        inventory_item:inventory_items(*)
      `
    )
    .in('area_id', areaIds);

  if (error) throw error;

  return (data || [])
    .filter((item) => item.current_quantity < item.min_quantity)
    .map((item) => item as AreaItemWithDetails);
}

export async function getStockHistory(
  areaId?: string,
  itemId?: string,
  limit = 50
): Promise<StockUpdate[]> {
  let query = supabase
    .from('stock_updates')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (areaId) {
    query = query.eq('area_id', areaId);
  }

  if (itemId) {
    query = query.eq('inventory_item_id', itemId);
  }

  const { data, error } = await query;

  if (error) throw error;

  return (data || []) as StockUpdate[];
}

export async function getInventoryWithStock(locationId?: string): Promise<InventoryWithStock[]> {
  const fullSelect = `
    id,
    active,
    current_quantity,
    min_quantity,
    max_quantity,
    par_level,
    unit_type,
    order_unit,
    conversion_factor,
    last_updated_at,
    inventory_item:inventory_items(*),
    area:storage_areas(
      id,
      name,
      location_id,
      check_frequency,
      last_checked_at,
      location:locations(*)
    )
  `;

  const fallbackSelect = `
    id,
    active,
    current_quantity,
    min_quantity,
    max_quantity,
    par_level,
    unit_type,
    inventory_item:inventory_items(*),
    area:storage_areas(
      id,
      name,
      location_id,
      check_frequency,
      location:locations(*)
    )
  `;

  let data: any[] | null = null;
  let error: any = null;

  const fullAttempt = await supabase
    .from('area_items')
    .select(fullSelect)
    .eq('active', true);

  data = fullAttempt.data as any[] | null;
  error = fullAttempt.error;

  if (error && extractMissingSchemaColumn(error)) {
    const fallbackAttempt = await supabase
      .from('area_items')
      .select(fallbackSelect)
      .eq('active', true);
    data = fallbackAttempt.data as any[] | null;
    error = fallbackAttempt.error;
  }

  if (error) throw error;

  const rows = (data || []) as any[];
  const grouped = new Map<string, InventoryWithStock>();

  rows.forEach((row) => {
    const inventoryItem = row.inventory_item as InventoryItem;
    const area = row.area as {
      id: string;
      name: string;
      location_id: string;
      check_frequency: CheckFrequency;
      last_checked_at: string | null;
      location: Location;
    };
    if (!inventoryItem || !area?.id || !area?.location_id || !area?.location?.id) {
      return;
    }
    const key = `${inventoryItem.id}-${area.location_id}`;
    const current = Number(row.current_quantity ?? 0);
    const min = Number(row.min_quantity ?? 0);
    const max = Number(row.max_quantity ?? 0);
    const unit = row.unit_type || inventoryItem.base_unit || 'each';
    const lastUpdated = row.last_updated_at as string | null;

    if (!grouped.has(key)) {
      grouped.set(key, {
        id: key,
        inventory_item: inventoryItem,
        location: area.location,
        area_ids: [area.id],
        area_names: [area.name],
        areas: [
          {
            id: area.id,
            name: area.name,
            check_frequency: area.check_frequency,
            last_checked_at: area.last_checked_at,
          },
        ],
        current_quantity: current,
        min_quantity: min,
        max_quantity: max,
        unit_type: unit,
        last_updated_at: lastUpdated ?? null,
      });
      return;
    }

    const existing = grouped.get(key)!;
    existing.current_quantity += current;
    existing.min_quantity += min;
    existing.max_quantity += max;
    existing.area_ids = Array.from(new Set([...existing.area_ids, area.id]));
    existing.area_names = Array.from(new Set([...existing.area_names, area.name]));
    existing.areas = [
      ...existing.areas,
      {
        id: area.id,
        name: area.name,
        check_frequency: area.check_frequency,
        last_checked_at: area.last_checked_at,
      },
    ];
    if (lastUpdated && (!existing.last_updated_at || lastUpdated > existing.last_updated_at)) {
      existing.last_updated_at = lastUpdated;
    }
  });

  const result = Array.from(grouped.values());
  if (locationId) {
    return result.filter((item) => item.location.id === locationId);
  }
  return result;
}
