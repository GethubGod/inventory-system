export type VoiceOrderActionForFormatting = {
  type: string;
  itemName?: string | null;
  matchedItemId?: string | null;
  spokenItemText?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
  remainingQuantity?: number | string | null;
  remainingUnit?: string | null;
  confidence?: number | null;
};

export type VoiceCatalogItemForFormatting = {
  id: string;
  name: string;
};

export type VoiceTextFormatResult = {
  text: string;
  lines: string[];
  safeLineCount: number;
};

const WORD_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
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
};

const WORD_FRACTIONS: Record<string, number> = {
  half: 0.5,
  halves: 0.5,
  quarter: 0.25,
  quarters: 0.25,
};

function cleanText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.;:!?])$/g, '$1')
    .replace(/[,.;:!?]+$/g, '')
    .trim();
}

function formatDecimal(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(3))).replace(/\.?0+$/, '');
}

function parseFraction(value: string): number | null {
  const match = value.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

export function normalizeVoiceQuantity(value: number | string | null | undefined): string | null {
  if (typeof value === 'number') return formatDecimal(value);
  const raw = cleanText(value).toLowerCase();
  if (!raw) return null;

  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return formatDecimal(numeric);

  const numericMixed = raw.match(/^(\d+(?:\.\d+)?)\s+(?:and\s+)?(\d+\s*\/\s*\d+)$/);
  if (numericMixed) {
    const whole = Number(numericMixed[1]);
    const fraction = parseFraction(numericMixed[2]);
    return fraction == null ? null : formatDecimal(whole + fraction);
  }

  const fraction = parseFraction(raw);
  if (fraction != null) return formatDecimal(fraction);

  const wordMixed = raw.match(/^([a-z]+|\d+(?:\.\d+)?)\s+and\s+(?:a\s+|an\s+|one\s+)?(half|quarter)$/);
  if (wordMixed) {
    const whole = Number(wordMixed[1]);
    const wholeValue = Number.isFinite(whole) ? whole : WORD_NUMBERS[wordMixed[1]];
    const fractionValue = WORD_FRACTIONS[wordMixed[2]];
    return wholeValue == null || fractionValue == null ? null : formatDecimal(wholeValue + fractionValue);
  }

  const wordValue = WORD_NUMBERS[raw] ?? WORD_FRACTIONS[raw];
  return wordValue == null ? null : formatDecimal(wordValue);
}

export function normalizeVoiceUnit(value: string | null | undefined): string | null {
  const raw = cleanText(value).toLowerCase().replace(/\.$/, '');
  if (!raw) return null;
  const compactUnits: Record<string, string> = {
    case: 'cs',
    cases: 'cs',
    pound: 'lb',
    pounds: 'lb',
    lbs: 'lb',
    ounce: 'oz',
    ounces: 'oz',
  };
  return compactUnits[raw] ?? raw;
}

function catalogNameForAction(
  action: VoiceOrderActionForFormatting,
  catalogById: Map<string, VoiceCatalogItemForFormatting>,
): string | null {
  if (!action.matchedItemId || (action.confidence ?? 0) < 0.65) return null;
  return catalogById.get(action.matchedItemId)?.name ?? null;
}

function itemTextForAction(
  action: VoiceOrderActionForFormatting,
  catalogById: Map<string, VoiceCatalogItemForFormatting>,
): string | null {
  return cleanText(
    catalogNameForAction(action, catalogById) ??
    action.itemName ??
    action.spokenItemText,
  ) || null;
}

function formatQuantityLine(itemName: string, quantity: string | null, unit: string | null): string {
  return [itemName, quantity, unit].filter((part): part is string => Boolean(part)).join(' ');
}

function isSafeCatalogLine(action: VoiceOrderActionForFormatting): boolean {
  return Boolean(action.matchedItemId && (action.confidence ?? 0) >= 0.65);
}

export function formatQuickOrderVoiceText(input: {
  actions: VoiceOrderActionForFormatting[];
  catalog: VoiceCatalogItemForFormatting[];
}): VoiceTextFormatResult {
  const catalogById = new Map(input.catalog.map((item) => [item.id, item]));
  const lines: string[] = [];
  let safeLineCount = 0;

  for (const action of input.actions) {
    const itemName = itemTextForAction(action, catalogById);
    if (!itemName) continue;

    if (action.type === 'remove') {
      lines.push(`remove ${itemName}`);
      if (isSafeCatalogLine(action)) safeLineCount += 1;
      continue;
    }

    if (
      action.type !== 'order' &&
      action.type !== 'update_quantity' &&
      action.type !== 'inventory_remaining' &&
      action.type !== 'unknown' &&
      action.type !== 'needs_input'
    ) {
      continue;
    }

    const quantity = normalizeVoiceQuantity(
      action.type === 'inventory_remaining'
        ? action.remainingQuantity ?? action.quantity
        : action.quantity,
    );
    const unit = normalizeVoiceUnit(
      action.type === 'inventory_remaining'
        ? action.remainingUnit ?? action.unit
        : action.unit,
    );
    const line = formatQuantityLine(itemName, quantity, unit);
    if (!line) continue;
    lines.push(line);
    if (isSafeCatalogLine(action)) safeLineCount += 1;
  }

  const dedupedLines = [...new Set(lines)];
  return {
    text: dedupedLines.join('\n'),
    lines: dedupedLines,
    safeLineCount,
  };
}
