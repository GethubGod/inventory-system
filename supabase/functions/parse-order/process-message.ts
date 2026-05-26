import { buildCatalogSearchIndex, matchCatalogIndex } from './catalog-matcher.ts';
import { parseDeterministicOrder } from './deterministic-parser.ts';
import type { QuickOrderInputClassificationResult } from './input-classifier.ts';
import { routeIntentWithLlm, type LlmIntentRoute } from './llm-intent-router.ts';
import { normalizeModelUsed, routeQuickOrderModel, type QuickOrderModelConfig } from './model-router.ts';
import { parseQuickOrder, PARSER_VERSION } from './orchestrator.ts';
import { buildQuickOrderRecommendations, type RecommendationHistoryOrder } from './recommendation-engine.ts';
import { buildProcessMessages } from './response-formatter.ts';
import { routeQuickOrderSegments, type QuickOrderSegmentRoute } from './segment-router.ts';
import { applyStockSafetyLimits, deduplicatePendingClarifications, validateQuickOrderSafety } from './safety-engine.ts';
import { applyStockUnitSynonyms, extractStockUpdates, type StockUpdateExtraction } from './stock-updates.ts';
import { QuickOrderTimer } from './timing.ts';
import { validateParsedLine } from './validator.ts';
import type { CatalogSearchIndex } from './catalog-search-index.ts';
import type {
  CatalogItem,
  EmployeeQuickOrderAlias,
  InventoryReorderRule,
  InventoryStatusTerm,
  ItemAllowedUnitRule,
  ItemOrderProfile,
  ItemOrderLimit,
  ItemReorderRule,
  ParserCorrection,
  ParseResponse,
  ParsedItem,
  ProcessQuickOrderMessageRequest,
  ProcessQuickOrderResponse,
  QuickOrderAliasRule,
  QuickOrderReorderRule,
  QuickOrderStatusTerm,
  QuickOrderUnitRule,
  QuickOrderMessage,
  QuickOrderModelUsed,
  StockOperation,
} from './types.ts';
import type { UnitAliasMap } from './units.ts';

export type ProcessQuickOrderMessageInput = {
  request: ProcessQuickOrderMessageRequest;
  catalog: CatalogItem[];
  globalCatalog?: CatalogItem[];
  corrections: ParserCorrection[];
  previousMessages: QuickOrderMessage[];
  existingParsedItems: ParsedItem[];
  limits: ItemOrderLimit[];
  allowedUnitRules: ItemAllowedUnitRule[];
  globalAllowedUnitRules?: ItemAllowedUnitRule[];
  employeeAliases?: EmployeeQuickOrderAlias[];
  employeeNameKeys?: string[];
  aliasRules?: QuickOrderAliasRule[];
  unitRules?: QuickOrderUnitRule[];
  quickOrderReorderRules?: QuickOrderReorderRule[];
  quickOrderStatusTerms?: QuickOrderStatusTerm[];
  parserSettings?: Record<string, unknown>;
  inventoryReorderRules?: InventoryReorderRule[];
  inventoryStatusTerms?: InventoryStatusTerm[];
  reorderRules?: ItemReorderRule[];
  orderProfiles?: ItemOrderProfile[];
  recentOrders: RecommendationHistoryOrder[];
  userRole?: string | null;
  modelConfig: QuickOrderModelConfig;
  unitAliases: UnitAliasMap;
  classification: QuickOrderInputClassificationResult;
  unitSynonyms?: { from_unit: string; to_unit: string }[];
  callLlm?: (prompt: string, model: string | null) => Promise<string>;
  persistStockUpdates?: (updates: StockOperation[]) => Promise<{ ok: boolean; error?: string }>;
  debugTimings?: boolean;
};

