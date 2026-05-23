import { matchCatalogItem } from './catalog-matcher.ts';
import { parseDeterministicOrder } from './deterministic-parser.ts';
import { DEFAULT_UNIT_ALIASES, getUnitWords, normalizeUnitForComparison, type UnitAliasMap } from './units.ts';
import type {
  CatalogItem,
  EmployeeQuickOrderAlias,
  InventoryStatusItem,
  InventoryStatusTerm,
  ParserCorrection,
  QuickOrderSource,
  StockOperation,
} from './types.ts';

export type StockUpdateExtraction = {
  stockUpdates: StockOperation[];
  statusItems: InventoryStatusItem[];
  stockSegments: string[];
  remainingText: string;
  hasStockSignal: boolean;
};

const STOCK_SIGNAL =
  /\b(?:we have|i have|if i have|if we have|have|has|left|remaining|on hand|current stock|counted|out of|no|is at|are at|low on|almost at|around|about)\b/i;

const NUMBER_WORDS: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
  seventeen: '17',
  eighteen: '18',
  nineteen: '19',
  twenty: '20',
};

export function extractStockUpdates(input: {
  message: string;
  source: QuickOrderSource;
  catalog: CatalogItem[];
  corrections: ParserCorrection[];
  catalogIndex?: import('./catalog-search-index.ts').CatalogSearchIndex;
  unitAliases?: import('./units.ts').UnitAliasMap;
  statusTerms?: InventoryStatusTerm[];
  employeeAliases?: EmployeeQuickOrderAlias[];
  locationId?: string | null;
  assumeStock?: boolean;
}): StockUpdateExtraction {
  const hasStockSignal = input.assumeStock === true || STOCK_SIGNAL.test(input.message);
  if (!hasStockSignal) {
    return { stockUpdates: [], statusItems: [], stockSegments: [], remainingText: input.message, hasStockSignal: false };
  }

  const segments = splitStockSegments(input.message);
  const stockUpdates: StockOperation[] = [];
  const statusItems: InventoryStatusItem[] = [];
  const stockSegments: string[] = [];
  const nonStockSegments: string[] = [];

  for (const segment of segments) {
    const statusParsed = parseStatusSegment(segment, input);
    if (statusParsed) {
      statusItems.push(statusParsed.statusItem);
      if (statusParsed.stockUpdate) stockUpdates.push(statusParsed.stockUpdate);
      stockSegments.push(segment);
      continue;
    }

    const parsed = parseStockSegment(segment, input);
    if (!parsed) {
      if (!looksLikeStockHeader(segment)) nonStockSegments.push(segment);
      continue;
    }
    stockUpdates.push(parsed);
    stockSegments.push(segment);
  }

  return {
    stockUpdates: dedupeStockUpdates(stockUpdates),
    statusItems: dedupeStatusItems(statusItems),
    stockSegments,
    remainingText: nonStockSegments.join(', ').trim(),
    hasStockSignal,
  };
}

