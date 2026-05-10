import { matchCatalogItem } from './catalog-matcher.ts';
import { parseDeterministicOrder } from './deterministic-parser.ts';
import { detectRepeatedOrderList, resolveParsedItemConflicts } from './conflicts.ts';
import { detectQuickOrderIntent } from './intent-detector.ts';
import { buildCommandOperations } from './operations.ts';
import { parseWithLlmFallback } from './llm-fallback.ts';
import type {
  CatalogItem,
  ParserCorrection,
  ParserExample,
  ParserMetrics,
  ParsedItem,
  ParseFlag,
  ParseResponse,
  QuickOrderMessage,
} from './types.ts';
import { validateParsedLine } from './validator.ts';

type OrchestratorInput = {
  rawText: string;
  catalog: CatalogItem[];
  examples: ParserExample[];
  corrections: ParserCorrection[];
  previousMessages: QuickOrderMessage[];
  existingParsedItems: ParsedItem[];
  callLlm?: (prompt: string) => Promise<string>;
};

/** Command intents that should be routed to the operations builder. */
const COMMAND_INTENTS = new Set(['remove', 'replace', 'update', 'increase', 'decrease', 'clear']);

/** Hardcoded version string — appears in every response for deployment verification. */
export const PARSER_VERSION = 'quick-order-parser-v3-line-based';

