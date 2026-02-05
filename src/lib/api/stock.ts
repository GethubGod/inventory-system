import { supabase } from '@/lib/supabase';
import {
  AreaItemWithDetails,
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
    .eq('area_id', areaId);

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
  const { error } = await supabase
    .from('area_items')
    .update({
      current_quantity: quantity,
      last_updated_at: options.updated_at ?? new Date().toISOString(),
      last_updated_by: options.updated_by ?? null,
    })
    .eq('id', areaItemId);

  if (error) throw error;
}

export async function updateStorageAreaLastChecked(
  areaId: string,
  options: UpdateStorageAreaOptions = {}
): Promise<void> {
  const { error } = await supabase
    .from('storage_areas')
    .update({
      last_checked_at: options.last_checked_at ?? new Date().toISOString(),
      last_checked_by: options.last_checked_by ?? null,
    })
    .eq('id', areaId);

  if (error) throw error;
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
