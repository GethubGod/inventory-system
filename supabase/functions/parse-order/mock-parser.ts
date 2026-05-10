// @ts-nocheck

type CatalogItem = {
  id: string;
  name: string;
  aliases: string[];
  default_unit: string | null;
};

type MockParsedItem = {
  item_id: string | null;
  item_name: string;
  raw_token: string;
  quantity: number | null;
  unit: string | null;
  confidence: number;
  needs_clarification: boolean;
  unresolved: boolean;
  notes: string | null;
};

type MockFlag = {
  type: string;
  message: string;
  raw_token?: string;
  item_id?: string;
  possible_matches?: Array<{ item_id: string; item_name: string }>;
  reason?: string;
};

type MockSuggestion = {
  item_id: string;
  item_name: string;
  suggested_qty: number;
  unit: string | null;
  unit_type: string | null;
  reason: string | null;
  confidence: number;
};

type MockParserInput = {
  raw_text: string;
  location_id: string;
  session_id: string | null;
  user_id: string;
  catalog: CatalogItem[];
  is_first_message: boolean;
};

type MockParserOutput = {
  reply_text: string;
  parsed_items: MockParsedItem[];
  flags: MockFlag[];
  suggestions: MockSuggestion[];
  session_state: {
    total_items: number;
    ready_to_submit: boolean;
  };
};

const UNIT_KEYWORDS: Record<string, string> = {
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
  pc: 'pc',
  pcs: 'pc',
  piece: 'pc',
  pieces: 'pc',
  case: 'case',
  cases: 'case',
  gallon: 'gallon',
  gallons: 'gallon',
  gal: 'gallon',
  pack: 'pack',
  packs: 'pack',
  tube: 'tube',
  tubes: 'tube',
  bag: 'bag',
  bags: 'bag',
  box: 'box',
  boxes: 'box',
};

const EDIT_KEYWORDS = ['make that', 'change to', 'actually', 'not ', 'instead'];
const QTY_PATTERN = /(\d+(?:\.\d+)?)/;

