import { sanitizeAssistantReply } from './quickOrderErrors';
import {
  getParsedItemDisplayName,
  getParsedItemIssue,
  type PendingQuickOrderClarification,
  type ParsedQuickOrderItem,
  type QuickOrderMergeResult,
} from './quickOrderItems';

export type QuickOrderParseStatus = 'ok' | 'needs_review' | 'needs_clarification' | 'error';

export type QuickOrderParseDiagnostics = {
  parse_mode?: string;
  items_received: number;
  items_accepted: number;
  items_rejected: number;
  rejected_reasons: string[];
  pending_action_count: number;
  unchanged_count?: number;
};

export type RawQuickOrderParseResponse = {
  status?: QuickOrderParseStatus;
  assistant_message?: unknown;
  reply_text?: unknown;
  parsed_items?: unknown;
  pending_actions?: unknown;
  pending_clarifications?: unknown;
  flags?: unknown;
  suggestions?: unknown;
  diagnostics?: Partial<QuickOrderParseDiagnostics> | null;
  error?: unknown;
  detail?: unknown;
  code?: unknown;
};

export type NormalizedQuickOrderParseResponse = {
  status: QuickOrderParseStatus;
  assistantMessage: string;
  parsedItems: ParsedQuickOrderItem[];
  pendingActions: PendingQuickOrderClarification[];
  flags: { type: string; message: string; raw_token?: string; item_id?: string }[];
  suggestions: unknown[];
  diagnostics: QuickOrderParseDiagnostics;
  errorCode?: string;
  rawError?: string;
};

export function normalizeQuickOrderParseResponse(
  value: unknown,
): NormalizedQuickOrderParseResponse {
  const raw = isRecord(value) ? value as RawQuickOrderParseResponse : {};
  const parsedItemsRaw = Array.isArray(raw.parsed_items) ? raw.parsed_items : [];
  const parsedItems: ParsedQuickOrderItem[] = [];
  const rejectedReasons: string[] = [];

  parsedItemsRaw.forEach((entry) => {
    const item = normalizeParsedItem(entry);
    if (item) {
      parsedItems.push(item);
    } else {
      rejectedReasons.push('empty_item');
    }
  });

  const pendingActions = normalizePendingActions(raw.pending_actions ?? raw.pending_clarifications);
  const status = normalizeStatus(raw.status, parsedItems, pendingActions, raw.error);
  const assistantMessage = sanitizeAssistantReply(
    stringValue(raw.assistant_message) ?? stringValue(raw.reply_text),
    status === 'error'
      ? 'I had trouble reading that order. Please try again.'
      : 'I had trouble reading that order. Please try again or add the items manually.',
  );
  const backendDiagnostics = isRecord(raw.diagnostics) ? raw.diagnostics : {};
  const flags = normalizeFlags(raw.flags);

  return {
    status,
    assistantMessage,
    parsedItems,
    pendingActions,
    flags,
    suggestions: Array.isArray(raw.suggestions) ? raw.suggestions : [],
    diagnostics: {
      parse_mode: stringValue(backendDiagnostics.parse_mode) ?? undefined,
      items_received: numberValue(backendDiagnostics.items_received) ?? parsedItemsRaw.length,
      items_accepted: numberValue(backendDiagnostics.items_accepted) ?? parsedItems.length,
      items_rejected: numberValue(backendDiagnostics.items_rejected) ?? rejectedReasons.length,
      rejected_reasons: [
        ...arrayOfStrings(backendDiagnostics.rejected_reasons),
        ...rejectedReasons,
      ],
      pending_action_count: pendingActions.length,
      unchanged_count: numberValue(backendDiagnostics.unchanged_count) ?? undefined,
    },
    errorCode: stringValue(raw.code) ?? undefined,
    rawError: stringValue(raw.error) ?? stringValue(raw.detail) ?? undefined,
  };
}

