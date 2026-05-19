import type { ParsedItem, PendingQuickOrderClarification, ParseFlag } from './types.ts';
import { formatQuantityWithUnit, normalizeUnitForComparison } from './units.ts';

const ADDITIVE = /\b(add|add another|also|more|plus|another|extra|increase|need more)\b/i;
const REPLACEMENT = /\b(change|change to|make it|make that|replace|instead|actually|update|set|to|should be)\b/i;

export type ConflictResult = {
  acceptedItems: ParsedItem[];
  updatedItems: ParsedItem[];
  pendingClarifications: PendingQuickOrderClarification[];
  flags: ParseFlag[];
};

export type RepeatedOrderListDetection = {
  isRepeatedList: boolean;
  exactMatches: ParsedItem[];
  changedItems: ParsedItem[];
  newItems: ParsedItem[];
  unchangedCount: number;
};

export function getParserItemKey(item: Pick<ParsedItem, 'client_key' | 'item_id' | 'unit' | 'raw_token' | 'item_name'>): string {
  if (item.client_key) return `client:${item.client_key}`;
  if (item.item_id) return `id:${item.item_id}:unit:${normalizeUnitForComparison(item.unit) ?? 'missing'}`;
  return `raw:${(item.raw_token || item.item_name || 'unknown').trim().toLowerCase()}`;
}

