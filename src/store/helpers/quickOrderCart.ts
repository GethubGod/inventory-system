/**
 * Pure conversion from Quick Order parsed items to the inputs the normal cart
 * store understands. Kept side-effect free so it can be unit tested and reused
 * by the Quick Order "Confirm order" flow without duplicating cart business
 * logic (the actual merging into `cartByLocation` is still done by
 * `useOrderStore.addToCart`).
 */
import type { UnitType } from '@/types';
import {
  getParsedItemIssue,
  resolveQuickOrderUnitType,
  type ParsedQuickOrderItem,
  type QuickOrderInventoryItem,
} from '@/features/ordering/quickOrderItems';

/** One `addToCart(...)`-shaped argument bundle. */
export type QuickOrderCartAdd = {
  inventoryItemId: string;
  quantity: number;
  unitType: UnitType;
  note: string | null;
};

/**
 * True when every parsed item can be turned into a cart line (has an inventory
 * id, a positive quantity and a unit, and no outstanding clarification). An
 * empty list is not "ready" — there is nothing to confirm.
 */
export function areQuickOrderItemsCartReady(items: ParsedQuickOrderItem[]): boolean {
  return items.length > 0 && items.every((item) => getParsedItemIssue(item) == null);
}

/**
 * Converts ready parsed items into {@link QuickOrderCartAdd}s. Throws if any
 * item is not ready — callers should gate on {@link areQuickOrderItemsCartReady}
 * first; the throw is a defensive backstop, never an expected path.
 */
export function quickOrderItemsToCartAdds(
  items: ParsedQuickOrderItem[],
  inventoryById: Map<string, QuickOrderInventoryItem>,
): QuickOrderCartAdd[] {
  return items.map((item) => {
    if (getParsedItemIssue(item) != null || !item.item_id) {
      throw new Error('Quick Order item is not ready to add to the cart.');
    }
    const quantity = item.quantity;
    if (quantity == null || !Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('Quick Order item is missing a quantity.');
    }
    return {
      inventoryItemId: item.item_id,
      quantity,
      unitType: resolveQuickOrderUnitType(item, inventoryById.get(item.item_id) ?? null),
      note: item.notes ?? null,
    };
  });
}
