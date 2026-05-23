import {
  analyzeSemanticTokens,
  buildCatalogSearchIndex,
  catalogNameStructuralSegmentMatches,
  findCatalogAlternatives,
  isStrongDeterministicMatch,
  matchCatalogIndex,
  normalizeSearchText,
} from './catalog-matcher.ts';
import type { CatalogSearchIndex } from './catalog-search-index.ts';
import { deduplicatePendingClarifications } from './safety-engine.ts';
import { parseDeterministicOrder } from './deterministic-parser.ts';
import { createClientKey, detectRepeatedOrderList, getParserItemKey, resolveParsedItemConflicts } from './conflicts.ts';
import { classifyQuickOrderInput } from './input-classifier.ts';
import type { QuickOrderInputClassificationResult } from './input-classifier.ts';
import { buildCommandOperations } from './operations.ts';
import { parseWithLlmFallback } from './llm-fallback.ts';
import { answerProductQuestion, type QaContextProduct } from './qa-handler.ts';
import {
  deriveAllowedUnitLabels,
  displayUnitLabel,
  formatAllowedUnitList,
  formatQuantityWithUnit,
  normalizeUnitForComparison,
  DEFAULT_UNIT_ALIASES,
  type UnitAliasMap,
} from './units.ts';
import type {
  CatalogAlternative,
  CatalogMatchResult,
  CatalogItem,
  EmployeeQuickOrderAlias,
  ParserCorrection,
  ParseDiagnostics,
  ParserExample,
  ParserMetrics,
  ParsedItem,
  ParseFlag,
  ParseResponse,
  QuickOrderMessage,
} from './types.ts';
import { normalizeParsedItemStatus, validateParsedLine } from './validator.ts';

type OrchestratorInput = {
  rawText: string;
  locationId?: string;
  userId?: string | null;
  catalog: CatalogItem[];
  globalCatalog?: CatalogItem[];
  examples: ParserExample[];
  corrections: ParserCorrection[];
  previousMessages: QuickOrderMessage[];
  existingParsedItems: ParsedItem[];
  callLlm?: (prompt: string) => Promise<string>;
  unitAliases?: UnitAliasMap;
  catalogIndex?: CatalogSearchIndex;
  globalCatalogIndex?: CatalogSearchIndex;
  employeeAliases?: EmployeeQuickOrderAlias[];
  classification?: QuickOrderInputClassificationResult;
  debugCatalog?: boolean;
};

/** Command intents that should be routed to the operations builder. */
const COMMAND_INTENTS = new Set(['remove', 'replace', 'update', 'increase', 'decrease', 'clear']);
const COMMAND_ONLY_TERMS = new Set([
  'combine',
  'replace',
  'remove',
  'delete',
  'cancel',
  'change',
  'update',
  'set',
  'clear',
]);
const MIN_PLAUSIBLE_REVIEW_CONFIDENCE = 0.75;

/** Hardcoded version string — appears in every response for deployment verification. */
export const PARSER_VERSION = 'quick-order-parser-v3-line-based';

function matchCatalogWithEmployeeAliases(
  itemText: string,
  catalogIndex: CatalogSearchIndex,
  employeeAliases: EmployeeQuickOrderAlias[],
  locationId: string | null,
): CatalogMatchResult {
  const officialNameMatch = matchOfficialCatalogName(itemText, catalogIndex);
  if (officialNameMatch) return officialNameMatch;

  const employeeAliasMatch = matchEmployeeQuickOrderAlias(itemText, catalogIndex, employeeAliases, locationId);
  if (employeeAliasMatch) return employeeAliasMatch;

  return matchCatalogIndex(itemText, catalogIndex);
}

function matchOfficialCatalogName(
  itemText: string,
  catalogIndex: CatalogSearchIndex,
): CatalogMatchResult | null {
  const normalized = normalizeSearchText(itemText);
  if (!normalized) return null;
  const compact = normalized.replace(/\s+/g, '');
  const officialEntries = catalogIndex.entries.filter((entry) =>
    entry.type === 'name' && (entry.normalized === normalized || entry.compact === compact)
  );
  const uniqueByItem = uniqueCatalogEntriesByItem(officialEntries);
  if (uniqueByItem.length === 0) return null;
  if (uniqueByItem.length === 1) {
    const entry = uniqueByItem[0];
    return {
      item_id: entry.item.id,
      item_name: entry.item.name,
      display_name: entry.item.name,
      match_type: entry.normalized === normalized ? 'exact_name' : 'compact_exact',
      confidence: entry.normalized === normalized ? 1 : 0.99,
      needs_clarification: false,
      matched_term: entry.term,
      token_coverage: 1,
      generic_token_overlap: [],
      specific_token_overlap: normalized.split(' ').filter(Boolean),
      missing_specific_tokens: [],
      semantic_validation_passed: true,
      confidence_tier: 'high',
      decision_reason: 'official_item_name_exact',
    };
  }
  return ambiguousEmployeeAliasMatch(uniqueByItem.map((entry) => ({
    item_id: entry.item.id,
    item_name: entry.item.name,
    confidence: 1,
    term: entry.term,
    matched_term: entry.term,
    match_type: 'exact_name',
    reason: 'duplicate_official_item_name',
  })), 'Official item name matches multiple catalog items.');
}

function matchEmployeeQuickOrderAlias(
  itemText: string,
  catalogIndex: CatalogSearchIndex,
  employeeAliases: EmployeeQuickOrderAlias[],
  locationId: string | null,
): CatalogMatchResult | null {
  const normalized = normalizeSearchText(itemText);
  if (!normalized) return null;

  const candidates = employeeAliases.filter((alias) =>
    alias.active !== false &&
    alias.alias_key === normalized &&
    (alias.location_id == null || (locationId != null && alias.location_id === locationId))
  );
  const locationSpecific = locationId
    ? candidates.filter((alias) => alias.location_id === locationId)
    : [];
  const scoped = locationSpecific.length > 0
    ? locationSpecific
    : candidates.filter((alias) => alias.location_id == null);
  if (scoped.length === 0) return null;

  const catalogById = new Map(catalogIndex.catalog.map((item) => [item.id, item]));
  const alternatives = scoped
    .map((alias): CatalogAlternative | null => {
      const item = catalogById.get(alias.inventory_item_id);
      if (!item) return null;
      return {
        item_id: item.id,
        item_name: item.name,
        confidence: 0.98,
        term: alias.alias_text,
        matched_term: alias.alias_text,
        match_type: 'employee_alias',
        reason: alias.location_id ? 'employee_location_alias' : 'employee_global_alias',
      };
    })
    .filter((entry): entry is CatalogAlternative => Boolean(entry));

  if (scoped.length !== 1 || alternatives.length !== 1) {
    return ambiguousEmployeeAliasMatch(
      alternatives,
      'Employee-specific alias has multiple active matches. Ask a manager to fix the Google Sheet row.',
    );
  }

  const item = catalogById.get(scoped[0].inventory_item_id);
  if (!item) return null;
  return {
    item_id: item.id,
    item_name: item.name,
    display_name: item.name,
    matched_alias: scoped[0].alias_text,
    matched_term: scoped[0].alias_text,
    match_type: 'employee_alias',
    confidence: 0.98,
    needs_clarification: false,
    token_coverage: 1,
    generic_token_overlap: [],
    specific_token_overlap: normalized.split(' ').filter(Boolean),
    missing_specific_tokens: [],
    semantic_validation_passed: true,
    confidence_tier: 'high',
    decision_reason: scoped[0].location_id ? 'employee_location_alias' : 'employee_global_alias',
  };
}

function ambiguousEmployeeAliasMatch(
  alternatives: CatalogAlternative[],
  issue: string,
): CatalogMatchResult {
  return {
    item_id: null,
    item_name: null,
    display_name: alternatives[0]?.item_name ?? 'Ambiguous item',
    match_type: 'ambiguous',
    confidence: alternatives[0]?.confidence ?? 0,
    needs_clarification: true,
    issue,
    reason: issue,
    alternatives: alternatives.length > 0 ? alternatives : undefined,
    confidence_tier: 'medium',
    decision_reason: 'employee_alias_data_error',
  };
}

function uniqueCatalogEntriesByItem(entries: CatalogSearchIndex['entries']): CatalogSearchIndex['entries'] {
  const byId = new Map<string, CatalogSearchIndex['entries'][number]>();
  for (const entry of entries) {
    if (!byId.has(entry.item.id)) byId.set(entry.item.id, entry);
  }
  return [...byId.values()];
}

