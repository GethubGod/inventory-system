import { supabase } from '@/lib/supabase';

export type HolidayLocationGroup = 'sushi' | 'poki';
export type HolidayAdjustmentKind = 'add' | 'scale' | 'set_qty';

export interface HolidayTemplateInventoryItem {
  id: string;
  name: string;
  baseUnit: string | null;
  packUnit: string | null;
  defaultOrderUnit: string | null;
}

export interface HolidayTemplateItem {
  templateId: string;
  itemId: string;
  adjustmentKind: HolidayAdjustmentKind;
  quantity: number;
  note: string | null;
  inventoryItem: HolidayTemplateInventoryItem | null;
}

export interface HolidayTemplate {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  active: boolean;
  createdBy: string;
  createdAt: string | null;
  updatedAt: string | null;
  items: HolidayTemplateItem[];
}

export interface CreateHolidayTemplateInput {
  name: string;
  startsOn: string;
  endsOn: string;
  active?: boolean;
}

export interface UpdateHolidayTemplateInput {
  name?: string;
  startsOn?: string;
  endsOn?: string;
  active?: boolean;
}

export interface HolidayTemplateItemInput {
  itemId: string;
  adjustmentKind: HolidayAdjustmentKind;
  quantity: number;
  note?: string | null;
}

export interface ChecklistHolidayAdjustment {
  itemId: string;
  itemName: string;
  unit: string;
  adjustmentKind: HolidayAdjustmentKind;
  quantity: number;
}

/**
 * The active holiday banner and its non-persisted checklist adjustments.
 * A template can be active before its manager has added lines, so an active
 * template intentionally returns an empty `adjustments` array rather than
 * disappearing from the banner.
 */
export interface ChecklistHolidayOverlay {
  templateId: string;
  templateName: string;
  adjustments: ChecklistHolidayAdjustment[];
}

type Row = Record<string, any>;

const db = supabase as any;
const TEMPLATE_COLUMNS = 'id,name,starts_on,ends_on,active,created_by,created_at,updated_at';
const TEMPLATE_ITEM_COLUMNS = [
  'template_id',
  'item_id',
  'adjustment_kind',
  'quantity',
  'note',
  'inventory_item:inventory_items(id,name,base_unit,pack_unit,default_order_unit)',
].join(',');
const TEMPLATE_WITH_ITEMS_COLUMNS = `${TEMPLATE_COLUMNS},holiday_template_items(${TEMPLATE_ITEM_COLUMNS})`;

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function relatedRow(value: unknown): Row | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value && typeof value === 'object' ? value as Row : null;
}

function asAdjustmentKind(value: unknown): HolidayAdjustmentKind {
  if (value === 'add' || value === 'scale' || value === 'set_qty') return value;
  throw new Error('Holiday template contains an invalid adjustment kind.');
}

