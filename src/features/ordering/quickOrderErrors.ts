/**
 * User-facing error copy for Quick Order.
 *
 * Employees and managers must never see raw parser / LLM / JSON / stack-trace
 * text. Every string that could end up in the chat as an error pill or an
 * assistant reply is run through {@link toFriendlyQuickOrderError} first; the
 * technical detail is kept only in `console.warn` / the `errorCode` field for
 * debugging.
 */

/** Known error codes returned by the parse-order edge function. */
export const QUICK_ORDER_ERROR_MESSAGES: Record<string, string> = {
  feature_disabled: 'Quick Order is temporarily off — please use Browse.',
  rate_limit_user_daily: 'Daily limit reached. Switch to Browse or try tomorrow.',
  rate_limit_org_monthly: 'Monthly AI budget reached. Contact your manager.',
  ai_unavailable: 'Sorry, having trouble connecting. Please try again.',
  invalid_json: "I couldn't read that order. Try typing it again — one item per line.",
  parser_error: 'I had trouble processing that. Please try again.',
};

/** Generic fallback when nothing more specific is known. */
export const GENERIC_QUICK_ORDER_ERROR = 'Something went wrong. Please try again.';

/** Friendly copy for a parse failure where the text itself looked technical. */
const UNREADABLE_ORDER_MESSAGE =
  "I couldn't read that order. Try typing it again — one item per line.";

/**
 * Patterns that indicate a string is internal/technical and must not be shown.
 * Kept deliberately broad: a false positive just swaps in friendlier copy.
 */
const TECHNICAL_PATTERNS: RegExp[] = [
  /\bjson\b/i,
  /\bllm\b/i,
  /\bparse(r|d)?\b/i,
  /\bschema\b/i,
  /\bundefined\b|\bNaN\b|\bnull\b/,
  /\bexception\b/i,
  /\bstack\b/i,
  /\b(TypeError|SyntaxError|ReferenceError|RangeError)\b/,
  /Error:\s/,
  /\bat\s+\S+\s*\(/, // stack frame "at fn (file:line)"
  /^[[{]/, // raw JSON payload
  /https?:\/\/\S+\/functions\//i, // edge-function URLs
  /\bedge function\b/i,
];

function looksTechnical(value: string): boolean {
  return TECHNICAL_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Resolves the message to show the user.
 *
 * - If `code` matches a known error code, use that copy.
 * - Otherwise, if `rawText` is missing or looks technical, use a friendly,
 *   retryable fallback.
 * - Otherwise the parser produced its own user-safe copy — pass it through.
 */
export function toFriendlyQuickOrderError(rawText?: string | null, code?: string | null): string {
  if (code && QUICK_ORDER_ERROR_MESSAGES[code]) {
    return QUICK_ORDER_ERROR_MESSAGES[code];
  }

  const trimmed = typeof rawText === 'string' ? rawText.trim() : '';
  if (!trimmed) {
    return code ? GENERIC_QUICK_ORDER_ERROR : UNREADABLE_ORDER_MESSAGE;
  }
  if (looksTechnical(trimmed)) {
    return UNREADABLE_ORDER_MESSAGE;
  }
  return trimmed;
}

/**
 * Sanitises an assistant reply before it is rendered. Same rules as
 * {@link toFriendlyQuickOrderError} but with a caller-supplied fallback for the
 * common "we parsed something but the reply text is suspect" case.
 */
export function sanitizeAssistantReply(replyText?: string | null, fallback?: string): string {
  const trimmed = typeof replyText === 'string' ? replyText.trim() : '';
  if (!trimmed || looksTechnical(trimmed)) {
    return fallback ?? UNREADABLE_ORDER_MESSAGE;
  }
  return trimmed;
}
