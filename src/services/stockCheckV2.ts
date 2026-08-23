import { supabase } from '@/lib/supabase';

export type StockCheckEntryMode = 'numeric' | 'status';
export type StockCheckStatusValue = 'full' | 'low' | 'out';

export interface StockCheckAreaProgress {
  itemsTotal: number;
  itemsChecked: number;
  itemsSkipped: number;
  skippedItemIds: string[];
  lastEntryMode: StockCheckEntryMode | null;
  completedAt: string | null;
}

export interface StockCheckSessionV2 {
  id: string;
  areaId: string;
  locationId: string;
  currentAreaId: string | null;
  userId: string;
  startedAt: string;
  completedAt: string | null;
  status: 'in_progress' | 'completed' | 'abandoned';
  itemsChecked: number;
  itemsSkipped: number;
  itemsTotal: number;
  entryMode: StockCheckEntryMode | null;
  areaProgress: Record<string, StockCheckAreaProgress>;
}

export interface GuidedStockCheckItem {
  areaItemId: string;
  inventoryItemId: string;
  name: string;
  countUnit: string;
  orderUnit: string | null;
  orderUnitSize: number | null;
  parLevel: number | null;
  reorderPoint: number | null;
  currentQuantity: number;
  shelfSortOrder: number;
  count: {
    quantity: number;
    entryMode: StockCheckEntryMode;
    statusValue: StockCheckStatusValue | null;
  } | null;
}

export interface GuidedStockCheckArea {
  id: string;
  name: string;
  sortOrder: number;
  progress: StockCheckAreaProgress;
  items: GuidedStockCheckItem[];
}

export interface GuidedStockCheck {
  session: StockCheckSessionV2;
  areas: GuidedStockCheckArea[];
}

export interface StockCheckPar {
  areaItemId: string;
  inventoryItemId: string;
  areaId: string;
  areaName: string;
  itemName: string;
  parLevel: number | null;
  reorderPoint: number | null;
  countUnit: string;
  orderUnit: string | null;
  orderUnitSize: number | null;
  shelfSortOrder: number;
}

export interface StockCheckSuggestion {
  areaItemId: string;
  itemId: string;
  itemName: string;
  suggestedQty: number;
  unit: string;
  countedQty: number;
  parLevel: number;
  reorderPoint: number;
}

export type StockCheckCountInput =
  | {
      entryMode: 'numeric';
      quantity: number;
    }
  | {
      entryMode: 'status';
      status: StockCheckStatusValue;
    };

export interface StockCheckCountResult {
  stockUpdateId: string;
  areaItemId: string;
  quantity: number;
  entryMode: StockCheckEntryMode;
  statusValue: StockCheckStatusValue | null;
  session: StockCheckSessionV2;
}

type SessionRow = {
  id: string;
  area_id: string;
  location_id: string;
  current_area_id: string | null;
  user_id: string;
  started_at: string;
  completed_at: string | null;
  status: StockCheckSessionV2['status'];
  items_checked: number | string;
  items_skipped: number | string;
  items_total: number | string;
  entry_mode: StockCheckEntryMode | null;
  area_progress: unknown;
};

type StorageAreaRow = {
  id: string;
  name: string;
  sort_order: number | string | null;
};

type InventoryItemRow = {
  id: string;
  name: string;
};

type AreaItemRow = {
  id: string;
  area_id: string;
  inventory_item_id: string;
  par_level: number | string | null;
  reorder_point: number | string | null;
  current_quantity: number | string | null;
  unit_type: string | null;
  order_unit: string | null;
  conversion_factor: number | string | null;
  shelf_sort_order: number | string | null;
  inventory_item: InventoryItemRow | InventoryItemRow[] | null;
};

type StockUpdateRow = {
  id: string;
  area_item_id: string | null;
  new_quantity: number | string;
  entry_mode: StockCheckEntryMode | null;
  status_value: StockCheckStatusValue | null;
};

type SuggestionRow = {
  area_item_id: string;
  item_id: string;
  item_name: string;
  suggested_qty: number | string;
  unit: string;
  counted_qty: number | string;
  par_level: number | string;
  reorder_point: number | string;
};