export async function parseQuickOrder(input: OrchestratorInput): Promise<ParseResponse> {
  // ----------------------------------------------------------------
  // 1. Detect intent BEFORE parsing items.
  // ----------------------------------------------------------------
  const intentResult = detectQuickOrderIntent(input.rawText);
  const textToParse = intentResult.strippedText || input.rawText;

  // ----------------------------------------------------------------
  // 2. Handle confirm intent (no parsing needed).
  // ----------------------------------------------------------------
  if (intentResult.intent === 'confirm') {
    return buildConfirmResponse(input.existingParsedItems);
  }

  // ----------------------------------------------------------------
  // 3. Parse the (stripped) text into candidate items.
  // ----------------------------------------------------------------
  const candidates = parseDeterministicOrder(textToParse);
  const parsedItems: ParsedItem[] = [];
  const flags: ParseFlag[] = [];

  for (const candidate of candidates) {
    const match = matchCatalogItem(candidate.item_text, input.catalog, input.corrections);
    const validated = validateParsedLine({ candidate, match, catalog: input.catalog });
    parsedItems.push(validated.item);
    flags.push(...validated.flags);
  }

  // ----------------------------------------------------------------
  // 4. Route command intents to the operations builder.
  // ----------------------------------------------------------------
  if (COMMAND_INTENTS.has(intentResult.intent)) {
    const opResult = buildCommandOperations({
      intent: intentResult.intent,
      parsedItems,
      existingItems: input.existingParsedItems,
      rawText: input.rawText,
      catalog: input.catalog,
    });

    const appliedOps = opResult.operations.filter((op) => op.status === 'applied');
    const failedOps = opResult.operations.filter((op) => op.status === 'failed');
    const hasApplied = appliedOps.length > 0;
    const hasPending = opResult.pendingClarifications.length > 0;

    const status = hasApplied
      ? 'ok'
      : hasPending
        ? 'needs_clarification'
        : failedOps.length > 0
          ? 'needs_review'
          : 'ok';

    return {
      status,
      assistant_message: opResult.assistantMessage,
      reply_text: opResult.assistantMessage,
      parsed_items: [],
      flags: [...flags, ...opResult.flags],
      suggestions: [],
      pending_actions: opResult.pendingClarifications,
      pending_clarifications: opResult.pendingClarifications,
      session_state: {
        total_items: input.existingParsedItems.length,
        ready_to_submit: false,
      },
      operations: opResult.operations,
      diagnostics: {
        parser_version: PARSER_VERSION,
        parse_mode: 'deterministic_only',
        catalog_count: input.catalog.length,
        candidate_count: candidates.length,
        items_received: parsedItems.length,
        items_accepted: 0,
        items_rejected: 0,
        rejected_reasons: [],
        pending_action_count: opResult.pendingClarifications.length,
      },
    };
  }

  // ----------------------------------------------------------------
  // 5. Add / unknown intent — existing add flow with duplicate detection.
  //    For 'increase' intent, conflict resolution uses additive language detection.
  //    For 'add' intent with explicit keyword, we also treat as additive.
  // ----------------------------------------------------------------

  // Identify only the lines the LLM needs to help with.
  const unresolvedForLlm = parsedItems.filter(
    (item) => item.unresolved || item.match_type === 'unresolved' || (item.match_type === 'fuzzy' && item.needs_clarification),
  );
  const needsLlm = unresolvedForLlm.length > 0;

  let llmRepairNeeded = false;
  let llmFailed = false;
  let reconciliationDiagnostics: ReconciliationDiagnostics = {
    replaced_review_count: 0,
    duplicate_line_count: 0,
    ignored_llm_extra_count: 0,
  };

  if (needsLlm && input.callLlm) {
    const llmResult = await parseWithLlmFallback({
      rawText: input.rawText,
      catalog: input.catalog,
      prompt: buildFocusedFallbackPrompt(input, unresolvedForLlm),
      callLlm: input.callLlm,
    });
    llmRepairNeeded = llmResult.repairNeeded;
    llmFailed = llmResult.llmFailed;
    flags.push(...llmResult.flags);

    const reconciled = reconcileParsedSources(parsedItems, llmResult.items);
    reconciliationDiagnostics = reconciled.diagnostics;
    parsedItems.length = 0;
    parsedItems.push(...reconciled.items);
  } else if (needsLlm) {
    llmFailed = true;
  }

  const readyItems = parsedItems.filter((item) => !item.needs_clarification && !item.unresolved);
  const repeatedList = detectRepeatedOrderList(input.existingParsedItems, readyItems);
  const conflictInput = repeatedList.isRepeatedList
    ? [...repeatedList.changedItems, ...repeatedList.newItems]
    : readyItems;

  // For explicit 'add' intent, inject additive language into rawText so conflict
  // resolution auto-adds instead of asking.
  const effectiveRawText = intentResult.intent === 'add'
    ? `add ${textToParse}`
    : input.rawText;

  const conflictResult = resolveParsedItemConflicts(
    input.existingParsedItems,
    conflictInput,
    effectiveRawText,
  );
  const unresolvedItems = parsedItems.filter((item) => item.needs_clarification || item.unresolved);
  const combined = combineParsedItemsByLine([
    ...unresolvedItems,
    ...conflictResult.acceptedItems,
    ...conflictResult.updatedItems,
  ]);
  const finalItems = combined.items;
  reconciliationDiagnostics = {
    ...reconciliationDiagnostics,
    duplicate_line_count: reconciliationDiagnostics.duplicate_line_count + combined.duplicateLineCount,
  };
  flags.push(...conflictResult.flags);

  let invariantErrorCode: string | undefined;
  if (finalItems.length > candidates.length) {
    invariantErrorCode = 'parsed_items_exceed_candidates';
    console.error('[parse-order] INVARIANT VIOLATION: parsed_items exceeds candidates', {
      candidate_count: candidates.length,
      parsed_items_count: finalItems.length,
      error_code: invariantErrorCode,
      line_ids: finalItems.map((item) => item.line_id ?? null),
    });
  }

  const pendingClarifications = conflictResult.pendingClarifications;
  const unresolvedCount = finalItems.filter((item) => item.needs_clarification || item.unresolved).length;
  const readyToSubmit = finalItems.length > 0 && unresolvedCount === 0 && pendingClarifications.length === 0;
  const status = readyToSubmit
    ? 'ok'
    : pendingClarifications.length > 0
      ? 'needs_clarification'
      : unresolvedCount > 0
        ? 'needs_review'
        : repeatedList.unchangedCount > 0
          ? 'ok'
          : 'needs_review';

  const llmUsed = Boolean(input.callLlm && needsLlm);
  const metrics: ParserMetrics = {
    parse_mode_used: llmUsed ? 'deterministic_plus_llm' : candidates.length === 0 ? 'llm_only_fallback' : 'deterministic_only',
    lines_parsed: candidates.length,
    high_confidence_matches: finalItems.filter((item) => (item.confidence ?? 0) >= 0.9).length,
    fuzzy_matches: finalItems.filter((item) => item.match_type === 'fuzzy').length,
    unresolved_items: unresolvedCount,
    conflicts: pendingClarifications.length,
    json_repair_needed: llmRepairNeeded,
    llm_failed: llmFailed,
    llm_used: llmUsed,
  };
  const assistantMessage = buildReplyText(finalItems, pendingClarifications.length, repeatedList.unchangedCount);
  const diagnostics = {
    parser_version: PARSER_VERSION,
    parse_mode: metrics.parse_mode_used,
    catalog_count: input.catalog.length,
    candidate_count: candidates.length,
    items_before_validation: candidates.length,
    items_after_validation: finalItems.length,
    valid_count: finalItems.filter((item) => !item.needs_clarification && !item.unresolved).length,
    review_count: unresolvedCount,
    llm_lines_sent: unresolvedForLlm.length,
    llm_replaced_count: reconciliationDiagnostics.replaced_review_count,
    replaced_review_count: reconciliationDiagnostics.replaced_review_count,
    duplicate_line_count: reconciliationDiagnostics.duplicate_line_count,
    ignored_llm_extra_count: reconciliationDiagnostics.ignored_llm_extra_count,
    items_received: candidates.length,
    items_accepted: finalItems.length,
    items_rejected: Math.max(0, candidates.length - finalItems.length - repeatedList.unchangedCount),
    rejected_reasons: flags.map((flag) => flag.reason ?? flag.type),
    pending_action_count: pendingClarifications.length,
    unchanged_count: repeatedList.unchangedCount,
    repeated_existing_count: repeatedList.unchangedCount,
    item_diagnostics: buildItemDiagnostics(finalItems),
    raw_input_length: input.rawText.length,
    candidate_lines: candidates.length,
    error_code: invariantErrorCode,
  };

  return {
    status,
    assistant_message: assistantMessage,
    reply_text: assistantMessage,
    parsed_items: finalItems,
    flags,
    suggestions: [],
    pending_actions: pendingClarifications,
    pending_clarifications: pendingClarifications,
    session_state: {
      total_items: finalItems.length,
      ready_to_submit: readyToSubmit,
    },
    metrics,
    diagnostics,
  };
}

