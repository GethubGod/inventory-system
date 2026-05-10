/**
 * Shared data model + helpers for the Quick Order parsed-item cart.
 *
 * The "Order List" card renders directly from {@link ParsedQuickOrderItem}[] —
 * there is intentionally no second, derived copy of this state — so every helper
 * here is written to be defensive about partially-parsed / hallucinated items.
 */

export type ParsedQuickOrderItem = {
  id?: string;
  line_id?: string;
  client_key?: string;
  item_id: string | null;
  /** Primary name field returned by the parser. */
  item_name?: string;
  item_text?: string;
  /** Legacy / alternate name fields seen across parser + persisted payloads. */
  name?: string;
  display_name?: string;
  product_name?: string;
  catalog_name?: string;
  matched_name?: string;
  /** The raw text the user typed for this item, if known. */
  raw_token?: string;
  raw_text?: string;
  quantity: number | null;
  unit: string | null;
  confidence?: number;
  needs_clarification?: boolean;
  unresolved?: boolean;
  notes?: string | null;
  issue?: string;
  alternatives?: {
    item_id: string;
    item_name: string;
    confidence: number;
  }[];
  parse_source?: 'deterministic' | 'fuzzy' | 'llm' | 'manual' | 'correction';
  status?: 'valid' | 'review' | 'no_match' | 'missing_quantity' | 'missing_unit' | 'ambiguous' | 'invalid' | 'invalid_unit';
  match_type?: string;
  pending_conflict_id?: string;
  merge_behavior?: 'add_to_existing' | 'replace_existing' | 'keep_separate';
  existing_item_key?: string;
};

export type QuickOrderMergeResult = {
  items: ParsedQuickOrderItem[];
  addedItems: ParsedQuickOrderItem[];
  updatedItems: ParsedQuickOrderItem[];
  reviewItems: ParsedQuickOrderItem[];
  addedCount: number;
  updatedCount: number;
  reviewCount: number;
  unchangedCount: number;
  rejectedReasons: string[];
};

export type RepeatedOrderListResult = {
  isRepeatedList: boolean;
  exactMatches: ParsedQuickOrderItem[];
  changedItems: ParsedQuickOrderItem[];
  newItems: ParsedQuickOrderItem[];
  unchangedCount: number;
};

export type QuickOrderClarificationAction = {
  id: 'add' | 'replace' | 'keep_separate' | 'cancel' | 'choose_existing';
  label: string;
  preview?: string;
  existing_item_key?: string;
};

export type PendingQuickOrderClarification = {
  id: string;
  type:
    | 'quantity_conflict'
    | 'unit_conflict'
    | 'missing_quantity'
    | 'missing_unit'
    | 'ambiguous_item'
    | 'choose_existing_line';
  item_id: string | null;
  item_name: string;
  existing_item_key?: string;
  existing_item_keys?: string[];
  incoming_item?: ParsedQuickOrderItem;
  message: string;
  actions: QuickOrderClarificationAction[];
};

/** Inventory rows used for the in-app item picker / unit resolution. */
export type QuickOrderInventoryItem = {
  id: string;
  name: string;
  base_unit: string | null;
  pack_unit: string | null;
};

export type ParsedItemIssueKind =
  | 'choose-item'
  | 'pick-quantity'
  | 'pick-unit'
  | 'fix-unit'
  | 'needs-clarification';

export type ParsedItemIssue = {
  kind: ParsedItemIssueKind;
  /** Short label safe to show inline in a row or as a banner. */
  label: string;
};

const NAME_FIELDS: (keyof ParsedQuickOrderItem)[] = [
  'item_name',
  'name',
  'display_name',
  'product_name',
  'catalog_name',
  'matched_name',
];

