import { parseJsonPayload } from './llm-fallback.ts';
import type { QuickOrderMessage } from './types.ts';

export type LlmIntentRoute = {
  classification:
    | 'history_request'
    | 'tutorial_request'
    | 'recommend_order_request'
    | 'current_stock_update'
    | 'product_question'
    | 'order_entry'
    | 'order_command'
    | 'unknown_non_order';

  intent:
    | 'show_recent_orders'
    | 'show_last_week_order'
    | 'compare_previous_order'
    | 'recommend_from_stock'
    | 'check_missing_items'
    | 'ask_help'
    | 'answer_product_question'
    | 'add_items'
    | 'remove_items'
    | 'update_items'
    | 'none';

  confidence: number;

  entities: {
    time_range?: 'yesterday' | 'last_week' | 'recent' | 'usual' | 'last_month';
    item_names?: string[];
    quantities?: {
      item_name?: string;
      quantity: number;
      unit?: string;
    }[];
  };

  requires_action: boolean;
  should_mutate_cart: boolean;
  clarification_question?: string;
  user_message?: string;
};

export type LlmIntentRouterInput = {
  userMessage: string;
  recentMessages?: QuickOrderMessage[];
  callLlm?: (prompt: string) => Promise<string>;
};

const CLASSIFICATIONS: LlmIntentRoute['classification'][] = [
  'history_request',
  'tutorial_request',
  'recommend_order_request',
  'current_stock_update',
  'product_question',
  'order_entry',
  'order_command',
  'unknown_non_order',
];

const INTENTS: LlmIntentRoute['intent'][] = [
  'show_recent_orders',
  'show_last_week_order',
  'compare_previous_order',
  'recommend_from_stock',
  'check_missing_items',
  'ask_help',
  'answer_product_question',
  'add_items',
  'remove_items',
  'update_items',
  'none',
];

const TIME_RANGES = ['yesterday', 'last_week', 'recent', 'usual', 'last_month'] as const;
const MUTATING_INTENTS = new Set<LlmIntentRoute['intent']>(['add_items', 'remove_items', 'update_items']);

export async function routeIntentWithLlm(input: LlmIntentRouterInput): Promise<{
  route: LlmIntentRoute;
  rawText: string;
  repairNeeded: boolean;
  llmFailed: boolean;
}> {
  if (!input.callLlm) {
    return {
      route: buildUnknownRoute(input.userMessage, 0.4, 'I’m not sure what you want me to do. Do you want to add items, see past orders, get a recommendation, or ask for help?'),
      rawText: '',
      repairNeeded: false,
      llmFailed: true,
    };
  }

  try {
    const prompt = buildIntentRouterPrompt(input.userMessage, summarizeRecentContext(input.recentMessages ?? []));
    const rawText = await input.callLlm(prompt);
    const parsed = parseJsonPayload(rawText);
    if (!parsed.value) {
      return {
        route: buildUnknownRoute(input.userMessage, 0.4, 'I understood this might be about ordering, but I need more detail. Do you want to add items, see past orders, get a recommendation, or ask for help?'),
        rawText,
        repairNeeded: true,
        llmFailed: false,
      };
    }
    return {
      route: normalizeLlmIntentRoute(parsed.value, input.userMessage),
      rawText,
      repairNeeded: parsed.repairNeeded,
      llmFailed: false,
    };
  } catch {
    return {
      route: buildUnknownRoute(input.userMessage, 0.4, 'I’m not sure what you want me to do. Do you want to add items, see past orders, get a recommendation, or ask for help?'),
      rawText: '',
      repairNeeded: false,
      llmFailed: true,
    };
  }
}

export function normalizeLlmIntentRoute(value: unknown, fallbackMessage = ''): LlmIntentRoute {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const classification = asEnum(raw.classification, CLASSIFICATIONS) ?? 'unknown_non_order';
  const intent = asEnum(raw.intent, INTENTS) ?? defaultIntentForClassification(classification);
  const confidence = clampConfidence(raw.confidence);
  const entities = normalizeEntities(raw.entities);
  const shouldMutate = Boolean(raw.should_mutate_cart) && MUTATING_INTENTS.has(intent);

  return {
    classification,
    intent,
    confidence,
    entities,
    requires_action: typeof raw.requires_action === 'boolean' ? raw.requires_action : classification !== 'unknown_non_order',
    should_mutate_cart: shouldMutate,
    clarification_question: typeof raw.clarification_question === 'string' && raw.clarification_question.trim()
      ? raw.clarification_question.trim()
      : undefined,
    user_message: typeof raw.user_message === 'string' && raw.user_message.trim()
      ? raw.user_message.trim()
      : fallbackMessage,
  };
}

