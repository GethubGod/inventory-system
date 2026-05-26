// Pure text helpers for the parse-order entrypoint. Kept in their own module so
// they can be unit-tested without importing index.ts (which calls Deno.serve at
// module load and cannot run under jest).

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Removes configured "ignore" phrases (from qo_keywords) from the raw message.
 *
 * CRITICAL: this MUST preserve newlines. A multi-line order or inventory list is
 * parsed line-by-line downstream, so collapsing all whitespace (`\s+`, which
 * includes "\n") into single spaces flattens the entire list into one line —
 * every line after the first is lost and the message becomes unparseable,
 * producing a blanket "I'm not sure what you want" reply for an otherwise valid
 * order. We therefore collapse only horizontal whitespace (spaces/tabs) and
 * tidy blank lines, keeping the line structure intact.
 */
export function stripIgnoredQuickOrderPhrases(message: string, phrases: string[]): string {
  let result = message;
  for (const phrase of phrases) {
    const trimmed = phrase.trim();
    if (!trimmed) continue;
    result = result.replace(new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, 'gi'), ' ');
  }
  return result
    .replace(/[^\S\n]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
