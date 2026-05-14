import { sanitizeAssistantReply } from './quickOrderErrors';
import {
  getParsedItemDisplayName,
  getParsedItemIssue,
  normalizeQuickOrderItemForDisplay,
  type PendingQuickOrderClarification,
  type ParsedQuickOrderItem,
  type QuickOrderMergeResult,
  type QuickOrderOperation,
  type QuickOrderOperationResult,
} from './quickOrderItems';

export type QuickOrderParseStatus = 'ok' | 'needs_review' | 'needs_clarification' | 'error';

export type QuickOrderParseDiagnostics = {
  parser_version?: string;
  parse_mode?: string;
  catalog_count?: number;
  candidate_count?: number;
  items_before_validation?: number;
  items_after_validation?: number;
  valid_count?: number;
  review_count?: number;
  items_received: number;
  items_accepted: number;
  items_rejected: number;
  rejected_reasons: string[];
  pending_action_count: number;
  unchanged_count?: number;
  input_classification?: string;
  input_classification_reason?: string;
  llm_lines_sent?: number;
  llm_replaced_count?: number;
  replaced_review_count?: number;
  duplicate_line_count?: number;
  ignored_llm_extra_count?: number;
  catalog_debug?: unknown;
  item_diagnostics?: unknown;
  error_code?: string;
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
  operations: QuickOrderOperation[];
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
  const operations = normalizeOperations((raw as Record<string, unknown>).operations);
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
      parser_version: stringValue(backendDiagnostics.parser_version) ?? undefined,
      parse_mode: stringValue(backendDiagnostics.parse_mode) ?? undefined,
      catalog_count: numberValue(backendDiagnostics.catalog_count) ?? undefined,
      candidate_count: numberValue(backendDiagnostics.candidate_count) ?? undefined,
      items_before_validation: numberValue(backendDiagnostics.items_before_validation) ?? undefined,
      items_after_validation: numberValue(backendDiagnostics.items_after_validation) ?? undefined,
      valid_count: numberValue(backendDiagnostics.valid_count) ?? undefined,
      review_count: numberValue(backendDiagnostics.review_count) ?? undefined,
      items_received: numberValue(backendDiagnostics.items_received) ?? parsedItemsRaw.length,
      items_accepted: numberValue(backendDiagnostics.items_accepted) ?? parsedItems.length,
      items_rejected: numberValue(backendDiagnostics.items_rejected) ?? rejectedReasons.length,
      rejected_reasons: [
        ...arrayOfStrings(backendDiagnostics.rejected_reasons),
        ...rejectedReasons,
      ],
      pending_action_count: pendingActions.length,
      unchanged_count: numberValue(backendDiagnostics.unchanged_count) ?? undefined,
      input_classification: stringValue(backendDiagnostics.input_classification) ?? undefined,
      input_classification_reason: stringValue(backendDiagnostics.input_classification_reason) ?? undefined,
      llm_lines_sent: numberValue(backendDiagnostics.llm_lines_sent) ?? undefined,
      llm_replaced_count: numberValue(backendDiagnostics.llm_replaced_count) ?? undefined,
      replaced_review_count: numberValue(backendDiagnostics.replaced_review_count) ?? undefined,
      duplicate_line_count: numberValue(backendDiagnostics.duplicate_line_count) ?? undefined,
      ignored_llm_extra_count: numberValue(backendDiagnostics.ignored_llm_extra_count) ?? undefined,
      catalog_debug: backendDiagnostics.catalog_debug,
      item_diagnostics: backendDiagnostics.item_diagnostics,
      error_code: stringValue(backendDiagnostics.error_code) ?? undefined,
    },
    errorCode: stringValue(raw.code) ?? undefined,
    rawError: stringValue(raw.error) ?? stringValue(raw.detail) ?? undefined,
    operations,
  };
}

export function buildQuickOrderAssistantMessage(input: {
  normalized: NormalizedQuickOrderParseResponse;
  mergeResult: QuickOrderMergeResult;
  pendingCount: number;
  operationResult?: QuickOrderOperationResult | null;
}): string {
  const { normalized, mergeResult, pendingCount, operationResult } = input;
  const reviewCount = mergeResult.reviewCount + pendingCount;

  // If operations were applied, build message from operations.
  if (operationResult && (operationResult.removedCount > 0 || operationResult.updatedCount > 0)) {
    const parts: string[] = [];
    if (operationResult.removedCount > 0) {
      // Use the backend assistant message which is more specific (includes item name).
      return normalized.assistantMessage;
    }
    if (operationResult.updatedCount > 0) {
      return normalized.assistantMessage;
    }
    return parts.join(' ') || normalized.assistantMessage;
  }

  // If the response has operations but no merge changes, use backend message.
  if (normalized.operations.length > 0 && normalized.operations.some((op) => op.status === 'applied')) {
    return normalized.assistantMessage;
  }

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
    if (mergeResult.updatedItems.length === 1) {
      const item = mergeResult.updatedItems[0];
      const quantity = item.quantity != null && item.unit
        ? ` to ${item.quantity} ${item.unit}`
        : '';
      return `Updated ${getParsedItemDisplayName(item)}${quantity}.`;
    }
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

  if (normalized.parsedItems.length === 0 && normalized.pendingActions.length === 0 && normalized.operations.length === 0) {
    return isGenericNoChangeMessage(normalized.assistantMessage)
      ? 'I had trouble reading that order. Please try again or add the items manually.'
      : normalized.assistantMessage;
  }

  return normalized.assistantMessage;
}

function isGenericNoChangeMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return normalized === '' || normalized === 'got it.' || normalized === 'got it';
}