export function buildQuickOrderAssistantMessage(input: {
  normalized: NormalizedQuickOrderParseResponse;
  mergeResult: QuickOrderMergeResult;
  pendingCount: number;
}): string {
  const { normalized, mergeResult, pendingCount } = input;
  const reviewCount = mergeResult.reviewCount + pendingCount;

  if (mergeResult.addedCount > 0 && reviewCount === 0) {
    if (mergeResult.unchangedCount > 0) {
      const label = formatAddedItems(mergeResult.addedItems);
      return `Added ${label}. The other ${mergeResult.unchangedCount} item${mergeResult.unchangedCount === 1 ? ' was' : 's were'} already in your order.`;
    }
    return `Added ${mergeResult.addedCount} item${mergeResult.addedCount === 1 ? '' : 's'}.`;
  }

  if (mergeResult.addedCount > 0 && reviewCount > 0) {
    return `Added ${mergeResult.addedCount} item${mergeResult.addedCount === 1 ? '' : 's'}. Please review ${reviewCount} item${reviewCount === 1 ? '' : 's'}.`;
  }

  if (mergeResult.updatedCount > 0 && reviewCount === 0) {
    return `Updated ${mergeResult.updatedCount} item${mergeResult.updatedCount === 1 ? '' : 's'}.`;
  }

  if (reviewCount > 0) {
    return pendingCount > 0
      ? 'I found duplicates. Please choose how to handle them.'
      : 'I found items that need review before adding.';
  }

  if (mergeResult.unchangedCount > 0) {
    return mergeResult.unchangedCount === 1
      ? 'That item is already in your order.'
      : 'Those items are already in your order.';
  }

  if (normalized.parsedItems.length === 0 && normalized.pendingActions.length === 0) {
    return 'I had trouble reading that order. Please try again or add the items manually.';
  }

  return normalized.assistantMessage;
}

export function hasQuickOrderStateChange(result: QuickOrderMergeResult, pendingCount: number): boolean {
  return result.addedCount > 0 || result.updatedCount > 0 || result.reviewCount > 0 || pendingCount > 0;
}

function normalizeParsedItem(value: unknown): ParsedQuickOrderItem | null {
  if (!isRecord(value)) return null;
  const rawText = stringValue(value.raw_text) ?? stringValue(value.raw_token) ?? '';
  const displayName =
    stringValue(value.display_name) ??
    stringValue(value.item_name) ??
    stringValue(value.name) ??
    stringValue(value.matched_name) ??
    rawText;
  const itemId = stringValue(value.item_id);
  const quantity = numberValue(value.quantity);
  const unit = stringValue(value.unit);
  const status = normalizeItemStatus(value.status, itemId, quantity, unit, Boolean(value.needs_clarification));

  if (!itemId && !displayName && !rawText && quantity == null && !unit) return null;

  return {
    id: stringValue(value.id) ?? undefined,
    client_key: stringValue(value.client_key) ?? undefined,
    item_id: itemId,
    item_name: stringValue(value.item_name) ?? (displayName || undefined),
    display_name: displayName || undefined,
    name: stringValue(value.name) ?? (displayName || undefined),
    raw_token: stringValue(value.raw_token) ?? rawText,
    raw_text: rawText || stringValue(value.raw_token) || displayName,
    quantity,
    unit,
    confidence: numberValue(value.confidence) ?? undefined,
    needs_clarification: Boolean(value.needs_clarification) || status !== 'valid',
    unresolved: Boolean(value.unresolved) || !itemId,
    notes: stringValue(value.notes),
    issue: stringValue(value.issue) ?? undefined,
    alternatives: normalizeAlternatives(value.alternatives),
    parse_source: normalizeParseSource(value.parse_source),
    status,
    match_type: stringValue(value.match_type) ?? undefined,
    pending_conflict_id: stringValue(value.pending_conflict_id) ?? undefined,
    merge_behavior: normalizeMergeBehavior(value.merge_behavior),
    existing_item_key: stringValue(value.existing_item_key) ?? undefined,
  };
}