// ---------------------------------------------------------------------------
// Confirm helper
// ---------------------------------------------------------------------------

function buildConfirmResponse(existingItems: ParsedItem[]): ParseResponse {
  const unresolvedCount = existingItems.filter((item) => item.needs_clarification || item.unresolved).length;
  if (existingItems.length === 0) {
    return {
      status: 'needs_review',
      assistant_message: 'Your order is empty. Add some items first!',
      reply_text: 'Your order is empty. Add some items first!',
      parsed_items: [],
      flags: [],
      suggestions: [],
      pending_actions: [],
      pending_clarifications: [],
      session_state: { total_items: 0, ready_to_submit: false },
    };
  }
  if (unresolvedCount > 0) {
    return {
      status: 'needs_review',
      assistant_message: `${unresolvedCount} item${unresolvedCount === 1 ? '' : 's'} still need${unresolvedCount === 1 ? 's' : ''} review before submitting.`,
      reply_text: `${unresolvedCount} item${unresolvedCount === 1 ? '' : 's'} still need${unresolvedCount === 1 ? 's' : ''} review before submitting.`,
      parsed_items: [],
      flags: [],
      suggestions: [],
      pending_actions: [],
      pending_clarifications: [],
      session_state: { total_items: existingItems.length, ready_to_submit: false },
    };
  }
  return {
    status: 'ok',
    assistant_message: `Ready to submit ${existingItems.length} item${existingItems.length === 1 ? '' : 's'}.`,
    reply_text: `Ready to submit ${existingItems.length} item${existingItems.length === 1 ? '' : 's'}.`,
    parsed_items: [],
    flags: [],
    suggestions: [],
    pending_actions: [],
    pending_clarifications: [],
    session_state: { total_items: existingItems.length, ready_to_submit: true },
    operations: [{
      type: 'no_op',
      target_item_id: null,
      target_display_name: 'confirm',
      status: 'applied',
      message: 'Order confirmed.',
    }],
  };
}