export async function parseQuickOrder(input: OrchestratorInput): Promise<ParseResponse> {
  const unitAliases = input.unitAliases ?? DEFAULT_UNIT_ALIASES;
  const catalogIndex = input.catalogIndex ?? buildCatalogSearchIndex(input.catalog, input.corrections);
  const globalCatalogIndex = input.globalCatalogIndex ?? (
    input.globalCatalog ? buildCatalogSearchIndex(input.globalCatalog, input.corrections) : undefined
  );
  const catalogDebug = buildCatalogDebug(input, catalogIndex, input.debugCatalog === true);

  // ----------------------------------------------------------------
  // 1. Detect intent BEFORE parsing items.
  // ----------------------------------------------------------------
  const classification = input.classification ?? classifyQuickOrderInput(input.rawText, {
    hasPendingDuplicateAction: input.previousMessages.some((message) =>
      (message.pending_clarifications ?? []).some((entry) => entry.type === 'quantity_conflict' || entry.type === 'unit_conflict')
    ),
  });
  const intentResult = classification.intentResult;
  const textToParse = intentResult.strippedText || input.rawText;

  // ----------------------------------------------------------------
  // 1a. Product Q&A — short product questions go to Gemini before any
  //     order-parsing logic runs. We bypass the parser entirely.
  // ----------------------------------------------------------------
  if (classification.classification === 'product_question') {
    if (!hasProductQuestionContext(input.rawText, input, catalogIndex)) {
      return buildNonOrderResponse(
        input,
        { ...classification, classification: 'unknown_non_order', reason: 'product_question_without_item' },
        'I’m not sure what you want me to do. Do you want to add items, see past orders, get a recommendation, or ask for help?',
        catalogDebug,
      );
    }
    return await buildProductQuestionResponse(input, classification, catalogDebug);
  }

  const preParseResponse = buildPreParseResponse(input, classification, catalogDebug);
  if (preParseResponse) return preParseResponse;

  // ----------------------------------------------------------------
  // 2. Handle confirm intent (no parsing needed).
  // ----------------------------------------------------------------
  if (intentResult.intent === 'confirm') {
    return buildConfirmResponse(input.existingParsedItems);
  }

  // ----------------------------------------------------------------
  // 3. Parse the (stripped) text into candidate items.
  // ----------------------------------------------------------------
  const candidates = parseDeterministicOrder(textToParse, unitAliases);
  const omittedTargetResolution = resolveOmittedTargetCandidates({
    input,
    candidates,
    intent: intentResult.intent,
    unitAliases,
    catalogIndex,
  });
  if (omittedTargetResolution.response) return omittedTargetResolution.response;
  const candidatesToMatch = omittedTargetResolution.candidates;
  const parsedItems: ParsedItem[] = [];
  const flags: ParseFlag[] = [];

  for (const candidate of candidatesToMatch) {
    const baseMatch = matchCatalogWithEmployeeAliases(
      candidate.item_text,
      catalogIndex,
      input.employeeAliases ?? [],
      input.locationId ?? null,
    );
    const match = maybePromoteBareCatalogToken(
      candidate,
      maybeAmbiguousBareCatalogToken(candidate, baseMatch, catalogIndex),
      catalogIndex,
    );
    const validated = validateParsedLine({ candidate, match, catalog: input.catalog, unitAliases });
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
        candidate_count: candidatesToMatch.length,
        items_received: parsedItems.length,
        items_accepted: 0,
        items_rejected: 0,
        rejected_reasons: [],
        pending_action_count: opResult.pendingClarifications.length,
        catalog_debug: catalogDebug,
      },
    };
  }

  // ----------------------------------------------------------------
  // 5. Add / unknown intent — existing add flow with duplicate detection.
  //    For 'increase' intent, conflict resolution uses additive language detection.
  //    For 'add' intent with explicit keyword, we also treat as additive.
  // ----------------------------------------------------------------

  const orderGate = gateParsedItemsForOrder(parsedItems, catalogIndex, input.catalog);
  parsedItems.length = 0;
  parsedItems.push(...orderGate.items);
  if (candidatesToMatch.length > 0 && parsedItems.length === 0 && orderGate.noOpDiagnostics.length > 0) {
    return buildNoOpResponse({
      input,
      candidatesCount: candidatesToMatch.length,
      catalogDebug,
      noOpDiagnostics: orderGate.noOpDiagnostics,
      pendingClarifications: orderGate.pendingClarifications,
      flags,
    });
  }

  // Identify only the lines the LLM needs to help with.
  const unresolvedForLlm = parsedItems.filter(
    (item) =>
      !isStrongDeterministicMatch(item) &&
      item.issue !== 'Item spelling needs confirmation.' &&
      isPlausibleForLlm(item, catalogIndex) &&
      (item.unresolved || item.match_type === 'unresolved' || item.status === 'ambiguous' || item.status === 'no_match'),
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
      catalogIndex,
      unitAliases,
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

  const normalizedParsedItems = normalizeParsedItemsForResponse(parsedItems, input.catalog);
  parsedItems.length = 0;
  parsedItems.push(...normalizedParsedItems);

  const readyItems = parsedItems.filter((item) => !item.needs_clarification && !item.unresolved);
  const reviewResolution = resolveExistingReviewRows(input.existingParsedItems, readyItems);
  const itemsForDuplicateDetection = reviewResolution.remainingItems;
  const repeatedList = detectRepeatedOrderList(input.existingParsedItems, itemsForDuplicateDetection);
  const conflictInput = repeatedList.isRepeatedList
    ? [...repeatedList.changedItems, ...repeatedList.newItems]
    : itemsForDuplicateDetection;

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
    ...reviewResolution.resolvedItems,
    ...conflictResult.acceptedItems,
    ...conflictResult.updatedItems,
  ]);
  const finalItems = normalizeParsedItemsForResponse(combined.items, input.catalog);
  reconciliationDiagnostics = {
    ...reconciliationDiagnostics,
    duplicate_line_count: reconciliationDiagnostics.duplicate_line_count + combined.duplicateLineCount,
  };
  flags.push(...conflictResult.flags);

  let invariantErrorCode: string | undefined;
  if (finalItems.length > candidatesToMatch.length) {
    invariantErrorCode = 'parsed_items_exceed_candidates';
    console.error('[parse-order] INVARIANT VIOLATION: parsed_items exceeds candidates', {
      candidate_count: candidatesToMatch.length,
      parsed_items_count: finalItems.length,
      error_code: invariantErrorCode,
      line_ids: finalItems.map((item) => item.line_id ?? null),
    });
  }
  const strongRejectedItem = finalItems.find(hasRejectedStrongCandidate);
  if (!invariantErrorCode && strongRejectedItem) invariantErrorCode = 'strong_match_rejected';
  const rejectedHighConfidence = finalItems.some((item) =>
    (item.status === 'no_match' || item.status === 'ambiguous') && (item.alternatives?.[0]?.confidence ?? 0) >= 0.75
  );
  if (!invariantErrorCode && rejectedHighConfidence) invariantErrorCode = 'high_confidence_candidate_rejected';

  const pendingClarifications = deduplicatePendingClarifications([
    ...omittedTargetResolution.omittedClarifications,
    ...orderGate.pendingClarifications,
    ...conflictResult.pendingClarifications,
  ]);
  const unresolvedCount = finalItems.filter((item) => item.needs_clarification || item.unresolved).length;
  const readyToSubmit = finalItems.length > 0 && unresolvedCount === 0 && pendingClarifications.length === 0;
  const unchangedCountForReply = conflictResult.updatedItems.length > 0 ? 0 : repeatedList.unchangedCount;
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
    parse_mode_used: llmUsed ? 'deterministic_plus_llm' : candidatesToMatch.length === 0 ? 'llm_only_fallback' : 'deterministic_only',
    lines_parsed: candidatesToMatch.length,
    high_confidence_matches: finalItems.filter((item) => (item.confidence ?? 0) >= 0.9).length,
    fuzzy_matches: finalItems.filter((item) => item.match_type === 'fuzzy').length,
    unresolved_items: unresolvedCount,
    conflicts: pendingClarifications.length,
    json_repair_needed: llmRepairNeeded,
    llm_failed: llmFailed,
    llm_used: llmUsed,
  };
  const assistantMessage = buildReplyText(
    finalItems,
    pendingClarifications.map((clarification) => clarification.message),
    unchangedCountForReply,
    input.catalog,
  );
  const diagnostics: ParseDiagnostics = {
    parser_version: PARSER_VERSION,
    parse_mode: metrics.parse_mode_used,
    catalog_count: input.catalog.length,
    candidate_count: candidatesToMatch.length,
    items_before_validation: candidatesToMatch.length,
    items_after_validation: finalItems.length,
    valid_count: finalItems.filter((item) => !item.needs_clarification && !item.unresolved).length,
    review_count: unresolvedCount,
    llm_lines_sent: unresolvedForLlm.length,
    llm_replaced_count: reconciliationDiagnostics.replaced_review_count,
    replaced_review_count: reconciliationDiagnostics.replaced_review_count,
    duplicate_line_count: reconciliationDiagnostics.duplicate_line_count,
    ignored_llm_extra_count: reconciliationDiagnostics.ignored_llm_extra_count,
    items_received: candidatesToMatch.length,
    items_accepted: finalItems.length,
    items_rejected: Math.max(0, candidatesToMatch.length - finalItems.length - repeatedList.unchangedCount),
    rejected_reasons: flags.map((flag) => flag.reason ?? flag.type),
    pending_action_count: pendingClarifications.length,
    unchanged_count: repeatedList.unchangedCount,
    repeated_existing_count: repeatedList.unchangedCount,
    item_diagnostics: buildItemDiagnostics(finalItems, catalogIndex, globalCatalogIndex),
    catalog_debug: catalogDebug,
    raw_input_length: input.rawText.length,
    candidate_lines: candidatesToMatch.length,
    error_code: invariantErrorCode,
    input_classification: classification.classification,
    input_classification_reason: classification.reason,
  };

  diagnostics.item_diagnostics = [
    ...(diagnostics.item_diagnostics ?? []),
    ...orderGate.noOpDiagnostics,
  ];

  logReviewDiagnostics(diagnostics.item_diagnostics ?? []);

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

function resolveExistingReviewRows(
  existingItems: ParsedItem[],
  incomingReadyItems: ParsedItem[],
): { resolvedItems: ParsedItem[]; remainingItems: ParsedItem[] } {
  const consumedExistingKeys = new Set<string>();
  const resolvedItems: ParsedItem[] = [];
  const remainingItems: ParsedItem[] = [];

  for (const incoming of incomingReadyItems) {
    const existing = existingItems.find((item) => {
      if (consumedExistingKeys.has(getParserItemKey(item))) return false;
      if (!item.needs_clarification && !item.unresolved) return false;
      if (incoming.item_id && item.item_id === incoming.item_id) return true;
      const existingName = normalizeSearchText(item.item_name ?? item.display_name ?? item.item_text ?? item.raw_token ?? '');
      const incomingName = normalizeSearchText(incoming.item_name ?? incoming.display_name ?? incoming.item_text ?? incoming.raw_token ?? '');
      return Boolean(existingName && incomingName && existingName === incomingName);
    });

    if (!existing) {
      remainingItems.push(incoming);
      continue;
    }

    consumedExistingKeys.add(getParserItemKey(existing));
    resolvedItems.push({
      ...incoming,
      client_key: existing.client_key ?? incoming.client_key,
      existing_item_key: getParserItemKey(existing),
      merge_behavior: 'replace_existing',
      needs_clarification: false,
      unresolved: false,
      status: 'valid',
      issue: undefined,
      issue_code: undefined,
      action: null,
    });
  }

  return { resolvedItems, remainingItems };
}

