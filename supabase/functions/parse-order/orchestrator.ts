import { matchCatalogItem } from './catalog-matcher.ts';
import { parseDeterministicOrder } from './deterministic-parser.ts';
import { detectRepeatedOrderList, resolveParsedItemConflicts } from './conflicts.ts';
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

export async function parseQuickOrder(input: OrchestratorInput): Promise<ParseResponse> {
  const candidates = parseDeterministicOrder(input.rawText);
  const parsedItems: ParsedItem[] = [];
  const flags: ParseFlag[] = [];

  for (const candidate of candidates) {
    const match = matchCatalogItem(candidate.item_text, input.catalog, input.corrections);
    const validated = validateParsedLine({ candidate, match, catalog: input.catalog });
    parsedItems.push(validated.item);
    flags.push(...validated.flags);
  }

  const needsLlm =
    candidates.length === 0 ||
    parsedItems.some((item) => item.unresolved || item.match_type === 'unresolved' || (item.match_type === 'fuzzy' && item.needs_clarification));

  let llmRepairNeeded = false;
  let llmFailed = false;
  let llmItems: ParsedItem[] = [];

  if (needsLlm && input.callLlm) {
    const llmResult = await parseWithLlmFallback({
      rawText: input.rawText,
      catalog: input.catalog,
      prompt: buildFallbackPrompt(input, parsedItems),
      callLlm: input.callLlm,
    });
    llmRepairNeeded = llmResult.repairNeeded;
    llmFailed = llmResult.llmFailed;
    llmItems = llmResult.items;
    flags.push(...llmResult.flags);
  } else if (needsLlm) {
    llmFailed = true;
  }

  const mergedByRaw = replaceUnresolvedWithLlmItems(parsedItems, llmItems);
  const readyItems = mergedByRaw.filter((item) => !item.needs_clarification && !item.unresolved);
  const repeatedList = detectRepeatedOrderList(input.existingParsedItems, readyItems);
  const conflictInput = repeatedList.isRepeatedList
    ? [...repeatedList.changedItems, ...repeatedList.newItems]
    : readyItems;
  const conflictResult = resolveParsedItemConflicts(
    input.existingParsedItems,
    conflictInput,
    input.rawText,
  );
  const unresolvedItems = mergedByRaw.filter((item) => item.needs_clarification || item.unresolved);
  const finalItems = [
    ...unresolvedItems,
    ...conflictResult.acceptedItems,
    ...conflictResult.updatedItems,
  ];
  flags.push(...conflictResult.flags);

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

  const metrics: ParserMetrics = {
    parse_mode_used: input.callLlm && needsLlm ? 'deterministic_plus_llm' : candidates.length === 0 ? 'llm_only_fallback' : 'deterministic_only',
    lines_parsed: candidates.length,
    high_confidence_matches: finalItems.filter((item) => (item.confidence ?? 0) >= 0.9).length,
    fuzzy_matches: finalItems.filter((item) => item.match_type === 'fuzzy').length,
    unresolved_items: unresolvedCount,
    conflicts: pendingClarifications.length,
    json_repair_needed: llmRepairNeeded,
    llm_failed: llmFailed,
    llm_used: Boolean(input.callLlm && needsLlm),
  };
  const assistantMessage = buildReplyText(finalItems, pendingClarifications.length, repeatedList.unchangedCount);
  const diagnostics = {
    parse_mode: metrics.parse_mode_used,
    items_received: parsedItems.length,
    items_accepted: finalItems.length,
    items_rejected: Math.max(0, parsedItems.length - finalItems.length - repeatedList.unchangedCount),
    rejected_reasons: flags.map((flag) => flag.reason ?? flag.type),
    pending_action_count: pendingClarifications.length,
    unchanged_count: repeatedList.unchangedCount,
    repeated_existing_count: repeatedList.unchangedCount,
    raw_input_length: input.rawText.length,
    candidate_lines: candidates.length,
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

function replaceUnresolvedWithLlmItems(deterministicItems: ParsedItem[], llmItems: ParsedItem[]): ParsedItem[] {
  if (llmItems.length === 0) return deterministicItems;
  
  const finalItems: ParsedItem[] = [];
  const usedLlmIndices = new Set<number>();

  for (const detItem of deterministicItems) {
    if (!detItem.unresolved && !detItem.needs_clarification) {
      finalItems.push(detItem);
      const matchIndex = llmItems.findIndex((llmItem, index) => 
        !usedLlmIndices.has(index) && 
        (normalizeRaw(llmItem.raw_token || '') === normalizeRaw(detItem.raw_token || '') || 
         (llmItem.item_id === detItem.item_id && llmItem.quantity === detItem.quantity))
      );
      if (matchIndex >= 0) usedLlmIndices.add(matchIndex);
    }
  }

  const unmatchedUnresolvedDetItems: ParsedItem[] = [];
  for (const detItem of deterministicItems) {
    if (detItem.unresolved || detItem.needs_clarification) {
      const matchIndex = llmItems.findIndex((llmItem, index) => 
        !usedLlmIndices.has(index) && 
        llmItem.item_id &&
        normalizeRaw(llmItem.raw_token || '') === normalizeRaw(detItem.raw_token || '')
      );
      if (matchIndex >= 0) {
        finalItems.push(llmItems[matchIndex]);
        usedLlmIndices.add(matchIndex);
      } else {
        unmatchedUnresolvedDetItems.push(detItem);
      }
    }
  }

  const unusedLlmItems = llmItems.filter((_, i) => !usedLlmIndices.has(i));
  finalItems.push(...unusedLlmItems);

  for (const detItem of unmatchedUnresolvedDetItems) {
    const detRaw = normalizeRaw(detItem.raw_token || detItem.raw_text || '');
    const isCovered = unusedLlmItems.some(llmItem => {
      const llmRaw = normalizeRaw(llmItem.raw_token || llmItem.raw_text || '');
      return llmRaw.length > 0 && detRaw.includes(llmRaw);
    });
    if (!isCovered) {
      finalItems.push(detItem);
    }
  }

  return finalItems;
}

function normalizeRaw(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
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

function buildFallbackPrompt(input: OrchestratorInput, preParsed: ParsedItem[]): string {
  return `You are a helper for a deterministic restaurant order parser.
Return strict JSON only. Do not use item_id values outside the catalog.

Original user text:
${input.rawText}

Pre-parsed candidates:
${JSON.stringify(preParsed.map((item) => ({
  raw_text: item.raw_text ?? item.raw_token,
  item_name: item.item_name,
  quantity: item.quantity,
  unit: item.unit,
  issue: item.issue,
  alternatives: item.alternatives,
})))}

Existing order items:
${JSON.stringify(input.existingParsedItems)}

Recent messages:
${JSON.stringify(input.previousMessages.slice(-8))}

Catalog:
${JSON.stringify(input.catalog.map((item) => ({
  id: item.id,
  name: item.name,
  aliases: item.aliases,
  allowed_units: item.allowed_units,
  default_unit: item.default_unit,
})))}

Manager examples:
${JSON.stringify(input.examples.slice(0, 10))}

Schema:
{"reply_text":"string","parsed_items":[{"item_id":"uuid or null","item_name":"string","raw_token":"string","quantity":1,"unit":"lb","confidence":0.8}]}`;
}