function parseStockSegment(
  segment: string,
  input: {
    source: QuickOrderSource;
    catalog: CatalogItem[];
    corrections: ParserCorrection[];
    catalogIndex?: import('./catalog-search-index.ts').CatalogSearchIndex;
    unitAliases?: UnitAliasMap;
    employeeAliases?: EmployeeQuickOrderAlias[];
    locationId?: string | null;
  },
): StockOperation | null {
  const trimmed = segment.trim();
  if (!trimmed) return null;

  const zeroMatch = trimmed.match(/\b(?:out of|no)\s+(.+)$/i);
  if (zeroMatch) {
    const itemText = cleanItemTail(zeroMatch[1]);
    return buildStockOperation({
      itemText,
      quantity: 0,
      unit: null,
      originalText: trimmed,
      input,
      confidence: 0.92,
    });
  }

  const lowMatch = trimmed.match(/\blow on\s+(.+)$/i);
  if (lowMatch) {
    const itemText = cleanItemTail(lowMatch[1]);
    return buildStockOperation({
      itemText,
      quantity: 0,
      unit: null,
      originalText: trimmed,
      input,
      confidence: 0.72,
      approximateModifier: 'low',
    });
  }

  let normalized = normalizeStockPhrase(trimmed);
  const inferredQuestion = inferStockFromRecommendationQuestion(normalized);
  if (inferredQuestion) normalized = inferredQuestion;
  const hasForm = normalized.match(/^(.+?)\s+has\s+(.+)$/i);
  if (hasForm) normalized = `${hasForm[2]} ${hasForm[1]}`;
  const currentForm = normalized.match(/^current\s+(.+?)\s+(?:is|are)\s+(.+)$/i);
  if (currentForm) normalized = `${currentForm[2]} ${currentForm[1]}`;
  const atForm = normalized.match(/^(.+?)\s+(?:is|are)\s+at\s+(.+)$/i);
  if (atForm) normalized = `${atForm[2]} ${atForm[1]}`;
  normalized = replaceNumberWords(normalized);
  normalized = normalized
    .replace(/\b(\d+)\s+and\s+a\s+half\b/gi, (_, whole) => `${whole}.5`)
    .replace(/\ba\s+half\b/gi, '0.5')
    .replace(/\bhalf\b/gi, '0.5');

  const unitAliases = input.unitAliases ?? DEFAULT_UNIT_ALIASES;
  const candidates = parseDeterministicOrder(normalized, unitAliases);
  const candidate = candidates[0];
  if (!candidate || candidate.quantity == null) return null;

  return buildStockOperation({
    itemText: candidate.item_text,
    quantity: candidate.quantity,
    unit: candidate.unit,
    originalText: trimmed,
    input,
    confidence: candidate.parse_confidence,
    approximateModifier: detectApproximateModifier(trimmed),
  });
}

function inferStockFromRecommendationQuestion(value: string): string | null {
  const match = value.match(/\bhow\s+much\s+(.+?)\s+should\s+(?:i|we)\s+order\s+if\s+(?:i|we)\s+have\s+(.+)$/i);
  if (!match) return null;
  return `${match[2]} ${match[1]}`;
}

function buildStockOperation(input: {
  itemText: string;
  quantity: number;
  unit: string | null;
  originalText: string;
  confidence: number;
  approximateModifier?: StockOperation['approximate_modifier'];
  input: {
    source: QuickOrderSource;
    catalog: CatalogItem[];
    corrections: ParserCorrection[];
    catalogIndex?: import('./catalog-search-index.ts').CatalogSearchIndex;
    unitAliases?: UnitAliasMap;
    employeeAliases?: EmployeeQuickOrderAlias[];
    locationId?: string | null;
  };
}): StockOperation | null {
  const resolved = resolveStockCatalogItem(input.itemText, input.input);
  if (!resolved) return null;
  const unitAliases = input.input.unitAliases ?? DEFAULT_UNIT_ALIASES;
  const unit = normalizeUnitForComparison(input.unit, unitAliases) ?? resolved.item.default_unit ?? resolved.item.base_unit ?? resolved.item.pack_unit ?? null;
  return {
    item_id: resolved.item.id,
    item_name: resolved.item.name,
    quantity: input.quantity,
    unit,
    approximate_modifier: input.approximateModifier ?? null,
    source: input.input.source,
    confidence: Math.min(input.confidence, resolved.matchConfidence || 0.5),
    original_text: input.originalText,
  };
}

