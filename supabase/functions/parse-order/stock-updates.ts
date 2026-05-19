import { matchCatalogItem } from './catalog-matcher.ts';
import { parseDeterministicOrder } from './deterministic-parser.ts';
import { DEFAULT_UNIT_ALIASES, normalizeUnitForComparison, type UnitAliasMap } from './units.ts';
import type { CatalogItem, ParserCorrection, QuickOrderSource, StockOperation } from './types.ts';

export type StockUpdateExtraction = {
  stockUpdates: StockOperation[];
  stockSegments: string[];
  remainingText: string;
  hasStockSignal: boolean;
};

const STOCK_SIGNAL =
  /\b(?:we have|i have|have|has|left|remaining|on hand|current stock|counted|out of|no)\b/i;

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
}): StockUpdateExtraction {
  const hasStockSignal = STOCK_SIGNAL.test(input.message);
  if (!hasStockSignal) {
    return { stockUpdates: [], stockSegments: [], remainingText: input.message, hasStockSignal: false };
  }

  const segments = splitStockSegments(input.message);
  const stockUpdates: StockOperation[] = [];
  const stockSegments: string[] = [];
  const nonStockSegments: string[] = [];

  for (const segment of segments) {
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

  let normalized = normalizeStockPhrase(trimmed);
  const hasForm = normalized.match(/^(.+?)\s+has\s+(.+)$/i);
  if (hasForm) normalized = `${hasForm[2]} ${hasForm[1]}`;
  normalized = replaceNumberWords(normalized);

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
  });
}

function buildStockOperation(input: {
  itemText: string;
  quantity: number;
  unit: string | null;
  originalText: string;
  confidence: number;
  input: {
    source: QuickOrderSource;
    catalog: CatalogItem[];
    corrections: ParserCorrection[];
    catalogIndex?: import('./catalog-search-index.ts').CatalogSearchIndex;
    unitAliases?: UnitAliasMap;
  };
}): StockOperation | null {
  const match = matchCatalogItem(input.itemText, input.input.catalog, input.input.corrections, input.input.catalogIndex);
  const item = match.item_id ? input.input.catalog.find((entry) => entry.id === match.item_id) ?? null : null;
  if (!item) return null;
  const unitAliases = input.input.unitAliases ?? DEFAULT_UNIT_ALIASES;
  const unit = normalizeUnitForComparison(input.unit, unitAliases) ?? item.default_unit ?? item.base_unit ?? item.pack_unit ?? null;
  return {
    item_id: item.id,
    item_name: item.name,
    quantity: input.quantity,
    unit,
    source: input.input.source,
    confidence: Math.min(input.confidence, match.confidence || 0.5),
    original_text: input.originalText,
  };
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
    .replace(/^\s*(?:have|counted)\s+/i, '')
    .replace(/^\s*current\s+stock\s*/i, '')
    .replace(/\b(?:left|remaining|on hand|in stock)\b/gi, ' ')
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