export function createClientKey(prefix = 'qo'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function resolveParsedItemConflicts(
  existingItems: ParsedItem[],
  incomingItems: ParsedItem[],
  userText: string,
): ConflictResult {
  const acceptedItems: ParsedItem[] = [];
  const updatedItems: ParsedItem[] = [];
  const pendingClarifications: PendingQuickOrderClarification[] = [];
  const flags: ParseFlag[] = [];

  for (const incoming of incomingItems) {
    if (!incoming.item_id || incoming.needs_clarification || incoming.unresolved) {
      acceptedItems.push(incoming);
      continue;
    }

    const matches = existingItems.filter((item) => item.item_id === incoming.item_id && !item.unresolved);
    if (matches.length === 0) {
      acceptedItems.push(incoming);
      continue;
    }

    if (incoming.quantity == null) {
      pendingClarifications.push(missingQuantityClarification(incoming));
      continue;
    }
    if (!incoming.unit) {
      pendingClarifications.push(missingUnitClarification(incoming));
      continue;
    }
    if (matches.length > 1 && !matches.some((item) => sameUnit(item, incoming))) {
      pendingClarifications.push(chooseExistingClarification(matches, incoming));
      continue;
    }

    const sameUnitMatch = matches.find((item) => sameUnit(item, incoming));
    const additive = ADDITIVE.test(userText);
    const replacement = REPLACEMENT.test(userText);

    if (sameUnitMatch) {
      if (additive) {
        updatedItems.push({
          ...sameUnitMatch,
          quantity: (sameUnitMatch.quantity ?? 0) + incoming.quantity,
          needs_clarification: false,
          unresolved: false,
          merge_behavior: 'add_to_existing',
          merge_delta_quantity: incoming.quantity,
          existing_item_key: getParserItemKey(sameUnitMatch),
        });
      } else if (replacement || hasCompleteQuantityAndUnit(incoming)) {
        updatedItems.push({
          ...sameUnitMatch,
          quantity: incoming.quantity,
          unit: incoming.unit,
          raw_token: incoming.raw_token,
          raw_text: incoming.raw_text,
          needs_clarification: false,
          unresolved: false,
          merge_behavior: 'replace_existing',
          existing_item_key: getParserItemKey(sameUnitMatch),
        });
      } else {
        const pending = quantityConflictClarification(sameUnitMatch, incoming);
        pendingClarifications.push(pending);
        flags.push({
          type: 'quantity_conflict',
          message: pending.message,
          raw_token: incoming.raw_token,
          item_id: incoming.item_id,
          reason: 'same_item_same_unit_ambiguous',
        });
      }
      continue;
    }

    const firstMatch = matches[0];
    if (replacement || (!additive && hasCompleteQuantityAndUnit(incoming))) {
      updatedItems.push({
        ...firstMatch,
        quantity: incoming.quantity,
        unit: incoming.unit,
        raw_token: incoming.raw_token,
        raw_text: incoming.raw_text,
        needs_clarification: false,
        unresolved: false,
        merge_behavior: 'replace_existing',
        existing_item_key: getParserItemKey(firstMatch),
      });
    } else if (additive) {
      acceptedItems.push({
        ...incoming,
        client_key: incoming.client_key ?? createClientKey('sep'),
        merge_behavior: 'keep_separate',
      });
    } else {
      const pending = unitConflictClarification(firstMatch, incoming);
      pendingClarifications.push(pending);
      flags.push({
        type: 'quantity_conflict',
        message: pending.message,
        raw_token: incoming.raw_token,
        item_id: incoming.item_id,
        reason: 'same_item_different_unit_ambiguous',
      });
    }
  }

  return { acceptedItems, updatedItems, pendingClarifications, flags };
}

export function detectRepeatedOrderList(
  existingItems: ParsedItem[],
  incomingItems: ParsedItem[],
): RepeatedOrderListDetection {
  const readyIncoming = incomingItems.filter((item) => item.item_id && !item.unresolved && !item.needs_clarification);
  const existingByKey = new Map(
    existingItems
      .filter((item) => item.item_id && !item.unresolved)
      .map((item) => [getParserItemKey(item), item]),
  );

  const exactMatches: ParsedItem[] = [];
  const changedItems: ParsedItem[] = [];
  const newItems: ParsedItem[] = [];

  for (const incoming of readyIncoming) {
    const existing = existingByKey.get(getParserItemKey(incoming));
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

  const isRepeatedList = readyIncoming.length >= 2 && exactMatches.length > 0;
  return {
    isRepeatedList,
    exactMatches,
    changedItems,
    newItems,
    unchangedCount: exactMatches.length,
  };
}

function sameUnit(a: ParsedItem, b: ParsedItem): boolean {
  return normalizeUnitForComparison(a.unit) === normalizeUnitForComparison(b.unit);
}

function sameQuantity(a: ParsedItem, b: ParsedItem): boolean {
  return a.quantity != null && b.quantity != null && Math.abs(a.quantity - b.quantity) < 0.000001;
}

function hasCompleteQuantityAndUnit(item: ParsedItem): boolean {
  return item.quantity != null && Number.isFinite(item.quantity) && item.quantity > 0 && Boolean(item.unit?.trim());
}

function quantityConflictClarification(existing: ParsedItem, incoming: ParsedItem): PendingQuickOrderClarification {
  const id = createClientKey('conflict');
  const existingQty = formatQty(existing);
  const incomingQty = formatQty(incoming);
  const total = formatQuantityWithUnit((existing.quantity ?? 0) + (incoming.quantity ?? 0), incoming.unit);
  return {
    id,
    type: 'quantity_conflict',
    item_id: incoming.item_id,
    item_name: incoming.item_name ?? incoming.display_name ?? 'Item',
    existing_item_key: getParserItemKey(existing),
    incoming_item: incoming,
    message: `${incoming.item_name ?? incoming.display_name ?? 'This item'} is already in the order as ${existingQty}. Add ${incomingQty} or replace it?`,
    actions: [
      { id: 'add', label: 'Add to existing', preview: `${total} total` },
      { id: 'replace', label: 'Replace', preview: incomingQty },
      { id: 'keep_separate', label: 'Keep both', preview: `${existingQty} and ${incomingQty}` },
      { id: 'cancel', label: 'Cancel' },
    ],
  };
}

function unitConflictClarification(existing: ParsedItem, incoming: ParsedItem): PendingQuickOrderClarification {
  const id = createClientKey('conflict');
  return {
    id,
    type: 'unit_conflict',
    item_id: incoming.item_id,
    item_name: incoming.item_name ?? incoming.display_name ?? 'Item',
    existing_item_key: getParserItemKey(existing),
    incoming_item: incoming,
    message: `${incoming.item_name ?? incoming.display_name ?? 'This item'} is already listed as ${formatQty(existing)}. Should I also add ${formatQty(incoming)}, or replace ${formatQty(existing)}?`,
    actions: [
      { id: 'keep_separate', label: 'Add as separate line', preview: formatQty(incoming) },
      { id: 'replace', label: 'Replace existing', preview: formatQty(incoming) },
      { id: 'cancel', label: 'Cancel' },
    ],
  };
}

function missingQuantityClarification(incoming: ParsedItem): PendingQuickOrderClarification {
  return {
    id: createClientKey('conflict'),
    type: 'missing_quantity',
    item_id: incoming.item_id,
    item_name: incoming.item_name ?? incoming.display_name ?? 'Item',
    incoming_item: incoming,
    message: `How much ${incoming.item_name ?? incoming.display_name ?? 'this item'} should I add?`,
    actions: [{ id: 'cancel', label: 'Cancel' }],
  };
}

function missingUnitClarification(incoming: ParsedItem): PendingQuickOrderClarification {
  return {
    id: createClientKey('conflict'),
    type: 'missing_unit',
    item_id: incoming.item_id,
    item_name: incoming.item_name ?? incoming.display_name ?? 'Item',
    incoming_item: incoming,
    message: `What unit for ${incoming.item_name ?? incoming.display_name ?? 'this item'}?`,
    actions: [{ id: 'cancel', label: 'Cancel' }],
  };
}

function chooseExistingClarification(existingItems: ParsedItem[], incoming: ParsedItem): PendingQuickOrderClarification {
  return {
    id: createClientKey('conflict'),
    type: 'choose_existing_line',
    item_id: incoming.item_id,
    item_name: incoming.item_name ?? incoming.display_name ?? 'Item',
    existing_item_keys: existingItems.map(getParserItemKey),
    incoming_item: incoming,
    message: `Which ${incoming.item_name ?? incoming.display_name ?? 'item'} line should this update?`,
    actions: [
      ...existingItems.map((item) => ({
        id: 'choose_existing' as const,
        label: `${item.item_name ?? item.display_name ?? 'Item'} ${formatQty(item)}`,
        preview: getParserItemKey(item),
        existing_item_key: getParserItemKey(item),
      })),
      { id: 'keep_separate', label: 'Add as new line', preview: formatQty(incoming) },
      { id: 'cancel', label: 'Cancel' },
    ],
  };
}

function formatQty(item: ParsedItem): string {
  const qty = item.quantity ?? '?';
  return item.quantity == null ? `${qty} ${item.unit ?? ''}`.trim() : formatQuantityWithUnit(item.quantity, item.unit);
}