/**
 * Reconcile deterministic items with LLM items.
 *
 * RULES:
 * 1. Match by line_id first, then by normalized raw_token.
 * 2. Only replace unresolved/needs_clarification items.
 * 3. Prefer a resolved LLM item (has item_id) over an unresolved deterministic item.
 * 4. NEVER append extra LLM items — output length === input length.
 * 5. Preserve line_id from the deterministic item.
 */
export function reconcileParsedSources(
  deterministicItems: ParsedItem[],
  llmItems: ParsedItem[],
): { items: ParsedItem[]; diagnostics: ReconciliationDiagnostics } {
  if (llmItems.length === 0) {
    return {
      items: [...deterministicItems],
      diagnostics: { replaced_review_count: 0, duplicate_line_count: 0, ignored_llm_extra_count: 0 },
    };
  }

  const llmByLineId = new Map<string, ParsedItem>();
  const llmByToken = new Map<string, ParsedItem>();
  let duplicateLineCount = 0;
  for (const llmItem of llmItems) {
    if (!llmItem.item_id) continue;
    if (llmItem.line_id) {
      if (llmByLineId.has(llmItem.line_id)) duplicateLineCount += 1;
      if (!llmByLineId.has(llmItem.line_id)) llmByLineId.set(llmItem.line_id, llmItem);
    }
    const key = normalizeRaw(llmItem.raw_token || llmItem.raw_text || '');
    if (key && !llmByToken.has(key)) llmByToken.set(key, llmItem);
  }

  const usedLlmItems = new Set<ParsedItem>();
  let replacedReviewCount = 0;
  const items = deterministicItems.map((detItem) => {
    if (!detItem.unresolved && !detItem.needs_clarification) return detItem;
    if (detItem.item_id && (detItem.status === 'missing_quantity' || detItem.status === 'missing_unit')) return detItem;

    const detKey = normalizeRaw(detItem.raw_token || detItem.raw_text || '');
    const llmMatch = (detItem.line_id ? llmByLineId.get(detItem.line_id) : undefined) ?? llmByToken.get(detKey);
    if (llmMatch && shouldReplaceWithLlm(detItem, llmMatch)) {
      replacedReviewCount += 1;
      usedLlmItems.add(llmMatch);
      return {
        ...llmMatch,
        line_id: detItem.line_id,
        raw_text: detItem.raw_text,
        raw_token: detItem.raw_token,
      };
    }
    return detItem;
  });

  const ignoredLlmExtraCount = llmItems.filter((item) => item.item_id && !usedLlmItems.has(item)).length;

  return {
    items,
    diagnostics: {
      replaced_review_count: replacedReviewCount,
      duplicate_line_count: duplicateLineCount,
      ignored_llm_extra_count: ignoredLlmExtraCount,
    },
  };
}