function buildIntentRouterPrompt(userMessage: string, recentContextSummary: string): string {
  return [
    'You are an intent router for a restaurant inventory Quick Order system.',
    'Classify the user message into one small JSON object. Do not add items to cart. Do not invent item names. Do not answer the user directly.',
    'Return only valid JSON matching this TypeScript shape:',
    '{"classification":"history_request|tutorial_request|recommend_order_request|current_stock_update|product_question|order_entry|order_command|unknown_non_order","intent":"show_recent_orders|show_last_week_order|compare_previous_order|recommend_from_stock|check_missing_items|ask_help|answer_product_question|add_items|remove_items|update_items|none","confidence":0.0,"entities":{"time_range":"yesterday|last_week|recent|usual|last_month","item_names":["name"],"quantities":[{"item_name":"name","quantity":1,"unit":"unit"}]},"requires_action":true,"should_mutate_cart":false,"clarification_question":"optional","user_message":"original"}',
    'Rules: should_mutate_cart is true only when the user clearly asked to add, remove, or update order items. Recommendations and history should not mutate the cart. If unclear, confidence must be below 0.65 and include a clarification_question.',
    'Examples:',
    '{"user":"Show me my recent orders","route":{"classification":"history_request","intent":"show_recent_orders","confidence":0.95,"entities":{"time_range":"recent"},"requires_action":true,"should_mutate_cart":false}}',
    '{"user":"U are what","route":{"classification":"tutorial_request","intent":"ask_help","confidence":0.85,"entities":{},"requires_action":true,"should_mutate_cart":false}}',
    '{"user":"How can I order?","route":{"classification":"tutorial_request","intent":"ask_help","confidence":0.95,"entities":{},"requires_action":true,"should_mutate_cart":false}}',
    '{"user":"What should I buy if I have 2 cases salmon left?","route":{"classification":"recommend_order_request","intent":"recommend_from_stock","confidence":0.9,"entities":{"item_names":["salmon"],"quantities":[{"item_name":"salmon","quantity":2,"unit":"cases"}]},"requires_action":true,"should_mutate_cart":false}}',
    '{"user":"Add what I usually order","route":{"classification":"recommend_order_request","intent":"add_items","confidence":0.8,"entities":{"time_range":"usual"},"requires_action":true,"should_mutate_cart":true}}',
    '{"user":"What am I missing from yesterday?","route":{"classification":"recommend_order_request","intent":"check_missing_items","confidence":0.92,"entities":{"time_range":"yesterday"},"requires_action":true,"should_mutate_cart":false}}',
    '{"user":"Does this look complete?","route":{"classification":"recommend_order_request","intent":"check_missing_items","confidence":0.9,"entities":{"time_range":"usual"},"requires_action":true,"should_mutate_cart":false}}',
    `Recent context summary: ${recentContextSummary || 'none'}`,
    `User message: ${JSON.stringify(userMessage)}`,
    'JSON only:',
  ].join('\n');
}

function summarizeRecentContext(messages: QuickOrderMessage[]): string {
  return messages
    .slice(-4)
    .map((message) => {
      const role = message.role ?? 'unknown';
      const text = (message.content ?? message.text ?? message.raw_text ?? message.reply_text ?? '').replace(/\s+/g, ' ').trim();
      if (!text) return '';
      return `${role}: ${text.slice(0, 160)}`;
    })
    .filter(Boolean)
    .join(' | ')
    .slice(0, 700);
}

function normalizeEntities(value: unknown): LlmIntentRoute['entities'] {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const entities: LlmIntentRoute['entities'] = {};
  const timeRange = asEnum(raw.time_range, TIME_RANGES);
  if (timeRange) entities.time_range = timeRange;
  if (Array.isArray(raw.item_names)) {
    const names = raw.item_names
      .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
      .map((name) => name.trim())
      .slice(0, 8);
    if (names.length > 0) entities.item_names = [...new Set(names)];
  }
  if (Array.isArray(raw.quantities)) {
    const quantities = raw.quantities
      .map((entry) => normalizeQuantityEntity(entry))
      .filter((entry): entry is NonNullable<LlmIntentRoute['entities']['quantities']>[number] => Boolean(entry))
      .slice(0, 8);
    if (quantities.length > 0) entities.quantities = quantities;
  }
  return entities;
}

function normalizeQuantityEntity(value: unknown): NonNullable<LlmIntentRoute['entities']['quantities']>[number] | null {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const quantity = typeof raw.quantity === 'number'
    ? raw.quantity
    : typeof raw.quantity === 'string'
      ? Number(raw.quantity)
      : null;
  if (quantity === null || !Number.isFinite(quantity)) return null;
  const entity: NonNullable<LlmIntentRoute['entities']['quantities']>[number] = { quantity };
  if (typeof raw.item_name === 'string' && raw.item_name.trim()) entity.item_name = raw.item_name.trim();
  if (typeof raw.unit === 'string' && raw.unit.trim()) entity.unit = raw.unit.trim();
  return entity;
}

function asEnum<T extends readonly string[]>(value: unknown, allowed: T): T[number] | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T[number] : null;
}

function clampConfidence(value: unknown): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : 0.5;
  if (!Number.isFinite(parsed)) return 0.5;
  return Math.max(0, Math.min(1, parsed));
}

function defaultIntentForClassification(classification: LlmIntentRoute['classification']): LlmIntentRoute['intent'] {
  switch (classification) {
    case 'history_request':
      return 'show_recent_orders';
    case 'tutorial_request':
      return 'ask_help';
    case 'recommend_order_request':
    case 'current_stock_update':
      return 'recommend_from_stock';
    case 'product_question':
      return 'answer_product_question';
    case 'order_entry':
      return 'add_items';
    case 'order_command':
      return 'update_items';
    case 'unknown_non_order':
    default:
      return 'none';
  }
}

function buildUnknownRoute(userMessage: string, confidence: number, clarificationQuestion: string): LlmIntentRoute {
  return {
    classification: 'unknown_non_order',
    intent: 'none',
    confidence,
    entities: {},
    requires_action: false,
    should_mutate_cart: false,
    clarification_question: clarificationQuestion,
    user_message: userMessage,
  };
}