export async function processQuickOrderMessage(
  input: ProcessQuickOrderMessageInput,
): Promise<ProcessQuickOrderResponse> {
  const timer = new QuickOrderTimer();
  const request = normalizeRequest(input.request);
  const orderCatalog = input.catalog;
  const globalOrderCatalog = input.globalCatalog;
  const catalogIndex = buildCatalogSearchIndex(orderCatalog, input.corrections);
  const globalCatalogIndex = globalOrderCatalog
    ? buildCatalogSearchIndex(globalOrderCatalog, input.corrections)
    : undefined;
  let classification = input.classification;
  const routedMessage = request.mode_conflict_resolution === 'keep_inventory'
    ? stripExplicitOrderVerb(request.message)
    : request.message;
  let segmentRoute = routeQuickOrderSegments(routedMessage);
  const inventoryModeStock = shouldUseInventoryModeAsStock({
    request,
    message: routedMessage,
    classification,
    segmentRoute,
    unitAliases: input.unitAliases,
    inventoryStatusTerms: input.inventoryStatusTerms ?? [],
    quickOrderStatusTerms: input.quickOrderStatusTerms ?? [],
  });
  if (
    request.mode === 'inventory' &&
    request.mode_conflict_resolution !== 'keep_inventory' &&
    isExplicitOrderPhrase(request.message) &&
    isInventoryDraftMessage(stripExplicitOrderVerb(request.message), input.unitAliases)
  ) {
    return buildModeConflictResponse({
      input,
      request,
      orderCatalog,
      globalOrderCatalog,
      catalogIndex,
      globalCatalogIndex,
    });
  }
  if (inventoryModeStock) {
    classification = {
      ...classification,
      classification: 'current_stock_update',
      reason: request.mode_conflict_resolution === 'keep_inventory'
        ? 'composer_inventory_mode_conflict_resolution'
        : 'composer_inventory_mode',
    };
    segmentRoute = inventorySegmentsFor(routedMessage);
  }
  const zeroOrderExplanation = buildZeroOrderExplanationResponse({
    message: request.message,
    previousMessages: request.recent_messages ?? input.previousMessages,
    existingCount: request.existing_items.length > 0 ? request.existing_items.length : input.existingParsedItems.length,
    classification,
    timings: timer.snapshot(),
  });
  if (zeroOrderExplanation) return zeroOrderExplanation;

  const intentRouteModel = input.modelConfig.fallbackModel || input.modelConfig.defaultModel;
  const llmIntentRouting = await maybeRouteIntentWithLlm({
    message: routedMessage,
    sourceClassification: classification,
    segmentRoute,
    catalogIndex,
    unitAliases: input.unitAliases,
    existingParsedItems: request.existing_items.length > 0 ? request.existing_items : input.existingParsedItems,
    previousMessages: request.recent_messages ?? input.previousMessages,
    callLlm: input.callLlm
      ? (prompt) => input.callLlm!(prompt, intentRouteModel)
      : undefined,
  });
  const llmIntentRoute = llmIntentRouting?.route ?? null;
  if (llmIntentRouting?.classification) {
    classification = llmIntentRouting.classification;
  }
  // Routing trace (surfaced in diagnostics + logged) so a dead-end can be
  // diagnosed from a single response instead of guesswork.
  const multiItemListDetected = looksLikeMultiItemList(routedMessage, input.unitAliases);
  const routingTrace = {
    multi_item_list_detected: multiItemListDetected,
    llm_intent_router_invoked: llmIntentRouting !== null,
    routed_message_line_count: routedMessage.normalize('NFKC').split(/\r?\n|,|;/).map((l) => l.trim()).filter(Boolean).length,
    inventory_mode_stock: inventoryModeStock,
  };
  console.log('[parse-order] routing_trace', JSON.stringify({
    ...routingTrace,
    classification: classification.classification,
    classification_reason: classification.reason,
    mode: request.mode,
  }));

  const stockExtraction = timer.measure('deterministic_parse', (): StockUpdateExtraction => {
    const deterministicStock = inventoryModeStock
      ? extractStockUpdates({
          message: routedMessage,
          source: request.source,
          catalog: input.catalog,
          corrections: input.corrections,
          catalogIndex,
          unitAliases: input.unitAliases,
          statusTerms: input.inventoryStatusTerms ?? [],
          employeeAliases: input.employeeAliases ?? [],
          employeeNameKeys: input.employeeNameKeys ?? [],
          aliasRules: input.aliasRules ?? [],
          unitRules: input.unitRules ?? [],
          statusTermRules: input.quickOrderStatusTerms ?? [],
          parserSettings: input.parserSettings ?? {},
          locationId: request.location_id,
          employeeUserId: request.user_id,
          assumeStock: true,
          unitSynonyms: input.unitSynonyms,
        })
      : segmentRoute.stockSegments.length > 0
      ? extractStockUpdates({
          message: segmentRoute.stockSegments.join('\n'),
          source: request.source,
          catalog: input.catalog,
          corrections: input.corrections,
          catalogIndex,
          unitAliases: input.unitAliases,
          statusTerms: input.inventoryStatusTerms ?? [],
          employeeAliases: input.employeeAliases ?? [],
          employeeNameKeys: input.employeeNameKeys ?? [],
          aliasRules: input.aliasRules ?? [],
          unitRules: input.unitRules ?? [],
          statusTermRules: input.quickOrderStatusTerms ?? [],
          parserSettings: input.parserSettings ?? {},
          locationId: request.location_id,
          employeeUserId: request.user_id,
          unitSynonyms: input.unitSynonyms,
        })
      : emptyStockExtraction(routedMessage);
    const llmStockUpdates = llmIntentRoute && llmIntentRoute.confidence >= 0.65
      ? stockUpdatesFromLlmIntentRoute({
          route: llmIntentRoute,
          source: request.source,
          catalog: input.catalog,
          catalogIndex,
          originalText: request.message,
        })
      : [];
    return {
      ...deterministicStock,
      // Normalize every count's unit (e.g. box → case) regardless of which path
      // produced it, so the synonym is universal across inventory.
      stockUpdates: applyStockUnitSynonyms(
        mergeStockUpdates(deterministicStock.stockUpdates, llmStockUpdates),
        input.unitSynonyms,
      ),
    };
  });
  const inventoryReviewItems = inventoryModeStock
    ? buildInventoryModeReviewItems({
        segments: segmentRoute.stockSegments,
        statusSegments: stockExtraction.statusItems.map((item) => item.original_text),
        catalog: orderCatalog,
        catalogIndex,
        unitAliases: input.unitAliases,
      })
    : [];

  const stockSafety = applyStockSafetyLimits({
    stockUpdates: stockExtraction.stockUpdates,
    catalog: orderCatalog,
    locationId: request.location_id,
    source: request.source,
    limits: input.limits,
    allowedUnitRules: [],
    userRole: input.userRole,
  });

  const shouldRecommend =
    inventoryModeStock ||
    classification.classification === 'current_stock_update' ||
    classification.classification === 'recommend_order_request' ||
    classification.classification === 'mixed_stock_and_order_request' ||
    classification.classification === 'mixed_stock_and_recommendation_request' ||
    segmentRoute.recommendationSegments.length > 0;
  const shouldSkipOrderParse =
    inventoryModeStock ||
    segmentRoute.orderSegments.length === 0 &&
    (
      classification.classification === 'current_stock_update' ||
      classification.classification === 'recommend_order_request' ||
      classification.classification === 'mixed_stock_and_order_request' ||
      classification.classification === 'mixed_stock_and_recommendation_request'
    );
  // Product questions must always reach the orchestrator so it can route them
  // to the Q&A handler (the orchestrator's `product_question` branch bypasses
  // order parsing entirely).
  const isProductQuestion = classification.classification === 'product_question';
  const parserText = isProductQuestion
    ? request.message
    : segmentRoute.orderSegments.length > 0
      ? segmentRoute.orderSegments.join('\n')
      : shouldSkipOrderParse
        ? ''
        : stockExtraction.remainingText || request.message;

  const modelRoute = routeQuickOrderModel({
    message: parserText || request.message,
    source: request.source,
    config: input.modelConfig,
  });

  const routeParseResponse = llmIntentRoute
    ? buildLlmIntentRouteResponse({
        route: llmIntentRoute,
        existingCount: request.existing_items.length > 0 ? request.existing_items.length : input.existingParsedItems.length,
        recentOrders: input.recentOrders,
        catalogCount: orderCatalog.length,
      })
    : null;

  const parseResponse = routeParseResponse ?? (parserText
    ? await timer.measureAsync('llm_fallback', () => parseQuickOrder({
        rawText: parserText,
        locationId: request.location_id,
        userId: request.user_id,
        catalog: orderCatalog,
        globalCatalog: globalOrderCatalog,
        examples: [],
        corrections: input.corrections,
        previousMessages: request.recent_messages ?? input.previousMessages,
        existingParsedItems: request.existing_items.length > 0 ? request.existing_items : input.existingParsedItems,
        callLlm: modelRoute.allowLlmFallback && input.callLlm
          ? (prompt) => input.callLlm!(prompt, modelRoute.model)
          : undefined,
        unitAliases: input.unitAliases,
        catalogIndex,
        globalCatalogIndex,
        employeeAliases: input.employeeAliases,
        employeeNameKeys: input.employeeNameKeys,
        aliasRules: input.aliasRules,
        unitRules: input.unitRules,
        parserSettings: input.parserSettings,
        mode: request.mode,
        classification,
        debugCatalog: input.debugTimings === true,
      }))
    : emptyParseResponse({
        existingCount: input.existingParsedItems.length,
        classification: classification.classification,
        reason: classification.reason,
        message: request.message,
        parsedItems: inventoryReviewItems,
        catalogCount: orderCatalog.length,
      }));
  const safety = timer.measure('safety_validation', () => validateQuickOrderSafety({
    parseResponse,
    catalog: orderCatalog,
    locationId: request.location_id,
    source: request.source,
    limits: input.limits,
    allowedUnitRules: [],
    userRole: input.userRole,
  }));

  let stockPersistError: string | null = null;
  let stockPersistErrorRaw: string | null = null;
  if (stockSafety.accepted.length > 0 && input.persistStockUpdates) {
    const persistResult = await timer.measureAsync('db_write', () => input.persistStockUpdates!(stockSafety.accepted));
    if (!persistResult.ok) {
      // Keep the raw DB/PostgREST error for logs + diagnostics only — never show
      // it to the employee. Surface a short, plain-language message instead.
      stockPersistErrorRaw = persistResult.error ?? 'unknown_error';
      stockPersistError = "I couldn't save those counts just now. Your items are listed below — please try again in a moment.";
      console.warn('[parse-order] stock_persist_failed', JSON.stringify({
        raw_error: stockPersistErrorRaw,
        accepted_count: stockSafety.accepted.length,
        location_id: request.location_id,
      }));
    }
  }

  const recommendationResult = shouldRecommend
    ? timer.measure('recommendation_engine', () => buildQuickOrderRecommendations({
        catalog: orderCatalog,
        stockUpdates: stockSafety.accepted,
        recentOrders: input.recentOrders,
        limits: [],
        allowedUnitRules: [],
        globalAllowedUnitRules: [],
        inventoryReorderRules: input.inventoryReorderRules ?? [],
        quickOrderReorderRules: input.quickOrderReorderRules ?? [],
        quickOrderUnitRules: input.unitRules ?? [],
        employeeNameKeys: input.employeeNameKeys ?? [],
        employeeUserId: request.user_id,
        parserSettings: input.parserSettings ?? {},
        reorderRules: input.reorderRules ?? [],
        orderProfiles: input.orderProfiles ?? [],
        statusItems: stockExtraction.statusItems,
        locationId: request.location_id,
        mode: request.mode ?? 'order',
        maxItems: inventoryModeStock ? Math.max(1, stockSafety.accepted.length) : undefined,
        includeHistoryCandidates: !inventoryModeStock,
      }))
    : { recommendations: [], warnings: [] };

  const allWarnings = [...safety.warnings, ...recommendationResult.warnings, ...stockSafety.warnings];
  const allBlocked = [...safety.blockedOperations, ...stockSafety.blocked];
  const messages = timer.measure('response_build', () => buildProcessMessages({
    parseResponse: safety.response,
    stockUpdates: stockSafety.accepted,
    recommendations: recommendationResult.recommendations,
    safetyWarnings: allWarnings,
    blockedOperations: allBlocked,
  }));

  const actualModelUsed: QuickOrderModelUsed = llmIntentRoute && llmIntentRouting?.llmFailed === false
      ? normalizeModelUsed(intentRouteModel)
    : safety.response.metrics?.llm_used
      ? modelRoute.modelUsed
    : 'none';
  const processStatus = deriveProcessStatus({
    parseResponse: safety.response,
    stockUpdates: stockSafety.accepted,
    recommendationsCount: recommendationResult.recommendations.length,
    warningsCount: allWarnings.filter((warning) => warning.severity !== 'info').length,
    blockedCount: allBlocked.length,
    stockPersistError,
  });
  const timings = timer.snapshot();

  if (input.debugTimings) {
    console.log('[parse-order] process_message_timings', JSON.stringify({
      timings,
      model_route: modelRoute,
      classification: classification.classification,
    }));
  }

  const pendingClarifications = deduplicatePendingClarifications(safety.pendingClarifications);

  return {
    ...safety.response,
    status: processStatus,
    legacy_status: safety.response.status ?? 'ok',
    display_message: stockPersistError ?? messages.displayMessage,
    speech_message: stockPersistError ?? messages.speechMessage,
    assistant_message: stockPersistError ?? messages.displayMessage,
    reply_text: stockPersistError ?? messages.displayMessage,
    parsed_items: safety.response.parsed_items,
    cart_operations: safety.response.operations ?? [],
    operations: safety.response.operations ?? [],
    stock_updates: stockSafety.accepted,
    recommendations: recommendationResult.recommendations,
    clarifications: pendingClarifications,
    pending_actions: pendingClarifications,
    pending_clarifications: pendingClarifications,
    safety_warnings: allWarnings,
    blocked_operations: allBlocked,
    model_used: actualModelUsed,
    confidence: responseConfidence(safety.response, stockSafety.accepted),
    timings,
    diagnostics: {
      ...(safety.response.diagnostics ?? {}),
      input_classification: classification.classification,
      input_classification_reason: classification.reason,
      segment_count: segmentRoute.segments.length,
      order_segment_count: segmentRoute.orderSegments.length,
      stock_segment_count: segmentRoute.stockSegments.length,
      recommendation_segment_count: segmentRoute.recommendationSegments.length,
      unknown_segment_count: segmentRoute.unknownSegments.length,
      segment_intents: segmentRoute.segments.map((segment) => ({
        text: segment.text,
        intent: segment.intent,
        reason: segment.reason,
      })),
      model_route: modelRoute.reason,
      model_used: actualModelUsed,
      stock_update_count: stockSafety.accepted.length,
      stock_persist_error: stockPersistErrorRaw,
      recommendation_count: recommendationResult.recommendations.length,
      llm_intent_classification: llmIntentRoute?.classification,
      llm_intent_intent: llmIntentRoute?.intent,
      llm_intent_confidence: llmIntentRoute?.confidence,
      llm_intent_time_range: llmIntentRoute?.entities?.time_range,
      llm_intent_repair_needed: llmIntentRouting?.repairNeeded,
      llm_intent_failed: llmIntentRouting?.llmFailed,
      ...routingTrace,
    } as ProcessQuickOrderResponse['diagnostics'],
    assistantMessage: buildSmartAssistantMessage({
      displayMessage: stockPersistError ?? messages.displayMessage,
      recommendations: recommendationResult.recommendations,
      pendingClarifications,
      blockedCount: allBlocked.length,
      warningsCount: allWarnings.length,
      classification: classification.classification,
    }),
    contextPatch: buildContextPatch({
      stockUpdates: stockSafety.accepted,
      recommendations: recommendationResult.recommendations,
      pendingClarifications,
      classification: classification.classification,
    }),
  };
}

