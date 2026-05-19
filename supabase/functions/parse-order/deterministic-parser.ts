import type { CandidateParsedLine } from './types.ts';
import { getUnitWords, normalizeUnit } from './units.ts';

// ---------------------------------------------------------------------------
// Quantity patterns — supports numeric, fractional, and word quantities
// ---------------------------------------------------------------------------

/** Regex fragment matching a numeric quantity: 2, 0.5, .5 */
const NUMERIC_QTY = String.raw`(\d+(?:\.\d+)?|\.\d+)`;

/** Fraction patterns: 1/2, 3/4, etc. */
const FRACTION_QTY = String.raw`(\d+\s*/\s*\d+)`;

/** Word-to-number mapping for common quantities. */
const WORD_QUANTITIES: Record<string, number> = {
  half: 0.5,
  'half a': 0.5,
  'a half': 0.5,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  dozen: 12,
  'a': 1,
};

/** Sorted word quantity keys, longest-first so "half a" matches before "half". */
const WORD_QTY_KEYS = Object.keys(WORD_QUANTITIES).sort((a, b) => b.length - a.length);

// ---------------------------------------------------------------------------
// Unit patterns
// ---------------------------------------------------------------------------

const QTY_ONLY = new RegExp(`\\b(?:${NUMERIC_QTY}|${FRACTION_QTY})\\b`, 'i');

function escapedUnitPattern(): string {
  return getUnitWords().map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
}

function qtyUnitRegex(): RegExp {
  return new RegExp(`(?:${NUMERIC_QTY}|${FRACTION_QTY})\\s*(${escapedUnitPattern()})\\b`, 'i');
}

function qtyUnitOnlyRegex(): RegExp {
  return new RegExp(`^\\s*(?:${NUMERIC_QTY}|${FRACTION_QTY})\\s*(${escapedUnitPattern()})\\s*$`, 'i');
}

function unitOnlyRegex(): RegExp {
  return new RegExp(`^\\s*(${escapedUnitPattern()})\\s*$`, 'i');
}

function wordQtyUnitOnlyRegex(): RegExp {
  return new RegExp(`^\\s*(${WORD_QTY_PATTERN})\\s+(${escapedUnitPattern()})\\s*$`, 'i');
}

function qtyUnitOfItemRegex(): RegExp {
  return new RegExp(
    `^\\s*(?:${NUMERIC_QTY}|${FRACTION_QTY})\\s*(${escapedUnitPattern()})\\s+(?:of\\s+)(.+)$`,
    'i',
  );
}

function wordQtyUnitOfItemRegex(): RegExp {
  return new RegExp(
    `^\\s*(${WORD_QTY_PATTERN})\\s+(${escapedUnitPattern()})\\s+(?:of\\s+)(.+)$`,
    'i',
  );
}

function wordQtyUnitItemNoOfRegex(): RegExp {
  return new RegExp(
    `^\\s*(${WORD_QTY_PATTERN})\\s+(${escapedUnitPattern()})\\s+(.+)$`,
    'i',
  );
}

function qtyUnitItemNoOfRegex(): RegExp {
  return new RegExp(
    `^\\s*(?:${NUMERIC_QTY}|${FRACTION_QTY})\\s*(${escapedUnitPattern()})\\s+(.+)$`,
    'i',
  );
}

function itemQtyUnitRegex(): RegExp {
  return new RegExp(
    `^(.+?)\\s+(?:${NUMERIC_QTY}|${FRACTION_QTY})\\s*(${escapedUnitPattern()})\\s*$`,
    'i',
  );
}

function itemWordQtyUnitRegex(): RegExp {
  return new RegExp(
    `^(.+?)\\s+(${WORD_QTY_PATTERN})\\s+(${escapedUnitPattern()})\\s*$`,
    'i',
  );
}

// ---------------------------------------------------------------------------
// Intent stripping
// ---------------------------------------------------------------------------

const LEADING_INTENT = /^(?:please\s+)?(?:(?:add(?:\s+more|\s+another)?|also(?:\s+add)?|plus|another|need(?:\s+more)?|change(?:\s+to)?|make(?:\s+it|\s+that)?|replace|actually|update(?:\s+to)?|set(?:\s+to)?|remove|delete|take\s+out|take\s+off|get\s+rid\s+of|drop|cancel\s+item|subtract|reduce|lower|decrease|minus|take\s+away)\s+)/i;
const TRAILING_INTENT = /\s+(?:to|instead)$/i;

