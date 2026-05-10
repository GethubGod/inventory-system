/**
 * Deterministic intent detector for Quick Order commands.
 *
 * Runs **before** the item parser so the orchestrator can route
 * remove / replace / update / clear / confirm intents to dedicated
 * operation builders instead of the add-duplicate-detection path.
 *
 * Matching is case-insensitive and uses word boundaries. Longer phrases
 * are tested first so "take out" wins over a hypothetical "take" rule.
 */

export type QuickOrderIntent =
  | 'add'
  | 'remove'
  | 'replace'
  | 'update'
  | 'increase'
  | 'decrease'
  | 'clear'
  | 'confirm'
  | 'unknown';

export type IntentDetectionResult = {
  intent: QuickOrderIntent;
  confidence: number;
  /** Raw text with the command prefix/suffix stripped — ready for item parsing. */
  strippedText: string;
  /** The exact command phrase that matched, e.g. "remove", "take out". */
  matchedPhrase: string | null;
};

// ---------------------------------------------------------------------------
// Pattern groups — tested in declaration order (first match wins).
// Within each group, patterns are sorted longest-first automatically.
// ---------------------------------------------------------------------------

type IntentRule = {
  intent: QuickOrderIntent;
  confidence: number;
  patterns: string[];
};

const INTENT_RULES: IntentRule[] = [
  // Clear must be checked before remove to avoid "clear order" → remove
  {
    intent: 'clear',
    confidence: 0.98,
    patterns: [
      'clear order',
      'clear all',
      'empty order',
      'delete everything',
      'remove everything',
      'start over',
      'start fresh',
    ],
  },
  // Confirm
  {
    intent: 'confirm',
    confidence: 0.95,
    patterns: [
      'place order',
      'send order',
      'submit order',
      'confirm order',
      'confirm',
      "that's it",
      'thats it',
      'ready',
      'done',
    ],
  },
  // Remove
  {
    intent: 'remove',
    confidence: 0.96,
    patterns: [
      'remove from order',
      'delete from order',
      'do not include',
      "don't include",
      'get rid of',
      'cancel item',
      'take out',
      'take off',
      'no more',
      'remove',
      'delete',
      'drop',
    ],
  },
  // Replace
  {
    intent: 'replace',
    confidence: 0.94,
    patterns: [
      'replace with',
      'switch to',
      'replace',
      'switch',
    ],
  },
  // Update (change/set/make/actually/instead)
  {
    intent: 'update',
    confidence: 0.93,
    patterns: [
      'change to',
      'update to',
      'set to',
      'make it',
      'make that',
      'change',
      'update',
      'set',
      'make',
      'actually',
      'instead',
    ],
  },
  // Increase (explicit additive intent)
  {
    intent: 'increase',
    confidence: 0.92,
    patterns: [
      'add another',
      'also add',
      'add more',
      'need more',
      'plus',
      'more',
    ],
  },
  // Decrease
  {
    intent: 'decrease',
    confidence: 0.91,
    patterns: [
      'take away',
      'subtract',
      'decrease',
      'reduce',
      'lower',
      'minus',
    ],
  },
  // Explicit add (weaker than increase — no auto-add for duplicates in `unknown`)
  {
    intent: 'add',
    confidence: 0.85,
    patterns: [
      'include',
      'another',
      'order',
      'need',
      'add',
      'get',
    ],
  },
];

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Builds a regex that matches a pattern at the start of the string,
 * optionally preceded by "please". The pattern is escaped and word-boundary
 * terminated so "add" doesn't match "address".
 */
function buildLeadingRegex(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^(?:please\\s+)?${escaped}\\b\\s*`, 'i');
}

/**
 * Builds a regex that matches a pattern at the end of the string,
 * preceded by a word boundary.
 */
function buildTrailingRegex(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\s+${escaped}\\s*$`, 'i');
}

// Pre-compile all regexes once.
const COMPILED_RULES: {
  intent: QuickOrderIntent;
  confidence: number;
  phrase: string;
  leading: RegExp;
  trailing: RegExp;
  exact: RegExp;
}[] = [];

for (const rule of INTENT_RULES) {
  // Sort patterns longest-first for deterministic matching.
  const sorted = [...rule.patterns].sort((a, b) => b.length - a.length);
  for (const phrase of sorted) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    COMPILED_RULES.push({
      intent: rule.intent,
      confidence: rule.confidence,
      phrase,
      leading: buildLeadingRegex(phrase),
      trailing: buildTrailingRegex(phrase),
      exact: new RegExp(`^(?:please\\s+)?${escaped}\\s*$`, 'i'),
    });
  }
}

export function detectQuickOrderIntent(rawText: string): IntentDetectionResult {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { intent: 'unknown', confidence: 0, strippedText: '', matchedPhrase: null };
  }

  for (const rule of COMPILED_RULES) {
    // Check if the ENTIRE input is just a command (e.g. "clear order", "confirm").
    if (rule.exact.test(trimmed)) {
      return {
        intent: rule.intent,
        confidence: rule.confidence,
        strippedText: '',
        matchedPhrase: rule.phrase,
      };
    }

    // Check leading: "remove izumidai 2pk" → strippedText = "izumidai 2pk"
    const leadingMatch = trimmed.match(rule.leading);
    if (leadingMatch) {
      const stripped = trimmed.slice(leadingMatch[0].length).trim();
      // Only match if there's remaining text (otherwise it's an exact match handled above).
      if (stripped) {
        return {
          intent: rule.intent,
          confidence: rule.confidence,
          strippedText: stripped,
          matchedPhrase: rule.phrase,
        };
      }
    }

    // Check trailing: "izumidai 2pk instead" → strippedText = "izumidai 2pk"
    const trailingMatch = trimmed.match(rule.trailing);
    if (trailingMatch) {
      const stripped = trimmed.slice(0, trailingMatch.index).trim();
      if (stripped) {
        return {
          intent: rule.intent,
          confidence: rule.confidence,
          strippedText: stripped,
          matchedPhrase: rule.phrase,
        };
      }
    }
  }

  return { intent: 'unknown', confidence: 0.5, strippedText: trimmed, matchedPhrase: null };
}
