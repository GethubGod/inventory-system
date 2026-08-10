import { sanitizeAssistantReply } from './quickOrderErrors';
import {
  getParsedItemDisplayName,
  getParsedItemIssue,
  formatQuickOrderQuantity,
  normalizeQuickOrderItemForDisplay,
  type PendingQuickOrderClarification,
  type ParsedQuickOrderItem,
  type QuickOrderMergeResult,
  type QuickOrderOperation,
  type QuickOrderOperationResult,
} from './quickOrderItems';

const QUICK_ORDER_TUTORIAL_MESSAGE = [
  'I’m Tuna Intelligence. I help create Quick Order drafts from typed orders.',
  [
    'You can say:',
    '- "Salmon 3 cases"',
    '- "Remove salmon"',
    '- "We have 2 cases avocado left"',
    '- "Show my recent orders"',
    '- "Use last week’s order"',
    '- "What should I buy if I have 2 cases salmon left?"',
    '- "Undo that"',
  ].join('\n'),
  'I’ll ask if something is unclear.',
].join('\n\n');

export type QuickOrderParseStatus =
  | 'ok'
  | 'needs_review'
  | 'needs_clarification'
  | 'partial_success'
  | 'blocked'
  | 'qa_answer'
  | 'error';

export type QuickOrderMessageSource = 'typed' | 'voice' | 'welcome';

export type QuickOrderStockUpdate = {
  item_id: string;
  item_name: string;
  quantity: number;
  unit: string | null;
  source: QuickOrderMessageSource;
  confidence: number;
  original_text: string;
  approximate_modifier?: string | null;
  /** Phrase from the employee's personal alias that resolved this item, if any. */
  personal_alias?: string | null;
  /** True when no unit was typed and the item's own unit was filled in. */
  unit_inferred?: boolean;
  resolution?: Record<string, unknown> | null;
  reason_codes?: string[];
  resolution_trace?: string[];
  user_visible_note?: string | null;
};

export type QuickOrderSafetyWarning = {
  type: string;
  message: string;
  item_id?: string | null;
  item_name?: string | null;
  quantity?: number | null;
  unit?: string | null;
  severity?: 'info' | 'warning' | 'blocked';
  resolution?: Record<string, unknown> | null;
  reason_codes?: string[];
  resolution_trace?: string[];
  user_visible_note?: string | null;
};

export type QuickOrderBlockedOperation = {
  type: string;
  item_id?: string | null;
  item_name?: string | null;
  attempted_quantity?: number | null;
  unit?: string | null;
  reason: string;
  message: string;
};

export type QuickOrderRecommendation = {
  item_id: string;
  item_name: string;
  suggested_quantity: number;
  unit: string | null;
  confidence: number;
  reason: string;
  inputs?: Record<string, unknown>;
  safety_status: 'normal' | 'confirm' | 'manager_approval' | 'blocked';
  recommendation_type?: 'stock_reorder_rule' | 'history_profile' | 'recent_history';
  auto_apply_eligible?: boolean;
  resolution?: Record<string, unknown> | null;
  reason_codes?: string[];
  resolution_trace?: string[];
  user_visible_note?: string | null;
};

export type QuickOrderAssistantAction = {
  id: string;
  type: string;
  label: string;
  operation?: string;
  mutationId?: string;
  disabled?: boolean;
  status?: string;
  payload?: Record<string, unknown>;
};

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
  segment_count?: number;
  order_segment_count?: number;
  stock_segment_count?: number;
  recommendation_segment_count?: number;
  unknown_segment_count?: number;
  segment_intents?: unknown;
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
  status?: unknown;
  legacy_status?: unknown;
  assistant_message?: unknown;
  assistantMessage?: unknown;
  reply_text?: unknown;
  replyText?: unknown;
  display_message?: unknown;
  displayMessage?: unknown;
  speech_message?: unknown;
  speechMessage?: unknown;
  parsed_items?: unknown;
  parsedItems?: unknown;
  pending_actions?: unknown;
  pending_clarifications?: unknown;
  clarifications?: unknown;
  flags?: unknown;
  suggestions?: unknown;
  stock_updates?: unknown;
  recommendations?: unknown;
  safety_warnings?: unknown;
  blocked_operations?: unknown;
  cart_operations?: unknown;
  model_used?: unknown;
  confidence?: unknown;
  timings?: unknown;
  diagnostics?: Partial<QuickOrderParseDiagnostics> | null;
  error?: unknown;
  detail?: unknown;
  code?: unknown;
  actions?: unknown;
  assistant_actions?: unknown;
  assistantActions?: unknown;
  context_patch?: unknown;
  contextPatch?: unknown;
  mutation_id?: unknown;
  mutationId?: unknown;
};