type DeterministicCandidate = ReturnType<typeof parseDeterministicOrder>[number];

type OmittedTargetResolution = {
  candidates: DeterministicCandidate[];
  omittedClarifications: NonNullable<ParseResponse['pending_clarifications']>;
  response: ParseResponse | null;
};

type ContextPatchKind = 'quantity_unit' | 'unit_only' | 'quantity_only';

type RecentTargetItem = {
  item_id: string;
  item_name: string;
  display_name?: string;
  unit?: string | null;
  quantity?: number | null;
  existing_item_key?: string;
};

function resolveOmittedTargetCandidates(input: {
  input: OrchestratorInput;
  candidates: DeterministicCandidate[];
  intent: string;
  unitAliases: UnitAliasMap;
  catalogIndex: CatalogSearchIndex;
}): OmittedTargetResolution {
  const resolvedCandidates: DeterministicCandidate[] = [];
  const omittedClarifications: NonNullable<ParseResponse['pending_clarifications']> = [];

  for (const candidate of input.candidates) {
    const patchKind = getContextPatchKind(candidate, input.unitAliases);
    if (!patchKind) {
      resolvedCandidates.push(candidate);
      continue;
    }

    const target = inferRecentTargetItem(input.input, candidate, patchKind, input.intent, input.catalogIndex, input.unitAliases);
    if (target.status === 'resolved') {
      resolvedCandidates.push(buildContextPatchedCandidate(candidate, target.item, patchKind));
      continue;
    }

    omittedClarifications.push(...buildOmittedTargetPending({
      orchestratorInput: input.input,
      candidate,
      intent: input.intent,
      patchKind,
      targets: target.status === 'ambiguous' ? target.items : [],
    }));
  }

  const response = resolvedCandidates.length === 0 && omittedClarifications.length > 0
    ? buildOmittedTargetOnlyResponse({
        orchestratorInput: input.input,
        clarifications: omittedClarifications,
        candidateCount: input.candidates.length,
      })
    : null;

  return { candidates: resolvedCandidates, omittedClarifications, response };
}

function getContextPatchKind(candidate: DeterministicCandidate, unitAliases: UnitAliasMap): ContextPatchKind | null {
  const itemText = normalizeSearchText(candidate.item_text ?? '');
  if (!itemText) {
    if (candidate.quantity != null && candidate.unit) return 'quantity_unit';
    if (candidate.unit) return 'unit_only';
    if (candidate.quantity != null) return 'quantity_only';
    return null;
  }
  const unit = normalizeUnitForComparison(candidate.unit, unitAliases);
  const rawUnit = normalizeUnitForComparison(candidate.unit_raw, unitAliases);
  if (unit && (normalizeUnitForComparison(itemText, unitAliases) === unit || normalizeUnitForComparison(itemText, unitAliases) === rawUnit)) {
    if (candidate.quantity != null) return 'quantity_unit';
    return 'unit_only';
  }
  return null;
}

function isOmittedItemCandidate(candidate: DeterministicCandidate, unitAliases: UnitAliasMap): boolean {
  return getContextPatchKind(candidate, unitAliases) != null;
}

function buildContextPatchedCandidate(
  candidate: DeterministicCandidate,
  target: RecentTargetItem,
  patchKind: ContextPatchKind,
): DeterministicCandidate {
  const quantity = patchKind === 'unit_only'
    ? target.quantity ?? candidate.quantity
    : candidate.quantity;
  const unit = patchKind === 'quantity_only'
    ? target.unit ?? candidate.unit
    : candidate.unit;
  return {
    ...candidate,
    item_text: target.item_name,
    quantity: quantity ?? null,
    unit: unit ?? null,
    issue: quantity == null
      ? 'missing_quantity'
      : unit == null
        ? 'missing_unit'
        : undefined,
  };
}

function inferRecentTargetItem(
  input: OrchestratorInput,
  candidate: DeterministicCandidate,
  patchKind: ContextPatchKind,
  intent: string,
  catalogIndex: CatalogSearchIndex,
  unitAliases: UnitAliasMap,
): { status: 'resolved'; item: RecentTargetItem } | { status: 'ambiguous'; items: RecentTargetItem[] } | { status: 'none' } {
  const contextInterrupted = isRecentContextInterrupted(input.previousMessages, input.catalog, catalogIndex, unitAliases);

  if (!contextInterrupted) {
    const pendingTargets = uniqueRecentTargets(
      input.existingParsedItems
        .filter((item) => item.item_id && !item.unresolved && isAwaitingQuantityOrUnit(item))
        .map(targetFromParsedItem),
    ).filter((item) => canApplyContextPatch(item, patchKind, intent));
    const pendingByUnit = filterTargetsByUnit(pendingTargets, candidate.unit, unitAliases);
    if (pendingByUnit.length === 1) return { status: 'resolved', item: pendingByUnit[0] };
    if (pendingTargets.length === 1) return { status: 'resolved', item: pendingTargets[0] };
    if (pendingTargets.length > 1) return { status: 'ambiguous', items: pendingTargets };

    const recentTargets = latestTargetsFromMessages(input.previousMessages, input.catalog, catalogIndex, unitAliases)
      .filter((item) => canApplyContextPatch(item, patchKind, intent));
    const recentByUnit = filterTargetsByUnit(recentTargets, candidate.unit, unitAliases);
    if (recentByUnit.length === 1) return { status: 'resolved', item: recentByUnit[0] };
    if (recentTargets.length === 1) return { status: 'resolved', item: recentTargets[0] };
    if (recentTargets.length > 1) return { status: 'ambiguous', items: recentTargets };
  }

  const existingTargets = uniqueRecentTargets(
    input.existingParsedItems
      .filter((item) => item.item_id && !item.unresolved && (!contextInterrupted || !isAwaitingQuantityOrUnit(item)))
      .map(targetFromParsedItem),
  ).filter((item) => canApplyContextPatch(item, patchKind, intent));
  const existingByUnit = filterTargetsByUnit(existingTargets, candidate.unit, unitAliases);
  if (existingByUnit.length === 1) return { status: 'resolved', item: existingByUnit[0] };
  if (existingTargets.length === 1) return { status: 'resolved', item: existingTargets[0] };
  if (existingTargets.length > 1) return { status: 'ambiguous', items: existingTargets };

  return { status: 'none' };
}

function canApplyContextPatch(item: RecentTargetItem, patchKind: ContextPatchKind, intent: string): boolean {
  switch (patchKind) {
    case 'unit_only':
      return item.quantity != null && !item.unit;
    case 'quantity_only':
      return item.quantity == null;
    case 'quantity_unit':
      return isCommandContextPatch(intent) || item.quantity == null || !item.unit;
    default:
      return false;
  }
}

function isCommandContextPatch(intent: string): boolean {
  return COMMAND_INTENTS.has(intent);
}

function isRecentContextInterrupted(
  messages: QuickOrderMessage[],
  catalog: CatalogItem[],
  catalogIndex: CatalogSearchIndex,
  unitAliases: UnitAliasMap,
): boolean {
  const start = Math.max(0, messages.length - 6);
  for (let index = messages.length - 1; index >= start; index -= 1) {
    const message = messages[index];
    const structuredTargetCount =
      (message.pending_clarifications ?? []).filter((clarification) => clarification.incoming_item?.item_id).length +
      (message.parsed_items ?? []).filter((item) => item.item_id && !item.unresolved).length;
    if (structuredTargetCount > 0) return false;

    const role = message.role ?? '';
    const text = message.content ?? message.text ?? message.raw_text ?? '';
    if (role === 'user' && text.trim()) {
      return targetsFromUserText(text, catalog, catalogIndex, unitAliases).length === 0;
    }
  }
  return false;
}

function isAwaitingQuantityOrUnit(item: ParsedItem): boolean {
  return item.status === 'missing_quantity' ||
    item.status === 'missing_quantity_and_unit' ||
    item.status === 'missing_unit' ||
    Boolean(item.needs_clarification && item.item_id && (item.quantity == null || !item.unit));
}

function latestTargetsFromMessages(
  messages: QuickOrderMessage[],
  catalog: CatalogItem[],
  catalogIndex: CatalogSearchIndex,
  unitAliases: UnitAliasMap,
): RecentTargetItem[] {
  const start = Math.max(0, messages.length - 6);
  for (let index = messages.length - 1; index >= start; index -= 1) {
    const message = messages[index];
    const structuredTargets = uniqueRecentTargets([
      ...((message.pending_clarifications ?? [])
        .map((clarification) => clarification.incoming_item)
        .filter((item): item is ParsedItem => Boolean(item?.item_id))
        .map(targetFromParsedItem)),
      ...((message.parsed_items ?? [])
        .filter((item) => item.item_id && !item.unresolved)
        .map(targetFromParsedItem)),
    ]);
    if (structuredTargets.length > 0) return structuredTargets;

    const role = message.role ?? '';
    const text = message.content ?? message.text ?? message.raw_text ?? '';
    if (role === 'user' && text.trim()) {
      const textTargets = targetsFromUserText(text, catalog, catalogIndex, unitAliases);
      if (textTargets.length > 0) return textTargets;
      return [];
    }
  }
  return [];
}