function parseStatusSegment(
  segment: string,
  input: {
    source: QuickOrderSource;
    catalog: CatalogItem[];
    corrections: ParserCorrection[];
    catalogIndex?: import('./catalog-search-index.ts').CatalogSearchIndex;
    unitAliases?: UnitAliasMap;
    statusTerms?: InventoryStatusTerm[];
    employeeAliases?: EmployeeQuickOrderAlias[];
    locationId?: string | null;
  },
): { statusItem: InventoryStatusItem; stockUpdate: StockOperation | null } | null {
  const term = matchStatusTerm(segment, input.statusTerms ?? []);
  if (!term) return null;

  const afterPhrase = segment.trim().slice(term.rawPhrase.length).trim();
  const unitAliases = input.unitAliases ?? DEFAULT_UNIT_ALIASES;
  const unitAndItem = splitDetectedUnitPrefix(afterPhrase, unitAliases);
  const itemText = term.term.remaining_unit_behavior === 'detected_unit'
    ? unitAndItem.itemText
    : afterPhrase;
  const resolved = resolveStockCatalogItem(itemText, input);
  const unit = term.term.remaining_unit_behavior === 'detected_unit'
    ? unitAndItem.unit
    : term.term.remaining_unit_behavior === 'item_default_unit'
      ? null
      : null;
  const remainingQty = typeof term.term.remaining_qty === 'number' && Number.isFinite(term.term.remaining_qty)
    ? term.term.remaining_qty
    : null;

  const statusItem: InventoryStatusItem = {
    item_id: resolved?.item.id ?? null,
    item_name: resolved?.item.name ?? null,
    item_text: itemText,
    phrase: term.term.phrase,
    phrase_key: term.term.phrase_key,
    status: term.term.status,
    recommendation_action: term.term.recommendation_action,
    remaining_qty: remainingQty,
    remaining_unit: unit,
    original_text: segment.trim(),
    confidence: resolved ? Math.min(0.94, resolved.matchConfidence) : 0.5,
    issue: resolved ? null : 'item_not_found',
  };

  const shouldCreateStock =
    resolved &&
    remainingQty != null &&
    (
      term.term.recommendation_action === 'check_reorder_rule' ||
      term.term.recommendation_action === 'use_existing_recommendation_engine'
    );

  return {
    statusItem,
    stockUpdate: shouldCreateStock
      ? buildStockOperation({
          itemText,
          quantity: remainingQty,
          unit,
          originalText: segment.trim(),
          input,
          confidence: statusItem.confidence,
          approximateModifier: term.term.status === 'low' ? 'low' : null,
        })
      : null,
  };
}

function matchStatusTerm(
  segment: string,
  terms: InventoryStatusTerm[],
): { term: InventoryStatusTerm; rawPhrase: string } | null {
  const normalizedSegment = normalizeStatusPhraseKey(segment);
  if (!normalizedSegment) return null;
  const candidates = terms
    .filter((term) => term.active !== false && term.phrase_key && term.phrase)
    .map((term) => ({ term, key: normalizeStatusPhraseKey(term.phrase_key || term.phrase) }))
    .filter((entry) =>
      entry.key &&
      (normalizedSegment === entry.key || normalizedSegment.startsWith(`${entry.key} `))
    )
    .sort((a, b) =>
      (a.term.priority ?? 100) - (b.term.priority ?? 100) ||
      b.key.length - a.key.length
    );
  const selected = candidates[0];
  if (!selected) return null;
  const rawMatch = segment.trim().match(new RegExp(`^\\s*${escapeRegExp(selected.key).replace(/\\ /g, '\\s+')}\\b`, 'i'));
  return { term: selected.term, rawPhrase: rawMatch?.[0]?.trim() ?? selected.term.phrase };
}

function splitDetectedUnitPrefix(
  value: string,
  unitAliases: UnitAliasMap,
): { unit: string | null; itemText: string } {
  const trimmed = value.trim();
  if (!trimmed) return { unit: null, itemText: '' };
  const unitPattern = getUnitWords(unitAliases).map(escapeRegExp).join('|');
  const match = trimmed.match(new RegExp(`^(${unitPattern})\\b\\s*(.*)$`, 'i'));
  if (!match) return { unit: null, itemText: trimmed };
  const unit = normalizeUnitForComparison(match[1], unitAliases);
  return { unit, itemText: (match[2] ?? '').trim() };
}