const ZERO_ORDER_EXPLANATION = "I didn't order this because it met the stock requirements.";

function buildZeroOrderExplanationResponse(input: {
  message: string;
  previousMessages: QuickOrderMessage[];
  existingCount: number;
  classification: QuickOrderInputClassificationResult;
  timings: ProcessQuickOrderResponse['timings'];
}): ProcessQuickOrderResponse | null {
  if (!isZeroOrderExplanationQuestion(input.message)) return null;
  if (!hasRecentZeroOrderContext(input.previousMessages, input.message)) return null;

  return {
    status: 'qa_answer',
    legacy_status: 'qa_answer',
    assistant_message: ZERO_ORDER_EXPLANATION,
    reply_text: ZERO_ORDER_EXPLANATION,
    display_message: ZERO_ORDER_EXPLANATION,
    speech_message: ZERO_ORDER_EXPLANATION,
    parsed_items: [],
    cart_operations: [],
    operations: [],
    stock_updates: [],
    recommendations: [],
    clarifications: [],
    pending_actions: [],
    pending_clarifications: [],
    flags: [],
    suggestions: [],
    safety_warnings: [],
    blocked_operations: [],
    model_used: 'none',
    confidence: 0.95,
    timings: input.timings,
    diagnostics: {
      parser_version: PARSER_VERSION,
      parse_mode: 'zero_order_explanation',
      input_classification: input.classification.classification,
      input_classification_reason: input.classification.reason,
    } as ProcessQuickOrderResponse['diagnostics'],
    session_state: {
      total_items: input.existingCount,
      ready_to_submit: false,
    },
    assistantMessage: {
      type: 'history_answer',
      text: ZERO_ORDER_EXPLANATION,
      actions: [],
      explanation: {
        reason: 'Answered from the previous no-order inventory result.',
        confidence: 'high',
        dataSources: ['recent_quick_order_context'],
      },
    },
  };
}

