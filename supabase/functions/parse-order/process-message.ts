import { classifyQuickOrderInput } from './input-classifier.ts';
import { routeQuickOrderModel, type QuickOrderModelConfig } from './model-router.ts';
import { parseQuickOrder, PARSER_VERSION } from './orchestrator.ts';
import { buildQuickOrderRecommendations, type RecommendationHistoryOrder } from './recommendation-engine.ts';
import { buildProcessMessages } from './response-formatter.ts';
import { routeQuickOrderSegments } from './segment-router.ts';
import { validateQuickOrderSafety } from './safety-engine.ts';
import { extractStockUpdates, type StockUpdateExtraction } from './stock-updates.ts';
import { QuickOrderTimer } from './timing.ts';
import type {
  CatalogItem,
  ItemAllowedUnitRule,
  ItemOrderLimit,
  ParserCorrection,
  ParserExample,
  ParseResponse,
  ParsedItem,
  ProcessQuickOrderMessageRequest,
  ProcessQuickOrderResponse,
  QuickOrderMessage,
  QuickOrderModelUsed,
  StockOperation,
} from './types.ts';

export type ProcessQuickOrderMessageInput = {
  request: ProcessQuickOrderMessageRequest;
  catalog: CatalogItem[];
  globalCatalog?: CatalogItem[];
  examples: ParserExample[];
  corrections: ParserCorrection[];
  previousMessages: QuickOrderMessage[];
  existingParsedItems: ParsedItem[];
  limits: ItemOrderLimit[];
  allowedUnitRules: ItemAllowedUnitRule[];
  recentOrders: RecommendationHistoryOrder[];
  userRole?: string | null;
  modelConfig: QuickOrderModelConfig;
  callLlm?: (prompt: string, model: string | null) => Promise<string>;
  persistStockUpdates?: (updates: StockOperation[]) => Promise<void>;
  debugTimings?: boolean;
};

