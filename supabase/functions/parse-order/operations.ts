/**
 * Builds remove / replace / update / clear operations from parsed intent + items.
 *
 * This module is called by the orchestrator when the intent detector finds a
 * command intent (remove, replace, update, increase, decrease, clear). It
 * matches parsed items against the existing order and produces a list of
 * {@link QuickOrderOperation}s that the frontend applies to the local state.
 */

import { getParserItemKey, createClientKey } from './conflicts.ts';
import { normalizeSearchText } from './catalog-matcher.ts';
import type {
  CatalogItem,
  ParsedItem,
  ParseFlag,
  PendingQuickOrderClarification,
  QuickOrderOperation,
} from './types.ts';
import type { QuickOrderIntent } from './intent-detector.ts';
import { normalizeUnitForComparison } from './units.ts';

export type OperationBuilderInput = {
  intent: QuickOrderIntent;
  parsedItems: ParsedItem[];
  existingItems: ParsedItem[];
  rawText: string;
  catalog: CatalogItem[];
};

export type OperationBuilderResult = {
  operations: QuickOrderOperation[];
  pendingClarifications: PendingQuickOrderClarification[];
  flags: ParseFlag[];
  assistantMessage: string;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildCommandOperations(input: OperationBuilderInput): OperationBuilderResult {
  switch (input.intent) {
    case 'remove':
      return buildRemoveOperations(input);
    case 'replace':
    case 'update':
      return buildReplaceOperations(input);
    case 'increase':
      return buildIncreaseOperations(input);
    case 'decrease':
      return buildDecreaseOperations(input);
    case 'clear':
      return buildClearOperation(input);
    default:
      return emptyResult('No command recognised.');
  }
}

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

function buildRemoveOperations(input: OperationBuilderInput): OperationBuilderResult {
  const operations: QuickOrderOperation[] = [];
  const pendingClarifications: PendingQuickOrderClarification[] = [];
  const flags: ParseFlag[] = [];
  const removedNames: string[] = [];

  for (const parsed of input.parsedItems) {
    const matches = findMatchingExistingItems(parsed, input.existingItems);

    if (matches.length === 1) {
      const target = matches[0];
      const displayName = target.display_name ?? target.item_name ?? target.raw_token ?? 'Item';
      operations.push({
        type: 'remove',
        target_item_id: target.item_id,
        target_display_name: displayName,
        target_item_key: getParserItemKey(target),
        quantity: target.quantity,
        unit: target.unit,
        status: 'applied',
        message: `Removed ${displayName}.`,
      });
      removedNames.push(displayName);
    } else if (matches.length > 1) {
      pendingClarifications.push({
        id: createClientKey('remove'),
        type: 'remove_ambiguous',
        item_id: parsed.item_id,
        item_name: parsed.item_name ?? parsed.display_name ?? parsed.raw_token ?? 'Item',
        message: `Which item should I remove?`,
        actions: [
          ...matches.map((match) => ({
            id: 'replace' as const,
            label: `${match.display_name ?? match.item_name ?? match.raw_token ?? 'Item'} ${formatQty(match)}`,
            existing_item_key: getParserItemKey(match),
          })),
          { id: 'cancel' as const, label: 'Cancel' },
        ],
      });
    } else {
      const searchName = parsed.display_name ?? parsed.item_name ?? parsed.raw_token ?? 'item';
      operations.push({
        type: 'no_op',
        target_item_id: null,
        target_display_name: searchName,
        status: 'failed',
        message: `I couldn't find ${searchName} in your current order.`,
      });
      flags.push({
        type: 'unresolved_item',
        message: `I couldn't find "${searchName}" in the current order.`,
        raw_token: parsed.raw_token,
        reason: 'remove_target_not_found',
      });
    }
  }

  if (input.parsedItems.length === 0) {
    return emptyResult("I couldn't tell which item to remove. Try: remove [item name]");
  }

  const message = removedNames.length > 0
    ? removedNames.length === 1
      ? `Removed ${removedNames[0]}.`
      : `Removed ${removedNames.length} items.`
    : operations.find((op) => op.status === 'failed')?.message
      ?? pendingClarifications[0]?.message
      ?? "I couldn't find that item.";

  return { operations, pendingClarifications, flags, assistantMessage: message };
}

// ---------------------------------------------------------------------------
// Replace / Update
// ---------------------------------------------------------------------------

function buildReplaceOperations(input: OperationBuilderInput): OperationBuilderResult {
  const operations: QuickOrderOperation[] = [];
  const flags: ParseFlag[] = [];
  const updatedNames: string[] = [];

  for (const parsed of input.parsedItems) {
    const matches = findMatchingExistingItems(parsed, input.existingItems);

    if (matches.length >= 1) {
      const target = matches[0];
      const displayName = target.display_name ?? target.item_name ?? target.raw_token ?? 'Item';
      const newQty = parsed.quantity ?? target.quantity;
      const newUnit = parsed.unit ?? target.unit;
      operations.push({
        type: 'replace',
        target_item_id: target.item_id,
        target_display_name: displayName,
        target_item_key: getParserItemKey(target),
        quantity: newQty,
        unit: newUnit,
        status: 'applied',
        message: `Updated ${displayName} to ${newQty} ${newUnit ?? ''}.`.trim(),
      });
      updatedNames.push(displayName);
    } else {
      const searchName = parsed.display_name ?? parsed.item_name ?? parsed.raw_token ?? 'item';
      operations.push({
        type: 'no_op',
        target_item_id: null,
        target_display_name: searchName,
        status: 'failed',
        message: `I couldn't find ${searchName} in your current order to update.`,
      });
    }
  }

  const message = updatedNames.length > 0
    ? updatedNames.length === 1
      ? operations.find((op) => op.status === 'applied')?.message ?? `Updated ${updatedNames[0]}.`
      : `Updated ${updatedNames.length} items.`
    : operations.find((op) => op.status === 'failed')?.message ?? "I couldn't find that item to update.";

  return { operations, pendingClarifications: [], flags, assistantMessage: message };
}

// ---------------------------------------------------------------------------
// Increase (add more to existing)
// ---------------------------------------------------------------------------

function buildIncreaseOperations(input: OperationBuilderInput): OperationBuilderResult {
  const operations: QuickOrderOperation[] = [];
  const updatedNames: string[] = [];

  for (const parsed of input.parsedItems) {
    const matches = findMatchingExistingItems(parsed, input.existingItems);

    if (matches.length >= 1) {
      // Prefer same-unit match.
      const sameUnitMatch = matches.find((m) =>
        normalizeUnitForComparison(m.unit) === normalizeUnitForComparison(parsed.unit),
      ) ?? matches[0];

      const displayName = sameUnitMatch.display_name ?? sameUnitMatch.item_name ?? 'Item';
      const addQty = parsed.quantity ?? 0;
      const newQty = (sameUnitMatch.quantity ?? 0) + addQty;
      operations.push({
        type: 'update_quantity',
        target_item_id: sameUnitMatch.item_id,
        target_display_name: displayName,
        target_item_key: getParserItemKey(sameUnitMatch),
        quantity: newQty,
        unit: parsed.unit ?? sameUnitMatch.unit,
        status: 'applied',
        message: `Updated ${displayName} to ${newQty} ${parsed.unit ?? sameUnitMatch.unit ?? ''}.`.trim(),
      });
      updatedNames.push(displayName);
    } else {
      // No existing item to add to — treat as a new add (operation is add, not update).
      operations.push({
        type: 'add',
        target_item_id: parsed.item_id,
        target_display_name: parsed.display_name ?? parsed.item_name ?? parsed.raw_token ?? 'Item',
        quantity: parsed.quantity,
        unit: parsed.unit,
        status: 'applied',
        message: `Added ${parsed.display_name ?? parsed.item_name ?? parsed.raw_token ?? 'item'}.`,
      });
    }
  }

  const message = updatedNames.length > 0
    ? operations.find((op) => op.status === 'applied')?.message ?? `Updated ${updatedNames.length} items.`
    : operations.find((op) => op.status === 'applied')?.message ?? 'Done.';

  return { operations, pendingClarifications: [], flags: [], assistantMessage: message };
}

// ---------------------------------------------------------------------------
// Decrease
// ---------------------------------------------------------------------------

function buildDecreaseOperations(input: OperationBuilderInput): OperationBuilderResult {
  const operations: QuickOrderOperation[] = [];
  const updatedNames: string[] = [];

  for (const parsed of input.parsedItems) {
    const matches = findMatchingExistingItems(parsed, input.existingItems);

    if (matches.length >= 1) {
      const target = matches[0];
      const displayName = target.display_name ?? target.item_name ?? 'Item';
      const subtractQty = parsed.quantity ?? 0;
      const newQty = Math.max(0, (target.quantity ?? 0) - subtractQty);
      if (newQty <= 0) {
        operations.push({
          type: 'remove',
          target_item_id: target.item_id,
          target_display_name: displayName,
          target_item_key: getParserItemKey(target),
          status: 'applied',
          message: `Removed ${displayName} (quantity reduced to 0).`,
        });
      } else {
        operations.push({
          type: 'update_quantity',
          target_item_id: target.item_id,
          target_display_name: displayName,
          target_item_key: getParserItemKey(target),
          quantity: newQty,
          unit: target.unit,
          status: 'applied',
          message: `Reduced ${displayName} to ${newQty} ${target.unit ?? ''}.`.trim(),
        });
      }
      updatedNames.push(displayName);
    } else {
      const searchName = parsed.display_name ?? parsed.item_name ?? parsed.raw_token ?? 'item';
      operations.push({
        type: 'no_op',
        target_item_id: null,
        target_display_name: searchName,
        status: 'failed',
        message: `I couldn't find ${searchName} in your current order to reduce.`,
      });
    }
  }

  const message = operations.find((op) => op.status === 'applied')?.message
    ?? operations.find((op) => op.status === 'failed')?.message
    ?? 'Done.';

  return { operations, pendingClarifications: [], flags: [], assistantMessage: message };
}

// ---------------------------------------------------------------------------
// Clear
// ---------------------------------------------------------------------------

function buildClearOperation(_input: OperationBuilderInput): OperationBuilderResult {
  return {
    operations: [{
      type: 'clear',
      target_item_id: null,
      target_display_name: 'All items',
      status: 'applied',
      message: 'Cleared the order.',
    }],
    pendingClarifications: [],
    flags: [],
    assistantMessage: 'Cleared the order.',
  };
}

// ---------------------------------------------------------------------------
// Matching helpers
// ---------------------------------------------------------------------------

/**
 * Finds existing items that match a parsed item, using a priority cascade:
 * 1. item_id exact match (same unit)
 * 2. item_id match (any unit)
 * 3. Normalized display_name / item_name match
 * 4. Normalized raw_token match
 * 5. Parenthetical/alias substring match
 */
function findMatchingExistingItems(parsed: ParsedItem, existing: ParsedItem[]): ParsedItem[] {
  if (existing.length === 0) return [];

  // 1. Exact item_id + unit match.
  if (parsed.item_id) {
    const exactUnitMatches = existing.filter(
      (item) => item.item_id === parsed.item_id
        && (!parsed.unit || normalizeUnitForComparison(item.unit) === normalizeUnitForComparison(parsed.unit)),
    );
    if (exactUnitMatches.length > 0) return exactUnitMatches;

    // 2. item_id match (any unit).
    const idMatches = existing.filter((item) => item.item_id === parsed.item_id);
    if (idMatches.length > 0) return idMatches;
  }

  // 3. Normalized display name match.
  const parsedName = normalizeSearchText(
    parsed.display_name ?? parsed.item_name ?? parsed.raw_token ?? '',
  );
  if (parsedName) {
    const nameMatches = existing.filter((item) => {
      const dn = normalizeSearchText(item.display_name ?? item.item_name ?? '');
      const in_ = normalizeSearchText(item.item_name ?? '');
      return dn === parsedName || in_ === parsedName;
    });
    if (nameMatches.length > 0) return nameMatches;

    // 4. raw_token match.
    const rawMatches = existing.filter((item) => {
      const raw = normalizeSearchText(item.raw_token ?? item.raw_text ?? '');
      return raw === parsedName;
    });
    if (rawMatches.length > 0) return rawMatches;

    // 5. Parenthetical / substring match — check if parsedName appears inside
    //    an existing item's display name or vice versa.
    const parentheticalMatches = existing.filter((item) => {
      const dn = normalizeSearchText(item.display_name ?? item.item_name ?? '');
      if (!dn) return false;
      // "izumidai" matches "white fish izumidai" (parenthetical sub-term).
      return dn.includes(parsedName) || parsedName.includes(dn);
    });
    if (parentheticalMatches.length > 0) return parentheticalMatches;
  }

  return [];
}

function formatQty(item: ParsedItem): string {
  const qty = item.quantity ?? '?';
  return `${qty} ${item.unit ?? ''}`.trim();
}

function emptyResult(message: string): OperationBuilderResult {
  return { operations: [], pendingClarifications: [], flags: [], assistantMessage: message };
}