function isZeroOrderExplanationQuestion(message: string): boolean {
  const normalized = message.normalize('NFKC').trim().toLowerCase();
  if (!/\bwhy\b/.test(normalized)) return false;
  if (!/\border(?:ed|ing)?\b/.test(normalized)) return false;
  return (
    /\b(?:0|zero)\b/.test(normalized) ||
    /\b(?:didn['’]?t|did not)\b.*\border\b/.test(normalized) ||
    /\bno\s+order\b/.test(normalized) ||
    /\bnot\s+order(?:ed|ing)?\b/.test(normalized)
  );
}

function hasRecentZeroOrderContext(messages: QuickOrderMessage[], question: string): boolean {
  const questionKey = normalizeExplanationLookupText(question);
  for (const message of messages.slice(-8).reverse()) {
    const warnings = Array.isArray(message.safety_warnings) ? message.safety_warnings : [];
    for (const warning of warnings) {
      if (warning?.type !== 'no_order_needed') continue;
      if (matchesQuestionItem(questionKey, warning.item_name)) return true;
      if (!mentionsAnyCatalogLikeTerm(questionKey)) return true;
    }

    const inventoryUpdates = Array.isArray(message.inventory_updates) ? message.inventory_updates : [];
    for (const update of inventoryUpdates) {
      if (!update || typeof update !== 'object') continue;
      const quantity = typeof update.new_quantity === 'number' ? update.new_quantity : null;
      const noOrderRow = quantity === null || quantity === 0 || Boolean(update.no_order_reason);
      if (!noOrderRow) continue;
      if (matchesQuestionItem(questionKey, update.item_name)) return true;
      if (!mentionsAnyCatalogLikeTerm(questionKey)) return true;
    }
  }
  return false;
}

function normalizeExplanationLookupText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesQuestionItem(questionKey: string, itemName: string | null | undefined): boolean {
  const itemKey = normalizeExplanationLookupText(itemName ?? '');
  if (!itemKey) return false;
  if (questionKey.includes(itemKey)) return true;
  return itemKey
    .split(' ')
    .filter((token) => token.length >= 4)
    .some((token) => questionKey.includes(token));
}

function mentionsAnyCatalogLikeTerm(questionKey: string): boolean {
  const ignored = new Set([
    'why',
    'did',
    'didn',
    'didnt',
    'you',
    'order',
    'ordered',
    'ordering',
    'zero',
    'case',
    'cases',
    'pack',
    'packs',
    'piece',
    'pieces',
    'pound',
    'pounds',
    'this',
    'that',
    'because',
    'not',
  ]);
  return questionKey.split(' ').some((token) => token.length >= 4 && !ignored.has(token));
}

function buildSmartAssistantMessage(input: {
  displayMessage: string;
  recommendations: import('./types.ts').Recommendation[];
  pendingClarifications: import('./types.ts').PendingQuickOrderClarification[];
  blockedCount: number;
  warningsCount: number;
  classification: string;
}): ProcessQuickOrderResponse['assistantMessage'] {
  if (input.classification === 'tutorial_request') {
    return {
      type: 'tutorial',
      text: input.displayMessage,
      actions: [],
      explanation: {
        reason: 'Quick Order help request',
        confidence: 'high',
        dataSources: ['quick_order_capabilities'],
      },
    };
  }
  if (input.classification === 'history_request') {
    return {
      type: 'history_answer',
      text: input.displayMessage,
      actions: [],
      explanation: {
        reason: 'Quick Order history request',
        confidence: 'high',
        dataSources: ['order_history'],
      },
    };
  }
  if (input.recommendations.length > 0) {
    const confidenceValue = Math.max(...input.recommendations.map((entry) => entry.confidence ?? 0));
    return {
      type: 'smart_suggestion',
      text: input.displayMessage,
      actions: [],
      explanation: {
        reason: input.recommendations[0]?.reason ?? 'Suggested from Quick Order context.',
        confidence: confidenceValue >= 0.85 ? 'high' : confidenceValue >= 0.7 ? 'medium' : 'low',
        dataSources: [
          ...new Set(input.recommendations.map((entry) =>
            entry.recommendation_type === 'stock_reorder_rule'
              ? 'item_reorder_rules'
              : entry.recommendation_type === 'history_profile'
                ? 'item_order_profiles'
                : 'order_history'
          )),
          'current_cart',
        ],
      },
    };
  }
  if (input.pendingClarifications.length > 0) {
    return { type: 'clarification', text: input.displayMessage, actions: [] };
  }
  if (input.blockedCount > 0) return { type: 'error', text: input.displayMessage, actions: [] };
  return { type: 'success', text: input.displayMessage, actions: [] };
}

function buildContextPatch(input: {
  stockUpdates: import('./types.ts').StockOperation[];
  recommendations: import('./types.ts').Recommendation[];
  pendingClarifications: import('./types.ts').PendingQuickOrderClarification[];
  classification: string;
}): ProcessQuickOrderResponse['contextPatch'] {
  const lastRecommendation = input.recommendations[0];
  const lastStock = input.stockUpdates[input.stockUpdates.length - 1];
  const itemId = lastRecommendation?.item_id ?? lastStock?.item_id ?? input.pendingClarifications[0]?.item_id ?? null;
  const itemName = lastRecommendation?.item_name ?? lastStock?.item_name ?? input.pendingClarifications[0]?.item_name ?? null;
  return {
    lastReferencedItemId: itemId,
    lastReferencedItemName: itemName,
    lastAction: input.recommendations.length > 0
      ? 'stock_based_recommendation'
      : input.stockUpdates.length > 0
        ? 'current_stock_update'
        : input.classification,
    lastSuggestedQuantity: lastRecommendation?.suggested_quantity ?? null,
    pendingClarificationId: input.pendingClarifications[0]?.id ?? null,
  };
}

function applyAllowedUnitRulesToCatalog(
  catalog: CatalogItem[],
  rules: ItemAllowedUnitRule[],
): CatalogItem[] {
  if (!Array.isArray(rules) || rules.length === 0) return catalog;
  const unitsByItem = new Map<string, string[]>();
  for (const rule of rules) {
    if (!rule.item_id || typeof rule.unit !== 'string' || !rule.unit.trim()) continue;
    const current = unitsByItem.get(rule.item_id) ?? [];
    current.push(rule.unit.trim());
    if (rule.order_unit && rule.order_unit.trim()) {
      current.push(rule.order_unit.trim());
    }
    unitsByItem.set(rule.item_id, current);
  }
  if (unitsByItem.size === 0) return catalog;
  return catalog.map((item) => {
    const allowedUnits = unitsByItem.get(item.id);
    return allowedUnits && allowedUnits.length > 0
      ? { ...item, allowed_units: [...new Set(allowedUnits)] }
      : item;
  });
}

function buildInventoryModeReviewItems(input: {
  segments: string[];
  statusSegments?: string[];
  catalog: CatalogItem[];
  catalogIndex: CatalogSearchIndex;
  unitAliases: UnitAliasMap;
}): ParsedItem[] {
  const items: ParsedItem[] = [];
  const statusSegments = new Set((input.statusSegments ?? []).map((segment) => segment.trim().toLowerCase()));
  for (const segment of input.segments) {
    if (statusSegments.has(segment.trim().toLowerCase())) continue;
    const candidates = parseDeterministicOrder(segment, input.unitAliases);
    for (const candidate of candidates) {
      if (!candidate.item_text.trim()) continue;
      const match = matchCatalogIndex(candidate.item_text, input.catalogIndex);
      const validated = validateParsedLine({
        candidate,
        match,
        catalog: input.catalog,
        unitAliases: input.unitAliases,
        parseSource: 'deterministic',
      }).item;
      // A count that carries a quantity normally becomes a stock update via the
      // stock-update path. Surface it here ONLY when it could not be resolved to
      // a catalog item at all — otherwise the stock-update path owns it and we
      // must not duplicate it. Counts that resolve to nothing used to be dropped
      // silently (buildStockOperation returns null), which made a whole
      // inventory entry come back empty and look "unreadable". Keeping the
      // unresolved count as a no-match review item lets the employee re-match or
      // add it manually instead of seeing a blanket error.
      if (candidate.quantity != null && (validated.item_id || !validated.unresolved)) {
        continue;
      }
      items.push({
        ...validated,
        source: 'remaining_inventory',
        isSuggested: false,
        suggestionSource: 'remaining_inventory',
      });
    }
  }
  return items;
}

function shouldUseInventoryModeAsStock(input: {
  request: ProcessQuickOrderMessageRequest;
  message: string;
  classification: QuickOrderInputClassificationResult;
  segmentRoute: QuickOrderSegmentRoute;
  unitAliases: UnitAliasMap;
  inventoryStatusTerms?: InventoryStatusTerm[];
  quickOrderStatusTerms?: QuickOrderStatusTerm[];
}): boolean {
  if (input.request.mode !== 'inventory') return false;
  if (isExplicitOrderPhrase(input.message)) return false;
  if (input.request.mode_conflict_resolution === 'keep_inventory') {
    return isInventoryDraftMessage(input.message, input.unitAliases) || hasInventoryStatusDraftSignal(input);
  }
  if (input.segmentRoute.recommendationSegments.length > 0) return false;
  if (
    !isModeControllableClassification(input.classification.classification) &&
    !isInventoryDraftMessage(input.message, input.unitAliases) &&
    !hasInventoryStatusDraftSignal(input)
  ) {
    return false;
  }
  return isInventoryDraftMessage(input.message, input.unitAliases) || hasInventoryStatusDraftSignal(input);
}

function hasInventoryStatusDraftSignal(input: {
  message: string;
  inventoryStatusTerms?: InventoryStatusTerm[];
  quickOrderStatusTerms?: QuickOrderStatusTerm[];
}): boolean {
  const normalized = normalizeInventoryStatusText(input.message);
  if (!normalized) return false;
  if (/\b(?:a\s+lot|lots|no\s+more)\b/i.test(input.message)) return true;

  const keys = [
    ...(input.inventoryStatusTerms ?? []).map((term) => term.phrase_key || term.phrase),
    ...(input.quickOrderStatusTerms ?? []).map((term) => term.phrase_key || term.phrase),
  ]
    .map(normalizeInventoryStatusText)
    .filter(Boolean);

  return keys.some((key) =>
    normalized === key ||
    normalized.startsWith(`${key} `) ||
    normalized.endsWith(` ${key}`)
  );
}

function normalizeInventoryStatusText(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/\s+/g, ' ');
}

function isModeControllableClassification(classification: string): boolean {
  return classification === 'order_entry' || classification === 'current_stock_update';
}

function isShortItemQuantityMessage(message: string, unitAliases: UnitAliasMap): boolean {
  return isInventoryDraftMessage(message, unitAliases, { requireQuantity: true });
}

function isInventoryDraftMessage(
  message: string,
  unitAliases: UnitAliasMap,
  options?: { requireQuantity?: boolean },
): boolean {
  const trimmed = message.trim();
  if (!trimmed || /[?]/.test(trimmed) || /^(?:what|when|where|why|how|can|could|should|do|did|is|are)\b/i.test(trimmed)) {
    return false;
  }
  const candidates = parseDeterministicOrder(trimmed, unitAliases);
  const hasQuantity = candidates.some((candidate) => candidate.quantity != null);
  if (options?.requireQuantity && !hasQuantity) return false;
  return candidates.length > 0 && candidates.every((candidate) =>
    candidate.item_text.trim().length > 0 &&
    (candidate.quantity != null || candidate.issue === 'missing_quantity')
  );
}

function isExplicitOrderPhrase(message: string): boolean {
  return /^\s*(?:please\s+)?(?:order|add|get|put|buy|i\s+need|we\s+need|need)\b/i.test(message);
}

function stripExplicitOrderVerb(message: string): string {
  return message
    .replace(/^\s*(?:please\s+)?(?:order|add|get|put|buy)\s+/i, '')
    .replace(/^\s*(?:i|we)\s+need\s+/i, '')
    .replace(/^\s*need\s+/i, '')
    .trim();
}

function inventorySegmentsFor(message: string): QuickOrderSegmentRoute {
  const stockSegments = message
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .split(/\n|,|;/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  return {
    segments: stockSegments.map((text) => ({
      text,
      intent: 'stock_update' as const,
      reason: 'composer_inventory_mode',
    })),
    orderSegments: [],
    stockSegments,
    recommendationSegments: [],
    unknownSegments: [],
  };
}

async function buildModeConflictResponse(input: {
  input: ProcessQuickOrderMessageInput;
  request: ProcessQuickOrderMessageRequest;
  orderCatalog: CatalogItem[];
  globalOrderCatalog?: CatalogItem[];
  catalogIndex: CatalogSearchIndex;
  globalCatalogIndex?: CatalogSearchIndex;
}): Promise<ProcessQuickOrderResponse> {
  const request = input.request;
  const parseText = stripExplicitOrderVerb(request.message) || request.message;
  const parseResponse = await parseQuickOrder({
    rawText: parseText,
    locationId: request.location_id,
    userId: request.user_id,
    catalog: input.orderCatalog,
    globalCatalog: input.globalOrderCatalog,
    examples: [],
    corrections: input.input.corrections,
    previousMessages: request.recent_messages ?? input.input.previousMessages,
    existingParsedItems: request.existing_items.length > 0 ? request.existing_items : input.input.existingParsedItems,
    unitAliases: input.input.unitAliases,
    catalogIndex: input.catalogIndex,
    globalCatalogIndex: input.globalCatalogIndex,
    employeeAliases: input.input.employeeAliases,
    employeeNameKeys: input.input.employeeNameKeys,
    aliasRules: input.input.aliasRules,
    unitRules: input.input.unitRules,
    parserSettings: input.input.parserSettings,
    mode: 'order',
    classification: {
      ...input.input.classification,
      classification: 'order_entry',
      reason: 'composer_mode_conflict_order_phrase',
    },
  });
  const safety = validateQuickOrderSafety({
    parseResponse,
    catalog: input.orderCatalog,
    locationId: request.location_id,
    source: request.source,
    limits: [],
    allowedUnitRules: [],
    userRole: input.input.userRole,
  });
  const incoming = safety.response.parsed_items[0] ?? parseResponse.parsed_items[0] ?? null;
  const itemLabel = incoming?.item_name ?? incoming?.display_name ?? incoming?.raw_token ?? 'that item';
  const qtyLabel = incoming?.quantity != null
    ? `${incoming.quantity}${incoming.unit ? ` ${incoming.unit}` : ''}`
    : '';
  const message = `You’re in Inventory mode, but this sounds like an order. Should I switch to Order mode and add ${itemLabel}${qtyLabel ? ` ${qtyLabel}` : ''}?`;
  const clarification = {
    id: `mode_conflict_order_in_inventory:${incoming?.line_id ?? Date.now()}`,
    type: 'quantity_conflict' as const,
    item_id: incoming?.item_id ?? null,
    item_name: itemLabel,
    incoming_item: incoming
      ? {
          ...incoming,
          raw_text: request.message,
          raw_token: incoming.raw_token || parseText,
        }
      : undefined,
    message,
    actions: [
      {
        id: 'add' as const,
        label: 'Switch to Order and Add',
        preview: itemLabel,
      },
      {
        id: 'cancel' as const,
        label: 'Keep as Inventory',
      },
    ],
  };

  return {
    status: 'needs_clarification',
    legacy_status: 'needs_clarification',
    assistant_message: message,
    display_message: message,
    speech_message: message,
    reply_text: message,
    parsed_items: [],
    flags: [],
    suggestions: [],
    pending_actions: [clarification],
    pending_clarifications: [clarification],
    clarifications: [clarification],
    session_state: {
      total_items: request.existing_items.length,
      ready_to_submit: false,
    },
    operations: [],
    cart_operations: [],
    stock_updates: [],
    recommendations: [],
    safety_warnings: safety.warnings,
    blocked_operations: safety.blockedOperations,
    model_used: 'none',
    confidence: incoming?.confidence ?? 0.8,
    timings: { total_ms: 0 },
    diagnostics: {
      parser_version: PARSER_VERSION,
      parse_mode: 'deterministic_only',
      input_classification: 'order_entry',
      input_classification_reason: 'composer_mode_conflict_order_phrase',
      items_received: parseResponse.parsed_items.length,
      items_accepted: 0,
      items_rejected: 0,
      rejected_reasons: ['composer_mode_conflict'],
      pending_action_count: 1,
    },
    assistantMessage: {
      type: 'clarification',
      text: message,
      actions: [],
    },
    contextPatch: {
      lastReferencedItemId: incoming?.item_id ?? null,
      lastReferencedItemName: itemLabel,
      lastAction: 'mode_conflict_order_in_inventory',
      pendingClarificationId: clarification.id,
    },
  };
}

function normalizeRequest(request: ProcessQuickOrderMessageRequest): ProcessQuickOrderMessageRequest {
  return {
    ...request,
    source: request.source === 'voice' ? 'voice' : 'typed',
    mode: request.mode === 'inventory' ? 'inventory' : 'order',
    mode_conflict_resolution: request.mode_conflict_resolution === 'keep_inventory' ? 'keep_inventory' : undefined,
    message: request.message.trim(),
    existing_items: Array.isArray(request.existing_items) ? request.existing_items : [],
    recent_messages: Array.isArray(request.recent_messages) ? request.recent_messages : undefined,
  };
}

function emptyStockExtraction(message: string): StockUpdateExtraction {
  return {
    stockUpdates: [],
    statusItems: [],
    stockSegments: [],
    remainingText: message,
    hasStockSignal: false,
  };
}

function emptyParseResponse(input: {
  existingCount: number;
  classification: string;
  reason: string;
  message: string;
  parsedItems?: ParsedItem[];
  catalogCount?: number;
}): ParseResponse {
  const parsedItems = input.parsedItems ?? [];
  const reviewCount = parsedItems.filter((item) => item.needs_clarification || item.unresolved).length;
  return {
    status: reviewCount > 0 ? 'needs_review' : 'ok',
    assistant_message: reviewCount > 0 ? 'I found items that need review before adding.' : 'Got it.',
    reply_text: reviewCount > 0 ? 'I found items that need review before adding.' : 'Got it.',
    parsed_items: parsedItems,
    flags: [],
    suggestions: [],
    pending_actions: [],
    pending_clarifications: [],
    session_state: {
      total_items: input.existingCount,
      ready_to_submit: false,
    },
    diagnostics: {
      parser_version: PARSER_VERSION,
      parse_mode: 'deterministic_only',
      catalog_count: input.catalogCount ?? 0,
      candidate_count: parsedItems.length,
      items_received: parsedItems.length,
      items_accepted: parsedItems.length - reviewCount,
      items_rejected: 0,
      rejected_reasons: [input.reason],
      pending_action_count: 0,
      raw_input_length: input.message.length,
      candidate_lines: parsedItems.length,
      input_classification: input.classification,
      input_classification_reason: input.reason,
    },
    metrics: {
      parse_mode_used: 'deterministic_only',
      lines_parsed: parsedItems.length,
      high_confidence_matches: 0,
      fuzzy_matches: 0,
      unresolved_items: reviewCount,
      conflicts: 0,
      json_repair_needed: false,
      llm_failed: false,
      llm_used: false,
    },
    operations: [],
  };
}

function deriveProcessStatus(input: {
  parseResponse: ParseResponse;
  stockUpdates: StockOperation[];
  recommendationsCount: number;
  warningsCount: number;
  blockedCount: number;
  stockPersistError: string | null;
}): ProcessQuickOrderResponse['status'] {
  if (input.stockPersistError && input.stockUpdates.length === 0 && input.parseResponse.parsed_items.length === 0) {
    return 'error';
  }
  if (input.parseResponse.status === 'error') return 'error';
  if (input.parseResponse.status === 'qa_answer') return 'qa_answer';
  const hasSuccess =
    input.parseResponse.parsed_items.length > 0 ||
    (input.parseResponse.operations ?? []).some((operation) => operation.status === 'applied') ||
    input.stockUpdates.length > 0 ||
    input.recommendationsCount > 0;
  if (input.blockedCount > 0 && !hasSuccess) return 'blocked';
  if (input.blockedCount > 0 && hasSuccess) return 'partial_success';
  if (hasSuccess && (input.parseResponse.status === 'needs_review' || input.parseResponse.status === 'needs_clarification')) {
    return 'partial_success';
  }
  if (hasSuccess && ((input.parseResponse.pending_clarifications?.length ?? 0) > 0 || input.warningsCount > 0)) {
    return 'partial_success';
  }
  if ((input.parseResponse.pending_clarifications?.length ?? 0) > 0 || input.warningsCount > 0) return 'needs_clarification';
  return 'success';
}

function responseConfidence(response: ParseResponse, stockUpdates: StockOperation[]): number {
  const values = [
    ...response.parsed_items.map((item) => item.confidence),
    ...stockUpdates.map((update) => update.confidence),
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (values.length === 0) return 0.8;
  return Math.max(0, Math.min(1, values.reduce((sum, value) => sum + value, 0) / values.length));
}

async function maybeRouteIntentWithLlm(input: {
  message: string;
  sourceClassification: QuickOrderInputClassificationResult;
  segmentRoute: QuickOrderSegmentRoute;
  catalogIndex: CatalogSearchIndex;
  unitAliases: UnitAliasMap;
  existingParsedItems: ParsedItem[];
  previousMessages: QuickOrderMessage[];
  callLlm?: (prompt: string) => Promise<string>;
}): Promise<{
  route: LlmIntentRoute;
  classification?: QuickOrderInputClassificationResult;
  repairNeeded: boolean;
  llmFailed: boolean;
} | null> {
  if (!input.callLlm) return null;
  if (!shouldUseLlmIntentRouter(input)) return null;

  const routed = await routeIntentWithLlm({
    userMessage: input.message,
    recentMessages: input.previousMessages,
    callLlm: input.callLlm,
  });
  const route = routed.route;

  if (route.confidence < 0.65 || route.classification === 'unknown_non_order') {
    // The LLM was unsure. Never let that uncertainty discard a pasted multi-line
    // item list — fall through (return null) so the deterministic + stock path
    // surfaces every line instead of returning a generic "I'm not sure what you
    // want" clarification. (Defense in depth: shouldUseLlmIntentRouter already
    // skips multi-item lists, and the orchestrator reclassifies them, but this
    // closes the path where an applied give-up route short-circuits both.)
    if (looksLikeMultiItemList(input.message, input.unitAliases)) return null;
    return { ...routed };
  }

  return {
    ...routed,
    classification: classificationFromLlmRoute(route, input.sourceClassification),
  };
}

function shouldUseLlmIntentRouter(input: {
  message: string;
  sourceClassification: QuickOrderInputClassificationResult;
  segmentRoute: QuickOrderSegmentRoute;
  catalogIndex: CatalogSearchIndex;
  unitAliases: UnitAliasMap;
  existingParsedItems: ParsedItem[];
}): boolean {
  const classification = input.sourceClassification.classification;

  if (
    classification === 'order_command' &&
    input.sourceClassification.intentResult.intent === 'add' &&
    /\b(?:usual|normally|based on|what'?s low|what is low)\b/i.test(input.message)
  ) {
    return true;
  }

  // A multi-line list of item-like lines (e.g. a whole order or inventory count
  // pasted in) is unambiguously an order/inventory entry — never a history,
  // recommendation, or tutorial request. Always let the deterministic + stock
  // path handle it so each line is surfaced (added or flagged for review)
  // instead of the LLM router collapsing the entire list into one generic
  // "I'm not sure what you mean" clarification when individual lines don't
  // cleanly match the catalog. This is the safety net that keeps a confusing
  // line from wiping out the whole message.
  if (looksLikeMultiItemList(input.message, input.unitAliases)) return false;

  if (hasUsefulDeterministicOrderSignal(input)) return false;

  if (
    classification === 'clear_request' ||
    classification === 'confirm_request' ||
    classification === 'duplicate_resolution_action' ||
    classification === 'identity_question' ||
    classification === 'suggestion_request' ||
    classification === 'mixed_stock_and_order_request' ||
    classification === 'mixed_stock_and_recommendation_request'
  ) {
    return false;
  }

  if (
    classification === 'order_command' &&
    input.sourceClassification.intentResult.intent !== 'add' &&
    input.sourceClassification.intentResult.confidence >= 0.85
  ) {
    return false;
  }

  if (classification === 'tutorial_request') {
    return false;
  }

  if (classification === 'history_request' || classification === 'recommend_order_request') {
    return true;
  }

  if (classification === 'unknown_non_order' || classification === 'product_question') {
    return true;
  }

  if (input.segmentRoute.unknownSegments.length > 0) return true;
  if (classification === 'current_stock_update' && /\b(?:what should|what do|recommend|order|buy)\b/i.test(input.message)) {
    return true;
  }

  return classification === 'order_entry';
}

/**
 * True when the message reads as a multi-line list of item entries — two or
 * more lines where a majority parse to a non-empty item name. Such a list is an
 * order or inventory dump, not a single intent like "show recent orders", so it
 * must bypass the LLM intent router and flow through the deterministic + stock
 * path where every line is individually surfaced.
 */
function looksLikeMultiItemList(message: string, unitAliases: UnitAliasMap): boolean {
  const lines = message
    .normalize('NFKC')
    .split(/\r?\n|,|;/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return false;

  let itemLike = 0;
  for (const line of lines) {
    // A question is never an item line; its presence argues against a list.
    if (/[?]/.test(line)) continue;
    const candidates = parseDeterministicOrder(line, unitAliases);
    if (candidates.some((candidate) => candidate.item_text.trim().length > 0)) {
      itemLike += 1;
    }
  }
  return itemLike >= 2 && itemLike >= Math.ceil(lines.length / 2);
}

function hasUsefulDeterministicOrderSignal(input: {
  message: string;
  sourceClassification: QuickOrderInputClassificationResult;
  catalogIndex: CatalogSearchIndex;
  unitAliases: UnitAliasMap;
  existingParsedItems: ParsedItem[];
}): boolean {
  const candidates = parseDeterministicOrder(input.message, input.unitAliases);
  if (candidates.length === 0) return false;

  for (const candidate of candidates) {
    const itemText = candidate.item_text.trim();
    if (!itemText) {
      if (input.existingParsedItems.length > 0 && (candidate.quantity != null || candidate.unit)) return true;
      continue;
    }
    const match = matchCatalogIndex(itemText, input.catalogIndex);
    // A clean catalog match is a useful order signal on its own. A bare item
    // name with no quantity/unit (e.g. "Japanese scallop") should resolve the
    // item and prompt for quantity via the normal parser instead of being sent
    // to the LLM intent router, which treats a verbless product name as
    // ambiguous and returns a generic clarification. order_entry is the default
    // classification for a typed item name in Order mode, so accept it here the
    // same way order_command is — this mirrors how Inventory mode resolves a
    // bare item name as a missing-quantity draft.
    if (
      match.item_id &&
      !match.needs_clarification &&
      (
        candidate.quantity != null ||
        candidate.unit ||
        input.sourceClassification.classification === 'order_command' ||
        input.sourceClassification.classification === 'order_entry'
      )
    ) {
      return true;
    }
  }

  return false;
}

function classificationFromLlmRoute(
  route: LlmIntentRoute,
  source: QuickOrderInputClassificationResult,
): QuickOrderInputClassificationResult {
  const intentResult = {
    ...source.intentResult,
    intent: intentForLlmRoute(route),
    confidence: route.confidence,
    strippedText: route.user_message ?? source.intentResult.strippedText,
    matchedPhrase: null,
  };
  return {
    classification: route.classification,
    intentResult,
    normalizedText: (route.user_message ?? source.normalizedText).normalize('NFKC').trim().toLowerCase(),
    reason: `llm_intent_router:${route.intent}`,
  };
}

function intentForLlmRoute(route: LlmIntentRoute): QuickOrderInputClassificationResult['intentResult']['intent'] {
  switch (route.intent) {
    case 'add_items':
      return 'add';
    case 'remove_items':
      return 'remove';
    case 'update_items':
      return 'update';
    default:
      return 'unknown';
  }
}

function buildLlmIntentRouteResponse(input: {
  route: LlmIntentRoute;
  existingCount: number;
  recentOrders: RecommendationHistoryOrder[];
  catalogCount: number;
}): ParseResponse | null {
  const route = input.route;
  if (route.confidence < 0.65) {
    return buildRouteOnlyParseResponse({
      status: 'needs_clarification',
      message: route.clarification_question ?? 'I’m not sure what you want me to do. Do you want to add items, see past orders, get a recommendation, or ask for help?',
      existingCount: input.existingCount,
      catalogCount: input.catalogCount,
      route,
      pendingClarification: true,
    });
  }

  if (route.classification === 'unknown_non_order') {
    return buildRouteOnlyParseResponse({
      status: 'ok',
      message: 'I can help with ordering, current stock suggestions, past orders, and product questions. What would you like to do?',
      existingCount: input.existingCount,
      catalogCount: input.catalogCount,
      route,
    });
  }

  if (route.classification === 'tutorial_request' && route.intent === 'ask_help') {
    return buildRouteOnlyParseResponse({
      status: 'ok',
      message: buildQuickOrderTutorialMessage(),
      existingCount: input.existingCount,
      catalogCount: input.catalogCount,
      route,
    });
  }

  if (route.classification === 'history_request') {
    return buildRouteOnlyParseResponse({
      status: 'ok',
      message: buildHistoryMessage(route, input.recentOrders),
      existingCount: input.existingCount,
      catalogCount: input.catalogCount,
      route,
    });
  }

  if (route.classification === 'recommend_order_request' && route.intent === 'add_items' && route.confidence < 0.85) {
    return null;
  }

  if (route.classification === 'order_command' || route.classification === 'order_entry' || route.classification === 'product_question' || route.classification === 'recommend_order_request' || route.classification === 'current_stock_update') {
    return null;
  }

  return null;
}

function buildRouteOnlyParseResponse(input: {
  status: NonNullable<ParseResponse['status']>;
  message: string;
  existingCount: number;
  catalogCount: number;
  route: LlmIntentRoute;
  pendingClarification?: boolean;
}): ParseResponse {
  const pendingClarifications = input.pendingClarification
    ? [{
        id: 'llm_intent_clarification',
        type: 'item_not_found' as const,
        item_id: null,
        item_name: 'Quick Order',
        message: input.message,
        actions: [],
      }]
    : [];

  return {
    status: input.status,
    assistant_message: input.message,
    reply_text: input.message,
    parsed_items: [],
    flags: [],
    suggestions: [],
    pending_actions: pendingClarifications,
    pending_clarifications: pendingClarifications,
    session_state: {
      total_items: input.existingCount,
      ready_to_submit: false,
    },
    diagnostics: {
      parser_version: PARSER_VERSION,
      parse_mode: 'llm_intent_router',
      catalog_count: input.catalogCount,
      candidate_count: 0,
      items_received: 0,
      items_accepted: 0,
      items_rejected: 0,
      rejected_reasons: [`llm_intent:${input.route.intent}`],
      pending_action_count: pendingClarifications.length,
      input_classification: input.route.classification,
      input_classification_reason: `llm_intent_router:${input.route.intent}`,
    },
    metrics: {
      parse_mode_used: 'llm_only_fallback',
      lines_parsed: 0,
      high_confidence_matches: 0,
      fuzzy_matches: 0,
      unresolved_items: 0,
      conflicts: pendingClarifications.length,
      json_repair_needed: false,
      llm_failed: false,
      llm_used: true,
    },
    operations: [],
  };
}

function buildQuickOrderTutorialMessage(): string {
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

function buildHistoryMessage(route: LlmIntentRoute, recentOrders: RecommendationHistoryOrder[]): string {
  const matchingOrders = recentOrders.slice(0, route.entities.time_range === 'recent' || !route.entities.time_range ? 3 : 1);
  if (matchingOrders.length === 0) {
    if (route.entities.time_range === 'last_week' || route.intent === 'show_last_week_order') {
      return 'No matching order from last week was found for this location.';
    }
    if (route.entities.time_range === 'last_month') {
      return 'No matching order from last month was found for this location.';
    }
    if (route.entities.time_range === 'usual') {
      return 'I don’t have enough history to suggest a usual order yet.';
    }
    if (route.entities.time_range === 'yesterday') {
      return 'No matching order from yesterday was found for this location.';
    }
    return 'I couldn’t find a recent order for this location yet.';
  }

  const summaries = matchingOrders.map((order, index) => {
    const when = route.entities.time_range === 'recent' || !route.entities.time_range
      ? `Recent order ${index + 1}`
      : labelForTimeRange(route.entities.time_range);
    const items = (order.items ?? [])
      .slice(0, 5)
      .map((item) => `${item.quantity ?? ''} ${item.unit ?? ''} ${item.item_name ?? 'item'}`.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(', ');
    return items ? `${when}: ${items}` : when;
  });
  return summaries.join('\n');
}

function labelForTimeRange(timeRange: LlmIntentRoute['entities']['time_range']): string {
  switch (timeRange) {
    case 'yesterday':
      return 'Yesterday';
    case 'last_week':
      return 'Last week';
    case 'last_month':
      return 'Last month';
    case 'usual':
      return 'Usual order';
    case 'recent':
    default:
      return 'Recent order';
  }
}

function stockUpdatesFromLlmIntentRoute(input: {
  route: LlmIntentRoute;
  source: ProcessQuickOrderMessageRequest['source'];
  catalog: CatalogItem[];
  catalogIndex: CatalogSearchIndex;
  originalText: string;
}): StockOperation[] {
  if (
    input.route.classification !== 'recommend_order_request' &&
    input.route.classification !== 'current_stock_update'
  ) {
    return [];
  }

  return (input.route.entities.quantities ?? [])
    .map((quantityEntity): StockOperation | null => {
      const itemName = quantityEntity.item_name ?? input.route.entities.item_names?.[0];
      if (!itemName) return null;
      const match = matchCatalogIndex(itemName, input.catalogIndex);
      if (!match.item_id || match.needs_clarification) return null;
      const catalogItem = input.catalog.find((item) => item.id === match.item_id);
      if (!catalogItem) return null;
      return {
        item_id: catalogItem.id,
        item_name: catalogItem.name,
        quantity: quantityEntity.quantity,
        unit: quantityEntity.unit ?? catalogItem.default_unit,
        source: input.source,
        confidence: Math.min(input.route.confidence, 0.88),
        original_text: input.originalText,
      };
    })
    .filter((update): update is StockOperation => Boolean(update));
}

function mergeStockUpdates(primary: StockOperation[], secondary: StockOperation[]): StockOperation[] {
  if (secondary.length === 0) return primary;
  const seen = new Set(primary.map((update) => `${update.item_id}:${update.unit ?? ''}`));
  const merged = [...primary];
  for (const update of secondary) {
    const key = `${update.item_id}:${update.unit ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(update);
  }
  return merged;
}