function normalizeItemStatus(
  value: unknown,
  itemId: string | null,
  quantity: number | null,
  unit: string | null,
  needsClarification: boolean,
): ParsedQuickOrderItem['status'] {
  if (
    value === 'valid' ||
    value === 'review' ||
    value === 'missing_quantity' ||
    value === 'missing_unit' ||
    value === 'ambiguous' ||
    value === 'invalid'
  ) {
    return value;
  }
  if (!itemId) return 'ambiguous';
  if (quantity == null) return 'missing_quantity';
  if (!unit) return 'missing_unit';
  return needsClarification ? 'review' : 'valid';
}

function normalizeParseSource(value: unknown): ParsedQuickOrderItem['parse_source'] {
  return value === 'fuzzy' || value === 'llm' || value === 'manual' || value === 'correction'
    ? value
    : 'deterministic';
}

function normalizeMergeBehavior(value: unknown): ParsedQuickOrderItem['merge_behavior'] {
  return value === 'add_to_existing' || value === 'replace_existing' || value === 'keep_separate'
    ? value
    : undefined;
}

function normalizePendingActions(value: unknown): PendingQuickOrderClarification[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((entry) => ({
      id: stringValue(entry.id) ?? `pending:${stringValue(entry.message) ?? Math.random().toString(36).slice(2)}`,
      type: normalizePendingType(entry.type),
      item_id: stringValue(entry.item_id),
      item_name: stringValue(entry.item_name) ?? 'Item',
      existing_item_key: stringValue(entry.existing_item_key) ?? undefined,
      existing_item_keys: arrayOfStrings(entry.existing_item_keys),
      incoming_item: normalizeParsedItem(entry.incoming_item) ?? undefined,
      message: stringValue(entry.message) ?? 'Review this item.',
      actions: Array.isArray(entry.actions)
        ? entry.actions.filter(isRecord).map((action) => ({
          id: normalizeActionId(action.id),
          label: stringValue(action.label) ?? 'Review',
          preview: stringValue(action.preview) ?? undefined,
          existing_item_key: stringValue(action.existing_item_key) ?? undefined,
        }))
        : [],
    }));
}

function normalizePendingType(value: unknown): PendingQuickOrderClarification['type'] {
  return value === 'unit_conflict' ||
    value === 'missing_quantity' ||
    value === 'missing_unit' ||
    value === 'ambiguous_item' ||
    value === 'choose_existing_line'
    ? value
    : 'quantity_conflict';
}

function normalizeActionId(value: unknown): PendingQuickOrderClarification['actions'][number]['id'] {
  return value === 'replace' || value === 'keep_separate' || value === 'cancel' || value === 'choose_existing'
    ? value
    : 'add';
}

function normalizeAlternatives(value: unknown): ParsedQuickOrderItem['alternatives'] {
  if (!Array.isArray(value)) return undefined;
  const alternatives = value.filter(isRecord).map((entry) => ({
    item_id: stringValue(entry.item_id) ?? '',
    item_name: stringValue(entry.item_name) ?? '',
    confidence: numberValue(entry.confidence) ?? 0,
  })).filter((entry) => entry.item_id && entry.item_name);
  return alternatives.length > 0 ? alternatives : undefined;
}

function normalizeFlags(value: unknown): NormalizedQuickOrderParseResponse['flags'] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((entry) => ({
    type: stringValue(entry.type) ?? 'parser_notice',
    message: stringValue(entry.message) ?? 'Review this item.',
    raw_token: stringValue(entry.raw_token) ?? undefined,
    item_id: stringValue(entry.item_id) ?? undefined,
  }));
}

function normalizeStatus(
  value: unknown,
  items: ParsedQuickOrderItem[],
  pendingActions: PendingQuickOrderClarification[],
  error: unknown,
): QuickOrderParseStatus {
  if (value === 'ok' || value === 'needs_review' || value === 'needs_clarification' || value === 'error') return value;
  if (error) return 'error';
  if (pendingActions.length > 0) return 'needs_clarification';
  if (items.some((item) => getParsedItemIssue(item))) return 'needs_review';
  return items.length > 0 ? 'ok' : 'error';
}

function formatAddedItems(items: ParsedQuickOrderItem[]): string {
  if (items.length === 1) return getParsedItemDisplayName(items[0]);
  return `${items.length} items`;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