type RecordCountRpcRow = {
  stock_update_id: string;
  area_item_id: string;
  quantity: number | string;
  entry_mode: StockCheckEntryMode;
  status_value: StockCheckStatusValue | null;
  session: SessionRow;
};

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = finiteNumber(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asInventoryItem(value: AreaItemRow['inventory_item']): InventoryItemRow | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function asEntryMode(value: unknown): StockCheckEntryMode | null {
  return value === 'numeric' || value === 'status' ? value : null;
}

function asStatusValue(value: unknown): StockCheckStatusValue | null {
  return value === 'full' || value === 'low' || value === 'out' ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function toProgress(value: unknown): StockCheckAreaProgress {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const entryMode = asEntryMode(row.last_entry_mode);

  return {
    itemsTotal: Math.max(0, finiteNumber(row.items_total)),
    itemsChecked: Math.max(0, finiteNumber(row.items_checked)),
    itemsSkipped: Math.max(0, finiteNumber(row.items_skipped)),
    skippedItemIds: asStringArray(row.skipped_item_ids),
    lastEntryMode: entryMode,
    completedAt: nullableText(row.completed_at),
  };
}

function toAreaProgressMap(value: unknown): Record<string, StockCheckAreaProgress> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([areaId, progress]) => [
      areaId,
      toProgress(progress),
    ]),
  );
}

function fallbackProgress(itemsTotal = 0): StockCheckAreaProgress {
  return {
    itemsTotal,
    itemsChecked: 0,
    itemsSkipped: 0,
    skippedItemIds: [],
    lastEntryMode: null,
    completedAt: null,
  };
}

function mapSession(row: SessionRow): StockCheckSessionV2 {
  return {
    id: row.id,
    areaId: row.area_id,
    locationId: row.location_id,
    currentAreaId: row.current_area_id,
    userId: row.user_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    status: row.status,
    itemsChecked: Math.max(0, finiteNumber(row.items_checked)),
    itemsSkipped: Math.max(0, finiteNumber(row.items_skipped)),
    itemsTotal: Math.max(0, finiteNumber(row.items_total)),
    entryMode: asEntryMode(row.entry_mode),
    areaProgress: toAreaProgressMap(row.area_progress),
  };
}

function mapSuggestion(row: SuggestionRow): StockCheckSuggestion {
  return {
    areaItemId: row.area_item_id,
    itemId: row.item_id,
    itemName: row.item_name,
    suggestedQty: Math.max(0, finiteNumber(row.suggested_qty)),
    unit: nullableText(row.unit) ?? 'each',
    countedQty: Math.max(0, finiteNumber(row.counted_qty)),
    parLevel: Math.max(0, finiteNumber(row.par_level)),
    reorderPoint: Math.max(0, finiteNumber(row.reorder_point)),
  };
}

/**
 * Fast-state quantity mapping shared by UI previews and the database RPC.
 *
 * Low is one whole numpad step below the configured reorder point so it
 * remains a real "below point" state. The database has the authoritative
 * implementation; this helper gives the client an immediate preview.
 */
export function mapStockCheckStatusToQuantity(input: {
  status: StockCheckStatusValue;
  parLevel: number | null | undefined;
  reorderPoint: number | null | undefined;
  legacyMinQuantity?: number | null | undefined;
  legacyMaxQuantity?: number | null | undefined;
}): number {
  const parLevel = Math.max(0, finiteNumber(input.parLevel ?? input.legacyMaxQuantity));
  const reorderPoint = Math.max(
    0,
    finiteNumber(input.reorderPoint ?? input.legacyMinQuantity ?? parLevel / 2),
  );

  switch (input.status) {
    case 'full':
      return parLevel;
    case 'low':
      return Math.max(0, reorderPoint - 1);
    case 'out':
      return 0;
  }
}

/**
 * Phase 9a's suggestion rule: only a count below the reorder point is
 * proposed, then the deficit to par is rounded up to an order-unit multiple.
 * `orderUnitSize` is the number of counted units represented by one order unit.
 */
export function calculateSuggestedOrderQty(input: {
  countedQty: number;
  parLevel: number | null | undefined;
  reorderPoint: number | null | undefined;
  orderUnitSize?: number | null | undefined;
}): number {
  const countedQty = Math.max(0, finiteNumber(input.countedQty));
  const parLevel = Math.max(0, finiteNumber(input.parLevel));
  const reorderPoint = nullableNumber(input.reorderPoint);
  const orderUnitSize = finiteNumber(input.orderUnitSize, 1);
  const safeOrderUnitSize = orderUnitSize > 0 ? orderUnitSize : 1;

  if (reorderPoint === null || countedQty >= reorderPoint || countedQty >= parLevel) {
    return 0;
  }

  return Math.ceil((parLevel - countedQty) / safeOrderUnitSize);
}

