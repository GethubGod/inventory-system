import type { InventoryItem } from '@/types';
import type {
  VoiceParsedAction,
  VoiceUnresolvedAction,
} from '@/features/ordering/quickOrderVoice';
import { clampQuantity, unitForInventoryItem } from './checklistSelection';

/**
 * Pure search/matching helpers for the pinned order bar. Kept free of
 * React/React Native imports so they are unit-testable in plain Jest.
 */

export const MAX_SEARCH_RESULTS = 30;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Filters the full inventory catalog by name or alias. Name-prefix matches
 * rank ahead of name substring matches, which rank ahead of alias matches,
 * preserving catalog order within each tier.
 */
export function filterCatalogItems(
  items: InventoryItem[],
  query: string,
  limit: number = MAX_SEARCH_RESULTS,
): InventoryItem[] {
  const normalized = normalize(query);
  if (normalized.length === 0) return [];

  const prefix: InventoryItem[] = [];
  const substring: InventoryItem[] = [];
  const alias: InventoryItem[] = [];

  for (const item of items) {
    const name = normalize(item.name);
    if (name.startsWith(normalized)) {
      prefix.push(item);
    } else if (name.includes(normalized)) {
      substring.push(item);
    } else if (
      (item.aliases ?? []).some((entry) => normalize(entry).includes(normalized))
    ) {
      alias.push(item);
    }
    if (prefix.length >= limit) break;
  }

  return [...prefix, ...substring, ...alias].slice(0, limit);
}

export interface VoiceAddition {
  item: InventoryItem;
  /** Quantity heard, clamped to checklist bounds; null = keep the default. */
  quantity: number | null;
  /** The unit the order line will actually use (item config, not speech). */
  unit: string;
  /** Unit as heard, when it differs from the line unit — surfaced for review. */
  spokenUnit: string | null;
  spokenText: string;
}

export interface VoiceMappingResult {
  additions: VoiceAddition[];
  /** Things that were heard but cannot be added automatically. */
  unmatched: string[];
}

/**
 * Maps the voice-parse response onto catalog items the checklist can add.
 * Only `add` actions with a resolved catalog item become additions; everything
 * else is reported as unmatched so nothing is silently dropped.
 */
export function mapVoiceActionsToAdditions(
  actions: VoiceParsedAction[],
  unresolved: VoiceUnresolvedAction[],
  items: InventoryItem[],
): VoiceMappingResult {
  const byId = new Map(items.map((item) => [item.id, item]));
  const additions: VoiceAddition[] = [];
  const unmatched: string[] = [];
  const seenItemIds = new Set<string>();

  for (const action of actions) {
    const spokenText = action.spokenItemName || action.itemName || action.sourceText;
    if (action.type !== 'add') {
      if (spokenText) unmatched.push(spokenText);
      continue;
    }
    const item = action.itemId ? byId.get(action.itemId) : undefined;
    if (!item) {
      if (spokenText) unmatched.push(spokenText);
      continue;
    }
    if (seenItemIds.has(item.id)) continue;
    seenItemIds.add(item.id);

    const lineUnit = unitForInventoryItem(item);
    const spokenUnit = action.unit?.trim() || null;
    additions.push({
      item,
      quantity:
        typeof action.quantity === 'number' && action.quantity > 0
          ? clampQuantity(action.quantity)
          : null,
      unit: lineUnit,
      spokenUnit:
        spokenUnit && normalize(spokenUnit) !== normalize(lineUnit)
          ? spokenUnit
          : null,
      spokenText,
    });
  }

  for (const entry of unresolved) {
    const label = entry.spokenItemName || entry.sourceText;
    if (label) unmatched.push(label);
  }

  return { additions, unmatched };
}