function randomDelay(): Promise<void> {
  const ms = 300 + Math.random() * 500;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tokenize(text: string): string[] {
  return text
    .split(/[,;\n]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function extractQuantity(token: string): { qty: number | null; remainder: string } {
  const match = token.match(QTY_PATTERN);
  if (!match) {
    return { qty: null, remainder: token };
  }

  const qty = parseFloat(match[1]);
  const remainder = token.replace(match[0], '').trim();
  return { qty: Number.isFinite(qty) && qty > 0 ? qty : null, remainder };
}

function extractUnit(token: string): { unit: string | null; remainder: string } {
  const words = token.toLowerCase().split(/\s+/);

  for (let i = words.length - 1; i >= 0; i--) {
    const normalized = UNIT_KEYWORDS[words[i]];
    if (normalized) {
      const remaining = [...words.slice(0, i), ...words.slice(i + 1)].join(' ').trim();
      return { unit: normalized, remainder: remaining || token };
    }
  }

  return { unit: null, remainder: token };
}

function matchCatalog(
  searchText: string,
  catalog: CatalogItem[],
): { matches: CatalogItem[]; matchType: 'exact_alias' | 'substring' | 'none' } {
  const needle = searchText.toLowerCase().trim();
  if (!needle) return { matches: [], matchType: 'none' };

  const exactAliasMatches = catalog.filter((item) =>
    item.aliases.some((alias) => alias.toLowerCase() === needle),
  );
  if (exactAliasMatches.length === 1) {
    return { matches: exactAliasMatches, matchType: 'exact_alias' };
  }
  if (exactAliasMatches.length > 1) {
    return { matches: exactAliasMatches, matchType: 'exact_alias' };
  }

  const substringMatches = catalog.filter(
    (item) =>
      item.name.toLowerCase().includes(needle) ||
      needle.includes(item.name.toLowerCase()) ||
      item.aliases.some(
        (alias) =>
          alias.toLowerCase().includes(needle) || needle.includes(alias.toLowerCase()),
      ),
  );

  if (substringMatches.length > 0) {
    return { matches: substringMatches, matchType: 'substring' };
  }

  return { matches: [], matchType: 'none' };
}

function isEditIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return EDIT_KEYWORDS.some((keyword) => lower.includes(keyword));
}

export async function runMockParser(input: MockParserInput): Promise<MockParserOutput> {
  await randomDelay();

  const tokens = tokenize(input.raw_text);
  const parsedItems: MockParsedItem[] = [];
  const flags: MockFlag[] = [];
  const suggestions: MockSuggestion[] = [];

  const hasEditIntent = isEditIntent(input.raw_text);

  for (const token of tokens) {
    const { qty, remainder: afterQty } = extractQuantity(token);
    const { unit: extractedUnit, remainder: searchText } = extractUnit(afterQty);
    const { matches, matchType } = matchCatalog(searchText || token, input.catalog);

    if (matches.length === 1) {
      const item = matches[0];
      const unit = extractedUnit ?? item.default_unit;
      const missingQty = qty === null;

      parsedItems.push({
        item_id: item.id,
        item_name: item.name,
        raw_token: token,
        quantity: qty,
        unit,
        confidence: matchType === 'exact_alias' ? 0.95 : 0.85,
        needs_clarification: missingQty || !unit,
        unresolved: false,
        notes: hasEditIntent ? 'edit_intent' : null,
      });

      if (missingQty) {
        flags.push({
          type: 'missing_quantity',
          message: `How many ${item.name}?`,
          raw_token: token,
          item_id: item.id,
          reason: 'qty_missing',
        });
      }
    } else if (matches.length > 1) {
      const bestMatch = matches[0];
      parsedItems.push({
        item_id: null,
        item_name: searchText || token,
        raw_token: token,
        quantity: qty,
        unit: extractedUnit,
        confidence: 0.4,
        needs_clarification: true,
        unresolved: true,
        notes: null,
      });

      flags.push({
        type: 'unresolved_item',
        message: `"${searchText || token}" could match multiple items. Which did you mean?`,
        raw_token: token,
        possible_matches: matches.map((m) => ({ item_id: m.id, item_name: m.name })),
        reason: 'ambiguous',
      });
    } else {
      parsedItems.push({
        item_id: null,
        item_name: searchText || token,
        raw_token: token,
        quantity: qty,
        unit: extractedUnit,
        confidence: 0.1,
        needs_clarification: true,
        unresolved: true,
        notes: null,
      });

      flags.push({
        type: 'unresolved_item',
        message: `I couldn't find "${searchText || token}" in the catalog.`,
        raw_token: token,
        reason: 'no_match',
      });
    }
  }

  // ~10% chance: artificially mark one resolved item as ambiguous (for UI testing)
  if (Math.random() < 0.1) {
    const resolvedItems = parsedItems.filter((item) => item.item_id && !item.unresolved);
    if (resolvedItems.length > 0) {
      const targetIdx = Math.floor(Math.random() * resolvedItems.length);
      const target = resolvedItems[targetIdx];

      // Find another catalog item to create fake ambiguity
      const otherItems = input.catalog.filter((c) => c.id !== target.item_id);
      if (otherItems.length > 0) {
        const other = otherItems[Math.floor(Math.random() * otherItems.length)];
        flags.push({
          type: 'unresolved_item',
          message: `Did you mean "${target.item_name}" or "${other.name}"?`,
          raw_token: target.raw_token,
          possible_matches: [
            { item_id: target.item_id!, item_name: target.item_name },
            { item_id: other.id, item_name: other.name },
          ],
          reason: 'ambiguous',
        });
      }
    }
  }

  // Generate 1-3 suggestions on first message only
  if (input.is_first_message && input.catalog.length > 0) {
    const parsedItemIds = new Set(
      parsedItems.map((item) => item.item_id).filter(Boolean),
    );

    const available = input.catalog.filter((item) => !parsedItemIds.has(item.id));
    const suggestionCount = Math.min(1 + Math.floor(Math.random() * 3), available.length);

    const shuffled = [...available].sort(() => Math.random() - 0.5);
    for (let i = 0; i < suggestionCount; i++) {
      const item = shuffled[i];
      suggestions.push({
        item_id: item.id,
        item_name: item.name,
        suggested_qty: Math.ceil(Math.random() * 5),
        unit: item.default_unit,
        unit_type: null,
        reason: 'Usually ordered on this day',
        confidence: 0.6 + Math.random() * 0.2,
      });
    }
  }

  const confirmedCount = parsedItems.filter(
    (item) => !item.needs_clarification && !item.unresolved,
  ).length;
  const flagCount = flags.length;
  const readyToSubmit = parsedItems.length > 0 && flagCount === 0;

  let replyText: string;
  if (parsedItems.length === 0) {
    replyText = "I didn't catch any items. Try something like \"salmon 2, tuna 3\".";
  } else if (flagCount === 0) {
    replyText =
      confirmedCount === 1
        ? 'Got this item.'
        : `Got ${confirmedCount} items.`;
  } else {
    replyText = `Got ${confirmedCount} item${confirmedCount !== 1 ? 's' : ''}, but ${flagCount} need${flagCount === 1 ? 's' : ''} a closer look.`;
  }

  return {
    reply_text: replyText,
    parsed_items: parsedItems,
    flags,
    suggestions,
    session_state: {
      total_items: parsedItems.length,
      ready_to_submit: readyToSubmit,
    },
  };
}