export type NormalizedQuickOrderParseResponse = {
  status: QuickOrderParseStatus;
  isBlocked: boolean;
  isPartialSuccess: boolean;
  assistantMessage: string;
  displayMessage: string;
  speechMessage: string;
  parsedItems: ParsedQuickOrderItem[];
  pendingActions: PendingQuickOrderClarification[];
  flags: { type: string; message: string; raw_token?: string; item_id?: string }[];
  suggestions: unknown[];
  stockUpdates: QuickOrderStockUpdate[];
  recommendations: QuickOrderRecommendation[];
  safetyWarnings: QuickOrderSafetyWarning[];
  blockedOperations: QuickOrderBlockedOperation[];
  modelUsed: string;
  confidence: number;
  timings: Record<string, unknown>;
  diagnostics: QuickOrderParseDiagnostics;
  errorCode?: string;
  rawError?: string;
  operations: QuickOrderOperation[];
  actions: QuickOrderAssistantAction[];
  contextPatch: Record<string, unknown> | null;
  mutationId: string | null;
};

export function normalizeQuickOrderParseResponse(
  value: unknown,
): NormalizedQuickOrderParseResponse {
  const raw = isRecord(value) ? value as RawQuickOrderParseResponse : {};
  const parsedItemsRaw = Array.isArray(raw.parsed_items)
    ? raw.parsed_items
    : Array.isArray(raw.parsedItems)
      ? raw.parsedItems
      : [];
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

  const pendingActions = normalizePendingActions(raw.pending_actions ?? raw.pending_clarifications ?? raw.clarifications);
  const operations = normalizeOperations((raw as Record<string, unknown>).operations ?? raw.cart_operations);
  const contextPatch = normalizeContextPatch(raw.context_patch ?? raw.contextPatch);
  const mutationId =
    stringValue(raw.mutation_id) ??
    stringValue(raw.mutationId) ??
    stringValue(contextPatch?.mutation_id) ??
    stringValue(contextPatch?.mutationId);
  const status = normalizeStatus(raw.status ?? raw.legacy_status, parsedItems, pendingActions, raw.error);
  const isBlocked = status === 'blocked';
  const isPartialSuccess = status === 'partial_success';
  const assistantMessage = formatAssistantReplyForDisplay(sanitizeAssistantReply(
    stringValue(raw.display_message) ??
      stringValue(raw.displayMessage) ??
      stringValue(raw.assistant_message) ??
      stringValue(raw.assistantMessage) ??
      stringValue(raw.reply_text) ??
      stringValue(raw.replyText),
    status === 'error'
      ? 'I had trouble reading that order. Please try again.'
      : 'I had trouble reading that order. Please try again or add the items manually.',
  ));
  const speechMessage = sanitizeAssistantReply(
    stringValue(raw.speech_message) ?? stringValue(raw.speechMessage) ?? assistantMessage,
    assistantMessage,
  );
  const backendDiagnostics = isRecord(raw.diagnostics) ? raw.diagnostics : {};
  const flags = normalizeFlags(raw.flags);

  return {
    status,
    isBlocked,
    isPartialSuccess,
    assistantMessage,
    displayMessage: assistantMessage,
    speechMessage,
    parsedItems,
    pendingActions,
    flags,
    suggestions: Array.isArray(raw.suggestions) ? raw.suggestions : [],
    stockUpdates: normalizeStockUpdates(raw.stock_updates),
    recommendations: normalizeRecommendations(raw.recommendations),
    safetyWarnings: normalizeSafetyWarnings(raw.safety_warnings),
    blockedOperations: normalizeBlockedOperations(raw.blocked_operations),
    modelUsed: stringValue(raw.model_used) ?? 'none',
    confidence: numberValue(raw.confidence) ?? 0.8,
    timings: isRecord(raw.timings) ? raw.timings : {},
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
      segment_count: numberValue(backendDiagnostics.segment_count) ?? undefined,
      order_segment_count: numberValue(backendDiagnostics.order_segment_count) ?? undefined,
      stock_segment_count: numberValue(backendDiagnostics.stock_segment_count) ?? undefined,
      recommendation_segment_count: numberValue(backendDiagnostics.recommendation_segment_count) ?? undefined,
      unknown_segment_count: numberValue(backendDiagnostics.unknown_segment_count) ?? undefined,
      segment_intents: backendDiagnostics.segment_intents,
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
    actions: normalizeAssistantActions(raw.actions ?? raw.assistant_actions ?? raw.assistantActions, mutationId),
    contextPatch,
    mutationId,
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

  if (normalized.status === 'qa_answer') {
    return normalized.assistantMessage || "I couldn't answer that — try rephrasing.";
  }

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

  if (mergeResult.updatedCount > 0 && mergeResult.addedCount > 0 && reviewCount === 0) {
    const updated = mergeResult.updatedItems.length === 1
      ? formatUpdatedItemMessage(mergeResult.updatedItems[0])
      : `Updated ${mergeResult.updatedCount} items.`;
    const added = `Added ${mergeResult.addedCount} other item${mergeResult.addedCount === 1 ? '' : 's'}.`;
    return `${updated} ${added}`;
  }

  if (mergeResult.addedCount > 0 && reviewCount === 0) {
    if (mergeResult.unchangedCount > 0) {
      const label = formatAddedItems(mergeResult.addedItems);
      return `Added ${label}. The other ${mergeResult.unchangedCount} item${mergeResult.unchangedCount === 1 ? ' was' : 's were'} already in your order.`;
    }
    if (mergeResult.addedItems.length === 1) {
      return formatAddedItemMessage(mergeResult.addedItems[0]);
    }
    if (mergeResult.addedItems.length > 1) {
      return formatMultiAddMessage(mergeResult.addedItems);
    }
    return 'Done';
  }

  if (mergeResult.addedCount > 0 && reviewCount > 0) {
    const inputPrompt = formatItemsNeedingInputMessage(mergeResult.reviewItems);
    if (inputPrompt) return inputPrompt;
    return pendingCount > 0 ? 'Review the item below.' : 'Done, with items to fix.';
  }

  if (mergeResult.updatedCount > 0 && reviewCount === 0) {
    if (mergeResult.updatedItems.length === 1) {
      return formatUpdatedItemMessage(mergeResult.updatedItems[0]);
    }
    return `Updated ${mergeResult.updatedCount} item${mergeResult.updatedCount === 1 ? '' : 's'}.`;
  }

  if (reviewCount > 0) {
    const inputPrompt = formatItemsNeedingInputMessage(mergeResult.reviewItems);
    if (inputPrompt) return inputPrompt;
    if (pendingCount > 0 && isSpecificAssistantMessage(normalized.assistantMessage)) {
      return normalized.assistantMessage;
    }
    return pendingCount > 0
      ? 'Please choose how to handle this item.'
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

function formatAssistantReplyForDisplay(message: string): string {
  if (isQuickOrderTutorialReply(message)) {
    return QUICK_ORDER_TUTORIAL_MESSAGE;
  }
  return message;
}

function isQuickOrderTutorialReply(message: string): boolean {
  const normalized = message
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  return (
    normalized.includes("i'm tuna intelligence") &&
    normalized.includes('quick order drafts') &&
    normalized.includes('you can say:') &&
    normalized.includes('salmon 3 cases') &&
    normalized.includes('undo that')
  );
}

function isGenericNoChangeMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return normalized === '' || normalized === 'got it.' || normalized === 'got it';
}

function isSpecificAssistantMessage(message: string): boolean {
  return !isGenericNoChangeMessage(message) &&
    !/^got \d+ item/i.test(message) &&
    !/^please review/i.test(message) &&
    !/^i found items that need review/i.test(message);
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
    matched_alias: stringValue(value.matched_alias),
    pending_conflict_id: stringValue(value.pending_conflict_id) ?? undefined,
    merge_behavior: normalizeMergeBehavior(value.merge_behavior),
    merge_delta_quantity: numberValue(value.merge_delta_quantity),
    existing_item_key: stringValue(value.existing_item_key) ?? undefined,
    source: normalizeParsedItemSource(value.source),
    isSuggested: value.isSuggested === true || value.is_suggested === true,
    suggestionReason: stringValue(value.suggestionReason) ?? stringValue(value.suggestion_reason) ?? undefined,
    suggestionSource: normalizeSuggestionSource(value.suggestionSource ?? value.suggestion_source),
    resolution: isRecord(value.resolution) ? value.resolution : null,
    reason_codes: arrayOfStrings(value.reason_codes),
    resolution_trace: arrayOfStrings(value.resolution_trace),
    user_visible_note: stringValue(value.user_visible_note),
  });
}

