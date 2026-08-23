// Checklist management API + pure helpers for the dashboard Ordering page.
// Reads/writes go straight through supabase-js: manager RLS on
// order_checklists/order_checklist_items grants full access, the
// enforce_profile_security trigger scopes profiles.order_send_mode writes to
// manager-on-employee, and generate_order_checklist authorizes managers for
// any user. Pure helpers are unit-tested in __tests__/ordering.test.ts.

import { getSupabase } from "@/lib/supabase";

export type LocationGroup = "sushi" | "poki";
export type OrderSendMode = "direct" | "review";

export interface ChecklistItemRecord {
  id: string;
  itemId: string | null;
  itemName: string;
  unit: string;
  defaultChecked: boolean;
  recommendedQty: number | null;
  stalenessBucket: string | null;
  itemSource: string;
  sortOrder: number;
}

export interface ChecklistRecord {
  id: string;
  generatedAt: string;
  items: ChecklistItemRecord[];
}

export interface InventoryOption {
  id: string;
  name: string;
  unit: string;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function normalizeSendMode(value: unknown): OrderSendMode {
  return value === "direct" ? "direct" : "review";
}

/**
 * Parses the recommended-qty input. Empty clears the value (null); a positive
 * finite number is kept to two decimals; anything else is rejected so the
 * field can roll back to the stored value.
 */
export function parseRecommendedQty(
  input: string,
): { ok: true; value: number | null } | { ok: false } {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return { ok: false };
  return { ok: true, value: Math.round(value * 100) / 100 };
}

/** Same order-unit preference the app uses for search-added checklist lines. */
export function unitForInventoryRow(row: {
  default_order_unit: string | null;
  base_unit: string | null;
  pack_unit: string | null;
}): string {
  return (
    row.default_order_unit?.trim() ||
    row.base_unit?.trim() ||
    row.pack_unit?.trim() ||
    "unit"
  );
}

/** Mirrors the app's checklist ordering: sort_order, then name. */
export function sortChecklistItems(
  items: ChecklistItemRecord[],
): ChecklistItemRecord[] {
  return [...items].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.itemName.localeCompare(right.itemName),
  );
}

/** Manual adds append after every existing row. */
export function nextSortOrder(items: ChecklistItemRecord[]): number {
  return items.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1;
}

/** Short provenance tag for a checklist row. */
export function itemProvenanceLabel(item: {
  itemSource: string;
  stalenessBucket: string | null;
}): string {
  if (item.itemSource === "manual") return "Added";
  if (item.itemSource === "import") return "Imported";
  switch (item.stalenessBucket) {
    case "frequent":
      return "Frequent";
    case "occasional":
      return "Occasional";
    case "rare":
      return "Rare";
    default:
      return "History";
  }
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

type ChecklistItemRow = {
  id: string;
  item_id: string | null;
  item_name: string;
  unit: string;
  default_checked: boolean;
  recommended_qty: number | string | null;
  staleness_bucket: string | null;
  item_source: string;
  sort_order: number | string;
};

function toNumberOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapItemRow(row: ChecklistItemRow): ChecklistItemRecord {
  return {
    id: row.id,
    itemId: row.item_id,
    itemName: row.item_name,
    unit: row.unit,
    defaultChecked: row.default_checked,
    recommendedQty: toNumberOrNull(row.recommended_qty),
    stalenessBucket: row.staleness_bucket,
    itemSource: row.item_source,
    sortOrder: toNumberOrNull(row.sort_order) ?? 0,
  };
}

const ITEM_COLUMNS =
  "id, item_id, item_name, unit, default_checked, recommended_qty, staleness_bucket, item_source, sort_order";

export async function fetchChecklistFor(
  userId: string,
  locationGroup: LocationGroup,
): Promise<ChecklistRecord | null> {
  const { data, error } = await getSupabase()
    .from("order_checklists")
    .select(`id, generated_at, order_checklist_items(${ITEM_COLUMNS})`)
    .eq("user_id", userId)
    .eq("location_group", locationGroup)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  return {
    id: data.id,
    generatedAt: data.generated_at,
    items: sortChecklistItems(
      ((data.order_checklist_items ?? []) as ChecklistItemRow[]).map(mapItemRow),
    ),
  };
}

export async function updateChecklistItem(
  itemId: string,
  patch: { default_checked?: boolean; recommended_qty?: number | null },
): Promise<void> {
  const { error } = await getSupabase()
    .from("order_checklist_items")
    .update(patch)
    .eq("id", itemId);
  if (error) throw new Error(error.message);
}

export async function deleteChecklistItem(itemId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("order_checklist_items")
    .delete()
    .eq("id", itemId);
  if (error) throw new Error(error.message);
}

export async function insertChecklistItem(input: {
  checklistId: string;
  itemId: string;
  itemName: string;
  unit: string;
  sortOrder: number;
}): Promise<ChecklistItemRecord> {
  const { data, error } = await getSupabase()
    .from("order_checklist_items")
    .insert({
      checklist_id: input.checklistId,
      item_id: input.itemId,
      item_name: input.itemName,
      unit: input.unit,
      default_checked: true,
      sort_order: input.sortOrder,
      item_source: "manual",
    })
    .select(ITEM_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return mapItemRow(data as ChecklistItemRow);
}

export async function searchInventoryItems(
  query: string,
  limit = 12,
): Promise<InventoryOption[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const { data, error } = await getSupabase()
    .from("inventory_items")
    .select("id, name, base_unit, pack_unit, default_order_unit")
    .eq("active", true)
    .ilike("name", `%${trimmed.replace(/[%_]/g, "")}%`)
    .order("name")
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    unit: unitForInventoryRow(row),
  }));
}

export async function fetchSendMode(userId: string): Promise<OrderSendMode> {
  const { data, error } = await getSupabase()
    .from("profiles")
    .select("order_send_mode")
    .eq("id", userId)
    .single();
  if (error) throw new Error(error.message);
  return normalizeSendMode(data?.order_send_mode);
}

export async function updateSendMode(
  userId: string,
  mode: OrderSendMode,
): Promise<void> {
  const { error } = await getSupabase()
    .from("profiles")
    .update({ order_send_mode: mode })
    .eq("id", userId)
    .eq("role", "employee");
  if (error) throw new Error(error.message);
}

export async function regenerateChecklist(
  userId: string,
  locationGroup: LocationGroup,
): Promise<void> {
  const { error } = await getSupabase().rpc("generate_order_checklist", {
    p_user_id: userId,
    p_location_group: locationGroup,
  });
  if (error) throw new Error(error.message);
}