function requireId(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function requireCalendarDate(value: string, field: string): string {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`${field} must be an ISO calendar date (YYYY-MM-DD).`);
  }

  const parsed = new Date(`${normalized}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new Error(`${field} must be an ISO calendar date (YYYY-MM-DD).`);
  }
  return normalized;
}

function requireQuantity(value: number, field = 'quantity'): number {
  const quantity = asNumber(value);
  if (quantity === null || quantity < 0) {
    throw new Error(`${field} must be a non-negative number.`);
  }
  return quantity;
}

function localCalendarDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeCreateInput(input: CreateHolidayTemplateInput) {
  const name = asString(input.name);
  if (!name) throw new Error('Holiday template name is required.');

  const startsOn = requireCalendarDate(input.startsOn, 'startsOn');
  const endsOn = requireCalendarDate(input.endsOn, 'endsOn');
  if (endsOn < startsOn) throw new Error('endsOn cannot be before startsOn.');

  return {
    name,
    starts_on: startsOn,
    ends_on: endsOn,
    active: input.active ?? true,
  };
}

function normalizeUpdateInput(input: UpdateHolidayTemplateInput): Row {
  const payload: Row = {};

  if (input.name !== undefined) {
    const name = asString(input.name);
    if (!name) throw new Error('Holiday template name is required.');
    payload.name = name;
  }
  if (input.startsOn !== undefined) payload.starts_on = requireCalendarDate(input.startsOn, 'startsOn');
  if (input.endsOn !== undefined) payload.ends_on = requireCalendarDate(input.endsOn, 'endsOn');
  if (input.active !== undefined) payload.active = input.active;

  if (Object.keys(payload).length === 0) throw new Error('Provide at least one holiday template field to update.');
  if (payload.starts_on && payload.ends_on && payload.ends_on < payload.starts_on) {
    throw new Error('endsOn cannot be before startsOn.');
  }
  return payload;
}

function normalizeItemInput(input: HolidayTemplateItemInput) {
  return {
    item_id: requireId(input.itemId, 'itemId'),
    adjustment_kind: asAdjustmentKind(input.adjustmentKind),
    quantity: requireQuantity(input.quantity),
    note: asString(input.note),
  };
}

function toInventoryItem(row: Row | null): HolidayTemplateInventoryItem | null {
  if (!row) return null;
  const id = asString(row.id);
  const name = asString(row.name);
  if (!id || !name) return null;

  return {
    id,
    name,
    baseUnit: asString(row.base_unit),
    packUnit: asString(row.pack_unit),
    defaultOrderUnit: asString(row.default_order_unit),
  };
}

function toTemplateItem(row: Row): HolidayTemplateItem {
  return {
    templateId: asString(row.template_id) ?? '',
    itemId: asString(row.item_id) ?? '',
    adjustmentKind: asAdjustmentKind(row.adjustment_kind),
    quantity: asNumber(row.quantity) ?? 0,
    note: asString(row.note),
    inventoryItem: toInventoryItem(relatedRow(row.inventory_item)),
  };
}

function toTemplate(row: Row): HolidayTemplate {
  return {
    id: asString(row.id) ?? '',
    name: asString(row.name) ?? 'Untitled holiday',
    startsOn: asString(row.starts_on) ?? '',
    endsOn: asString(row.ends_on) ?? '',
    active: row.active !== false,
    createdBy: asString(row.created_by) ?? '',
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    items: (Array.isArray(row.holiday_template_items) ? row.holiday_template_items : [])
      .map((item) => toTemplateItem(item as Row))
      .sort((left, right) => {
        const leftName = left.inventoryItem?.name ?? left.itemId;
        const rightName = right.inventoryItem?.name ?? right.itemId;
        return leftName.localeCompare(rightName);
      }),
  };
}

function toChecklistHolidayAdjustment(row: Row): ChecklistHolidayAdjustment {
  return {
    itemId: asString(row.item_id) ?? '',
    itemName: asString(row.item_name) ?? 'Unknown item',
    unit: asString(row.unit) ?? '',
    adjustmentKind: asAdjustmentKind(row.adjustment_kind),
    quantity: asNumber(row.quantity) ?? 0,
  };
}

async function getCurrentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;

  const userId = data.user?.id;
  if (!userId) throw new Error('You must be signed in to view holiday checklist adjustments.');
  return userId;
}

/** All authenticated users may read; writes are manager-only through RLS. Includes inventory references for the editor. */
export async function listHolidayTemplates(): Promise<HolidayTemplate[]> {
  const { data, error } = await db
    .from('holiday_templates')
    .select(TEMPLATE_WITH_ITEMS_COLUMNS)
    .order('starts_on', { ascending: false })
    .order('name', { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row: Row) => toTemplate(row));
}

export async function getHolidayTemplate(templateId: string): Promise<HolidayTemplate | null> {
  const normalizedTemplateId = requireId(templateId, 'templateId');
  const { data, error } = await db
    .from('holiday_templates')
    .select(TEMPLATE_WITH_ITEMS_COLUMNS)
    .eq('id', normalizedTemplateId)
    .maybeSingle();

  if (error) throw error;
  return data ? toTemplate(data as Row) : null;
}

export async function createHolidayTemplate(input: CreateHolidayTemplateInput): Promise<HolidayTemplate> {
  const payload = normalizeCreateInput(input);
  const { data, error } = await db
    .from('holiday_templates')
    .insert(payload)
    .select(TEMPLATE_WITH_ITEMS_COLUMNS)
    .single();

  if (error) throw error;
  if (!data) throw new Error('Holiday template was not returned after creation.');
  return toTemplate(data as Row);
}

export async function updateHolidayTemplate(
  templateId: string,
  input: UpdateHolidayTemplateInput,
): Promise<HolidayTemplate> {
  const normalizedTemplateId = requireId(templateId, 'templateId');
  const payload = normalizeUpdateInput(input);
  const { data, error } = await db
    .from('holiday_templates')
    .update(payload)
    .eq('id', normalizedTemplateId)
    .select(TEMPLATE_WITH_ITEMS_COLUMNS)
    .single();

  if (error) throw error;
  if (!data) throw new Error('Holiday template was not returned after update.');
  return toTemplate(data as Row);
}

export async function deleteHolidayTemplate(templateId: string): Promise<void> {
  const normalizedTemplateId = requireId(templateId, 'templateId');
  const { error } = await db
    .from('holiday_templates')
    .delete()
    .eq('id', normalizedTemplateId);

  if (error) throw error;
}

/** Writes are manager-only through RLS. One adjustment is allowed per inventory item per template. */
export async function createHolidayTemplateItem(
  templateId: string,
  input: HolidayTemplateItemInput,
): Promise<HolidayTemplateItem> {
  const normalizedTemplateId = requireId(templateId, 'templateId');
  const payload = normalizeItemInput(input);
  const { data, error } = await db
    .from('holiday_template_items')
    .insert({ template_id: normalizedTemplateId, ...payload })
    .select(TEMPLATE_ITEM_COLUMNS)
    .single();

  if (error) throw error;
  if (!data) throw new Error('Holiday template item was not returned after creation.');
  return toTemplateItem(data as Row);
}

export async function updateHolidayTemplateItem(
  templateId: string,
  itemId: string,
  input: Omit<HolidayTemplateItemInput, 'itemId'>,
): Promise<HolidayTemplateItem> {
  const normalizedTemplateId = requireId(templateId, 'templateId');
  const normalizedItemId = requireId(itemId, 'itemId');
  const payload = {
    adjustment_kind: asAdjustmentKind(input.adjustmentKind),
    quantity: requireQuantity(input.quantity),
    note: asString(input.note),
  };
  const { data, error } = await db
    .from('holiday_template_items')
    .update(payload)
    .eq('template_id', normalizedTemplateId)
    .eq('item_id', normalizedItemId)
    .select(TEMPLATE_ITEM_COLUMNS)
    .single();

  if (error) throw error;
  if (!data) throw new Error('Holiday template item was not returned after update.');
  return toTemplateItem(data as Row);
}

export async function deleteHolidayTemplateItem(templateId: string, itemId: string): Promise<void> {
  const normalizedTemplateId = requireId(templateId, 'templateId');
  const normalizedItemId = requireId(itemId, 'itemId');
  const { error } = await db
    .from('holiday_template_items')
    .delete()
    .eq('template_id', normalizedTemplateId)
    .eq('item_id', normalizedItemId);

  if (error) throw error;
}

/**
 * Loads today's active holiday (if any) and its server-authorized overlay for
 * the signed-in user's checklist. The RPC never mutates checklist rows.
 */
export async function getMyChecklistHolidayOverlay(
  locationGroup: HolidayLocationGroup,
): Promise<ChecklistHolidayOverlay | null> {
  const userId = await getCurrentUserId();
  const date = localCalendarDate();
  const { data: activeTemplateId, error: activeTemplateError } = await supabase.rpc('active_holiday_for', {
    p_date: date,
  });
  if (activeTemplateError) throw activeTemplateError;

  const templateId = asString(activeTemplateId);
  if (!templateId) return null;

  const [templateResult, overlayResult] = await Promise.all([
    db
      .from('holiday_templates')
      .select('id,name')
      .eq('id', templateId)
      .single(),
    supabase.rpc('get_checklist_holiday_overlay', {
      p_user_id: userId,
      p_location_group: locationGroup,
      p_date: date,
    }),
  ]);

  if (templateResult.error) throw templateResult.error;
  if (overlayResult.error) throw overlayResult.error;
  if (!templateResult.data) throw new Error('The active holiday template could not be loaded.');

  return {
    templateId,
    templateName: asString(templateResult.data.name) ?? 'Holiday',
    adjustments: (overlayResult.data ?? []).map((row: Row) => toChecklistHolidayAdjustment(row)),
  };
}