export function hasQuickOrderStateChange(
  result: QuickOrderMergeResult,
  pendingCount: number,
  operationResult?: QuickOrderOperationResult | null,
): boolean {
  if (result.addedCount > 0 || result.updatedCount > 0 || result.reviewCount > 0 || pendingCount > 0) return true;
  if (operationResult && (operationResult.removedCount > 0 || operationResult.updatedCount > 0)) return true;
  return false;
}

function normalizeParsedItem(value: unknown): ParsedQuickOrderItem | null {
  if (!isRecord(value)) return null;
  const rawText = stringValue(value.raw_text) ?? stringValue(value.raw_token) ?? '';
  const itemText = stringValue(value.item_text);
  const itemId = stringValue(value.item_id);
  const displayName =
    (itemId ? stringValue(value.item_name) : null) ??
    itemText ??
    stringValue(value.display_name) ??
    stringValue(value.item_name) ??
    stringValue(value.name) ??
    stringValue(value.matched_name) ??
    rawText;
  const quantity = numberValue(value.quantity);
  const unit = stringValue(value.unit);
  const status = normalizeItemStatus(value.status, itemId, quantity, unit, Boolean(value.needs_clarification));

  if (!itemId && !displayName && !rawText && quantity == null && !unit) return null;

  return normalizeQuickOrderItemForDisplay({
    id: stringValue(value.id) ?? undefined,
    line_id: stringValue(value.line_id) ?? undefined,
    client_key: stringValue(value.client_key) ?? undefined,
    item_id: itemId,
    item_name: stringValue(value.item_name) ?? (displayName || undefined),
    item_text: itemText ?? undefined,
    display_name: displayName || undefined,
    name: stringValue(value.name) ?? (displayName || undefined),
    raw_token: stringValue(value.raw_token) ?? rawText,
    raw_text: rawText || stringValue(value.raw_token) || displayName,
    quantity,
    unit,
    valid_units: arrayOfStrings(value.valid_units),
    confidence: numberValue(value.confidence) ?? undefined,
    needs_clarification: Boolean(value.needs_clarification) || status !== 'valid',
    unresolved: Boolean(value.unresolved) || !itemId,
    notes: stringValue(value.notes),
    issue: stringValue(value.issue) ?? undefined,
    issue_code: stringValue(value.issue_code) ?? undefined,
    action: normalizeItemAction(value.action),
    alternatives: normalizeAlternatives(value.alternatives),
    parse_source: normalizeParseSource(value.parse_source),
    status,
    match_type: stringValue(value.match_type) ?? undefined,
    pending_conflict_id: stringValue(value.pending_conflict_id) ?? undefined,
    merge_behavior: normalizeMergeBehavior(value.merge_behavior),
    existing_item_key: stringValue(value.existing_item_key) ?? undefined,
  });
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
    value === 'no_match' ||
    value === 'missing_quantity' ||
    value === 'missing_unit' ||
    value === 'missing_quantity_and_unit' ||
    value === 'ambiguous' ||
    value === 'invalid_unit' ||
    value === 'duplicate_needs_decision'
  ) {
    return value;
  }
  if (!itemId) return 'no_match';
  if (quantity == null) return 'missing_quantity';
  if (!unit) return 'missing_unit';
  return 'valid';
}

function normalizeItemAction(value: unknown): ParsedQuickOrderItem['action'] {
  return value === 'Add quantity' ||
    value === 'Choose unit' ||
    value === 'Fix unit' ||
    value === 'Choose item' ||
    value === 'Add or replace'
    ? value
    : null;
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
    value === 'choose_existing_line' ||
    value === 'clear_order'
    ? value
    : 'quantity_conflict';
}

function normalizeActionId(value: unknown): PendingQuickOrderClarification['actions'][number]['id'] {
  return value === 'replace' || value === 'keep_separate' || value === 'cancel' || value === 'choose_existing' || value === 'clear_order'
    ? value
    : 'add';
}

function normalizeAlternatives(value: unknown): ParsedQuickOrderItem['alternatives'] {
  if (!Array.isArray(value)) return undefined;
  const alternatives = value.filter(isRecord).map((entry) => ({
    item_id: stringValue(entry.item_id) ?? '',
    item_name: stringValue(entry.item_name) ?? '',
    confidence: numberValue(entry.confidence) ?? 0,
    score: numberValue(entry.score) ?? undefined,
    term: stringValue(entry.term) ?? undefined,
    matched_term: stringValue(entry.matched_term) ?? undefined,
    match_type: stringValue(entry.match_type) ?? undefined,
    reason: stringValue(entry.reason) ?? undefined,
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

function normalizeOperations(value: unknown): QuickOrderOperation[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((entry) => ({
    type: normalizeOperationType(entry.type),
    target_item_id: stringValue(entry.target_item_id),
    target_display_name: stringValue(entry.target_display_name) ?? 'Item',
    target_item_key: stringValue(entry.target_item_key) ?? undefined,
    quantity: numberValue(entry.quantity) ?? undefined,
    unit: stringValue(entry.unit) ?? undefined,
    status: entry.status === 'applied' || entry.status === 'pending' || entry.status === 'failed'
      ? entry.status as 'applied' | 'pending' | 'failed'
      : 'pending',
    message: stringValue(entry.message) ?? undefined,
  }));
}

function normalizeOperationType(value: unknown): QuickOrderOperation['type'] {
  if (
    value === 'add' ||
    value === 'remove' ||
    value === 'replace' ||
    value === 'update_quantity' ||
    value === 'update_unit' ||
    value === 'clear'
  ) {
    return value;
  }
  return 'no_op';
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
