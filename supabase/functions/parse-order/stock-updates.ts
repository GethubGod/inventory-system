import { matchCatalogItem } from './catalog-matcher.ts';
import { parseDeterministicOrder } from './deterministic-parser.ts';
import { resolveItemCandidate, resolveMissingUnit, resolveStatusTerm, resolveUnit } from './rule-resolver.ts';
import { DEFAULT_UNIT_ALIASES, getUnitWords, normalizeUnitForComparison, type UnitAliasMap } from './units.ts';
import type {
  CatalogItem,
  EmployeeQuickOrderAlias,
  InventoryStatusItem,
  InventoryStatusTerm,
  QuickOrderAliasRule,
  QuickOrderStatusTerm,
  ParserCorrection,
  QuickOrderSource,
  StockOperation,
  ItemAllowedUnitRule,
  QuickOrderUnitRule,
  QuickOrderResolutionMetadata,
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

// Inventory-only: a count like "a lot yellowtail" / "lots of crab sushi" means
// there is plenty in stock. We never order it and never warn — we just forget
// the line. (Configured `inventory_status_terms` for "a lot" still take
// precedence; this is the hardcoded fallback when no term is set up.)
const ABUNDANT_STOCK_PHRASE = /^\s*(?:a\s+lot|lots)\b/i;

// Inventory-only: "box" is treated as synonymous with "case".
const STOCK_UNIT_SYNONYMS: Record<string, string> = {
  box: 'cs',
};

/**
 * Apply inventory-mode unit synonyms (currently box → case) to a single unit.
 * Stock counts use this everywhere a unit is finalized so the synonym holds no
 * matter which path (deterministic, status term, or LLM) produced the count.
 * Ordering is unaffected — it never calls this.
 */
export function applyStockUnitSynonym(
  unit: string | null | undefined,
  synonyms?: { from_unit: string; to_unit: string }[],
): string | null {
  if (!unit) return unit ?? null;
  const normalized = normalizeUnitForComparison(unit) ?? unit.trim().toLowerCase();

  if (synonyms && synonyms.length > 0) {
    const match = synonyms.find(
      (s) => normalizeUnitForComparison(s.from_unit) === normalized
    );
    if (match && match.to_unit) {
      return normalizeUnitForComparison(match.to_unit) ?? match.to_unit;
    }
  }

  return STOCK_UNIT_SYNONYMS[normalized] ?? unit;
}

/** Normalize every stock operation's unit through the inventory synonyms. */
export function applyStockUnitSynonyms(
  updates: StockOperation[],
  synonyms?: { from_unit: string; to_unit: string }[],
): StockOperation[] {
  return updates.map((update) => {
    if (update.tracking_unit) return update;
    const synonym = applyStockUnitSynonym(update.unit, synonyms);
    return synonym === update.unit ? update : { ...update, unit: synonym };
  });
}

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
  statusTermRules?: QuickOrderStatusTerm[];
  employeeAliases?: EmployeeQuickOrderAlias[];
  employeeNameKeys?: string[];
  employeeUserId?: string | null;
  aliasRules?: QuickOrderAliasRule[];
  unitRules?: QuickOrderUnitRule[];
  parserSettings?: Record<string, unknown>;
  locationId?: string | null;
  assumeStock?: boolean;
  allowedUnitRules?: ItemAllowedUnitRule[];
  unitSynonyms?: { from_unit: string; to_unit: string }[];
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

    if (ABUNDANT_STOCK_PHRASE.test(segment)) {
      // Plenty in stock — emit a "no order needed" status so the employee sees
      // a clear result instead of an empty (and confusing) reply. If we cannot
      // resolve the item, fall through to dropping the line so it is neither
      // ordered nor surfaced as leftover text.
      const abundant = parseAbundantStockSegment(segment, input);
      if (abundant) {
        statusItems.push(abundant);
        stockSegments.push(segment);
      }
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
    employeeNameKeys?: string[];
    employeeUserId?: string | null;
    aliasRules?: QuickOrderAliasRule[];
    unitRules?: QuickOrderUnitRule[];
    parserSettings?: Record<string, unknown>;
    locationId?: string | null;
    allowedUnitRules?: ItemAllowedUnitRule[];
    unitSynonyms?: { from_unit: string; to_unit: string }[];
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
    employeeNameKeys?: string[];
    employeeUserId?: string | null;
    aliasRules?: QuickOrderAliasRule[];
    unitRules?: QuickOrderUnitRule[];
    parserSettings?: Record<string, unknown>;
    locationId?: string | null;
    allowedUnitRules?: ItemAllowedUnitRule[];
    unitSynonyms?: { from_unit: string; to_unit: string }[];
  };
}): StockOperation | null {
  const resolved = resolveStockCatalogItem(input.itemText, input.input);
  if (!resolved) return null;
  const unitAliases = input.input.unitAliases ?? DEFAULT_UNIT_ALIASES;
  const typedUnit = applyStockUnitSynonym(normalizeUnitForComparison(input.unit, unitAliases), input.input.unitSynonyms);
  // No unit typed: the count is implied to be the item's own unit (the only
  // unit it can be counted in), so fill it in and mark it as inferred.
  const unitInferred = typedUnit == null;
  const resolverContext = {
    mode: 'inventory' as const,
    employeeNameKeys: input.input.employeeNameKeys ?? [],
    employeeUserId: input.input.employeeUserId ?? null,
    locationId: input.input.locationId ?? null,
    settings: input.input.parserSettings ?? {},
  };
  const unitResolution = input.input.unitRules?.length
    ? (unitInferred
        ? resolveMissingUnit({ item: resolved.item, unitRules: input.input.unitRules, unitAliases, context: resolverContext })
        : resolveUnit({ item: resolved.item, typedUnit, unitRules: input.input.unitRules, unitAliases, context: resolverContext }))
    : null;
  let unit = unitResolution?.unit ?? typedUnit;
  const trackingUnit = unitResolution?.rule?.is_custom_counting_unit
    ? unitResolution.rule.tracking_unit ?? unitResolution.rule.from_unit ?? input.unit
    : null;
  let quantity = input.quantity;
  if (unitResolution) quantity *= unitResolution.multiplier;
  if (unitInferred && !unit) {
    const customRule = input.input.allowedUnitRules?.find(
      (rule) => rule.item_id === resolved.item.id
    );
    if (customRule && customRule.unit) {
      unit = customRule.unit;
    } else {
      unit = resolved.item.default_unit ?? resolved.item.base_unit ?? resolved.item.pack_unit ?? null;
    }
  }
  return {
    item_id: resolved.item.id,
    item_name: resolved.item.name,
    quantity,
    unit,
    tracking_unit: trackingUnit,
    unit_inferred: unitInferred,
    approximate_modifier: input.approximateModifier ?? null,
    source: input.input.source,
    confidence: Math.min(input.confidence, resolved.matchConfidence || 0.5),
    original_text: input.originalText,
    personal_alias: resolved.personalAlias ?? null,
    resolution: resolved.metadata ?? unitResolution?.metadata,
    reason_codes: [...(resolved.metadata?.reason_codes ?? []), ...(unitResolution?.metadata.reason_codes ?? [])],
    resolution_trace: [...(resolved.metadata?.resolution_trace ?? []), ...(unitResolution?.metadata.resolution_trace ?? [])],
    user_visible_note: resolved.metadata?.user_visible_note ?? unitResolution?.metadata.user_visible_note ?? null,
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
    statusTermRules?: QuickOrderStatusTerm[];
    employeeAliases?: EmployeeQuickOrderAlias[];
    employeeNameKeys?: string[];
    employeeUserId?: string | null;
    aliasRules?: QuickOrderAliasRule[];
    unitRules?: QuickOrderUnitRule[];
    parserSettings?: Record<string, unknown>;
    locationId?: string | null;
    allowedUnitRules?: ItemAllowedUnitRule[];
    unitSynonyms?: { from_unit: string; to_unit: string }[];
  },
): { statusItem: InventoryStatusItem; stockUpdate: StockOperation | null } | null {
  const v2Term = resolveStatusTerm({
    inputText: segment,
    statusTerms: input.statusTermRules ?? [],
    context: {
      mode: 'inventory',
      employeeNameKeys: input.employeeNameKeys ?? [],
      employeeUserId: input.employeeUserId ?? null,
      locationId: input.locationId ?? null,
      settings: input.parserSettings ?? {},
    },
  });
  const term = v2Term
    ? {
        rawPhrase: v2Term.rawPhrase,
        position: 'prefix' as const,
        term: {
          active: v2Term.term.active,
          phrase: v2Term.term.phrase,
          phrase_key: v2Term.term.phrase_key ?? normalizeStatusPhraseKey(v2Term.term.phrase),
          status: v2Term.term.status === 'out' ? 'zero' : v2Term.term.status,
          remaining_qty: v2Term.term.recommendation_action === 'order_needed' ? 0 : null,
          remaining_unit_behavior: v2Term.term.recommendation_action === 'order_needed' ? 'item_default_unit' : 'none',
          recommendation_action: v2Term.term.recommendation_action === 'no_order'
            ? 'no_order'
            : v2Term.term.recommendation_action === 'ask'
              ? 'ask_quantity'
              : 'check_reorder_rule',
          priority: 1,
          notes: v2Term.term.notes ?? null,
          source: v2Term.term.source ?? 'google_sheet',
        } as InventoryStatusTerm,
      }
    : matchStatusTerm(segment, input.statusTerms ?? []);
  if (!term) return null;

  const trimmedSegment = segment.trim();
  const afterPhrase = term.position === 'suffix'
    ? trimmedSegment.slice(0, Math.max(0, trimmedSegment.length - term.rawPhrase.length)).trim()
    : stripLeadingOf(trimmedSegment.slice(term.rawPhrase.length).trim());
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
    resolution: v2Term?.metadata ?? resolved?.metadata ?? null,
    reason_codes: [...(v2Term?.metadata.reason_codes ?? []), ...(resolved?.metadata?.reason_codes ?? [])],
    resolution_trace: [...(v2Term?.metadata.resolution_trace ?? []), ...(resolved?.metadata?.resolution_trace ?? [])],
    user_visible_note: v2Term?.metadata.user_visible_note ?? resolved?.metadata?.user_visible_note ?? null,
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

/**
 * Hardcoded fallback for "a lot of X" / "lots of X" when no `inventory_status_terms`
 * row is configured. Produces the same "enough → no_order" status a configured
 * term would, so the employee sees "no order needed" instead of an empty reply.
 */
function parseAbundantStockSegment(
  segment: string,
  input: {
    catalog: CatalogItem[];
    corrections: ParserCorrection[];
    catalogIndex?: import('./catalog-search-index.ts').CatalogSearchIndex;
    employeeAliases?: EmployeeQuickOrderAlias[];
    employeeNameKeys?: string[];
    employeeUserId?: string | null;
    aliasRules?: QuickOrderAliasRule[];
    parserSettings?: Record<string, unknown>;
    locationId?: string | null;
  },
): InventoryStatusItem | null {
  const itemText = stripLeadingOf(segment.trim().replace(ABUNDANT_STOCK_PHRASE, '').trim());
  if (!itemText) return null;
  const resolved = resolveStockCatalogItem(itemText, input);
  if (!resolved) return null;
  return {
    item_id: resolved.item.id,
    item_name: resolved.item.name,
    item_text: itemText,
    phrase: 'a lot',
    phrase_key: 'a lot',
    status: 'enough',
    recommendation_action: 'no_order',
    remaining_qty: null,
    remaining_unit: null,
    original_text: segment.trim(),
    confidence: Math.min(0.9, resolved.matchConfidence),
    issue: null,
    resolution: resolved.metadata ?? {
      reason_codes: ['abundant_stock_status'],
      resolution_trace: [`"${segment.trim().split(/\s+/).slice(0, 2).join(' ')}" means enough stock.`],
      status_term_applied: 'a lot',
      confidence: 0.9,
      user_visible_note: 'No order suggested because "a lot" means enough stock.',
    },
    reason_codes: resolved.metadata?.reason_codes ?? ['abundant_stock_status'],
    resolution_trace: resolved.metadata?.resolution_trace ?? ['"a lot" means enough stock.'],
    user_visible_note: resolved.metadata?.user_visible_note ?? 'No order suggested because "a lot" means enough stock.',
  };
}

/** Drop a leading "of " so "a lot of salmon" resolves the item "salmon". */
function stripLeadingOf(value: string): string {
  return value.replace(/^of\s+/i, '').trim();
}

function matchStatusTerm(
  segment: string,
  terms: InventoryStatusTerm[],
): { term: InventoryStatusTerm; rawPhrase: string; position: 'prefix' | 'suffix' } | null {
  const normalizedSegment = normalizeStatusPhraseKey(segment);
  if (!normalizedSegment) return null;
  const candidates = terms
    .filter((term) => term.active !== false && term.phrase_key && term.phrase)
    .map((term) => ({ term, key: normalizeStatusPhraseKey(term.phrase_key || term.phrase) }))
    .filter((entry) =>
      entry.key &&
      (
        normalizedSegment === entry.key ||
        normalizedSegment.startsWith(`${entry.key} `) ||
        normalizedSegment.endsWith(` ${entry.key}`)
      )
    )
    .sort((a, b) =>
      (a.term.priority ?? 100) - (b.term.priority ?? 100) ||
      b.key.length - a.key.length
    );
  const selected = candidates[0];
  if (!selected) return null;
  const phrasePattern = escapeRegExp(selected.key).replace(/\\ /g, '\\s+');
  const prefixMatch = segment.trim().match(new RegExp(`^\\s*${phrasePattern}\\b`, 'i'));
  if (prefixMatch) {
    return { term: selected.term, rawPhrase: prefixMatch[0]?.trim() ?? selected.term.phrase, position: 'prefix' };
  }
  const suffixMatch = segment.trim().match(new RegExp(`\\b${phrasePattern}\\s*$`, 'i'));
  return {
    term: selected.term,
    rawPhrase: suffixMatch?.[0]?.trim() ?? selected.term.phrase,
    position: 'suffix',
  };
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
    employeeNameKeys?: string[];
    employeeUserId?: string | null;
    aliasRules?: QuickOrderAliasRule[];
    parserSettings?: Record<string, unknown>;
    locationId?: string | null;
  },
): { item: CatalogItem; matchConfidence: number; personalAlias?: string | null; metadata?: QuickOrderResolutionMetadata | null } | null {
  const normalized = normalizeStatusPhraseKey(itemText);
  if (!normalized) return null;
  if (input.aliasRules?.length && input.catalogIndex) {
    const match = resolveItemCandidate({
      inputText: itemText,
      catalogIndex: input.catalogIndex,
      aliasRules: input.aliasRules,
      context: {
        mode: 'inventory',
        employeeNameKeys: input.employeeNameKeys ?? [],
        employeeUserId: input.employeeUserId ?? null,
        locationId: input.locationId ?? null,
        settings: input.parserSettings ?? {},
      },
    });
    const item = match.item_id ? input.catalog.find((entry) => entry.id === match.item_id) ?? null : null;
    if (item && !match.needs_clarification) {
      const aliasSource = match.match_type === 'employee_alias'
        ? 'employee'
        : match.match_type === 'exact_alias'
          ? 'global'
          : match.match_type === 'fuzzy'
            ? 'fuzzy'
            : 'exact';
      const typed = match.matched_alias ?? itemText;
      const metadata: QuickOrderResolutionMetadata = {
        reason_codes: [aliasSource === 'employee' ? 'employee_alias' : aliasSource === 'global' ? 'global_alias' : aliasSource === 'fuzzy' ? 'fuzzy_match' : 'exact_item_match'],
        resolution_trace: [`Matched "${typed}" to ${item.name}.`],
        alias_source: aliasSource,
        confidence: match.confidence,
        user_visible_note: aliasSource === 'employee'
          ? `Matched "${typed}" to ${item.name} using an employee inventory alias.`
          : aliasSource === 'global'
            ? `Matched "${typed}" to ${item.name} using a global alias.`
            : null,
      };
      return {
        item,
        matchConfidence: match.confidence || 0.5,
        personalAlias: aliasSource === 'employee' ? typed : null,
        metadata,
      };
    }
  }
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
    // Surface the phrase the employee typed so the UI can show that personal
    // context (not a generic guess) linked this term to the item.
    if (item) return { item, matchConfidence: 0.98, personalAlias: scoped[0].alias_text };
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