export async function processQuickOrderMessage(
  input: ProcessQuickOrderMessageInput,
): Promise<ProcessQuickOrderResponse> {
  const timer = new QuickOrderTimer();
  const request = normalizeRequest(input.request);
  const orderCatalog = applyAllowedUnitRulesToCatalog(input.catalog, input.allowedUnitRules);
  const globalOrderCatalog = input.globalCatalog
    ? applyAllowedUnitRulesToCatalog(input.globalCatalog, input.allowedUnitRules)
    : undefined;
  const classification = classifyQuickOrderInput(request.message, {
    hasPendingDuplicateAction: input.previousMessages.some((message) =>
      (message.pending_clarifications ?? []).some((entry) => entry.type === 'quantity_conflict' || entry.type === 'unit_conflict')
    ),
  });
  const segmentRoute = routeQuickOrderSegments(request.message);

  const stockExtraction = timer.measure('deterministic_parse', (): StockUpdateExtraction =>
    segmentRoute.stockSegments.length > 0
      ? extractStockUpdates({
          message: segmentRoute.stockSegments.join('\n'),
          source: request.source,
          catalog: input.catalog,
          corrections: input.corrections,
        })
      : emptyStockExtraction(request.message)
  );

  const shouldRecommend =
    classification.classification === 'recommend_order_request' ||
    classification.classification === 'mixed_stock_and_recommendation_request' ||
    segmentRoute.recommendationSegments.length > 0;
  const shouldSkipOrderParse =
    segmentRoute.orderSegments.length === 0 &&
    (
      classification.classification === 'current_stock_update' ||
      classification.classification === 'recommend_order_request' ||
      classification.classification === 'mixed_stock_and_recommendation_request'
    );
  const parserText = segmentRoute.orderSegments.length > 0
    ? segmentRoute.orderSegments.join('\n')
    : shouldSkipOrderParse
      ? ''
      : stockExtraction.remainingText || request.message;

  const modelRoute = routeQuickOrderModel({
    message: parserText || request.message,
    source: request.source,
    config: input.modelConfig,
  });

  const parseResponse = parserText
    ? await timer.measureAsync('llm_fallback', () => parseQuickOrder({
        rawText: parserText,
        locationId: request.location_id,
        catalog: orderCatalog,
        globalCatalog: globalOrderCatalog,
        examples: input.examples,
        corrections: input.corrections,
        previousMessages: request.recent_messages ?? input.previousMessages,
        existingParsedItems: request.existing_items.length > 0 ? request.existing_items : input.existingParsedItems,
        callLlm: modelRoute.allowLlmFallback && input.callLlm
          ? (prompt) => input.callLlm!(prompt, modelRoute.model)
          : undefined,
      }))
    : emptyParseResponse({
        existingCount: input.existingParsedItems.length,
        classification: classification.classification,
        reason: classification.reason,
        message: request.message,
      });

  const safety = timer.measure('safety_validation', () => validateQuickOrderSafety({
    parseResponse,
    catalog: orderCatalog,
    locationId: request.location_id,
    source: request.source,
    limits: input.limits,
    allowedUnitRules: input.allowedUnitRules,
    userRole: input.userRole,
  }));

  if (stockExtraction.stockUpdates.length > 0 && input.persistStockUpdates) {
    await timer.measureAsync('db_write', () => input.persistStockUpdates!(stockExtraction.stockUpdates));
  }

  const recommendationResult = shouldRecommend
    ? timer.measure('recommendation_engine', () => buildQuickOrderRecommendations({
        catalog: orderCatalog,
        stockUpdates: stockExtraction.stockUpdates,
        recentOrders: input.recentOrders,
        limits: input.limits,
        allowedUnitRules: input.allowedUnitRules,
      }))
    : { recommendations: [], warnings: [] };

  const messages = timer.measure('response_build', () => buildProcessMessages({
    parseResponse: safety.response,
    stockUpdates: stockExtraction.stockUpdates,
    recommendations: recommendationResult.recommendations,
    safetyWarnings: [...safety.warnings, ...recommendationResult.warnings],
    blockedOperations: safety.blockedOperations,
  }));

  const actualModelUsed: QuickOrderModelUsed = safety.response.metrics?.llm_used
    ? modelRoute.modelUsed
    : 'none';
  const processStatus = deriveProcessStatus({
    parseResponse: safety.response,
    stockUpdates: stockExtraction.stockUpdates,
    recommendationsCount: recommendationResult.recommendations.length,
    warningsCount: safety.warnings.length + recommendationResult.warnings.length,
    blockedCount: safety.blockedOperations.length,
  });
  const timings = timer.snapshot();

  if (input.debugTimings) {
    console.log('[parse-order] process_message_timings', JSON.stringify({
      timings,
      model_route: modelRoute,
      classification: classification.classification,
    }));
  }

  return {
    ...safety.response,
    status: processStatus,
    legacy_status: safety.response.status ?? 'ok',
    display_message: messages.displayMessage,
    speech_message: messages.speechMessage,
    assistant_message: messages.displayMessage,
    reply_text: messages.displayMessage,
    parsed_items: safety.response.parsed_items,
    cart_operations: safety.response.operations ?? [],
    operations: safety.response.operations ?? [],
    stock_updates: stockExtraction.stockUpdates,
    recommendations: recommendationResult.recommendations,
    clarifications: safety.pendingClarifications,
    pending_actions: safety.pendingClarifications,
    pending_clarifications: safety.pendingClarifications,
    safety_warnings: [...safety.warnings, ...recommendationResult.warnings],
    blocked_operations: safety.blockedOperations,
    model_used: actualModelUsed,
    confidence: responseConfidence(safety.response, stockExtraction.stockUpdates),
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
      stock_update_count: stockExtraction.stockUpdates.length,
      recommendation_count: recommendationResult.recommendations.length,
    } as ProcessQuickOrderResponse['diagnostics'],
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

function normalizeRequest(request: ProcessQuickOrderMessageRequest): ProcessQuickOrderMessageRequest {
  return {
    ...request,
    source: request.source === 'voice' ? 'voice' : 'typed',
    message: request.message.trim(),
    existing_items: Array.isArray(request.existing_items) ? request.existing_items : [],
    recent_messages: Array.isArray(request.recent_messages) ? request.recent_messages : undefined,
  };
}

function emptyStockExtraction(message: string): StockUpdateExtraction {
  return {
    stockUpdates: [],
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
}): ParseResponse {
  return {
    status: 'ok',
    assistant_message: 'Got it.',
    reply_text: 'Got it.',
    parsed_items: [],
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
      catalog_count: 0,
      candidate_count: 0,
      items_received: 0,
      items_accepted: 0,
      items_rejected: 0,
      rejected_reasons: [input.reason],
      pending_action_count: 0,
      raw_input_length: input.message.length,
      candidate_lines: 0,
      input_classification: input.classification,
      input_classification_reason: input.reason,
    },
    metrics: {
      parse_mode_used: 'deterministic_only',
      lines_parsed: 0,
      high_confidence_matches: 0,
      fuzzy_matches: 0,
      unresolved_items: 0,
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
}): ProcessQuickOrderResponse['status'] {
  if (input.parseResponse.status === 'error') return 'error';
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
