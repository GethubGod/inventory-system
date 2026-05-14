import { detectQuickOrderIntent, type IntentDetectionResult } from './intent-detector.ts';

export type QuickOrderInputClassification =
  | 'order_entry'
  | 'order_command'
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
  /\bwhat should i order\b/i,
  /\brecommend\b/i,
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

  if (SUGGESTION_PATTERNS.some((pattern) => pattern.test(nfkcText))) {
    return { classification: 'suggestion_request', intentResult, normalizedText, reason: 'suggestion_phrase' };
  }

  if (HISTORY_PATTERNS.some((pattern) => pattern.test(nfkcText))) {
    return { classification: 'history_request', intentResult, normalizedText, reason: 'history_phrase' };
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