function normalizeRaw(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

type ReconciliationDiagnostics = {
  replaced_review_count: number;
  duplicate_line_count: number;
  ignored_llm_extra_count: number;
};

function shouldReplaceWithLlm(deterministicItem: ParsedItem, llmItem: ParsedItem): boolean {
  if (!llmItem.item_id) return false;
  if (!deterministicItem.item_id) return true;
  if (isExactDeterministicMatch(deterministicItem)) return false;
  return (llmItem.confidence ?? 0) >= (deterministicItem.confidence ?? 0);
}

function isExactDeterministicMatch(item: ParsedItem): boolean {
  return (
    item.parse_source === 'deterministic' &&
    (item.match_type === 'exact_name' || item.match_type === 'exact_alias' || item.match_type === 'normalized')
  );
}

function combineParsedItemsByLine(items: ParsedItem[]): { items: ParsedItem[]; duplicateLineCount: number } {
  const byLine = new Map<string, ParsedItem>();
  const noLineItems: ParsedItem[] = [];
  let duplicateLineCount = 0;

  for (const item of items) {
    const lineId = item.line_id;
    if (!lineId) {
      noLineItems.push(item);
      continue;
    }

    const existing = byLine.get(lineId);
    if (!existing) {
      byLine.set(lineId, item);
      continue;
    }

    duplicateLineCount += 1;
    byLine.set(lineId, chooseBetterLineItem(existing, item));
  }

  return {
    items: [...byLine.values(), ...noLineItems].sort(compareParsedLineOrder),
    duplicateLineCount,
  };
}

function chooseBetterLineItem(a: ParsedItem, b: ParsedItem): ParsedItem {
  const aScore = scoreParsedItem(a);
  const bScore = scoreParsedItem(b);
  if (bScore !== aScore) return bScore > aScore ? b : a;
  return (b.confidence ?? 0) > (a.confidence ?? 0) ? b : a;
}

function scoreParsedItem(item: ParsedItem): number {
  let score = 0;
  if (item.item_id) score += 100;
  if (!item.unresolved) score += 20;
  if (!item.needs_clarification) score += 20;
  if (item.match_type === 'exact_name') score += 12;
  if (item.match_type === 'exact_alias' || item.match_type === 'normalized') score += 10;
  if (item.match_type === 'correction') score += 9;
  if (item.parse_source === 'deterministic') score += 2;
  if (item.match_type === 'llm') score += 1;
  return score;
}

function compareParsedLineOrder(a: ParsedItem, b: ParsedItem): number {
  return lineSortIndex(a.line_id) - lineSortIndex(b.line_id);
}

function lineSortIndex(lineId: string | undefined): number {
  const match = lineId?.match(/^line_(\d+)$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function buildItemDiagnostics(items: ParsedItem[]) {
  return items.map((item) => ({
    line_id: item.line_id,
    raw_text: item.raw_text ?? item.raw_token,
    item_text: item.item_text ?? item.item_name ?? item.raw_token,
    matched_item_name: item.item_name,
    match_type: item.match_type,
    status: item.status,
    reason: item.issue ?? null,
    alternatives: item.alternatives?.slice(0, 3),
  }));
}

function buildReplyText(items: ParsedItem[], conflictCount: number, unchangedCount = 0): string {
  const goodCount = items.filter((item) => !item.needs_clarification && !item.unresolved).length;
  const reviewCount = items.length - goodCount + conflictCount;
  if (goodCount === 0 && reviewCount === 0 && unchangedCount > 0) {
    return unchangedCount === 1
      ? 'That item is already in your order.'
      : 'Those items are already in your order.';
  }
  if (goodCount > 0 && unchangedCount > 0 && reviewCount === 0) {
    const names = items
      .filter((item) => !item.needs_clarification && !item.unresolved)
      .map((item) => item.display_name ?? item.item_name ?? item.raw_token)
      .filter(Boolean);
    const addedLabel = names.length === 1 ? names[0] : `${goodCount} items`;
    return `Added ${addedLabel}. The other ${unchangedCount} item${unchangedCount === 1 ? ' was' : 's were'} already in your order.`;
  }
  if (items.length === 0 && conflictCount === 0) return 'I had trouble reading that. Please try again or add the item manually.';
  if (reviewCount === 0) return goodCount === 1 ? 'Got this item.' : `Got ${goodCount} items.`;
  return `Got ${goodCount} item${goodCount === 1 ? '' : 's'}, but ${reviewCount} need${reviewCount === 1 ? 's' : ''} review.`;
}

/**
 * Build a focused LLM prompt with ONLY the unresolved lines + their top alternatives.
 * Does NOT send the full order — only the lines that need help.
 */
function buildFocusedFallbackPrompt(input: OrchestratorInput, unresolvedItems: ParsedItem[]): string {
  return `You are a helper for a deterministic restaurant order parser.
Return strict JSON only. Do not use item_id values outside the catalog.
Only resolve the specific unresolved items listed below.

Unresolved items that need matching:
${JSON.stringify(unresolvedItems.map((item) => ({
  line_id: item.line_id,
  raw_text: item.raw_text ?? item.raw_token,
  item_text: item.item_text ?? item.item_name ?? item.raw_token,
  quantity: item.quantity,
  unit: item.unit,
  issue: item.issue,
  top_alternatives: item.alternatives?.slice(0, 3),
})))}

Catalog (use only these item_ids):
${JSON.stringify(input.catalog.map((item) => ({
  id: item.id,
  name: item.name,
  aliases: item.aliases,
  allowed_units: item.allowed_units,
  default_unit: item.default_unit,
})))}

Schema:
{"reply_text":"string","parsed_items":[{"item_id":"uuid or null","item_name":"string","raw_token":"original line text","quantity":1,"unit":"lb","confidence":0.8}]}`;
}