function normalizeParsedItemSource(value: unknown): ParsedQuickOrderItem['source'] {
  return value === 'manual' ||
    value === 'inventory_recommendation' ||
    value === 'remaining_recommendation' ||
    value === 'remaining_inventory' ||
    value === 'history_reorder' ||
    value === 'missing_item'
    ? value
    : undefined;
}

function normalizeSuggestionSource(value: unknown): ParsedQuickOrderItem['suggestionSource'] {
  return value === 'remaining_inventory' || value === 'missing_item' || value === 'history'
    ? value
    : undefined;
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
          unit: stringValue(action.unit) ?? undefined,
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
    value === 'clear_order' ||
    value === 'item_not_found' ||
    value === 'invalid_unit' ||
    value === 'quantity_safety' ||
    value === 'manager_approval_required' ||
    value === 'low_confidence_match' ||
    value === 'remove_ambiguous'
    ? value
    : 'quantity_conflict';
}

function normalizeActionId(value: unknown): PendingQuickOrderClarification['actions'][number]['id'] {
  return value === 'replace' ||
    value === 'keep_separate' ||
    value === 'cancel' ||
    value === 'choose_existing' ||
    value === 'clear_order' ||
    value === 'use_item' ||
    value === 'use_unit' ||
    value === 'request_approval'
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

function normalizeStockUpdates(value: unknown): QuickOrderStockUpdate[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((entry) => ({
    item_id: stringValue(entry.item_id) ?? '',
    item_name: stringValue(entry.item_name) ?? 'Item',
    quantity: numberValue(entry.quantity) ?? 0,
    unit: stringValue(entry.unit),
    source: (entry.source === 'voice' ? 'voice' : 'typed') as QuickOrderMessageSource,
    confidence: numberValue(entry.confidence) ?? 0.8,
    original_text: stringValue(entry.original_text) ?? '',
    approximate_modifier: stringValue(entry.approximate_modifier),
    personal_alias: stringValue(entry.personal_alias),
    unit_inferred: entry.unit_inferred === true,
    resolution: isRecord(entry.resolution) ? entry.resolution : null,
    reason_codes: arrayOfStrings(entry.reason_codes),
    resolution_trace: arrayOfStrings(entry.resolution_trace),
    user_visible_note: stringValue(entry.user_visible_note),
  })).filter((entry) => entry.item_id && entry.item_name);
}

function normalizeRecommendations(value: unknown): QuickOrderRecommendation[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((entry) => ({
    item_id: stringValue(entry.item_id) ?? '',
    item_name: stringValue(entry.item_name) ?? 'Item',
    suggested_quantity: numberValue(entry.suggested_quantity) ?? 0,
    unit: stringValue(entry.unit),
    confidence: numberValue(entry.confidence) ?? 0.7,
    reason: stringValue(entry.reason) ?? 'Suggested from recent history.',
    inputs: isRecord(entry.inputs) ? entry.inputs : undefined,
    safety_status: normalizeRecommendationSafety(entry.safety_status),
    recommendation_type: normalizeRecommendationType(entry.recommendation_type),
    auto_apply_eligible: entry.auto_apply_eligible === true,
    resolution: isRecord(entry.resolution) ? entry.resolution : null,
    reason_codes: arrayOfStrings(entry.reason_codes),
    resolution_trace: arrayOfStrings(entry.resolution_trace),
    user_visible_note: stringValue(entry.user_visible_note),
  })).filter((entry) => entry.item_id && entry.suggested_quantity > 0);
}

function normalizeSafetyWarnings(value: unknown): QuickOrderSafetyWarning[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((entry) => ({
    type: stringValue(entry.type) ?? 'warning',
    message: stringValue(entry.message) ?? 'Review this item.',
    item_id: stringValue(entry.item_id),
    item_name: stringValue(entry.item_name),
    quantity: numberValue(entry.quantity),
    unit: stringValue(entry.unit),
    severity: entry.severity === 'blocked' || entry.severity === 'info' ? entry.severity : 'warning',
    resolution: isRecord(entry.resolution) ? entry.resolution : null,
    reason_codes: arrayOfStrings(entry.reason_codes),
    resolution_trace: arrayOfStrings(entry.resolution_trace),
    user_visible_note: stringValue(entry.user_visible_note),
  }));
}

function normalizeBlockedOperations(value: unknown): QuickOrderBlockedOperation[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((entry) => ({
    type: stringValue(entry.type) ?? 'operation',
    item_id: stringValue(entry.item_id),
    item_name: stringValue(entry.item_name),
    attempted_quantity: numberValue(entry.attempted_quantity),
    unit: stringValue(entry.unit),
    reason: stringValue(entry.reason) ?? 'blocked',
    message: stringValue(entry.message) ?? 'This operation was blocked.',
  }));
}

function normalizeAssistantActions(
  value: unknown,
  responseMutationId: string | null,
): QuickOrderAssistantAction[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((entry, index) => {
    const type =
      stringValue(entry.type) ??
      stringValue(entry.action) ??
      stringValue(entry.operation) ??
      stringValue(entry.id) ??
      'action';
    const mutationId =
      stringValue(entry.mutation_id) ??
      stringValue(entry.mutationId) ??
      responseMutationId ??
      undefined;
    return {
      id: stringValue(entry.id) ?? `${type}:${mutationId ?? index}`,
      type,
      label: stringValue(entry.label) ?? (type === 'revert' ? 'Revert' : 'Action'),
      operation: stringValue(entry.operation) ?? stringValue(entry.action) ?? undefined,
      mutationId,
      disabled: Boolean(entry.disabled),
      status: stringValue(entry.status) ?? undefined,
      payload: isRecord(entry.payload) ? entry.payload : undefined,
    };
  });
}

function normalizeContextPatch(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function normalizeRecommendationSafety(value: unknown): QuickOrderRecommendation['safety_status'] {
  return value === 'confirm' || value === 'manager_approval' || value === 'blocked' ? value : 'normal';
}

function normalizeRecommendationType(value: unknown): QuickOrderRecommendation['recommendation_type'] {
  return value === 'stock_reorder_rule' || value === 'history_profile' || value === 'recent_history'
    ? value
    : undefined;
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
  if (
    value === 'ok' ||
    value === 'needs_review' ||
    value === 'needs_clarification' ||
    value === 'partial_success' ||
    value === 'blocked' ||
    value === 'qa_answer' ||
    value === 'error'
  ) {
    return value;
  }
  if (value === 'success') return 'ok';
  if (error) return 'error';
  if (pendingActions.length > 0) return 'needs_clarification';
  if (items.some((item) => getParsedItemIssue(item))) return 'needs_review';
  return items.length > 0 ? 'ok' : 'error';
}

/**
 * Builds a chat prompt for items that were added but still need a quantity (or,
 * rarely, a unit) before they can be ordered. The Order List shows an "Add
 * quantity"/"Choose unit" button on each, but nothing in the chat told the
 * employee to act — this is that message. Returns null when no added item is
 * waiting on quantity/unit input (e.g. the only issues are item-match prompts,
 * which surface as their own clarification cards).
 */
function formatItemsNeedingInputMessage(items: ParsedQuickOrderItem[]): string | null {
  const needQuantity: ParsedQuickOrderItem[] = [];
  const needUnit: ParsedQuickOrderItem[] = [];
  for (const item of items) {
    const issue = getParsedItemIssue(item);
    if (issue?.kind === 'pick-quantity') needQuantity.push(item);
    else if (issue?.kind === 'pick-unit') needUnit.push(item);
  }
  if (needQuantity.length === 0 && needUnit.length === 0) return null;

  if (needUnit.length === 0) {
    const list = formatItemNameList(needQuantity);
    return needQuantity.length === 1
      ? `How much ${list} do you need? Type the quantity (like “3 cases”) or tap “Add quantity”.`
      : `I still need quantities for ${list}. Type them in (like “3 cases salmon”) or tap “Add quantity” on each.`;
  }
  if (needQuantity.length === 0) {
    const list = formatItemNameList(needUnit);
    return needUnit.length === 1
      ? `What unit for ${list}? Type it in or tap “Choose unit”.`
      : `I still need units for ${list}. Type them in or tap “Choose unit” on each.`;
  }
  const list = formatItemNameList([...needQuantity, ...needUnit]);
  return `A few items still need details: ${list}. Type the quantity or unit, or tap the button on each item.`;
}

/** "Salmon", "Salmon and Tuna Loin", "Salmon, Tuna Loin, and 2 more". */
function formatItemNameList(items: ParsedQuickOrderItem[]): string {
  const names = items.map(getParsedItemDisplayName);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  const shown = names.slice(0, 3);
  const remainder = names.length - shown.length;
  if (remainder <= 0) {
    return `${shown.slice(0, -1).join(', ')}, and ${shown[shown.length - 1]}`;
  }
  return `${shown.join(', ')}, and ${remainder} more`;
}

function formatAddedItems(items: ParsedQuickOrderItem[]): string {
  if (items.length === 1) return getParsedItemDisplayName(items[0]);
  return `${items.length} items`;
}

function formatAddedItemMessage(item: ParsedQuickOrderItem): string {
  const name = getParsedItemDisplayName(item);
  if (item.quantity != null && item.unit) {
    return `Added ${formatQuickOrderQuantity(item.quantity, item.unit)} of ${name}.`;
  }
  if (item.quantity != null) {
    return `Added ${item.quantity} ${name}.`;
  }
  return `Added ${name}.`;
}

function formatMultiAddMessage(items: ParsedQuickOrderItem[]): string {
  const previewCount = Math.min(items.length, 2);
  const previewParts = items.slice(0, previewCount).map((item) => {
    const name = getParsedItemDisplayName(item);
    if (item.quantity != null && item.unit) {
      return `${name} (${formatQuickOrderQuantity(item.quantity, item.unit)})`;
    }
    if (item.quantity != null) {
      return `${name} (${item.quantity})`;
    }
    return name;
  });
  const remainder = items.length - previewCount;
  if (remainder <= 0) {
    return `Added ${previewParts.join(' and ')}.`;
  }
  return `Added ${previewParts.join(', ')} and ${remainder} more.`;
}

function formatUpdatedItemMessage(item: ParsedQuickOrderItem): string {
  if (item.merge_behavior === 'add_to_existing') {
    const delta = item.merge_delta_quantity != null && item.unit
      ? formatQuickOrderQuantity(item.merge_delta_quantity, item.unit)
      : item.merge_delta_quantity != null
        ? `${item.merge_delta_quantity}`
        : 'that amount';
    const total = item.quantity != null && item.unit
      ? formatQuickOrderQuantity(item.quantity, item.unit)
      : item.quantity != null
        ? `${item.quantity}`
        : 'the new total';
    return `Added ${delta} to ${getParsedItemDisplayName(item)}. New total: ${total}.`;
  }
  const quantity = item.quantity != null && item.unit
    ? ` to ${formatQuickOrderQuantity(item.quantity, item.unit)}`
    : '';
  return `Updated ${getParsedItemDisplayName(item)}${quantity}.`;
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