function targetsFromUserText(
  text: string,
  catalog: CatalogItem[],
  catalogIndex: CatalogSearchIndex,
  unitAliases: UnitAliasMap,
): RecentTargetItem[] {
  const candidates = parseDeterministicOrder(text, unitAliases).filter((candidate) => !isOmittedItemCandidate(candidate, unitAliases));
  if (candidates.length === 0) return [];
  const targets = candidates
    .map((candidate) => matchCatalogIndex(candidate.item_text, catalogIndex))
    .filter((match) => match.item_id && !match.needs_clarification)
    .map((match) => ({
      item_id: match.item_id as string,
      item_name: match.item_name ?? match.display_name ?? 'Item',
      display_name: match.display_name ?? match.item_name ?? 'Item',
    }));
  return uniqueRecentTargets(targets);
}

function targetFromParsedItem(item: ParsedItem): RecentTargetItem {
  return {
    item_id: item.item_id as string,
    item_name: item.item_name ?? item.display_name ?? item.raw_token ?? 'Item',
    display_name: item.display_name ?? item.item_name ?? item.raw_token ?? 'Item',
    quantity: item.quantity,
    unit: item.unit,
    existing_item_key: getParserItemKey(item),
  };
}

function uniqueRecentTargets(items: RecentTargetItem[]): RecentTargetItem[] {
  const byId = new Map<string, RecentTargetItem>();
  for (const item of items) {
    if (!item.item_id) continue;
    if (!byId.has(item.item_id)) byId.set(item.item_id, item);
  }
  return [...byId.values()];
}

function filterTargetsByUnit(
  items: RecentTargetItem[],
  unit: string | null | undefined,
  unitAliases: UnitAliasMap,
): RecentTargetItem[] {
  const normalized = normalizeUnitForComparison(unit, unitAliases);
  if (!normalized) return [];
  return items.filter((item) => normalizeUnitForComparison(item.unit, unitAliases) === normalized);
}

function buildOmittedTargetPending(input: {
  orchestratorInput: OrchestratorInput;
  candidate: DeterministicCandidate;
  intent: string;
  patchKind: ContextPatchKind;
  targets: RecentTargetItem[];
}): NonNullable<ParseResponse['pending_clarifications']> {
  const patchLabel = formatContextPatchLabel(input.candidate, input.patchKind);
  const isRemoval = input.intent === 'remove' || input.intent === 'decrease';
  const message = input.targets.length > 0
    ? isRemoval
      ? `Which item should I remove ${patchLabel} from?`
      : `Which item should I apply ${patchLabel} to?`
    : `I need the item name for ${patchLabel}.`;
  return [{
    id: createClientKey(input.targets.length > 0 ? (isRemoval ? 'remove_target' : 'target') : 'missing_item'),
    type: input.targets.length > 0
      ? (isRemoval ? 'remove_ambiguous' as const : 'choose_existing_line' as const)
      : 'item_not_found' as const,
    item_id: null,
    item_name: patchLabel,
    message,
    incoming_item: {
      line_id: input.candidate.line_id,
      raw_text: input.candidate.raw_text,
      raw_token: input.candidate.raw_text,
      item_text: patchLabel,
      quantity: input.candidate.quantity,
      unit: input.candidate.unit,
    } as ParsedItem,
    actions: input.targets.length > 0
      ? [
        ...input.targets.slice(0, 4).map((target) => ({
          id: 'choose_existing' as const,
          label: target.display_name ?? target.item_name,
          existing_item_key: target.existing_item_key,
        })),
        { id: 'cancel' as const, label: 'Cancel' },
      ]
      : [],
  }];
}

function buildOmittedTargetOnlyResponse(input: {
  orchestratorInput: OrchestratorInput;
  clarifications: NonNullable<ParseResponse['pending_clarifications']>;
  candidateCount: number;
}): ParseResponse {
  const message = input.clarifications[0]?.message ?? 'I need more context for that update.';
  return {
    status: 'needs_clarification',
    assistant_message: message,
    reply_text: message,
    parsed_items: [],
    flags: [{
      type: input.clarifications.some((c) => c.actions.length > 0) ? 'ambiguous_item' : 'unresolved_item',
      message,
      raw_token: input.clarifications[0]?.incoming_item?.raw_text,
      reason: input.clarifications.some((c) => c.actions.length > 0) ? 'omitted_item_ambiguous' : 'omitted_item_no_context',
    }],
    suggestions: [],
    pending_actions: input.clarifications,
    pending_clarifications: input.clarifications,
    session_state: {
      total_items: input.orchestratorInput.existingParsedItems.length,
      ready_to_submit: false,
    },
    diagnostics: {
      parser_version: PARSER_VERSION,
      parse_mode: 'deterministic_only',
      catalog_count: input.orchestratorInput.catalog.length,
      candidate_count: input.candidateCount,
      items_before_validation: input.candidateCount,
      items_after_validation: 0,
      valid_count: 0,
      review_count: 0,
      items_received: input.candidateCount,
      items_accepted: 0,
      items_rejected: input.candidateCount,
      rejected_reasons: ['omitted_item_unresolved'],
      pending_action_count: input.clarifications.length,
      raw_input_length: input.orchestratorInput.rawText.length,
      candidate_lines: input.candidateCount,
    },
  };
}

function formatContextPatchLabel(candidate: DeterministicCandidate, patchKind: ContextPatchKind): string {
  if (patchKind === 'unit_only') return displayUnitLabel(candidate.unit) || 'that unit';
  if (patchKind === 'quantity_only') return formatQuantityWithUnit(candidate.quantity, null);
  return formatQuantityWithUnit(candidate.quantity, candidate.unit);
}

function maybeAmbiguousBareCatalogToken(
  candidate: ReturnType<typeof parseDeterministicOrder>[number],
  match: ReturnType<typeof matchCatalogIndex>,
  catalogIndex: CatalogSearchIndex,
): ReturnType<typeof matchCatalogIndex> {
  if (!match.item_id || candidate.quantity != null || candidate.unit) return match;
  const normalized = normalizeSearchText(candidate.item_text);
  if (!normalized || normalized.includes(' ')) return match;
  if (hasExactSameLengthCatalogNameMatch(normalized, match, catalogIndex)) return match;
  if (hasExactCatalogNameStructuralSegmentMatch(normalized, match, catalogIndex)) return match;

  if (match.match_type === 'fuzzy') {
    const matchedTerm = normalizeSearchText(match.matched_term ?? match.item_name ?? '');
    const lengthRatio = matchedTerm
      ? Math.min(normalized.length, matchedTerm.length) / Math.max(normalized.length, matchedTerm.length)
      : 0;
    if (lengthRatio < 0.65) return match;
    const alternatives = findCatalogAlternatives(candidate.item_text, catalogIndex, 3);
    if (alternatives.length > 0) {
      return {
        item_id: null,
        item_name: null,
        display_name: candidate.item_text,
        match_type: 'ambiguous',
        confidence: match.confidence,
        needs_clarification: true,
        issue: 'Item spelling needs confirmation.',
        alternatives,
      };
    }
  }

  const entries = catalogIndex.entries.filter((entry) => {
    if (entry.type !== 'name' && entry.type !== 'alias' && entry.type !== 'parenthetical' && entry.type !== 'generated') return false;
    return entry.normalized === normalized ||
      entry.normalized.startsWith(`${normalized} `) ||
      entry.normalized.endsWith(` ${normalized}`);
  });
  const itemIds = new Set(entries.map((entry) => entry.item.id));
  if (itemIds.size <= 1) return match;

  return {
    item_id: null,
    item_name: null,
    display_name: candidate.item_text,
    match_type: 'ambiguous',
    confidence: 0.9,
    needs_clarification: true,
    issue: 'Item text matches multiple catalog items.',
    alternatives: findCatalogAlternatives(candidate.item_text, catalogIndex, 5),
  };
}

function maybePromoteBareCatalogToken(
  candidate: ReturnType<typeof parseDeterministicOrder>[number],
  match: ReturnType<typeof matchCatalogIndex>,
  catalogIndex: CatalogSearchIndex,
): ReturnType<typeof matchCatalogIndex> {
  if (match.item_id || candidate.quantity != null || candidate.unit) return match;
  const normalized = normalizeSearchText(candidate.item_text);
  if (!normalized || normalized.includes(' ')) return match;

  const alternatives = findCatalogAlternatives(candidate.item_text, catalogIndex, 5);
  const top = alternatives[0];
  if (!top || !isPromotableBareAlternative(top)) return match;

  const topConfidence = top.confidence ?? top.score ?? 0;
  const tied = alternatives.filter((alternative) => {
    const confidence = alternative.confidence ?? alternative.score ?? 0;
    return Math.abs(confidence - topConfidence) < 0.001;
  });
  const structuralTies = tied.filter((alternative) =>
    alternative.item_name && catalogNameStructuralSegmentMatches(alternative.item_name, normalized)
  );
  if (tied.length > 1 && structuralTies.length !== 1) return match;
  const selected = structuralTies[0] ?? top;
  if (!selected.item_id || !selected.item_name) return match;

  return {
    item_id: selected.item_id,
    item_name: selected.item_name,
    display_name: selected.item_name,
    matched_alias: selected.matched_term ?? selected.term,
    matched_term: selected.matched_term ?? selected.term,
    match_type: selected.match_type ?? 'parenthetical_or_generated_exact',
    confidence: selected.confidence ?? selected.score ?? 0.94,
    needs_clarification: false,
    alternatives,
    confidence_tier: 'high',
    decision_reason: 'promoted_bare_exact_alternative',
  };
}

function isPromotableBareAlternative(alternative: CatalogAlternative): boolean {
  const confidence = alternative.confidence ?? alternative.score ?? 0;
  return confidence >= 0.9 && isStrongCandidateMatchType(alternative.match_type);
}

