/**
 * Helper for the Quick Order "Preview" flow.
 *
 * Tapping Preview on a reorder/history suggestion drops the suggested order into
 * the composer so the user can edit it inline and send it through the normal
 * parse-order path. {@link buildComposerOrderText} renders the suggested items
 * as plain, parser-friendly lines ("Name qty unit") — one per line, which the
 * deterministic parser splits on "\n".
 */

export type PreviewItem = {
  item_id?: string | null;
  item_name: string;
  quantity: number | null;
  unit?: string | null;
};

/** Common unit words whose plural can't be produced by appending "s". */
const PLURAL_UNIT_OVERRIDES: Record<string, string> = {
  box: 'boxes',
};

function pluralizeUnit(unit: string, quantity: number | null): string {
  const trimmed = unit.trim();
  if (!trimmed) return trimmed;
  if (quantity == null || quantity === 1) return trimmed;
  const lower = trimmed.toLowerCase();
  if (PLURAL_UNIT_OVERRIDES[lower]) return PLURAL_UNIT_OVERRIDES[lower];
  if (lower.endsWith('s')) return trimmed;
  return `${trimmed}s`;
}

/**
 * Renders suggestion items as editable composer text, one item per line:
 *   "Squid 1 pack"
 *   "Salmon 4 cases"
 * Units are pluralized for readability; the lines stay in "item qty unit" order
 * so the existing order parser handles them when the user hits send.
 */
export function buildComposerOrderText(items: PreviewItem[]): string {
  return items
    .map((item) => {
      const name = item.item_name?.trim() || 'Unknown item';
      const qty = item.quantity;
      const unit = item.unit ? pluralizeUnit(item.unit, qty) : '';
      const qtyText = qty != null && Number.isFinite(qty) ? String(qty) : '';
      return [name, qtyText, unit].filter(Boolean).join(' ');
    })
    .join('\n');
}
