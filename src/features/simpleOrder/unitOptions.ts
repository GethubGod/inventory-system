import type { InventoryItem } from '@/types';

/**
 * Unit choices for the quantity card's segmented control: the line's current
 * unit first, then the item's configured units, then common alternates —
 * deduped case-insensitively and capped so the control stays tappable.
 * Choosing one is a per-line override; inventory config is never mutated.
 */

export const COMMON_UNITS = ['case', 'lb', 'pack', 'each', 'bag', 'bottle'] as const;

export const MAX_UNIT_OPTIONS = 4;

export function unitOptionsForLine(
  lineUnit: string,
  inventoryItem?: Pick<
    InventoryItem,
    'base_unit' | 'pack_unit' | 'default_order_unit'
  > | null,
  limit: number = MAX_UNIT_OPTIONS,
): string[] {
  const options: string[] = [];
  const seen = new Set<string>();

  const push = (value: string | null | undefined) => {
    const trimmed = (value ?? '').trim();
    if (!trimmed) return;
    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) return;
    seen.add(normalized);
    options.push(trimmed);
  };

  push(lineUnit);
  push(inventoryItem?.base_unit);
  push(inventoryItem?.pack_unit);
  push(inventoryItem?.default_order_unit);
  for (const unit of COMMON_UNITS) push(unit);

  return options.slice(0, Math.max(1, limit));
}
