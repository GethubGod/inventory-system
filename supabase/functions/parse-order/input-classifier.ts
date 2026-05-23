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
  | 'tutorial_request'
  | 'confirm_request'
  | 'clear_request'
  | 'identity_question'
  | 'product_question'
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

const MISSING_ITEM_CHECK_PATTERNS = [
  /\bwhat (?:am i|are we) missing\b/i,
  /\bdid (?:i|we) forget\b/i,
  /\bam i missing\b/i,
  /\bare we missing\b/i,
  /\bwhat did (?:i|we) miss\b/i,
  /\bcheck if (?:i|we) forgot\b/i,
  /\bdoes this look complete\b/i,
  /\bis this order complete\b/i,
  /\bcompare this to\b/i,
  /\bcompare (?:this|my order|the order) (?:to|with)\b/i,
  /\bwhat(?:'s| is) different from\b/i,
  /\banything else (?:i|we) usually order\b/i,
  /\bwhat do (?:i|we) normally order that is not here\b/i,
  /\bwhat should (?:i|we) add\b/i,
  /\bwhat else should (?:i|we) (?:buy|order|add)\b/i,
];

const STOCK_PATTERNS = [
  /\b(?:we have|i have)\b.+(?:\d|\bone\b|\btwo\b|\bthree\b|\bfour\b|\bfive\b|\bhalf\b)/i,
  /\b(?:we have|i have|have|has)\b.+\b(?:left|remaining|on hand)\b/i,
  /\b(?:if i have|if we have)\b/i,
  /\b(?:left|remaining|on hand)\b/i,
  /\bcurrent\b.+\b(?:is|are)\s+(?:\d|\bone\b|\btwo\b|\bthree\b|\bfour\b|\bfive\b|\bhalf\b)/i,
  /\b(?:is|are)\s+at\s+(?:\d|\bone\b|\btwo\b|\bthree\b|\bfour\b|\bfive\b|\bhalf\b)/i,
  /\b(?:around|about|almost|nearly)\s+(?:\d|\bone\b|\btwo\b|\bthree\b|\bfour\b|\bfive\b|\bhalf\b)/i,
  /\blow on\b/i,
  /\bout of\b/i,
  /\bcounted\b/i,
  /\bcurrent stock\b/i,
  /\bno\s+[\p{L}\p{N}' -]+\b/iu,
];

const HISTORY_PATTERNS = [
  /\bwhat did i order\b/i,
  /\bhow much\b.+\border\b.+\blast month\b/i,
  /\blast month\b/i,
  /\bcompare\b.+\blast week\b/i,
  /\breorder recent\b/i,
  /\brecent order\b/i,
  /\blast (?:week|weeks|time|order)\b/i,
  /\bprevious order\b/i,
  /\bpast order\b/i,
  /\bsame as last time\b/i,
  /\bsame as usual\b/i,
  /\bthe usual\b/i,
  /\bmy usual\b/i,
  /\busual(?: order)?\b/i,
  /\breorder last\b/i,
];

const TUTORIAL_PATTERNS = [
  /^\s*help\s*$/i,
  /\bwhat can you do\b/i,
  /\bwhat you can do\b/i,
  /\btell me what you can do\b/i,
  /\bwhat are you\b/i,
  /\byou are what\b/i,
  /\bwho are you\b/i,
  /\bwhat do you do\b/i,
  /\bhow can i order\b/i,
  /\bhow do i use this\b/i,
  /\bcan you help me order\b/i,
  /\bwhat can (?:you|quick order) do\b/i,
  /\bhow do i use quick order\b/i,
  /\bhow does (?:this|quick order)(?: thing)? work\b/i,
  /\bwhat can i say\b/i,
  /\bshow examples?\b/i,
  /\bhow do suggestions work\b/i,
  /\bhow do i undo\b/i,
  /\bwhat does quick order understand\b/i,
  /\bcan you order based on what i have\b/i,
  /\bcan you use last week'?s order\b/i,
];

const QUESTION_PATTERN = /^(?:what|when|where|why|how|can|could|should|do|did|is|are)\b/i;
const PRODUCT_QUESTION_PATTERNS = [
  /\bwhat units?\b/i,
  /\bwhat (?:sizes?|packs?|cases?|amounts?)\b/i,
  /\bhow (?:much|many)\b/i,
  /\bdoes\b.+\bcome\b/i,
  /\bis\b.+\bavailable\b/i,
  /\bdo you (?:have|sell|carry)\b/i,
  /\bcan i (?:get|order)\b/i,
  /\btell me about\b/i,
];
const IDENTITY_PATTERNS = [
  /\bwho are you\b/i,
  /\bwhat are you\b/i,
  /\byou are what\b/i,
  /\bwhat is this\b/i,
  /\bwhat do you do\b/i,
  /\bwho is this\b/i,
];

const CONVERSATIONAL_NON_ORDER_PATTERNS = [
  /\bi like\b/i,
  /\bweather\b/i,
  /\brandom words?\b/i,
];

export function classifyQuickOrderInput(
  rawText: string,
  context: QuickOrderInputClassifierContext = {},
): QuickOrderInputClassificationResult {
  const nfkcText = rawText.normalize('NFKC');
  const normalizedText = normalizeClassificationText(nfkcText);
  const patternText = expandConversationalSlang(normalizedText);
  const intentResult = detectQuickOrderIntent(nfkcText);

  if (!normalizedText) {
    return { classification: 'unknown_non_order', intentResult, normalizedText, reason: 'empty_input' };
  }

  if (TUTORIAL_PATTERNS.some((pattern) => pattern.test(patternText))) {
    return { classification: 'tutorial_request', intentResult, normalizedText: patternText, reason: 'tutorial_phrase' };
  }

  if (IDENTITY_PATTERNS.some((pattern) => pattern.test(patternText))) {
    return { classification: 'tutorial_request', intentResult, normalizedText: patternText, reason: 'identity_tutorial_phrase' };
  }

  const hasStockSignal = STOCK_PATTERNS.some((pattern) => pattern.test(patternText));
  const hasRecommendationSignal =
    RECOMMEND_ORDER_PATTERNS.some((pattern) => pattern.test(patternText)) ||
    MISSING_ITEM_CHECK_PATTERNS.some((pattern) => pattern.test(patternText));
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

  if (HISTORY_PATTERNS.some((pattern) => pattern.test(patternText))) {
    return { classification: 'history_request', intentResult, normalizedText, reason: 'history_phrase' };
  }

  if (SUGGESTION_PATTERNS.some((pattern) => pattern.test(patternText))) {
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

  if (normalizedText === 'clear' || normalizedText === 'clear order' || normalizedText === 'clear cart' || intentResult.intent === 'clear') {
    return { classification: 'clear_request', intentResult, normalizedText, reason: 'clear_command' };
  }

  if (intentResult.intent === 'confirm') {
    return { classification: 'confirm_request', intentResult, normalizedText, reason: 'confirm_command' };
  }

  if (intentResult.intent !== 'unknown') {
    return { classification: 'order_command', intentResult, normalizedText, reason: `${intentResult.intent}_command` };
  }

  if (CONVERSATIONAL_NON_ORDER_PATTERNS.some((pattern) => pattern.test(patternText))) {
    return { classification: 'unknown_non_order', intentResult, normalizedText, reason: 'conversational_non_order' };
  }

  const endsWithQuestionMark = /\?\s*$/.test(nfkcText.trim());
  const matchesProductQuestionPhrase = PRODUCT_QUESTION_PATTERNS.some((pattern) => pattern.test(patternText));
  const matchesQuestionStart = QUESTION_PATTERN.test(patternText);
  if (endsWithQuestionMark || matchesProductQuestionPhrase || matchesQuestionStart) {
    return {
      classification: 'product_question',
      intentResult,
      normalizedText,
      reason: matchesProductQuestionPhrase
        ? 'product_question_phrase'
        : endsWithQuestionMark
          ? 'question_mark_terminated'
          : 'question_word_lead',
    };
  }

  return { classification: 'order_entry', intentResult, normalizedText, reason: 'default_order_entry' };
}

function normalizeClassificationText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, '')
    .replace(/\s+/g, ' ');
}

function expandConversationalSlang(normalizedText: string): string {
  return normalizedText
    .replace(/\bu\b/g, 'you')
    .replace(/\bur\b/g, 'your')
    .replace(/\br\b/g, 'are')
    .replace(/\s+/g, ' ')
    .trim();
}