function hasExactSameLengthCatalogNameMatch(
  normalized: string,
  match: ReturnType<typeof matchCatalogIndex>,
  catalogIndex: CatalogSearchIndex,
): boolean {
  const inputTokenCount = normalized.split(' ').filter(Boolean).length;
  return catalogIndex.entries.some((entry) =>
    entry.item.id === match.item_id &&
    entry.type === 'name' &&
    entry.normalized === normalized &&
    entry.normalized.split(' ').filter(Boolean).length === inputTokenCount
  );
}

function hasExactCatalogNameStructuralSegmentMatch(
  normalized: string,
  match: ReturnType<typeof matchCatalogIndex>,
  catalogIndex: CatalogSearchIndex,
): boolean {
  return catalogIndex.entries.some((entry) =>
    entry.item.id === match.item_id &&
    entry.type === 'name' &&
    catalogNameStructuralSegmentMatches(entry.item.name, normalized)
  );
}

type ItemDiagnostic = NonNullable<NonNullable<ParseResponse['diagnostics']>['item_diagnostics']>[number];

function buildPreParseResponse(
  input: OrchestratorInput,
  classification: QuickOrderInputClassificationResult,
  catalogDebug: ParseDiagnostics['catalog_debug'],
): ParseResponse | null {
  switch (classification.classification) {
    case 'current_stock_update':
      return buildNonOrderResponse(input, classification, 'Stock count noted.', catalogDebug);
    case 'recommend_order_request':
      return buildNonOrderResponse(input, classification, 'I don’t have enough current stock context to recommend an order yet.', catalogDebug);
    case 'mixed_stock_and_order_request':
    case 'mixed_stock_and_recommendation_request':
      return null;
    case 'suggestion_request':
      return buildNonOrderResponse(input, classification, 'I don’t have enough order history to suggest a usual order yet.', catalogDebug);
    case 'history_request':
      return buildNonOrderResponse(input, classification, getHistoryPlaceholderMessage(classification.normalizedText), catalogDebug);
    case 'tutorial_request':
      return buildNonOrderResponse(input, classification, buildTutorialMessage(), catalogDebug);
    case 'identity_question':
      return buildNonOrderResponse(input, classification, buildTutorialMessage(), catalogDebug);
    case 'duplicate_resolution_action':
      if (classification.reason === 'no_pending_duplicate_action') {
        return buildNonOrderResponse(input, classification, 'There is nothing to combine right now.', catalogDebug);
      }
      return null;
    case 'clear_request':
      if (input.existingParsedItems.length === 0) {
        return buildNonOrderResponse(input, classification, 'There is no current Quick Order list to clear.', catalogDebug);
      }
      return {
        status: 'needs_clarification',
        assistant_message: 'Clear the current Quick Order list?',
        reply_text: 'Clear the current Quick Order list?',
        parsed_items: [],
        flags: [],
        suggestions: [],
        pending_actions: [{
          id: 'clear_order_confirmation',
          type: 'clear_order',
          item_id: null,
          item_name: 'Quick Order',
          message: 'Clear the current Quick Order list?',
          actions: [
            { id: 'clear_order', label: 'Clear order' },
            { id: 'cancel', label: 'Cancel' },
          ],
        }],
        pending_clarifications: [{
          id: 'clear_order_confirmation',
          type: 'clear_order',
          item_id: null,
          item_name: 'Quick Order',
          message: 'Clear the current Quick Order list?',
          actions: [
            { id: 'clear_order', label: 'Clear order' },
            { id: 'cancel', label: 'Cancel' },
          ],
        }],
        session_state: {
          total_items: input.existingParsedItems.length,
          ready_to_submit: false,
        },
        diagnostics: buildClassificationDiagnostics(input, classification, catalogDebug),
      };
    case 'unknown_non_order':
      return buildNonOrderResponse(input, classification, 'I’m not sure what you want me to do. Do you want to add items, see past orders, get a recommendation, or ask for help?', catalogDebug);
    case 'order_entry':
    case 'order_command':
    case 'clarification_answer':
    case 'confirm_request':
      return null;
    default:
      return null;
  }
}

function getHistoryPlaceholderMessage(normalizedText: string): string {
  if (/\breorder recent\b|\brecent order\b|\blast order\b/.test(normalizedText)) {
    return 'I couldn’t find a recent order for this location yet.';
  }
  if (/\busual\b/.test(normalizedText)) {
    return 'I don’t have enough history to suggest a usual order yet.';
  }
  return 'No matching order from last week was found for this location.';
}

function buildTutorialMessage(): string {
  return [
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
}

function buildNonOrderResponse(
  input: OrchestratorInput,
  classification: QuickOrderInputClassificationResult,
  message: string,
  catalogDebug: ParseDiagnostics['catalog_debug'],
): ParseResponse {
  return {
    status: 'ok',
    assistant_message: message,
    reply_text: message,
    parsed_items: [],
    flags: [],
    suggestions: [],
    pending_actions: [],
    pending_clarifications: [],
    session_state: {
      total_items: input.existingParsedItems.length,
      ready_to_submit: false,
    },
    diagnostics: {
      ...buildClassificationDiagnostics(input, classification, catalogDebug),
      item_diagnostics: [{
        raw_text: input.rawText,
        item_text: input.rawText.trim(),
        status: 'no_op',
        action: null,
        was_added_to_order_list: false,
        no_op_reason: classification.reason,
      }],
    },
  };
}

function hasProductQuestionContext(
  rawText: string,
  input: OrchestratorInput,
  catalogIndex: CatalogSearchIndex,
): boolean {
  if (input.existingParsedItems.some((item) => item.item_id || item.item_name || item.item_text)) return true;
  if (catalogTextMentionsItem(rawText, catalogIndex)) return true;
  return /\b(?:supplier|supplies|carry|sell|available|unit|units|case|pack|size|sizes)\b/i.test(rawText) &&
    catalogTextMentionsItem(rawText, catalogIndex);
}

function catalogTextMentionsItem(rawText: string, catalogIndex: CatalogSearchIndex): boolean {
  const normalizedText = ` ${normalizeSearchText(rawText)} `;
  if (!normalizedText.trim()) return false;
  for (const entry of catalogIndex.entries) {
    const term = normalizeSearchText(entry.term);
    if (!term || term.length < 3) continue;
    if (normalizedText.includes(` ${term} `)) return true;
  }
  return false;
}

function buildClassificationDiagnostics(
  input: OrchestratorInput,
  classification: QuickOrderInputClassificationResult,
  catalogDebug: ParseDiagnostics['catalog_debug'],
): ParseDiagnostics {
  return {
    parser_version: PARSER_VERSION,
    parse_mode: 'deterministic_only',
    catalog_count: input.catalog.length,
    candidate_count: 0,
    items_before_validation: 0,
    items_after_validation: 0,
    valid_count: 0,
    review_count: 0,
    items_received: 0,
    items_accepted: 0,
    items_rejected: 0,
    rejected_reasons: [classification.reason],
    pending_action_count: 0,
    catalog_debug: catalogDebug,
    raw_input_length: input.rawText.length,
    candidate_lines: 0,
    input_classification: classification.classification,
    input_classification_reason: classification.reason,
  };
}

function normalizeParsedItemsForResponse(items: ParsedItem[], catalog: CatalogItem[]): ParsedItem[] {
  return items.map((item) => normalizeParsedItemStatus(
    item,
    item.item_id ? catalog.find((catalogItem) => catalogItem.id === item.item_id) ?? null : null,
  ));
}

function gateParsedItemsForOrder(
  items: ParsedItem[],
  catalogIndex: CatalogSearchIndex,
  catalog: CatalogItem[],
): {
  items: ParsedItem[];
  noOpDiagnostics: ItemDiagnostic[];
  pendingClarifications: NonNullable<ParseResponse['pending_clarifications']>;
} {
  const keptItems: ParsedItem[] = [];
  const noOpDiagnostics: ItemDiagnostic[] = [];
  const pendingClarifications: NonNullable<ParseResponse['pending_clarifications']> = [];

  for (const item of items) {
    const decision = shouldKeepParsedItem(item, catalogIndex);
    if (decision.keep) {
      keptItems.push(item);
      continue;
    }

    noOpDiagnostics.push(buildNoOpItemDiagnostic(item, catalogIndex, decision.reason));
    const clarification = buildRejectedItemClarification(item, catalogIndex, catalog);
    if (clarification) pendingClarifications.push(clarification);
  }

  return { items: keptItems, noOpDiagnostics, pendingClarifications };
}

function shouldKeepParsedItem(
  item: ParsedItem,
  catalogIndex: CatalogSearchIndex,
): { keep: boolean; reason: string } {
  const rawText = item.raw_text ?? item.raw_token ?? '';
  const itemText = item.item_text ?? item.item_name ?? item.raw_token ?? rawText;
  if (isCommandOnlyText(rawText) || isCommandOnlyText(itemText)) {
    return { keep: false, reason: commandNoOpReason(rawText || itemText) };
  }

  const hasQuantityOrUnit = item.quantity != null || Boolean(item.unit?.trim());
  const isSingleBareWord = isSingleWord(itemText) && !hasQuantityOrUnit;
  if (item.item_id) {
    if (item.status === 'invalid_unit') {
      return { keep: false, reason: 'invalid_unit' };
    }
    if (item.match_type === 'fuzzy' && !isAcceptableResolvedFuzzyItem(item, itemText, isSingleBareWord)) {
      return { keep: false, reason: 'weak_fuzzy_match' };
    }
    return { keep: true, reason: 'catalog_match' };
  }

  const topCandidate = topCandidatesForItem(item, catalogIndex)[0];
  const topConfidence = topCandidate?.confidence ?? topCandidate?.score ?? 0;

  if (item.status === 'ambiguous') {
    if (topConfidence >= 0.75) return { keep: false, reason: 'medium_confidence_match_needs_confirmation' };
    return { keep: false, reason: 'ambiguous_candidate_below_threshold' };
  }

  if (item.status === 'no_match' || item.unresolved || item.needs_clarification) {
    if (topConfidence >= MIN_PLAUSIBLE_REVIEW_CONFIDENCE) {
      return { keep: false, reason: 'medium_confidence_match_needs_confirmation' };
    }
    if (isSingleBareWord) return { keep: false, reason: 'single_word_unknown_without_strong_match' };
    return { keep: false, reason: 'no_catalog_match_above_threshold' };
  }

  return { keep: true, reason: 'order_row' };
}

function isAcceptableResolvedFuzzyItem(
  item: ParsedItem,
  itemText: string,
  isSingleBareWord: boolean,
): boolean {
  const itemName = item.item_name ?? item.display_name ?? '';
  const inputToken = normalizeSearchText(itemText);
  const catalogTokens = normalizeSearchText(itemName).split(/\s+/).filter(Boolean);
  if (isSingleBareWord) return catalogTokens.some((token) => isCloseSingleTokenTypo(inputToken, token));

  const confidence = item.confidence ?? 0;
  if (confidence >= MIN_PLAUSIBLE_REVIEW_CONFIDENCE) return true;
  const semantic = analyzeSemanticTokens(itemText, itemName);
  if (semantic.passed && semantic.tokenCoverage >= 0.75) return true;
  return false;
}

function isCloseSingleTokenTypo(inputToken: string, catalogToken: string): boolean {
  if (!inputToken || !catalogToken) return false;
  const lengthGap = Math.abs(inputToken.length - catalogToken.length);
  if (lengthGap > 2) return false;
  const longerLength = Math.max(inputToken.length, catalogToken.length);
  if (longerLength < 4) return inputToken === catalogToken;
  const distance = levenshteinDistance(inputToken, catalogToken);
  return distance <= (longerLength <= 6 ? 1 : 2);
}

function levenshteinDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }

  return previous[b.length] ?? 0;
}

