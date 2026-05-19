import { parseDeterministicOrder } from './deterministic-parser.ts';

export type QuickOrderSegmentIntent =
  | 'order_entry'
  | 'stock_update'
  | 'stock_header'
  | 'recommendation_request'
  | 'unknown_question';

export type QuickOrderSegment = {
  text: string;
  intent: QuickOrderSegmentIntent;
  reason: string;
};

export type QuickOrderSegmentRoute = {
  segments: QuickOrderSegment[];
  orderSegments: string[];
  stockSegments: string[];
  recommendationSegments: string[];
  unknownSegments: string[];
};

const RECOMMENDATION_PATTERNS = [
  /\bwhat should i order\b/i,
  /\bwhat should we order\b/i,
  /\brecommend(?:ed)? order\b/i,
  /\bsuggest what to order\b/i,
  /\bmake (?:the|my|an?) order\b/i,
];

const STOCK_HEADER_PATTERN =
  /^\s*(?:counted|current\s+stock)(?:\s+[\p{L}\p{N}'()\/ -]+)?\s*$/iu;

const EXPLICIT_STOCK_PATTERNS = [
  /\b(?:we have|i have|have|has)\b.+\b(?:left|remaining|on hand|in stock)\b/i,
  /\b(?:left|remaining|on hand|current stock)\b/i,
  /\bout of\b/i,
  /^\s*no\s+[\p{L}\p{N}'()\/ -]+\s*$/iu,
];

const QUESTION_PATTERN = /^(?:what|when|where|why|how|can|could|should|do|did|is|are)\b/i;

export function routeQuickOrderSegments(rawText: string): QuickOrderSegmentRoute {
  const rawSegments = splitQuickOrderSegments(rawText);
  const segments: QuickOrderSegment[] = [];
  let stockListMode = false;

  for (const text of rawSegments) {
    const recommendation = RECOMMENDATION_PATTERNS.some((pattern) => pattern.test(text));
    if (recommendation) {
      segments.push({ text, intent: 'recommendation_request', reason: 'recommendation_phrase' });
      stockListMode = false;
      continue;
    }

    if (STOCK_HEADER_PATTERN.test(text) && !hasOrderQuantitySignal(text)) {
      segments.push({ text, intent: 'stock_header', reason: 'stock_header' });
      stockListMode = true;
      continue;
    }

    const explicitStock = EXPLICIT_STOCK_PATTERNS.some((pattern) => pattern.test(text));
    if (explicitStock) {
      segments.push({ text, intent: 'stock_update', reason: 'explicit_stock_phrase' });
      continue;
    }

    if (stockListMode && hasOrderQuantitySignal(text)) {
      segments.push({ text, intent: 'stock_update', reason: 'stock_list_continuation' });
      continue;
    }

    stockListMode = false;

    if (QUESTION_PATTERN.test(text) || /\?\s*$/.test(text)) {
      segments.push({ text, intent: 'unknown_question', reason: 'question_like_text' });
      continue;
    }

    segments.push({ text, intent: 'order_entry', reason: 'default_order_segment' });
  }

  const orderSegments = segments
    .filter((segment) => segment.intent === 'order_entry')
    .map((segment) => segment.text);
  const stockSegments = segments
    .filter((segment) => segment.intent === 'stock_update')
    .map((segment) => segment.text);
  const recommendationSegments = segments
    .filter((segment) => segment.intent === 'recommendation_request')
    .map((segment) => segment.text);
  const unknownSegments = segments
    .filter((segment) => segment.intent === 'unknown_question')
    .map((segment) => segment.text);

  return {
    segments,
    orderSegments,
    stockSegments,
    recommendationSegments,
    unknownSegments,
  };
}

function splitQuickOrderSegments(rawText: string): string[] {
  return rawText
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .split(/\n|,|;/)
    .flatMap(splitSafeAnd)
    .map((segment) => segment.trim().replace(/[ \t]+/g, ' '))
    .filter(Boolean);
}

function splitSafeAnd(segment: string): string[] {
  const parts = segment.split(/\s+\band\s+/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return [segment];
  return parts.every((part) =>
    hasOrderQuantitySignal(part) ||
    EXPLICIT_STOCK_PATTERNS.some((pattern) => pattern.test(part)) ||
    RECOMMENDATION_PATTERNS.some((pattern) => pattern.test(part))
  )
    ? parts
    : [segment];
}

function hasOrderQuantitySignal(segment: string): boolean {
  const candidate = parseDeterministicOrder(segment)[0];
  return Boolean(candidate && candidate.quantity != null && candidate.item_text.trim());
}