function resolveStockCatalogItem(
  itemText: string,
  input: {
    catalog: CatalogItem[];
    corrections: ParserCorrection[];
    catalogIndex?: import('./catalog-search-index.ts').CatalogSearchIndex;
    employeeAliases?: EmployeeQuickOrderAlias[];
    locationId?: string | null;
  },
): { item: CatalogItem; matchConfidence: number } | null {
  const normalized = normalizeStatusPhraseKey(itemText);
  if (!normalized) return null;
  const exactName = input.catalog.filter((item) => normalizeStatusPhraseKey(item.name) === normalized);
  if (exactName.length === 1) return { item: exactName[0], matchConfidence: 1 };

  const aliases = input.employeeAliases ?? [];
  const aliasCandidates = aliases.filter((alias) =>
    alias.active !== false &&
    alias.alias_key === normalized &&
    (alias.location_id == null || (input.locationId != null && alias.location_id === input.locationId))
  );
  const locationSpecific = input.locationId
    ? aliasCandidates.filter((alias) => alias.location_id === input.locationId)
    : [];
  const scoped = locationSpecific.length > 0
    ? locationSpecific
    : aliasCandidates.filter((alias) => alias.location_id == null);
  if (scoped.length === 1) {
    const item = input.catalog.find((entry) => entry.id === scoped[0].inventory_item_id) ?? null;
    if (item) return { item, matchConfidence: 0.98 };
  }

  const match = matchCatalogItem(itemText, input.catalog, input.corrections, input.catalogIndex);
  const item = match.item_id ? input.catalog.find((entry) => entry.id === match.item_id) ?? null : null;
  return item ? { item, matchConfidence: match.confidence || 0.5 } : null;
}

function detectApproximateModifier(value: string): StockOperation['approximate_modifier'] {
  if (/\bonly\b/i.test(value)) return 'only';
  if (/\balmost|nearly\b/i.test(value)) return 'almost';
  if (/\baround\b/i.test(value)) return 'around';
  if (/\babout|approximately|approx|roughly\b/i.test(value)) return 'about';
  if (/\blow on\b/i.test(value)) return 'low';
  return null;
}

function splitStockSegments(message: string): string[] {
  return message
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .split(/\n|,|;/)
    .flatMap((segment) => segment.split(/\s+\band\s+/i))
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function normalizeStockPhrase(value: string): string {
  return value
    .replace(/^\s*(?:we|i)\s+have\s+/i, '')
    .replace(/\bif\s+(?:we|i)\s+have\s+/i, ' ')
    .replace(/^\s*(?:have|counted)\s+/i, '')
    .replace(/^\s*current\s+stock\s*/i, '')
    .replace(/^\s*only\s+/i, '')
    .replace(/\bhalf\s+(?:a\s+)?/gi, '0.5 ')
    .replace(/\b(case|cases|cs|box|boxes|pack|packs|pound|pounds|lb|lbs)\s+of\s+/gi, '$1 ')
    .replace(/\b(?:about|around|approximately|approx|roughly|almost|nearly)\b/gi, ' ')
    .replace(/\b(?:left|remaining|on hand|in stock)\b/gi, ' ')
    .replace(/\bhow\s+(?:many|much)\b.+$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanItemTail(value: string): string {
  return value
    .replace(/\b(?:left|remaining|on hand|in stock)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function replaceNumberWords(value: string): string {
  return value.replace(
    new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})\\b`, 'gi'),
    (match) => NUMBER_WORDS[match.toLowerCase()] ?? match,
  );
}

function looksLikeStockHeader(value: string): boolean {
  return /^\s*counted(?:\s+[\p{L}\p{N}' -]+)?\s*$/iu.test(value.trim());
}

function dedupeStockUpdates(updates: StockOperation[]): StockOperation[] {
  const byItemUnit = new Map<string, StockOperation>();
  for (const update of updates) {
    byItemUnit.set(`${update.item_id}:${update.unit ?? ''}`, update);
  }
  return [...byItemUnit.values()];
}

function dedupeStatusItems(items: InventoryStatusItem[]): InventoryStatusItem[] {
  const byOriginal = new Map<string, InventoryStatusItem>();
  for (const item of items) {
    byOriginal.set(`${item.original_text}:${item.item_id ?? item.item_text}`, item);
  }
  return [...byOriginal.values()];
}

function normalizeStatusPhraseKey(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/\s+/g, ' ');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