function isPlausibleForLlm(item: ParsedItem, catalogIndex: CatalogSearchIndex): boolean {
  if (item.item_id || isStrongDeterministicMatch(item)) return false;
  const rawText = item.raw_text ?? item.raw_token ?? '';
  const itemText = item.item_text ?? item.item_name ?? item.raw_token ?? rawText;
  if (isCommandOnlyText(rawText) || isCommandOnlyText(itemText)) return false;
  const topCandidate = topCandidatesForItem(item, catalogIndex)[0];
  const topConfidence = topCandidate?.confidence ?? topCandidate?.score ?? 0;
  if (topConfidence >= MIN_PLAUSIBLE_REVIEW_CONFIDENCE) return true;
  return false;
}

function buildNoOpResponse(input: {
  input: OrchestratorInput;
  candidatesCount: number;
  catalogDebug: ReturnType<typeof buildCatalogDebug>;
  noOpDiagnostics: ItemDiagnostic[];
  pendingClarifications: NonNullable<ParseResponse['pending_clarifications']>;
  flags: ParseFlag[];
}): ParseResponse {
  const assistantMessage = input.pendingClarifications[0]?.message ?? buildNoOpMessage(input.noOpDiagnostics);
  const rejectedReasons = input.noOpDiagnostics
    .map((diagnostic) => diagnostic.no_op_reason)
    .filter((reason): reason is string => Boolean(reason));

  return {
    status: input.pendingClarifications.length > 0 ? 'needs_clarification' : 'ok',
    assistant_message: assistantMessage,
    reply_text: assistantMessage,
    parsed_items: [],
    flags: input.flags,
    suggestions: [],
    pending_actions: input.pendingClarifications,
    pending_clarifications: input.pendingClarifications,
    session_state: {
      total_items: input.input.existingParsedItems.length,
      ready_to_submit: false,
    },
    metrics: {
      parse_mode_used: 'deterministic_only',
      lines_parsed: input.candidatesCount,
      high_confidence_matches: 0,
      fuzzy_matches: 0,
      unresolved_items: 0,
      conflicts: 0,
      json_repair_needed: false,
      llm_failed: false,
      llm_used: false,
    },
    diagnostics: {
      parser_version: PARSER_VERSION,
      parse_mode: 'deterministic_only',
      catalog_count: input.input.catalog.length,
      candidate_count: input.candidatesCount,
      items_before_validation: input.candidatesCount,
      items_after_validation: 0,
      valid_count: 0,
      review_count: 0,
      llm_lines_sent: 0,
      llm_replaced_count: 0,
      replaced_review_count: 0,
      duplicate_line_count: 0,
      ignored_llm_extra_count: 0,
      items_received: input.candidatesCount,
      items_accepted: 0,
      items_rejected: input.noOpDiagnostics.length,
      rejected_reasons: rejectedReasons,
      pending_action_count: input.pendingClarifications.length,
      item_diagnostics: input.noOpDiagnostics,
      catalog_debug: input.catalogDebug,
      raw_input_length: input.input.rawText.length,
      candidate_lines: input.candidatesCount,
    },
  };
}

function buildNoOpItemDiagnostic(
  item: ParsedItem,
  catalogIndex: CatalogSearchIndex,
  reason: string,
): ItemDiagnostic {
  const rawText = item.raw_text ?? item.raw_token ?? '';
  const itemText = item.item_text ?? item.item_name ?? item.raw_token ?? rawText;
  const topCandidates = topCandidatesForItem(item, catalogIndex);
  const semantic = topCandidates[0]?.matched_term
    ? analyzeSemanticTokens(itemText, topCandidates[0].matched_term)
    : null;
  const noOpReason = reason === 'command_without_pending_action'
    ? reason
    : semantic && !semantic.passed
      ? semantic.reason
      : reason;
  return {
    line_id: item.line_id,
    raw_text: rawText,
    item_text: itemText,
    quantity: item.quantity,
    raw_unit: extractRawUnit(rawText),
    normalized_unit: item.unit,
    matched_item_id: item.item_id,
    matched_item_name: item.item_name,
    selected_item_id: item.item_id,
    selected_item_name: item.item_name,
    item_id: item.item_id,
    item_name: item.item_name,
    match_type: item.match_type,
    match_confidence: item.confidence,
    confidence: item.confidence,
    status: 'no_op',
    action: null,
    reason: noOpReason,
    issue: null,
    alternatives: item.alternatives?.slice(0, 3),
    top_alternatives: topCandidates,
    top_candidates: topCandidates,
    failure_reason: noOpReason,
    ambiguity_reason: null,
    selected_location_catalog_contains_exact: catalogHasExact(itemText, catalogIndex),
    was_added_to_order_list: false,
    no_op_reason: noOpReason,
    pending_action_resolved: false,
    existing_item_resolved: false,
    action_type: commandNoOpReason(rawText) === 'command_without_pending_action' ? normalizeCommandText(rawText) : null,
    pending_action_id: null,
    input_tokens: semantic?.inputTokens,
    input_generic_tokens: semantic?.inputGenericTokens,
    input_specific_tokens: semantic?.inputSpecificTokens,
    token_coverage: semantic?.tokenCoverage,
    generic_token_overlap: semantic?.genericTokenOverlap,
    specific_token_overlap: semantic?.specificTokenOverlap,
    missing_specific_tokens: semantic?.missingSpecificTokens,
    semantic_validation_passed: semantic?.passed,
  };
}

function buildRejectedItemClarification(
  item: ParsedItem,
  catalogIndex: CatalogSearchIndex,
  catalog: CatalogItem[],
): NonNullable<ParseResponse['pending_clarifications']>[number] | null {
  const rawText = item.raw_text ?? item.raw_token ?? '';
  const itemText = item.item_text ?? item.item_name ?? item.raw_token ?? rawText;
  const displayName = item.item_name ?? item.display_name ?? itemText;

  if (item.item_id && item.status === 'invalid_unit') {
    const catalogItem = catalog.find((entry) => entry.id === item.item_id) ?? null;
    const allowedUnits = deriveAllowedUnitsForActions(catalogItem, item);
    const providedUnit = displayUnitLabel(item.unit);
    return {
      id: createRejectedClarificationId(item, 'invalid_unit'),
      type: 'invalid_unit',
      item_id: item.item_id,
      item_name: displayName,
      incoming_item: item,
      message: item.issue ?? `${displayName} cannot be ordered as ${providedUnit || 'that unit'}. Use ${formatAllowedUnitList(allowedUnits)}.`,
      actions: [
        ...allowedUnits.slice(0, 4).map((unit) => ({
          id: 'use_unit' as const,
          label: `Use ${displayUnitLabel(unit)}`,
          unit,
          preview: item.quantity != null ? `${item.quantity} ${displayUnitLabel(unit)}` : displayUnitLabel(unit),
        })),
        { id: 'cancel' as const, label: 'Cancel' },
      ],
    };
  }

  const alternatives = topCandidatesForItem(item, catalogIndex);
  const top = alternatives[0];
  const rawLabel = itemText || rawText || 'that item';
  const topConfidence = top?.confidence ?? top?.score ?? 0;
  if (top && topConfidence >= MIN_PLAUSIBLE_REVIEW_CONFIDENCE) {
    const suggestedItem: ParsedItem = {
      ...item,
      item_id: top.item_id,
      item_name: top.item_name,
      display_name: top.item_name,
      name: top.item_name,
      confidence: topConfidence,
      unresolved: false,
      needs_clarification: item.quantity == null || !item.unit,
      status: item.quantity == null
        ? 'missing_quantity'
        : !item.unit
          ? 'missing_unit'
          : 'valid',
      action: item.quantity == null
        ? 'Add quantity'
        : !item.unit
          ? 'Choose unit'
          : null,
      alternatives,
      candidate_matches: alternatives,
    };
    return {
      id: createRejectedClarificationId(item, 'item_suggestion'),
      type: 'ambiguous_item',
      item_id: null,
      item_name: rawLabel,
      incoming_item: suggestedItem,
      message: `I couldn't recognize "${rawLabel}". Did you mean ${top.item_name}?`,
      actions: [
        { id: 'use_item' as const, label: `Use ${top.item_name}` },
      ],
    };
  }

  return {
    id: createRejectedClarificationId(item, 'item_not_found'),
    type: 'item_not_found',
    item_id: null,
    item_name: rawLabel,
    message: `I couldn't recognize "${rawLabel}". Try the item name again.`,
    actions: [],
  };
}