// ---------------------------------------------------------------------------
// "qty unit of item" pattern: "1 box of crab mix", "half box of ground tuna"
// ---------------------------------------------------------------------------

// Build word-qty leading regex for "half box of crab mix", "half a box of ..."
const WORD_QTY_REGEX_PARTS = WORD_QTY_KEYS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const WORD_QTY_PATTERN = WORD_QTY_REGEX_PARTS.join('|');

// "item qty" — e.g. "salmon 2", "tuna loin 1"
const ITEM_QTY = new RegExp(
  `^(.+?)\\s+(?:${NUMERIC_QTY}|${FRACTION_QTY})\\s*$`,
  'i',
);

// "qty item" — e.g. "2 salmon", "6 shrimp ebi"
const QTY_ITEM = new RegExp(
  `^\\s*(?:${NUMERIC_QTY}|${FRACTION_QTY})\\s+(.+)$`,
  'i',
);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function normalizeOrderText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim().replace(/[ \t]+/g, ' ').toLowerCase())
    .join('\n')
    .trim();
}

function hasQuantitySignal(value: string): boolean {
  return qtyUnitRegex().test(value) || QTY_ONLY.test(value);
}

function splitSafeAnd(segment: string): string[] {
  const parts = segment.split(/\s+\band\b\s+/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return [segment];
  return parts.every(hasQuantitySignal) ? parts : [segment];
}

export function splitOrderLines(rawText: string): string[] {
  const primary = rawText
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .split(/\n|,|;/)
    .map((line) => line.trim().replace(/[ \t]+/g, ' '))
    .filter(Boolean);

  return primary.flatMap(splitSafeAnd);
}

function cleanItemText(value: string): string {
  let next = value.trim().replace(/[ \t]+/g, ' ');
  let previous = '';
  while (next !== previous) {
    previous = next;
    next = next.replace(LEADING_INTENT, '').replace(TRAILING_INTENT, '').trim();
  }
  return next;
}

/**
 * Converts a raw quantity string to a number.
 * Supports: "2", "0.5", ".5", "1/2", "3/4"
 */
function toQuantity(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();

  // Fraction: "1/2", "3/4"
  const fractionMatch = trimmed.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fractionMatch) {
    const numerator = Number(fractionMatch[1]);
    const denominator = Number(fractionMatch[2]);
    if (denominator > 0) {
      const result = numerator / denominator;
      return Number.isFinite(result) && result > 0 ? result : null;
    }
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Looks for a word quantity at the start of the text.
 * Returns [quantity, remaining_text] or null.
 */
function extractWordQuantity(text: string): [number, string] | null {
  const lower = text.toLowerCase().trim();
  for (const word of WORD_QTY_KEYS) {
    if (lower.startsWith(word + ' ') || lower === word) {
      const remaining = text.trim().slice(word.length).trim();
      return [WORD_QUANTITIES[word], remaining];
    }
  }
  return null;
}

export function parseDeterministicOrder(rawText: string): CandidateParsedLine[] {
  const lines = splitOrderLines(rawText);
  return lines.map((rawLine, index) => parseLine(rawLine, index));
}

function parseLine(rawLine: string, index: number): CandidateParsedLine {
  const compactRaw = normalizeAdditiveQuantityText(rawLine.trim().replace(/[ \t]+/g, ' '));
  const normalized = compactRaw.toLowerCase();
  let itemText = compactRaw;
  let quantity: number | null = null;
  let unit: string | null = null;
  let unitRaw: string | null = null;
  let confidence = 0.55;

  // ---------------------------------------------------------------
  // Pattern 0: follow-up quantity/unit only — "4cs", "4 cases".
  // The orchestrator can attach a recent target item if context is clear.
  // ---------------------------------------------------------------
  const numQtyUnitOnly = compactRaw.match(qtyUnitOnlyRegex());
  if (numQtyUnitOnly) {
    quantity = toQuantity(numQtyUnitOnly[1] ?? numQtyUnitOnly[2]);
    unitRaw = numQtyUnitOnly[3];
    unit = normalizeUnit(unitRaw) ?? unitRaw.toLowerCase();
    itemText = '';
    confidence = 0.92;
  }

  if (quantity == null) {
    const wordQtyUnitOnly = compactRaw.match(wordQtyUnitOnlyRegex());
    if (wordQtyUnitOnly) {
      const wordQty = WORD_QUANTITIES[wordQtyUnitOnly[1].toLowerCase()];
      if (wordQty != null) {
        quantity = wordQty;
        unitRaw = wordQtyUnitOnly[2];
        unit = normalizeUnit(unitRaw) ?? unitRaw.toLowerCase();
        itemText = '';
        confidence = 0.86;
      }
    }
  }

  if (quantity == null) {
    const unitOnly = compactRaw.match(unitOnlyRegex());
    if (unitOnly) {
      unitRaw = unitOnly[1];
      unit = normalizeUnit(unitRaw) ?? unitRaw.toLowerCase();
      itemText = '';
      confidence = 0.86;
    }
  }

  if (quantity == null && unit == null) {
    const quantityOnly = compactRaw.match(new RegExp(`^\\s*(?:${NUMERIC_QTY}|${FRACTION_QTY})\\s*$`, 'i'));
    if (quantityOnly) {
      quantity = toQuantity(quantityOnly[1] ?? quantityOnly[2]);
      itemText = '';
      confidence = 0.82;
    }
  }

  if (quantity == null && unit == null) {
    const wordQtyOnly = extractWordQuantity(compactRaw);
    if (wordQtyOnly && !wordQtyOnly[1]) {
      quantity = wordQtyOnly[0];
      itemText = '';
      confidence = 0.78;
    }
  }

  // ---------------------------------------------------------------
  // Pattern 1: "qty unit of item" — "1 box of crab mix", "half box of ground tuna"
  // ---------------------------------------------------------------
  const wordQtyUnitOf = quantity == null ? compactRaw.match(wordQtyUnitOfItemRegex()) : null;
  if (wordQtyUnitOf) {
    const wordQty = WORD_QUANTITIES[wordQtyUnitOf[1].toLowerCase()];
    if (wordQty != null) {
      quantity = wordQty;
      unitRaw = wordQtyUnitOf[2];
      unit = normalizeUnit(unitRaw) ?? unitRaw.toLowerCase();
      itemText = wordQtyUnitOf[3];
      confidence = 0.90;
    }
  }

  if (quantity == null) {
    const numQtyUnitOf = compactRaw.match(qtyUnitOfItemRegex());
    if (numQtyUnitOf) {
      quantity = toQuantity(numQtyUnitOf[1] ?? numQtyUnitOf[2]);
      unitRaw = numQtyUnitOf[3];
      unit = normalizeUnit(unitRaw) ?? unitRaw.toLowerCase();
      itemText = numQtyUnitOf[4];
      confidence = 0.92;
    }
  }

  // ---------------------------------------------------------------
  // Pattern 2: "qty unit item" (no "of") — "2cs salmon"
  // ---------------------------------------------------------------
  if (quantity == null) {
    const qtyUnitItem = compactRaw.match(qtyUnitItemNoOfRegex());
    if (qtyUnitItem) {
      quantity = toQuantity(qtyUnitItem[1] ?? qtyUnitItem[2]);
      unitRaw = qtyUnitItem[3];
      unit = normalizeUnit(unitRaw) ?? unitRaw.toLowerCase();
      itemText = qtyUnitItem[4];
      confidence = 0.92;
    }
  }

  if (quantity == null) {
    const wordQtyUnitItem = compactRaw.match(wordQtyUnitItemNoOfRegex());
    if (wordQtyUnitItem) {
      const wordQty = WORD_QUANTITIES[wordQtyUnitItem[1].toLowerCase()];
      if (wordQty != null) {
        quantity = wordQty;
        unitRaw = wordQtyUnitItem[2];
        unit = normalizeUnit(unitRaw) ?? unitRaw.toLowerCase();
        itemText = wordQtyUnitItem[3];
        confidence = 0.88;
      }
    }
  }

  // ---------------------------------------------------------------
  // Pattern 3: "item qty unit" — "salmon 2cs", "ground garlic 1 pack"
  // ---------------------------------------------------------------
  if (quantity == null) {
    const itemQtyUnit = compactRaw.match(itemQtyUnitRegex());
    if (itemQtyUnit) {
      itemText = itemQtyUnit[1];
      quantity = toQuantity(itemQtyUnit[2] ?? itemQtyUnit[3]);
      unitRaw = itemQtyUnit[4];
      unit = normalizeUnit(unitRaw) ?? unitRaw.toLowerCase();
      confidence = 0.92;
    }
  }

  if (quantity == null) {
    const itemWordQtyUnit = compactRaw.match(itemWordQtyUnitRegex());
    if (itemWordQtyUnit) {
      const wordQty = WORD_QUANTITIES[itemWordQtyUnit[2].toLowerCase()];
      if (wordQty != null) {
        itemText = itemWordQtyUnit[1];
        quantity = wordQty;
        unitRaw = itemWordQtyUnit[3];
        unit = normalizeUnit(unitRaw) ?? unitRaw.toLowerCase();
        confidence = 0.88;
      }
    }
  }

  // ---------------------------------------------------------------
  // Pattern 4: "qty item" — "2 salmon", "6 shrimp ebi"
  // ---------------------------------------------------------------
  if (quantity == null) {
    const qtyItem = compactRaw.match(QTY_ITEM);
    if (qtyItem) {
      quantity = toQuantity(qtyItem[1] ?? qtyItem[2]);
      itemText = qtyItem[3];
      confidence = 0.78;
    }
  }

  // ---------------------------------------------------------------
  // Pattern 5: "item qty" — "salmon 2"
  // ---------------------------------------------------------------
  if (quantity == null) {
    const itemQty = compactRaw.match(ITEM_QTY);
    if (itemQty) {
      itemText = itemQty[1];
      quantity = toQuantity(itemQty[2] ?? itemQty[3]);
      confidence = 0.74;
    }
  }

  // "item qty unknown-unit" — "Salmon 2 bottle".
  if (quantity == null) {
    const itemQtyUnknownUnit = compactRaw.match(/^(.+?)\s+(\d+(?:\.\d+)?|\.\d+|\d+\s*\/\s*\d+)\s+([\p{L}][\p{L}\p{N}'-]*)\s*$/iu);
    if (itemQtyUnknownUnit) {
      itemText = itemQtyUnknownUnit[1];
      quantity = toQuantity(itemQtyUnknownUnit[2]);
      unitRaw = itemQtyUnknownUnit[3];
      unit = normalizeUnit(unitRaw) ?? unitRaw.toLowerCase();
      confidence = 0.72;
    }
  }

  // ---------------------------------------------------------------
  // Pattern 6: "word-qty item" — "half salmon"
  // ---------------------------------------------------------------
  if (quantity == null) {
    const wordQty = extractWordQuantity(compactRaw);
    if (wordQty && wordQty[1]) {
      quantity = wordQty[0];
      itemText = wordQty[1];
      confidence = 0.70;
    }
  }

  // ---------------------------------------------------------------
  // Final: item-only (no quantity or unit found)
  // ---------------------------------------------------------------
  // If still nothing matched, itemText is the full normalized line.

  // Try to extract unit from item text if we missed it.
  if (!unit && quantity != null) {
    const unitSuffix = compactRaw.match(qtyUnitRegex());
    if (unitSuffix) {
      unitRaw = unitSuffix[3] ?? unitSuffix[2];
      unit = normalizeUnit(unitRaw) ?? unitRaw.toLowerCase();
    }
  }

  itemText = cleanItemText(itemText);
  const issue = !itemText
    ? 'missing_item'
    : quantity == null
      ? 'missing_quantity'
      : unit == null
        ? 'missing_unit'
        : undefined;

  return {
    line_id: `line_${index}`,
    raw_text: rawLine,
    normalized_text: normalized,
    item_text: itemText,
    quantity,
    unit,
    unit_raw: unitRaw,
    unit_normalized: normalizeUnit(unit),
    parse_source: 'deterministic',
    parse_confidence: issue ? Math.min(confidence, 0.65) : confidence,
    line_index: index,
    issue,
  };
}

function normalizeAdditiveQuantityText(value: string): string {
  return value
    .replace(
      /^(\d+(?:\.\d+)?|\.\d+|\d+\s*\/\s*\d+)\s+more\s+/i,
      '$1 ',
    )
    .replace(
      new RegExp(`^(${WORD_QTY_PATTERN})\\s+more\\s+`, 'i'),
      '$1 ',
    )
    .trim();
}
