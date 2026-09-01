// Kitchen item list (dashboard). Plain supabase-js reads/writes to
// `kitchen_items`; RLS lets managers write and any kitchen user read.
// Items are never deleted: deactivating hides them from the chef grid while
// past requests keep pointing at the row.

import { getSupabase } from "@/lib/supabase";

export interface KitchenItemRecord {
  id: string;
  name: string;
  unit: string;
  location_id: string | null;
  sort_order: number;
  active: boolean;
}

export interface KitchenItemInput {
  name: string;
  unit: string;
  location_id: string | null;
}

export const MAX_NAME_LENGTH = 60;
export const MAX_UNIT_LENGTH = 24;

/** Trim and validate a name/unit pair; returns a message when invalid. */
export function validateKitchenItemInput(input: KitchenItemInput): string | null {
  const name = input.name.trim();
  const unit = input.unit.trim();
  if (!name) return "Give the item a name.";
  if (name.length > MAX_NAME_LENGTH) return `Names are at most ${MAX_NAME_LENGTH} characters.`;
  if (!unit) return "Give the item a unit (pieces, tubs, trays…).";
  if (unit.length > MAX_UNIT_LENGTH) return `Units are at most ${MAX_UNIT_LENGTH} characters.`;
  return null;
}

/** Next sort position after the current list (1-based, gaps allowed). */
export function nextSortOrder(items: readonly { sort_order: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.sort_order), 0) + 1;
}

/**
 * Swap an item with its neighbour and return the two rows whose sort_order
 * changes. Ties get distinct positions so the move is visible.
 */
export function moveItem(
  items: readonly KitchenItemRecord[],
  id: string,
  direction: "up" | "down",
): Array<Pick<KitchenItemRecord, "id" | "sort_order">> {
  const ordered = [...items].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
  );
  const index = ordered.findIndex((item) => item.id === id);
  if (index < 0) return [];
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= ordered.length) return [];
  const a = ordered[index];
  const b = ordered[target];
  if (a.sort_order === b.sort_order) {
    return direction === "up"
      ? [{ id: a.id, sort_order: b.sort_order }, { id: b.id, sort_order: b.sort_order + 1 }]
      : [{ id: a.id, sort_order: b.sort_order + 1 }, { id: b.id, sort_order: b.sort_order }];
  }
  return [
    { id: a.id, sort_order: b.sort_order },
    { id: b.id, sort_order: a.sort_order },
  ];
}

export async function fetchKitchenItems(): Promise<KitchenItemRecord[]> {
  const { data, error } = await getSupabase()
    .from("kitchen_items")
    .select("id, name, unit, location_id, sort_order, active")
    .order("sort_order")
    .order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createKitchenItem(
  input: KitchenItemInput,
  sortOrder: number,
): Promise<KitchenItemRecord> {
  const { data, error } = await getSupabase()
    .from("kitchen_items")
    .insert({
      name: input.name.trim(),
      unit: input.unit.trim(),
      location_id: input.location_id,
      sort_order: sortOrder,
    })
    .select("id, name, unit, location_id, sort_order, active")
    .single();
  if (error) throw new Error(friendlyItemError(error.message));
  return data;
}

export async function updateKitchenItem(
  id: string,
  patch: Partial<Pick<KitchenItemRecord, "name" | "unit" | "location_id" | "sort_order" | "active">>,
): Promise<void> {
  const { error } = await getSupabase().from("kitchen_items").update(patch).eq("id", id);
  if (error) throw new Error(friendlyItemError(error.message));
}

function friendlyItemError(message: string): string {
  if (/kitchen_items_active_name_scope_key|duplicate key/i.test(message)) {
    return "An active item with that name already exists for this scope.";
  }
  return message;
}