function requireNonEmptyId(value: string, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

/** Start a new location-wide guided walk or return the caller's resumable one. */
export async function startOrResumeStockCheck(locationId: string): Promise<StockCheckSessionV2> {
  const { data, error } = await supabase.rpc('start_or_resume_stock_check', {
    p_location_id: requireNonEmptyId(locationId, 'Location ID'),
  });

  if (error) throw error;
  if (!data || typeof data !== 'object') {
    throw new Error('Stock check could not be started.');
  }

  return mapSession(data as SessionRow);
}

/** Load ordered areas/items plus the persisted guided-walk progress. */
export async function getGuidedStockCheck(sessionId: string): Promise<GuidedStockCheck> {
  const normalizedSessionId = requireNonEmptyId(sessionId, 'Stock-check session ID');
  const { data: sessionData, error: sessionError } = await supabase
    .from('stock_check_sessions')
    .select(`
      id,area_id,location_id,current_area_id,user_id,started_at,completed_at,
      status,items_checked,items_skipped,items_total,entry_mode,area_progress
    `)
    .eq('id', normalizedSessionId)
    .single();

  if (sessionError) throw sessionError;
  if (!sessionData) throw new Error('Stock-check session was not found.');

  const session = mapSession(sessionData as SessionRow);
  const areasResult = await supabase
    .from('storage_areas')
    .select('id,name,sort_order')
    .eq('location_id', session.locationId)
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (areasResult.error) throw areasResult.error;

  const areas = (areasResult.data ?? []) as StorageAreaRow[];
  const areaIds = areas.map((area) => area.id);
  const [itemsResult, countsResult] = await Promise.all([
    supabase
      .from('area_items')
      .select(`
        id,area_id,inventory_item_id,par_level,reorder_point,current_quantity,
        unit_type,order_unit,conversion_factor,shelf_sort_order,
        inventory_item:inventory_items(id,name)
      `)
      .in('area_id', areaIds)
      .eq('active', true)
      .order('shelf_sort_order', { ascending: true })
      .order('id', { ascending: true }),
    supabase
      .from('stock_updates')
      .select('id,area_item_id,new_quantity,entry_mode,status_value')
      .eq('stock_check_session_id', normalizedSessionId),
  ]);

  if (itemsResult.error) throw itemsResult.error;
  if (countsResult.error) throw countsResult.error;

  const areaIdSet = new Set(areaIds);
  const itemsByArea = new Map<string, GuidedStockCheckItem[]>();
  const countsByAreaItem = new Map<string, StockUpdateRow>();

  ((countsResult.data ?? []) as StockUpdateRow[]).forEach((count) => {
    if (count.area_item_id) countsByAreaItem.set(count.area_item_id, count);
  });

  ((itemsResult.data ?? []) as AreaItemRow[]).forEach((row) => {
    if (!areaIdSet.has(row.area_id)) return;
    const inventoryItem = asInventoryItem(row.inventory_item);
    if (!inventoryItem) return;

    const rawCount = countsByAreaItem.get(row.id);
    const entryMode = asEntryMode(rawCount?.entry_mode);
    const item: GuidedStockCheckItem = {
      areaItemId: row.id,
      inventoryItemId: row.inventory_item_id,
      name: inventoryItem.name,
      countUnit: nullableText(row.unit_type) ?? 'each',
      orderUnit: nullableText(row.order_unit),
      orderUnitSize: nullableNumber(row.conversion_factor),
      parLevel: nullableNumber(row.par_level),
      reorderPoint: nullableNumber(row.reorder_point),
      currentQuantity: Math.max(0, finiteNumber(row.current_quantity)),
      shelfSortOrder: finiteNumber(row.shelf_sort_order),
      count: rawCount && entryMode
        ? {
            quantity: Math.max(0, finiteNumber(rawCount.new_quantity)),
            entryMode,
            statusValue: asStatusValue(rawCount.status_value),
          }
        : null,
    };
    const existing = itemsByArea.get(row.area_id) ?? [];
    existing.push(item);
    itemsByArea.set(row.area_id, existing);
  });

  return {
    session,
    areas: areas.map((area) => {
      const items = (itemsByArea.get(area.id) ?? []).sort(
        (left, right) => left.shelfSortOrder - right.shelfSortOrder || left.name.localeCompare(right.name),
      );
      return {
        id: area.id,
        name: area.name,
        sortOrder: finiteNumber(area.sort_order),
        progress: session.areaProgress[area.id] ?? fallbackProgress(items.length),
        items,
      };
    }),
  };
}

export async function setStockCheckCurrentArea(
  sessionId: string,
  areaId: string,
): Promise<StockCheckSessionV2> {
  const { data, error } = await supabase.rpc('set_stock_check_current_area', {
    p_session_id: requireNonEmptyId(sessionId, 'Stock-check session ID'),
    p_area_id: requireNonEmptyId(areaId, 'Storage area ID'),
  });

  if (error) throw error;
  if (!data || typeof data !== 'object') throw new Error('Stock-check area could not be updated.');
  return mapSession(data as SessionRow);
}

export async function recordStockCheckCount(
  sessionId: string,
  areaItemId: string,
  input: StockCheckCountInput,
): Promise<StockCheckCountResult> {
  const sessionIdValue = requireNonEmptyId(sessionId, 'Stock-check session ID');
  const areaItemIdValue = requireNonEmptyId(areaItemId, 'Area item ID');

  if (input.entryMode === 'numeric' && (!Number.isFinite(input.quantity) || input.quantity < 0)) {
    throw new Error('Stock count must be a non-negative number.');
  }

  const { data, error } = await supabase.rpc('record_stock_check_count', {
    p_session_id: sessionIdValue,
    p_area_item_id: areaItemIdValue,
    p_entry_mode: input.entryMode,
    p_quantity: input.entryMode === 'numeric' ? input.quantity : null,
    p_status_value: input.entryMode === 'status' ? input.status : null,
  });

  if (error) throw error;
  if (!data || typeof data !== 'object') throw new Error('Stock count could not be recorded.');

  const row = data as RecordCountRpcRow;
  return {
    stockUpdateId: row.stock_update_id,
    areaItemId: row.area_item_id,
    quantity: Math.max(0, finiteNumber(row.quantity)),
    entryMode: row.entry_mode,
    statusValue: asStatusValue(row.status_value),
    session: mapSession(row.session),
  };
}

export async function skipStockCheckItem(
  sessionId: string,
  areaItemId: string,
): Promise<StockCheckSessionV2> {
  const { data, error } = await supabase.rpc('skip_stock_check_item', {
    p_session_id: requireNonEmptyId(sessionId, 'Stock-check session ID'),
    p_area_item_id: requireNonEmptyId(areaItemId, 'Area item ID'),
  });

  if (error) throw error;
  if (!data || typeof data !== 'object') throw new Error('Stock-check item could not be skipped.');
  return mapSession(data as SessionRow);
}

export async function completeStockCheck(sessionId: string): Promise<StockCheckSessionV2> {
  const { data, error } = await supabase.rpc('complete_stock_check', {
    p_session_id: requireNonEmptyId(sessionId, 'Stock-check session ID'),
  });

  if (error) throw error;
  if (!data || typeof data !== 'object') throw new Error('Stock check could not be completed.');
  return mapSession(data as SessionRow);
}

/** Manager-only under the existing area_items RLS policy. */
export async function getStockCheckPars(locationId: string): Promise<StockCheckPar[]> {
  const { data, error } = await supabase
    .from('area_items')
    .select(`
      id,area_id,inventory_item_id,par_level,reorder_point,unit_type,order_unit,
      conversion_factor,shelf_sort_order,
      area:storage_areas!inner(id,name,location_id),
      inventory_item:inventory_items(id,name)
    `)
    .eq('area.location_id', requireNonEmptyId(locationId, 'Location ID'))
    .eq('active', true)
    .order('shelf_sort_order', { ascending: true });

  if (error) throw error;

  return ((data ?? []) as Array<AreaItemRow & {
    area: { id: string; name: string; location_id: string } | null;
  }>).flatMap((row) => {
    const area = row.area;
    const inventoryItem = asInventoryItem(row.inventory_item);
    if (!area || !inventoryItem) return [];

    return [{
      areaItemId: row.id,
      inventoryItemId: row.inventory_item_id,
      areaId: area.id,
      areaName: area.name,
      itemName: inventoryItem.name,
      parLevel: nullableNumber(row.par_level),
      reorderPoint: nullableNumber(row.reorder_point),
      countUnit: nullableText(row.unit_type) ?? 'each',
      orderUnit: nullableText(row.order_unit),
      orderUnitSize: nullableNumber(row.conversion_factor),
      shelfSortOrder: finiteNumber(row.shelf_sort_order),
    }];
  });
}

/** Manager-only under the existing area_items RLS policy. */
export async function updateStockCheckPars(input: {
  areaItemId: string;
  parLevel: number;
  reorderPoint: number;
  orderUnit?: string | null;
  orderUnitSize?: number | null;
  shelfSortOrder?: number;
}): Promise<StockCheckPar> {
  if (!Number.isFinite(input.parLevel) || input.parLevel < 0) {
    throw new Error('Par level must be a non-negative number.');
  }
  if (!Number.isFinite(input.reorderPoint) || input.reorderPoint < 0) {
    throw new Error('Reorder point must be a non-negative number.');
  }
  if (input.reorderPoint > input.parLevel) {
    throw new Error('Reorder point cannot be greater than the par level.');
  }
  if (
    input.orderUnitSize !== undefined
    && input.orderUnitSize !== null
    && (!Number.isFinite(input.orderUnitSize) || input.orderUnitSize <= 0)
  ) {
    throw new Error('Order-unit size must be greater than zero.');
  }

  const payload = {
    par_level: input.parLevel,
    reorder_point: input.reorderPoint,
    ...(input.orderUnit !== undefined ? { order_unit: input.orderUnit?.trim() || null } : {}),
    ...(input.orderUnitSize !== undefined ? { conversion_factor: input.orderUnitSize } : {}),
    ...(input.shelfSortOrder !== undefined ? { shelf_sort_order: Math.max(0, Math.trunc(input.shelfSortOrder)) } : {}),
  };

  const { data, error } = await supabase
    .from('area_items')
    .update(payload)
    .eq('id', requireNonEmptyId(input.areaItemId, 'Area item ID'))
    .select(`
      id,area_id,inventory_item_id,par_level,reorder_point,unit_type,order_unit,
      conversion_factor,shelf_sort_order,
      area:storage_areas(id,name,location_id),
      inventory_item:inventory_items(id,name)
    `)
    .single();

  if (error) throw error;
  if (!data) throw new Error('Stock-check pars could not be saved.');

  const row = data as AreaItemRow & {
    area: { id: string; name: string; location_id: string } | { id: string; name: string; location_id: string }[] | null;
  };
  const area = Array.isArray(row.area) ? row.area[0] : row.area;
  const inventoryItem = asInventoryItem(row.inventory_item);
  if (!area || !inventoryItem) throw new Error('Saved stock-check pars are incomplete.');

  return {
    areaItemId: row.id,
    inventoryItemId: row.inventory_item_id,
    areaId: area.id,
    areaName: area.name,
    itemName: inventoryItem.name,
    parLevel: nullableNumber(row.par_level),
    reorderPoint: nullableNumber(row.reorder_point),
    countUnit: nullableText(row.unit_type) ?? 'each',
    orderUnit: nullableText(row.order_unit),
    orderUnitSize: nullableNumber(row.conversion_factor),
    shelfSortOrder: finiteNumber(row.shelf_sort_order),
  };
}

export async function suggestOrderFromCheck(sessionId: string): Promise<StockCheckSuggestion[]> {
  const { data, error } = await supabase.rpc('suggest_order_from_check', {
    p_session_id: requireNonEmptyId(sessionId, 'Stock-check session ID'),
  });

  if (error) throw error;
  return ((data ?? []) as SuggestionRow[]).map(mapSuggestion);
}

/** Seed/refresh the caller's Phase 5 checklist with check-derived selections. */
export async function createChecklistFromCheck(sessionId: string): Promise<{ checklistId: string }> {
  const { data, error } = await supabase.rpc('create_order_checklist_from_stock_check', {
    p_session_id: requireNonEmptyId(sessionId, 'Stock-check session ID'),
  });

  if (error) throw error;
  const checklistId = typeof data === 'string' ? data : null;
  if (!checklistId) throw new Error('Order checklist could not be created from this stock check.');
  return { checklistId };
}