function deriveAllowedUnitsForActions(catalogItem: CatalogItem | null, item: ParsedItem): string[] {
  const labels = deriveAllowedUnitLabels(catalogItem);
  if (labels.length > 0) return labels;
  return item.valid_units?.length ? item.valid_units : [];
}

function createRejectedClarificationId(item: ParsedItem, prefix: string): string {
  const basis = `${item.line_id ?? ''}:${item.raw_token ?? item.raw_text ?? item.item_text ?? ''}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return `${prefix}_${basis || 'item'}`;
}

function buildNoOpMessage(diagnostics: ItemDiagnostic[]): string {
  const first = diagnostics[0];
  const rawText = first?.raw_text?.trim() ?? '';
  const itemText = first?.item_text?.trim() ?? rawText;
  const reason = first?.no_op_reason;
  const topCandidate = first?.top_candidates?.[0];

  if (reason === 'command_without_pending_action' && normalizeCommandText(rawText || itemText) === 'combine') {
    return 'There is nothing to combine right now.';
  }
  if (looksLikeKeyboardNoise(itemText)) {
    return 'I couldn\'t recognize that as an inventory item.';
  }
  if (topCandidate && (topCandidate.confidence ?? topCandidate.score ?? 0) >= MIN_PLAUSIBLE_REVIEW_CONFIDENCE) {
    return `I couldn't recognize "${itemText}". Did you mean ${topCandidate.item_name}?`;
  }
  if (itemText) {
    return `I couldn't recognize "${itemText}". Try the item name again.`;
  }
  return 'I couldn\'t recognize that as an inventory item.';
}

function isCommandOnlyText(value: string): boolean {
  const normalized = normalizeCommandText(value);
  return COMMAND_ONLY_TERMS.has(normalized);
}

function commandNoOpReason(value: string): string {
  return isCommandOnlyText(value) ? 'command_without_pending_action' : 'no_catalog_match_above_threshold';
}

function normalizeCommandText(value: string): string {
  return value.trim().toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, '').replace(/\s+/g, ' ');
}

function isSingleWord(value: string): boolean {
  const normalized = normalizeSearchText(value);
  return Boolean(normalized) && !normalized.includes(' ');
}

function looksLikeKeyboardNoise(value: string): boolean {
  const compact = normalizeSearchText(value).replace(/\s+/g, '');
  return /^(asdf|qwer|zxcv|hjkl)+$/.test(compact);
}

// ---------------------------------------------------------------------------
// Product question helper — bypasses order parsing and asks Gemini directly.
// ---------------------------------------------------------------------------

function unitsForCatalogItem(item: CatalogItem): string[] {
  const collected: string[] = [];
  if (Array.isArray(item.allowed_units)) {
    for (const unit of item.allowed_units) {
      if (typeof unit === 'string' && unit.trim()) collected.push(unit.trim());
    }
  }
  for (const candidate of [item.default_unit, item.base_unit, item.pack_unit, item.order_unit]) {
    if (typeof candidate === 'string' && candidate.trim() && !collected.includes(candidate.trim())) {
      collected.push(candidate.trim());
    }
  }
  return collected;
}

