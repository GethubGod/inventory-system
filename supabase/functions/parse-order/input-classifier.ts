import { detectQuickOrderIntent, type IntentDetectionResult } from './intent-detector.ts';

export type QuickOrderInputClassification =
  | 'order_entry'
  | 'order_command'
  | 'current_stock_update'
  | 'recommend_order_request'
  | 'mixed_stock_and_order_request'
  | 'mixed_stock_and_recommendation_request'
  | 'clarification_answer'
  | 'duplicate_resolution_action'
  | 'suggestion_request'
  | 'history_request'
  | 'confirm_request'
  | 'clear_request'
  | 'unknown_non_order';

export type QuickOrderInputClassifierContext = {
  hasPendingDuplicateAction?: boolean;
};

export type QuickOrderInputClassificationResult = {
  classification: QuickOrderInputClassification;
  intentResult: IntentDetectionResult;
  normalizedText: string;
  reason: string;
};

const SUGGESTION_PATTERNS = [
  /\bsuggestions?\b/i,
];

const RECOMMEND_ORDER_PATTERNS = [
  /\bwhat should i order\b/i,
  /\bwhat should we order\b/i,
  /\brecommend(?:ed)? order\b/i,
  /\bsuggest what to order\b/i,
  /\bmake (?:the|my|an?) order\b/i,
];

const STOCK_PATTERNS = [
  /\b(?:we have|i have|have|has)\b.+\b(?:left|remaining|on hand)\b/i,
  /\b(?:left|remaining|on hand)\b/i,
  /\bout of\b/i,
  /\bcounted\b/i,
  /\bcurrent stock\b/i,
  /\bno\s+[\p{L}\p{N}' -]+\b/iu,
];

const HISTORY_PATTERNS = [
  /\bwhat did i order\b/i,
  /\breorder recent\b/i,
  /\brecent order\b/i,
  /\blast (?:week|time|order)\b/i,
  /\bprevious order\b/i,
  /\bpast order\b/i,
  /\bsame as last time\b/i,
  /\bsame as usual\b/i,
  /\bthe usual\b/i,
  /\bmy usual\b/i,
  /\busual(?: order)?\b/i,
  /\breorder last\b/i,
];

const QUESTION_PATTERN = /^(?:what|when|where|why|how|can|could|should|do|did|is|are)\b/i;

export function classifyQuickOrderInput(
  rawText: string,
  context: QuickOrderInputClassifierContext = {},
): QuickOrderInputClassificationResult {
  const nfkcText = rawText.normalize('NFKC');
  const normalizedText = nfkcText.trim().toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, '').replace(/\s+/g, ' ');
  const intentResult = detectQuickOrderIntent(nfkcText);

  if (!normalizedText) {
    return { classification: 'unknown_non_order', intentResult, normalizedText, reason: 'empty_input' };
  }

  const hasStockSignal = STOCK_PATTERNS.some((pattern) => pattern.test(nfkcText));
  const hasRecommendationSignal = RECOMMEND_ORDER_PATTERNS.some((pattern) => pattern.test(nfkcText));
  if (hasStockSignal && hasRecommendationSignal) {
    return {
      classification: 'mixed_stock_and_recommendation_request',
      intentResult,
      normalizedText,
      reason: 'stock_and_recommendation_phrase',
    };
  }

  if (hasStockSignal && intentResult.intent !== 'unknown' && intentResult.intent !== 'confirm') {
    return {
      classification: 'mixed_stock_and_order_request',
      intentResult,
      normalizedText,
      reason: 'stock_and_order_command',
    };
  }

  if (hasStockSignal) {
    return { classification: 'current_stock_update', intentResult, normalizedText, reason: 'stock_phrase' };
  }

  if (hasRecommendationSignal) {
    return { classification: 'recommend_order_request', intentResult, normalizedText, reason: 'recommendation_phrase' };
  }

  if (HISTORY_PATTERNS.some((pattern) => pattern.test(nfkcText))) {
    return { classification: 'history_request', intentResult, normalizedText, reason: 'history_phrase' };
  }

  if (SUGGESTION_PATTERNS.some((pattern) => pattern.test(nfkcText))) {
    return { classification: 'suggestion_request', intentResult, normalizedText, reason: 'suggestion_phrase' };
  }

  if (normalizedText === 'combine') {
    return {
      classification: 'duplicate_resolution_action',
      intentResult,
      normalizedText,
      reason: context.hasPendingDuplicateAction ? 'pending_duplicate_action' : 'no_pending_duplicate_action',
    };
  }

  if (normalizedText === 'clear' || normalizedText === 'clear order' || intentResult.intent === 'clear') {
    return { classification: 'clear_request', intentResult, normalizedText, reason: 'clear_command' };
  }

  if (intentResult.intent === 'confirm') {
    return { classification: 'confirm_request', intentResult, normalizedText, reason: 'confirm_command' };
  }

  if (intentResult.intent !== 'unknown') {
    return { classification: 'order_command', intentResult, normalizedText, reason: `${intentResult.intent}_command` };
  }

  if (QUESTION_PATTERN.test(nfkcText)) {
    return { classification: 'unknown_non_order', intentResult, normalizedText, reason: 'question_like_text' };
  }

  return { classification: 'order_entry', intentResult, normalizedText, reason: 'default_order_entry' };
}