function firstNonEmptyName(item: ParsedQuickOrderItem): string | null {
  for (const field of NAME_FIELDS) {
    const value = item[field];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

/**
 * Resolves a human-readable title for a parsed item, falling through every name
 * field the parser/persistence layer might have used. Never returns an empty
 * string — a nameless item still gets a visible "Unknown item" row plus an
 * issue indicator (see {@link getParsedItemIssue}).
 */
export function getParsedItemDisplayName(item: ParsedQuickOrderItem): string {
  if (item.item_id && item.item_name?.trim()) return item.item_name.trim();
  return item.item_text?.trim() || firstNonEmptyName(item) || item.raw_token?.trim() || item.raw_text?.trim() || 'Unknown item';
}

/** True when the parser actually attached a name (not just a raw token). */
export function hasParsedItemName(item: ParsedQuickOrderItem): boolean {
  return Boolean(item.item_id && item.item_name?.trim()) || Boolean(item.item_text?.trim()) || firstNonEmptyName(item) != null;
}

/**
 * Stable key for a parsed item: resolved items key on their inventory id,
 * unresolved items key on their lowered raw token / name. Used for React keys,
 * de-duplication, and locating an item to patch.
 */
export function getParsedItemKey(item: ParsedQuickOrderItem): string {
  if (item.client_key) return `client:${item.client_key}`;
  if (item.item_id) return `id:${item.item_id}:unit:${normalizeUnitKey(item.unit) ?? 'missing'}`;
  const token = item.raw_token?.trim() || item.raw_text?.trim() || getParsedItemDisplayName(item);
  return `unresolved:${normalizeItemKeyText(token)}:unit:${normalizeUnitKey(item.unit) ?? 'missing'}`;
}

/**
 * Returns the single most important thing wrong with this item, or null when it
 * is ready to submit. Order matters: an item with no inventory match needs that
 * resolved before quantity/unit are meaningful.
 */
export function getParsedItemIssue(item: ParsedQuickOrderItem): ParsedItemIssue | null {
  if (item.status === 'missing_quantity') {
    return { kind: 'pick-quantity', label: 'Add quantity' };
  }
  if (item.status === 'missing_unit') {
    return { kind: 'pick-unit', label: 'Choose unit' };
  }
  if (item.status === 'invalid_unit' || item.status === 'invalid') {
    return { kind: 'fix-unit', label: 'Fix unit' };
  }
  if (item.status === 'ambiguous' || item.status === 'no_match' || item.status === 'review') {
    if (!item.item_id || item.unresolved || item.status === 'ambiguous' || item.status === 'no_match') {
      return { kind: 'choose-item', label: 'Choose item' };
    }
    return { kind: 'needs-clarification', label: 'Needs review' };
  }
  if (!item.item_id || item.unresolved) {
    return { kind: 'choose-item', label: 'Choose item' };
  }
  if (item.quantity == null || !Number.isFinite(item.quantity) || item.quantity <= 0) {
    return { kind: 'pick-quantity', label: 'Add quantity' };
  }
  if (!item.unit || !item.unit.trim()) {
    return { kind: 'pick-unit', label: 'Choose unit' };
  }
  if (item.needs_clarification) {
    return { kind: 'needs-clarification', label: 'Needs review' };
  }
  return null;
}

export function isParsedItemReady(item: ParsedQuickOrderItem): boolean {
  return getParsedItemIssue(item) == null;
}

export function countUnresolvedItems(items: ParsedQuickOrderItem[]): number {
  return items.reduce((total, item) => (getParsedItemIssue(item) ? total + 1 : total), 0);
}

/** "4 lb" / "2 · unit needed" / "Quantity needed" — never empty. */
export function formatParsedItemQuantity(item: ParsedQuickOrderItem): string {
  const unit = item.unit?.trim();
  const hasQty = item.quantity != null && Number.isFinite(item.quantity) && item.quantity > 0;

  if (!hasQty) {
    return unit ? `— ${unit}` : 'Quantity needed';
  }
  return unit ? `${item.quantity} ${unit}` : `${item.quantity} · unit needed`;
}

/**
 * Returns a new array with exactly one item (matched by {@link getParsedItemKey})
 * replaced by `{ ...item, ...patch }`. `needs_clarification` / `unresolved` are
 * only cleared once the item actually has an id, a positive quantity, and a unit.
 */
export function updateParsedItem(
  items: ParsedQuickOrderItem[],
  key: string,
  patch: Partial<ParsedQuickOrderItem>,
): ParsedQuickOrderItem[] {
  return items.map((item) => {
    if (getParsedItemKey(item) !== key) return item;

    const next: ParsedQuickOrderItem = { ...item, ...patch };
    const resolved =
      Boolean(next.item_id) &&
      next.quantity != null &&
      Number.isFinite(next.quantity) &&
      next.quantity > 0 &&
      Boolean(next.unit && next.unit.trim());

    if (resolved) {
      next.needs_clarification = false;
      next.unresolved = false;
    }
    return next;
  });
}

/** Returns a new array without the item matched by {@link getParsedItemKey}. */
export function removeParsedItem(
  items: ParsedQuickOrderItem[],
  key: string,
): ParsedQuickOrderItem[] {
  return items.filter((item) => getParsedItemKey(item) !== key);
}

export function createQuickOrderClientKey(prefix = 'qo'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function mergeQuickOrderParsedItems(
  current: ParsedQuickOrderItem[],
  incoming: ParsedQuickOrderItem[],
): ParsedQuickOrderItem[] {
  return mergeQuickOrderParsedItemsDetailed(current, incoming).items;
}

export function mergeQuickOrderParsedItemsDetailed(
  current: ParsedQuickOrderItem[],
  incoming: ParsedQuickOrderItem[],
): QuickOrderMergeResult {
  let next = [...current];
  const addedItems: ParsedQuickOrderItem[] = [];
  const updatedItems: ParsedQuickOrderItem[] = [];
  const reviewItems: ParsedQuickOrderItem[] = [];
  const rejectedReasons: string[] = [];
  let unchangedCount = 0;

  for (const item of dedupeParsedItemsByLineId(incoming)) {
    if (!isRenderableParsedItem(item)) {
      rejectedReasons.push('empty_item');
      continue;
    }

    const existingKey = item.existing_item_key;
    if (item.merge_behavior === 'add_to_existing' && existingKey) {
      let changed = false;
      next = next.map((entry) =>
        getParsedItemKey(entry) === existingKey
          ? (() => {
            changed = true;
            const updated = {
              ...entry,
              ...item,
              quantity: item.quantity,
              client_key: entry.client_key,
              needs_clarification: false,
              unresolved: false,
            };
            updatedItems.push(updated);
            return updated;
          })()
          : entry,
      );
      if (!changed) rejectedReasons.push('missing_existing_item_for_add');
      continue;
    }

    if (item.merge_behavior === 'replace_existing' && existingKey) {
      let changed = false;
      next = next.map((entry) =>
        getParsedItemKey(entry) === existingKey
          ? (() => {
            changed = true;
            const updated = {
              ...entry,
              ...item,
              client_key: entry.client_key,
              needs_clarification: false,
              unresolved: false,
            };
            updatedItems.push(updated);
            return updated;
          })()
          : entry,
      );
      if (!changed) rejectedReasons.push('missing_existing_item_for_replace');
      continue;
    }

    const key = getParsedItemKey(item);
    const existingIndex = next.findIndex((entry) => getParsedItemKey(entry) === key);
    if (existingIndex >= 0 && !item.client_key && item.merge_behavior !== 'keep_separate') {
      const existing = next[existingIndex];
      if (areParsedItemsEquivalent(existing, item)) {
        unchangedCount += 1;
        continue;
      }

      if (isParsedItemReady(existing) && isParsedItemReady(item)) {
        unchangedCount += 1;
        rejectedReasons.push('duplicate_changed_without_action');
        continue;
      }

      next = next.map((entry, index) => {
        if (index !== existingIndex) return entry;
        const updated = { ...entry, ...item, client_key: entry.client_key };
        updatedItems.push(updated);
        if (getParsedItemIssue(updated)) reviewItems.push(updated);
        return updated;
      });
    } else {
      const added = item.client_key || item.merge_behavior === 'keep_separate' ? item : { ...item };
      next = [...next, added];
      addedItems.push(added);
      if (getParsedItemIssue(added)) reviewItems.push(added);
    }
  }

  return {
    items: next,
    addedItems,
    updatedItems,
    reviewItems,
    addedCount: addedItems.length,
    updatedCount: updatedItems.length,
    reviewCount: reviewItems.length,
    unchangedCount,
    rejectedReasons,
  };
}

function dedupeParsedItemsByLineId(items: ParsedQuickOrderItem[]): ParsedQuickOrderItem[] {
  const byLine = new Map<string, ParsedQuickOrderItem>();
  const withoutLine: ParsedQuickOrderItem[] = [];

  for (const item of items) {
    if (!item.line_id) {
      withoutLine.push(item);
      continue;
    }
    const existing = byLine.get(item.line_id);
    byLine.set(item.line_id, existing ? chooseBetterParsedItem(existing, item) : item);
  }

  return [...byLine.values(), ...withoutLine];
}

function chooseBetterParsedItem(a: ParsedQuickOrderItem, b: ParsedQuickOrderItem): ParsedQuickOrderItem {
  const aScore = parsedItemResolutionScore(a);
  const bScore = parsedItemResolutionScore(b);
  if (aScore !== bScore) return bScore > aScore ? b : a;
  return (b.confidence ?? 0) > (a.confidence ?? 0) ? b : a;
}

function parsedItemResolutionScore(item: ParsedQuickOrderItem): number {
  let score = 0;
  if (item.item_id) score += 100;
  if (!item.unresolved) score += 20;
  if (!getParsedItemIssue(item)) score += 20;
  if (item.match_type === 'exact_name') score += 12;
  if (item.match_type === 'exact_alias' || item.match_type === 'normalized') score += 10;
  if (item.parse_source === 'deterministic') score += 2;
  return score;
}

export function detectRepeatedOrderList(
  existingItems: ParsedQuickOrderItem[],
  incomingItems: ParsedQuickOrderItem[],
): RepeatedOrderListResult {
  const incomingReady = incomingItems.filter(isParsedItemReady);
  const existingByKey = new Map(
    existingItems
      .filter(isParsedItemReady)
      .map((item) => [getParsedItemKey(item), item]),
  );
  const exactMatches: ParsedQuickOrderItem[] = [];
  const changedItems: ParsedQuickOrderItem[] = [];
  const newItems: ParsedQuickOrderItem[] = [];

  for (const incoming of incomingReady) {
    const existing = existingByKey.get(getParsedItemKey(incoming));
    if (!existing) {
      newItems.push(incoming);
      continue;
    }
    if (sameQuantity(existing, incoming)) {
      exactMatches.push(incoming);
    } else {
      changedItems.push(incoming);
    }
  }

  return {
    isRepeatedList: incomingReady.length >= 2 && exactMatches.length > 0,
    exactMatches,
    changedItems,
    newItems,
    unchangedCount: exactMatches.length,
  };
}

export function applyQuickOrderClarificationAction(
  items: ParsedQuickOrderItem[],
  clarification: PendingQuickOrderClarification,
  action: QuickOrderClarificationAction,
): ParsedQuickOrderItem[] {
  const incoming = clarification.incoming_item;
  if (!incoming || action.id === 'cancel') return items;

  const existingKey = action.existing_item_key ?? clarification.existing_item_key;

  if (action.id === 'add' && existingKey) {
    return items.map((item) => {
      if (getParsedItemKey(item) !== existingKey) return item;
      return {
        ...item,
        quantity: (item.quantity ?? 0) + (incoming.quantity ?? 0),
        unit: item.unit ?? incoming.unit,
        needs_clarification: false,
        unresolved: false,
      };
    });
  }

  if ((action.id === 'replace' || action.id === 'choose_existing') && existingKey) {
    return items.map((item) =>
      getParsedItemKey(item) === existingKey
        ? {
          ...item,
          ...incoming,
          client_key: item.client_key,
          needs_clarification: false,
          unresolved: false,
        }
        : item,
    );
  }

  if (action.id === 'keep_separate') {
    return [
      ...items,
      {
        ...incoming,
        client_key: incoming.client_key ?? createQuickOrderClientKey('sep'),
        needs_clarification: false,
        unresolved: false,
      },
    ];
  }

  return items;
}

/**
 * Canonicalises a free-text unit string ("cases" → "cs", "pounds" → "lb", …).
 * Returns `null` for empty/whitespace input. Shared by row keying, the cart
 * conversion, and unit-type resolution so they all agree on what "the same
 * unit" means.
 */
export function normalizeQuickOrderUnit(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const key = value.trim().toLowerCase();
  switch (key) {
    case 'case':
    case 'cases':
      return 'cs';
    case 'pack':
    case 'packs':
    case 'pk':
    case 'pkg':
    case 'package':
    case 'packages':
      return 'pack';
    case 'lbs':
    case 'pound':
    case 'pounds':
      return 'lb';
    case 'pcs':
    case 'piece':
    case 'pieces':
      return 'pc';
    case 'ounce':
    case 'ounces':
      return 'oz';
    case 'each':
      return 'ea';
    default:
      return key;
  }
}

function normalizeUnitKey(value: string | null | undefined): string | null {
  return normalizeQuickOrderUnit(value);
}

function normalizeItemKeyText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRenderableParsedItem(item: ParsedQuickOrderItem): boolean {
  return Boolean(
    item.item_id ||
      item.raw_token?.trim() ||
      item.raw_text?.trim() ||
      firstNonEmptyName(item),
  );
}

function areParsedItemsEquivalent(a: ParsedQuickOrderItem, b: ParsedQuickOrderItem): boolean {
  return (
    getParsedItemKey(a) === getParsedItemKey(b) &&
    sameQuantity(a, b) &&
    normalizeQuickOrderUnit(a.unit) === normalizeQuickOrderUnit(b.unit) &&
    getParsedItemIssue(a)?.kind === getParsedItemIssue(b)?.kind
  );
}

function sameQuantity(a: ParsedQuickOrderItem, b: ParsedQuickOrderItem): boolean {
  if (a.quantity == null || b.quantity == null) return a.quantity == null && b.quantity == null;
  return Math.abs(a.quantity - b.quantity) < 0.000001;
}

/**
 * Maps a parsed item to the `UnitType` the cart/order layer expects: `'pack'`
 * when the parsed unit matches the inventory item's pack unit, otherwise
 * `'base'`. Mirrors the resolution used elsewhere in the ordering flow.
 */
export function resolveQuickOrderUnitType(
  item: ParsedQuickOrderItem,
  inventoryItem: QuickOrderInventoryItem | null | undefined,
): 'base' | 'pack' {
  const unit = normalizeQuickOrderUnit(item.unit);
  const packUnit = normalizeQuickOrderUnit(inventoryItem?.pack_unit);
  return unit != null && packUnit != null && unit === packUnit ? 'pack' : 'base';
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return Boolean(value && UUID_PATTERN.test(value));
}

// ---------------------------------------------------------------------------
// Operations — applied by the frontend when the backend returns command ops.
// ---------------------------------------------------------------------------

export type QuickOrderOperationType =
  | 'add'
  | 'remove'
  | 'replace'
  | 'update_quantity'
  | 'update_unit'
  | 'clear'
  | 'no_op';

export type QuickOrderOperation = {
  type: QuickOrderOperationType;
  target_item_id: string | null;
  target_display_name: string;
  target_item_key?: string;
  quantity?: number | null;
  unit?: string | null;
  status: 'applied' | 'pending' | 'failed';
  message?: string;
};

export type QuickOrderOperationResult = {
  items: ParsedQuickOrderItem[];
  appliedCount: number;
  removedCount: number;
  updatedCount: number;
  skippedCount: number;
  skippedReasons: string[];
};

/**
 * Applies backend-produced operations (remove, replace, update, clear) to the
 * local parsed-items state. Called before merging any new parsed items.
 */
export function applyQuickOrderOperations(
  existingItems: ParsedQuickOrderItem[],
  operations: QuickOrderOperation[],
): QuickOrderOperationResult {
  let items = [...existingItems];
  let appliedCount = 0;
  let removedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  const skippedReasons: string[] = [];

  for (const op of operations) {
    if (op.status !== 'applied') {
      skippedCount += 1;
      skippedReasons.push(`${op.type}_not_applied`);
      continue;
    }

    switch (op.type) {
      case 'clear': {
        removedCount += items.length;
        items = [];
        appliedCount += 1;
        break;
      }
      case 'remove': {
        const index = findOperationTargetIndex(items, op);
        if (index >= 0) {
          items = items.filter((_, i) => i !== index);
          removedCount += 1;
          appliedCount += 1;
        } else {
          skippedCount += 1;
          skippedReasons.push('remove_target_not_found');
        }
        break;
      }
      case 'replace': {
        const index = findOperationTargetIndex(items, op);
        if (index >= 0) {
          items = items.map((item, i) => {
            if (i !== index) return item;
            return {
              ...item,
              quantity: op.quantity ?? item.quantity,
              unit: op.unit ?? item.unit,
              needs_clarification: false,
              unresolved: false,
            };
          });
          updatedCount += 1;
          appliedCount += 1;
        } else {
          skippedCount += 1;
          skippedReasons.push('replace_target_not_found');
        }
        break;
      }
      case 'update_quantity': {
        const index = findOperationTargetIndex(items, op);
        if (index >= 0) {
          items = items.map((item, i) => {
            if (i !== index) return item;
            return {
              ...item,
              quantity: op.quantity ?? item.quantity,
              unit: op.unit ?? item.unit,
              needs_clarification: false,
              unresolved: false,
            };
          });
          updatedCount += 1;
          appliedCount += 1;
        } else {
          skippedCount += 1;
          skippedReasons.push('update_quantity_target_not_found');
        }
        break;
      }
      case 'update_unit': {
        const index = findOperationTargetIndex(items, op);
        if (index >= 0) {
          items = items.map((item, i) => {
            if (i !== index) return item;
            return {
              ...item,
              unit: op.unit ?? item.unit,
              needs_clarification: false,
              unresolved: false,
            };
          });
          updatedCount += 1;
          appliedCount += 1;
        } else {
          skippedCount += 1;
          skippedReasons.push('update_unit_target_not_found');
        }
        break;
      }
      case 'add':
      case 'no_op':
      default:
        // no_op and add don't change existing items here —
        // add items come through the normal merge path.
        appliedCount += 1;
        break;
    }
  }

  return { items, appliedCount, removedCount, updatedCount, skippedCount, skippedReasons };
}

/**
 * Finds the index of the existing item targeted by an operation, using a
 * priority cascade: target_item_key → item_id+unit → display_name → parenthetical.
 */
function findOperationTargetIndex(
  items: ParsedQuickOrderItem[],
  op: QuickOrderOperation,
): number {
  // 1. target_item_key exact match.
  if (op.target_item_key) {
    const idx = items.findIndex((item) => getParsedItemKey(item) === op.target_item_key);
    if (idx >= 0) return idx;
  }

  // 2. item_id + unit match.
  if (op.target_item_id) {
    const idx = items.findIndex((item) =>
      item.item_id === op.target_item_id
      && (!op.unit || normalizeQuickOrderUnit(item.unit) === normalizeQuickOrderUnit(op.unit)),
    );
    if (idx >= 0) return idx;

    // item_id only (any unit).
    const idIdx = items.findIndex((item) => item.item_id === op.target_item_id);
    if (idIdx >= 0) return idIdx;
  }

  // 3. Normalized display name match.
  const targetName = normalizeItemKeyText(op.target_display_name);
  if (targetName) {
    const idx = items.findIndex((item) => {
      const dn = normalizeItemKeyText(getParsedItemDisplayName(item));
      const in_ = normalizeItemKeyText(item.item_name ?? '');
      return dn === targetName || in_ === targetName;
    });
    if (idx >= 0) return idx;

    // 4. Raw token match.
    const rawIdx = items.findIndex((item) => {
      const raw = normalizeItemKeyText(item.raw_token ?? item.raw_text ?? '');
      return raw === targetName;
    });
    if (rawIdx >= 0) return rawIdx;

    // 5. Parenthetical / substring match.
    const subIdx = items.findIndex((item) => {
      const dn = normalizeItemKeyText(getParsedItemDisplayName(item));
      return dn.includes(targetName) || targetName.includes(dn);
    });
    if (subIdx >= 0) return subIdx;
  }

  return -1;
}