async function buildProductQuestionResponse(
  input: OrchestratorInput,
  classification: QuickOrderInputClassificationResult,
  catalogDebug: ParseDiagnostics['catalog_debug'],
): Promise<ParseResponse> {
  const catalogByName = new Map(input.catalog.map((item) => [item.name.toLowerCase(), item]));

  const cartItems: QaContextProduct[] = input.existingParsedItems
    .map((item): QaContextProduct | null => {
      const name = item.item_name ?? item.item_text ?? null;
      if (!name) return null;
      const catalogMatch = item.item_id
        ? input.catalog.find((entry) => entry.id === item.item_id)
        : catalogByName.get(name.toLowerCase());
      const units = catalogMatch
        ? unitsForCatalogItem(catalogMatch)
        : (item.unit ? [item.unit] : []);
      return { name, units };
    })
    .filter((entry): entry is QaContextProduct => Boolean(entry));

  // Recent matches: pull from prior assistant messages' parsed_items if present.
  const recentMatches: QaContextProduct[] = [];
  const seenRecent = new Set<string>();
  for (const message of input.previousMessages.slice(-5)) {
    const items = Array.isArray(message?.parsed_items) ? message.parsed_items : [];
    for (const rawItem of items) {
      if (!rawItem || typeof rawItem !== 'object') continue;
      const candidate = rawItem as { item_id?: string | null; item_name?: string | null };
      const name = typeof candidate.item_name === 'string' ? candidate.item_name : null;
      if (!name) continue;
      const key = name.toLowerCase();
      if (seenRecent.has(key)) continue;
      seenRecent.add(key);
      const catalogMatch = candidate.item_id
        ? input.catalog.find((entry) => entry.id === candidate.item_id)
        : catalogByName.get(key);
      const units = catalogMatch ? unitsForCatalogItem(catalogMatch) : [];
      recentMatches.push({ name, units });
      if (recentMatches.length >= 10) break;
    }
    if (recentMatches.length >= 10) break;
  }

  const qaResult = await answerProductQuestion({
    userInput: input.rawText,
    cartItems,
    recentMatches,
    userId: input.userId ?? null,
  });

  return {
    status: 'qa_answer',
    assistant_message: qaResult.assistantMessage,
    reply_text: qaResult.assistantMessage,
    parsed_items: [],
    flags: [],
    suggestions: [],
    pending_actions: [],
    pending_clarifications: [],
    session_state: {
      total_items: input.existingParsedItems.length,
      ready_to_submit: false,
    },
    diagnostics: {
      ...buildClassificationDiagnostics(input, classification, catalogDebug),
      parse_mode: 'qa_answer',
    },
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
    isDeterministicCatalogMatch(item.match_type)
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
  if (item.match_type === 'exact_alias' || item.match_type === 'correction' || item.match_type === 'parenthetical') score += 11;
  if (item.match_type === 'normalized_exact' || item.match_type === 'compact_exact' || item.match_type === 'normalized') score += 10;
  if (item.match_type === 'token_set' || item.match_type === 'prefix' || item.match_type === 'plural_normalized') score += 9;
  if (item.parse_source === 'deterministic') score += 2;
  if (item.match_type === 'llm') score += 1;
  return score;
}

function isDeterministicCatalogMatch(matchType: ParsedItem['match_type']): boolean {
  return (
    matchType === 'exact_name' ||
    matchType === 'exact_alias' ||
    matchType === 'correction' ||
    matchType === 'parenthetical_or_generated_exact' ||
    matchType === 'parenthetical_exact' ||
    matchType === 'generated_term_exact' ||
    matchType === 'parenthetical' ||
    matchType === 'normalized_exact' ||
    matchType === 'compact_exact' ||
    matchType === 'token_set' ||
    matchType === 'prefix' ||
    matchType === 'plural_normalized' ||
    matchType === 'normalized' ||
    matchType === 'token'
  );
}

function compareParsedLineOrder(a: ParsedItem, b: ParsedItem): number {
  return lineSortIndex(a.line_id) - lineSortIndex(b.line_id);
}

function lineSortIndex(lineId: string | undefined): number {
  const match = lineId?.match(/^line_(\d+)$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function buildItemDiagnostics(items: ParsedItem[], catalogIndex: CatalogSearchIndex, globalIndex?: CatalogSearchIndex) {
  return items.map((item) => {
    const itemText = item.item_text ?? item.item_name ?? item.raw_token;
    const topCandidates = topCandidatesForItem(item, catalogIndex);
    const matchedTerm = topCandidates[0]?.matched_term ?? topCandidates[0]?.term ?? item.item_name ?? itemText;
    const semantic = analyzeSemanticTokens(itemText, matchedTerm);
    return {
      line_id: item.line_id,
      raw_text: item.raw_text ?? item.raw_token,
      item_text: itemText,
      quantity: item.quantity,
      raw_unit: extractRawUnit(item.raw_text ?? item.raw_token ?? ''),
      normalized_unit: item.unit,
      matched_item_id: item.item_id,
      selected_item_id: item.item_id,
      item_id: item.item_id,
      matched_item_name: item.item_name,
      selected_item_name: item.item_name,
      item_name: item.item_name,
      match_type: item.match_type,
      match_confidence: item.confidence,
      confidence: item.confidence,
      status: item.status,
      action: actionForItem(item),
      reason: item.issue ?? null,
      issue: item.issue ?? null,
      alternatives: item.alternatives?.slice(0, 3),
      top_alternatives: topCandidates,
      top_candidates: topCandidates,
      failure_reason: item.status === 'no_match' ? item.issue ?? 'no_match' : null,
      ambiguity_reason: item.status === 'ambiguous' ? item.issue ?? 'ambiguous' : null,
      selected_location_catalog_contains_exact: catalogHasExact(itemText, catalogIndex),
      global_catalog_contains_exact: globalIndex ? catalogHasExact(itemText, globalIndex) : undefined,
      was_added_to_order_list: true,
      no_op_reason: null,
      pending_action_resolved: false,
      existing_item_resolved: false,
      action_type: null,
      pending_action_id: null,
      input_tokens: semantic.inputTokens,
      input_generic_tokens: semantic.inputGenericTokens,
      input_specific_tokens: semantic.inputSpecificTokens,
      token_coverage: semantic.tokenCoverage,
      generic_token_overlap: semantic.genericTokenOverlap,
      specific_token_overlap: semantic.specificTokenOverlap,
      missing_specific_tokens: semantic.missingSpecificTokens,
      semantic_validation_passed: semantic.passed,
      stale_status_corrected: false,
    };
  });
}

function actionForItem(item: ParsedItem): string | null {
  if (item.action) return item.action;
  if (item.status === 'no_match' || item.status === 'ambiguous') return 'Choose item';
  if (item.status === 'missing_quantity_and_unit') return 'Add quantity';
  if (item.status === 'missing_quantity') return 'Add quantity';
  if (item.status === 'missing_unit') return 'Choose unit';
  if (item.status === 'invalid_unit') return 'Fix unit';
  if (item.status === 'duplicate_needs_decision') return 'Add or replace';
  if (!item.item_id || item.unresolved) return 'Choose item';
  if (item.quantity == null || item.quantity <= 0) return 'Add quantity';
  if (!item.unit?.trim()) return 'Choose unit';
  return null;
}

function topCandidatesForItem(item: ParsedItem, catalogIndex: CatalogSearchIndex): CatalogAlternative[] {
  if (item.alternatives?.length) return item.alternatives.slice(0, 3);
  return findCatalogAlternatives(item.item_text ?? item.item_name ?? item.raw_token, catalogIndex, 3);
}

function hasRejectedStrongCandidate(item: ParsedItem): boolean {
  if (item.status !== 'ambiguous' && item.status !== 'no_match') return false;
  const top = item.alternatives?.[0];
  return Boolean(top && (top.confidence >= 0.9 || top.score != null && top.score >= 0.9) && isStrongCandidateMatchType(top.match_type));
}

function isStrongCandidateMatchType(matchType: CatalogAlternative['match_type']): boolean {
  return (
    matchType === 'exact_name' ||
    matchType === 'exact_alias' ||
    matchType === 'correction' ||
    matchType === 'parenthetical_or_generated_exact' ||
    matchType === 'parenthetical_exact' ||
    matchType === 'generated_term_exact' ||
    matchType === 'parenthetical' ||
    matchType === 'normalized_exact' ||
    matchType === 'compact_exact'
  );
}

function logReviewDiagnostics(diagnostics: NonNullable<ParseResponse['diagnostics']>['item_diagnostics']): void {
  const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  if (runtimeProcess?.env?.NODE_ENV === 'test' || runtimeProcess?.env?.JEST_WORKER_ID) return;
  const reviewDiagnostics = (diagnostics ?? []).filter((item) =>
    item.status === 'ambiguous' ||
    item.status === 'no_match' ||
    item.status === 'missing_quantity' ||
    item.status === 'missing_unit' ||
    item.status === 'invalid_unit'
  );
  if (reviewDiagnostics.length === 0) return;
  console.warn('[parse-order] review_item_diagnostics', JSON.stringify(reviewDiagnostics));
}

function extractRawUnit(rawText: string): string | null {
  const match = rawText.match(/(?:^|\s)(?:\d+(?:\.\d+)?|\d+\/\d+)\s*([a-zA-Z]+)\s*$/);
  return match?.[1] ?? null;
}

function buildCatalogDebug(
  input: OrchestratorInput,
  catalogIndex: CatalogSearchIndex,
  enabled = false,
): ParseDiagnostics['catalog_debug'] {
  if (!enabled) return undefined;

  const searchedTerms = ['crawfish', 'soft shell crab', 'izumidai', 'canadian clam'];
  const selectedContains = {
    crawfish: catalogHasMatch('crawfish', catalogIndex),
    soft_shell_crab: catalogHasMatch('soft shell crab', catalogIndex),
    white_fish_izumidai: catalogHasMatch('izumidai', catalogIndex),
    canadian_clam: catalogHasMatch('canadian clam', catalogIndex),
  };
  const possibleMatches = Object.fromEntries(
    searchedTerms.map((term) => [normalizeDebugKey(term), findCatalogAlternatives(term, catalogIndex, 3)]),
  ) as Record<string, CatalogAlternative[]>;

  const globalIndex = input.globalCatalogIndex ?? (
    input.globalCatalog ? buildCatalogSearchIndex(input.globalCatalog, input.corrections) : null
  );
  const globalContains = globalIndex
    ? {
      crawfish: catalogHasMatch('crawfish', globalIndex),
      soft_shell_crab: catalogHasMatch('soft shell crab', globalIndex),
      white_fish_izumidai: catalogHasMatch('izumidai', globalIndex),
      canadian_clam: catalogHasMatch('canadian clam', globalIndex),
    }
    : undefined;

  return {
    location_id: input.locationId,
    catalog_count: input.catalog.length,
    global_catalog_count: input.globalCatalog?.length,
    searched_terms: searchedTerms,
    catalog_contains: selectedContains,
    global_contains: globalContains,
    possible_matches: possibleMatches,
  };
}

function catalogHasMatch(term: string, index: CatalogSearchIndex): boolean {
  const normalized = normalizeSearchText(term);
  if (!normalized) return false;
  return index.entries.some((entry) =>
    entry.normalized === normalized ||
    entry.compact === normalized.replace(/\s+/g, '') ||
    entry.term === normalized
  );
}

function catalogHasExact(term: string, index: CatalogSearchIndex): boolean {
  const normalized = normalizeSearchText(term);
  if (!normalized) return false;
  const compact = normalized.replace(/\s+/g, '');
  return index.entries.some((entry) =>
    entry.normalized === normalized ||
    entry.compact === compact
  );
}

function normalizeDebugKey(term: string): string {
  if (term === 'izumidai') return 'white_fish_izumidai';
  return term.trim().toLowerCase().replace(/\s+/g, '_');
}

function buildReplyText(
  items: ParsedItem[],
  pendingMessages: string[],
  unchangedCount = 0,
  catalog: CatalogItem[] = [],
): string {
  const goodCount = items.filter((item) => !item.needs_clarification && !item.unresolved).length;
  const conflictCount = pendingMessages.length;
  const reviewCount = items.length - goodCount + conflictCount;
  const outcomeSummaries = buildOutcomeSummaries(items);
  if (pendingMessages.length > 0) {
    return [...outcomeSummaries, ...pendingMessages].slice(0, 2).join(' ');
  }
  if (items.length === 1 && reviewCount === 1) {
    return buildSingleReviewReplyText(items[0], catalog);
  }
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
  if (reviewCount === 0 && outcomeSummaries.length > 0) return outcomeSummaries.join(' ');
  if (reviewCount === 0) return goodCount === 1 ? 'Added this item.' : `Added ${goodCount} items.`;
  return `Got ${goodCount} item${goodCount === 1 ? '' : 's'}, but ${reviewCount} need${reviewCount === 1 ? 's' : ''} review.`;
}

function buildSingleReviewReplyText(item: ParsedItem, catalog: CatalogItem[]): string {
  const displayName = item.display_name ?? item.item_name ?? item.item_text ?? item.raw_token;
  if (item.status === 'missing_quantity') {
    return `Add a quantity for ${displayName}.`;
  }
  if (item.status === 'missing_quantity_and_unit') {
    return `Add a quantity and unit for ${displayName}.`;
  }
  if (item.status === 'missing_unit') {
    const catalogItem = item.item_id ? catalog.find((candidate) => candidate.id === item.item_id) : null;
    const allowedUnits = deriveAllowedUnitLabels(catalogItem);
    return allowedUnits.length
      ? `Add a unit for ${displayName}. Available units: ${formatAllowedUnitList(allowedUnits)}.`
      : `Add a unit for ${displayName}.`;
  }
  if (item.status === 'invalid_unit') {
    const catalogItem = item.item_id ? catalog.find((candidate) => candidate.id === item.item_id) : null;
    const allowedUnits = deriveAllowedUnitLabels(catalogItem);
    const allowedLabel = allowedUnits.length ? ` Use ${formatAllowedUnitList(allowedUnits)}.` : ' Use a valid unit.';
    return `${displayName} cannot be ordered as ${displayUnitLabel(item.unit) || 'that unit'}.${allowedLabel}`;
  }
  if (item.status === 'ambiguous') {
    if (item.issue === 'Item spelling needs confirmation.' && item.alternatives?.[0]?.item_name) {
      return `Did you mean ${item.alternatives[0].item_name}?`;
    }
    if ((item.alternatives?.length ?? 0) === 1) {
      return `Did you mean ${item.alternatives?.[0]?.item_name ?? displayName}?`;
    }
    return `Which ${item.item_text ?? item.raw_token} did you mean?`;
  }
  if (item.status === 'no_match' || item.unresolved) {
    const name = item.item_text ?? item.raw_token;
    return item.alternatives?.length
      ? `I couldn't recognize "${name}". Did you mean ${item.alternatives[0]?.item_name ?? 'one of these'}?`
      : `I couldn't recognize "${name}". Try the item name again.`;
  }
  return `Got this item, but it needs review.`;
}

function buildOutcomeSummaries(items: ParsedItem[]): string[] {
  return items
    .filter((item) => !item.needs_clarification && !item.unresolved)
    .slice(0, 2)
    .map((item) => {
      const displayName = item.display_name ?? item.item_name ?? item.raw_token ?? 'Item';
      const quantity = formatParsedQuantity(item.quantity, item.unit);
      if (item.merge_behavior === 'replace_existing') {
        return `Updated ${displayName} to ${quantity}.`;
      }
      if (item.merge_behavior === 'add_to_existing') {
        const delta = formatParsedQuantity(item.merge_delta_quantity ?? null, item.unit);
        return `Added ${delta} to ${displayName}. New total: ${quantity}.`;
      }
      return `Added ${displayName} ${quantity}.`;
    });
}

function formatParsedQuantity(quantity: number | null | undefined, unit: string | null | undefined): string {
  return formatQuantityWithUnit(quantity, unit);
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
