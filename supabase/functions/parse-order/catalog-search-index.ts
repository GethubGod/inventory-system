import type {
  CatalogAlternative,
  CatalogItem,
  CatalogMatchResult,
  MatchType,
  ParserCorrection,
} from './types.ts';

type SearchTermType =
  | 'name'
  | 'alias'
  | 'correction'
  | 'parenthetical'
  | 'generated'
  | 'short';

export type CatalogSearchEntry = {
  term: string;
  rawTerm: string;
  normalized: string;
  compact: string;
  pluralNormalized: string;
  pluralCompact: string;
  tokenKey: string;
  item: CatalogItem;
  type: SearchTermType;
};

export type CatalogSearchIndex = {
  catalog: CatalogItem[];
  entries: CatalogSearchEntry[];
};

type ScoredEntry = {
  entry: CatalogSearchEntry;
  confidence: number;
  match_type: MatchType;
  semantic: SemanticTokenAnalysis;
};

export type SemanticTokenAnalysis = {
  inputTokens: string[];
  candidateTokens: string[];
  inputGenericTokens: string[];
  inputSpecificTokens: string[];
  genericTokenOverlap: string[];
  specificTokenOverlap: string[];
  missingSpecificTokens: string[];
  tokenCoverage: number;
  passed: boolean;
  reason: string;
};

const SPLIT_PATTERN = /[()[\]{}\/,\-_]+/g;
const SMART_QUOTES = /[\u2018\u2019\u201A\u201B\u2032`´]/g;
const GENERIC_TOKENS = new Set([
  'powder',
  'sauce',
  'mix',
  'salad',
  'fish',
  'crab',
  'clam',
  'small',
  'large',
  'frozen',
  'fresh',
  'pack',
  'box',
  'case',
  'paper',
  'towel',
  'towels',
  'roll',
  'bag',
]);

export function normalizeCatalogText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(SMART_QUOTES, "'")
    .replace(/&/g, ' and ')
    .replace(SPLIT_PATTERN, ' ')
    .replace(/[^\p{L}\p{N}\s']+/gu, ' ')
    .replace(/'+/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export function compactCatalogText(value: string): string {
  return normalizeCatalogText(value).replace(/\s+/g, '');
}

export function pluralNormalizedText(value: string): string {
  return normalizeCatalogText(value)
    .split(' ')
    .filter(Boolean)
    .map(singularizeToken)
    .join(' ');
}

export function tokenSortKey(value: string): string {
  return pluralNormalizedText(value)
    .split(' ')
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .join(' ');
}

function singularizeToken(token: string): string {
  if (token.length <= 3) return token;
  if (token === 'cases') return 'case';
  if (token === 'packs') return 'pack';
  if (token === 'pieces') return 'piece';
  if (token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (
    token.endsWith('ches') ||
    token.endsWith('shes') ||
    token.endsWith('xes') ||
    token.endsWith('ses')
  ) {
    return token.slice(0, -2);
  }
  if (token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

export function getCatalogSearchTerms(itemName: string, aliases: string[] = []): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();

  function add(raw: string | null | undefined): void {
    const normalized = normalizeCatalogText(raw ?? '');
    if (normalized.length < 2 || seen.has(normalized)) return;
    seen.add(normalized);
    terms.push(normalized);
    const compact = normalized.replace(/\s+/g, '');
    if (compact !== normalized && compact.length >= 3 && !seen.has(compact)) {
      seen.add(compact);
      terms.push(compact);
    }
  }

  add(itemName);

  const segments = itemName
    .replace(SPLIT_PATTERN, '|')
    .split('|')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length > 1) {
    add(segments.join(' '));
    for (const segment of segments) add(segment);
  }

  const normalizedName = normalizeCatalogText(itemName);
  const tokens = normalizedName.split(' ').filter(Boolean);
  if (tokens.length >= 3) {
    for (let index = 0; index < tokens.length - 1; index += 1) {
      add(`${tokens[index]} ${tokens[index + 1]}`);
    }
  }
  if (tokens.length === 2) {
    for (const token of tokens) add(token);
  }

  for (const alias of aliases) add(alias);

  return terms;
}

export function catalogNameStructuralSegmentMatches(itemName: string, inputText: string): boolean {
  const normalizedInput = normalizeCatalogText(inputText);
  if (!normalizedInput) return false;
  return getCatalogNameStructuralSegments(itemName).some((segment) => segment === normalizedInput);
}

function getCatalogNameStructuralSegments(itemName: string): string[] {
  const segments = new Set<string>();
  const bracketed = itemName.match(/\(([^)]*)\)|\[([^\]]*)\]|\{([^}]*)\}/g) ?? [];

  for (const segment of bracketed) {
    addStructuralSegment(segment.replace(/^[([{]\s*|\s*[\])}]$/g, ''), segments);
  }

  addStructuralSegment(itemName.replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, ' '), segments);
  return [...segments];
}

function addStructuralSegment(raw: string, segments: Set<string>): void {
  const normalized = normalizeCatalogText(raw);
  if (!normalized) return;
  segments.add(normalized);
}

export function buildCatalogSearchIndex(
  catalog: CatalogItem[],
  corrections: ParserCorrection[] = [],
): CatalogSearchIndex {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const draft: CatalogSearchEntry[] = [];

  for (const item of catalog) {
    addEntry(draft, item.name, item, 'name');

    const nameTerms = getCatalogSearchTerms(item.name, []);
    for (const term of nameTerms) {
      if (term === normalizeCatalogText(item.name)) continue;
      addEntry(draft, term, item, isSubTermOfName(term, item.name) ? 'parenthetical' : 'generated');
    }

    for (const alias of item.aliases ?? []) {
      addEntry(draft, alias, item, 'alias');
      const compactAlias = compactCatalogText(alias);
      if (compactAlias !== normalizeCatalogText(alias)) addEntry(draft, compactAlias, item, 'alias');
    }
  }

  for (const correction of corrections) {
    if (!correction.raw_token.trim() || !correction.user_corrected_item_id) continue;
    const item = byId.get(correction.user_corrected_item_id);
    if (item) addEntry(draft, correction.raw_token, item, 'correction');
  }

  const byNormalized = new Map<string, Set<string>>();
  for (const entry of draft) {
    const current = byNormalized.get(entry.normalized) ?? new Set<string>();
    current.add(entry.item.id);
    byNormalized.set(entry.normalized, current);
  }

  const deduped = new Map<string, CatalogSearchEntry>();
  for (const entry of draft) {
    if (entry.normalized.split(' ').length === 1 && entry.type !== 'name' && entry.type !== 'alias' && entry.type !== 'correction') {
      const itemIds = byNormalized.get(entry.normalized);
      const isStructuralSegment = catalogNameStructuralSegmentMatches(entry.item.name, entry.normalized);
      if (itemIds && itemIds.size > 1 && !isStructuralSegment) continue;
      if (!isStructuralSegment) entry.type = 'short';
    }
    const key = `${entry.item.id}:${entry.type}:${entry.normalized}`;
    if (!deduped.has(key)) deduped.set(key, entry);
  }

  return { catalog, entries: [...deduped.values()] };
}

function isSubTermOfName(term: string, itemName: string): boolean {
  return normalizeCatalogText(itemName) !== normalizeCatalogText(term);
}

const MAX_ALIAS_LENGTH = 64;

function addEntry(
  entries: CatalogSearchEntry[],
  rawTerm: string,
  item: CatalogItem,
  type: SearchTermType,
): void {
  if (rawTerm.trim().length > MAX_ALIAS_LENGTH) return;
  const normalized = normalizeCatalogText(rawTerm);
  if (normalized.length < 2) return;
  const pluralNormalized = pluralNormalizedText(normalized);
  entries.push({
    term: normalized,
    rawTerm,
    normalized,
    compact: normalized.replace(/\s+/g, ''),
    pluralNormalized,
    pluralCompact: pluralNormalized.replace(/\s+/g, ''),
    tokenKey: tokenSortKey(normalized),
    item,
    type,
  });
}

export function matchCatalogIndex(
  itemText: string,
  index: CatalogSearchIndex,
): CatalogMatchResult {
  const normalized = normalizeCatalogText(itemText);
  if (!normalized) return withMatchDebug(itemText, noMatch(itemText, 'Missing item name.', [], 'low', 'empty_item_text'), []);

  const compact = normalized.replace(/\s+/g, '');
  const pluralNormalized = pluralNormalizedText(normalized);
  const pluralCompact = pluralNormalized.replace(/\s+/g, '');
  const tokenKey = tokenSortKey(normalized);

  const stages: { type: MatchType; confidence: number; entries: CatalogSearchEntry[] }[] = [
    { type: 'exact_name', confidence: 1, entries: index.entries.filter((entry) => entry.type === 'name' && entry.normalized === normalized) },
    { type: 'compact_exact', confidence: 0.99, entries: index.entries.filter((entry) => entry.type === 'name' && entry.compact === compact) },
    { type: 'exact_alias', confidence: 0.96, entries: index.entries.filter((entry) => entry.type === 'alias' && entry.normalized === normalized) },
    { type: 'correction', confidence: 0.95, entries: index.entries.filter((entry) => entry.type === 'correction' && entry.normalized === normalized) },
    { type: 'parenthetical_or_generated_exact', confidence: 0.94, entries: index.entries.filter((entry) => (entry.type === 'parenthetical' || entry.type === 'generated' || entry.type === 'short') && entry.normalized === normalized && isAllowedGeneratedExact(normalized, entry)) },
    { type: 'normalized_exact', confidence: 0.93, entries: index.entries.filter((entry) => entry.type === 'name' && entry.normalized === normalized) },
    { type: 'compact_exact', confidence: 0.93, entries: index.entries.filter((entry) => entry.compact === compact) },
    { type: 'token_set', confidence: 0.9, entries: index.entries.filter((entry) => entry.tokenKey === tokenKey && tokenKey.includes(' ') && analyzeSemanticTokens(normalized, entry.normalized).passed) },
    { type: 'prefix', confidence: 0.88, entries: index.entries.filter((entry) => isPrefixOrSuffixMatch(normalized, entry.normalized) && analyzeSemanticTokens(normalized, entry.normalized).passed) },
    { type: 'plural_normalized', confidence: 0.87, entries: index.entries.filter((entry) => (entry.pluralNormalized === pluralNormalized || entry.pluralCompact === pluralCompact) && analyzeSemanticTokens(normalized, entry.normalized).passed) },
  ];

  for (const stage of stages) {
    const unique = uniqueEntriesByItem(stage.entries);
    if (unique.length === 1) {
      return withMatchDebug(
        itemText,
        matched(unique[0], stage.type, stage.confidence, 'high', `unique_${stage.type}`),
        unique.map((entry) => ({
          entry,
          confidence: stage.confidence,
          match_type: stage.type,
          semantic: analyzeSemanticTokens(normalized, entry.normalized),
        })),
      );
    }
    if (unique.length > 1) {
      if (stage.type === 'parenthetical_or_generated_exact') {
        const structuralMatches = unique.filter((entry) =>
          catalogNameStructuralSegmentMatches(entry.item.name, normalized)
        );
        if (structuralMatches.length === 1) {
          return withMatchDebug(
            itemText,
            matched(structuralMatches[0], stage.type, stage.confidence, 'high', `structural_segment_${stage.type}`),
            unique.map((entry) => ({
              entry,
              confidence: stage.confidence,
              match_type: stage.type,
              semantic: analyzeSemanticTokens(normalized, entry.normalized),
            })),
          );
        }
      }
      return withMatchDebug(itemText, ambiguous(
        unique.map((entry) => ({
          entry,
          confidence: stage.confidence,
          match_type: stage.type,
          semantic: analyzeSemanticTokens(normalized, entry.normalized),
        })),
        'Item text matches multiple catalog items.',
        'medium',
        `multiple_${stage.type}`,
      ), unique.map((entry) => ({
        entry,
        confidence: stage.confidence,
        match_type: stage.type,
        semantic: analyzeSemanticTokens(normalized, entry.normalized),
      })));
    }
  }

  return fuzzyMatch(itemText, normalized, index.entries);
}

export function isStrongDeterministicMatch(match: { match_type?: MatchType; item_id?: string | null }): boolean {
  return Boolean(match.item_id) && (
    match.match_type === 'exact_name' ||
    match.match_type === 'exact_alias' ||
    match.match_type === 'correction' ||
    match.match_type === 'parenthetical_or_generated_exact' ||
    match.match_type === 'parenthetical_exact' ||
    match.match_type === 'generated_term_exact' ||
    match.match_type === 'parenthetical' ||
    match.match_type === 'normalized_exact' ||
    match.match_type === 'compact_exact'
  );
}

function isPrefixOrSuffixMatch(input: string, term: string): boolean {
  if (input.length < 4 || term.length < 4 || input === term) return false;
  return term.startsWith(`${input} `) || term.endsWith(` ${input}`) || input.startsWith(`${term} `) || input.endsWith(` ${term}`);
}

function isAllowedGeneratedExact(normalized: string, entry: CatalogSearchEntry): boolean {
  if (entry.type !== 'short') return true;
  const tokens = semanticTokens(normalized);
  return tokens.length !== 1 || !GENERIC_TOKENS.has(tokens[0]);
}

function fuzzyMatch(originalText: string, needle: string, entries: CatalogSearchEntry[]): CatalogMatchResult {
  if (needle.replace(/\s+/g, '').length <= 3) {
    return withMatchDebug(
      originalText,
      noMatch(originalText, 'Item match is too short for fuzzy matching.', [], 'low', 'too_short_for_fuzzy'),
      [],
    );
  }

  const scored = entries
    .map((entry) => {
      const semantic = analyzeSemanticTokens(needle, entry.normalized);
      return {
        entry,
        confidence: semantic.passed ? similarity(needle, entry.normalized) : Math.min(similarity(needle, entry.normalized), 0.69),
        match_type: 'fuzzy' as MatchType,
        semantic,
      };
    })
    .filter((entry) => entry.confidence >= 0.55)
    .sort((a, b) => b.confidence - a.confidence || a.entry.term.localeCompare(b.entry.term));

  const unique = uniqueScoredByItem(scored).slice(0, 3);
  if (unique.length === 0) {
    return withMatchDebug(
      originalText,
      noMatch(originalText, 'Item could not be matched to the catalog.', [], 'low', 'no_candidate_above_floor'),
      [],
    );
  }

  const [best, second] = unique;
  const isSingleWord = semanticTokens(needle).length === 1;
  const autoThreshold = isSingleWord ? 0.9 : 0.88;
  const margin = second ? best.confidence - second.confidence : 1;
  const tinyTypo = isVerySmallTypo(needle, best.entry.normalized);
  if (
    best.semantic.passed &&
    (best.confidence >= autoThreshold || (tinyTypo && best.confidence >= 0.86)) &&
    margin >= 0.08
  ) {
    return withMatchDebug(
      originalText,
      matched(
        best.entry,
        'fuzzy',
        clampConfidence(best.confidence),
        'high',
        tinyTypo ? 'unique_tiny_typo' : 'unique_strong_fuzzy',
      ),
      unique,
    );
  }
  if (best.semantic.passed && best.confidence >= 0.75) {
    return withMatchDebug(
      originalText,
      ambiguous(
        unique,
        second && margin < 0.08 ? 'Item match has competing candidates.' : 'Item match needs confirmation.',
        'medium',
        second && margin < 0.08 ? 'competing_candidate_close' : 'likely_candidate_below_auto_threshold',
      ),
      unique,
    );
  }
  return withMatchDebug(
    originalText,
    noMatch(originalText, 'Item match is too uncertain.', alternativesFromScored(unique), 'low', 'below_medium_threshold'),
    unique,
  );
}

export function findCatalogAlternatives(
  itemText: string,
  index: CatalogSearchIndex,
  limit = 3,
): CatalogAlternative[] {
  const normalized = normalizeCatalogText(itemText);
  if (!normalized) return [];
  return alternativesFromScored(
    uniqueScoredByItem(index.entries.map((entry) => ({
      entry,
      confidence: alternativeConfidence(normalized, entry),
      match_type: alternativeMatchType(normalized, entry),
      semantic: analyzeSemanticTokens(normalized, entry.normalized),
    }))).slice(0, limit),
  );
}

function matched(
  entry: CatalogSearchEntry,
  matchType: MatchType,
  confidence: number,
  tier: CatalogMatchResult['confidence_tier'] = 'high',
  reason: string = matchType,
): CatalogMatchResult {
  const semantic = analyzeSemanticTokens(entry.term, entry.normalized);
  return {
    item_id: entry.item.id,
    item_name: entry.item.name,
    display_name: entry.item.name,
    matched_alias: entry.type === 'alias' || entry.type === 'parenthetical' || entry.type === 'correction' ? entry.term : undefined,
    matched_term: entry.term,
    match_type: matchType,
    confidence,
    needs_clarification: false,
    token_coverage: semantic.tokenCoverage,
    generic_token_overlap: semantic.genericTokenOverlap,
    specific_token_overlap: semantic.specificTokenOverlap,
    missing_specific_tokens: semantic.missingSpecificTokens,
    semantic_validation_passed: true,
    confidence_tier: tier,
    decision_reason: reason,
  };
}

function noMatch(
  itemText: string,
  issue: string,
  alternatives: CatalogAlternative[] = [],
  tier: CatalogMatchResult['confidence_tier'] = 'low',
  reason = issue,
): CatalogMatchResult {
  return {
    item_id: null,
    item_name: itemText || null,
    display_name: itemText || 'Unknown item',
    match_type: 'no_match',
    confidence: alternatives[0]?.confidence ?? 0,
    needs_clarification: true,
    issue,
    reason: issue,
    alternatives: alternatives.length > 0 ? alternatives : undefined,
    confidence_tier: tier,
    decision_reason: reason,
  };
}

function ambiguous(
  scored: ScoredEntry[],
  issue: string,
  tier: CatalogMatchResult['confidence_tier'] = 'medium',
  reason = issue,
): CatalogMatchResult {
  const alternatives = alternativesFromScored(scored);
  return {
    item_id: null,
    item_name: null,
    display_name: alternatives[0]?.item_name ?? 'Ambiguous item',
    match_type: 'ambiguous',
    confidence: alternatives[0]?.confidence ?? 0,
    needs_clarification: true,
    issue,
    reason: issue,
    alternatives,
    confidence_tier: tier,
    decision_reason: reason,
  };
}

function uniqueEntriesByItem(entries: CatalogSearchEntry[]): CatalogSearchEntry[] {
  const byId = new Map<string, CatalogSearchEntry>();
  for (const entry of entries) {
    if (!byId.has(entry.item.id)) byId.set(entry.item.id, entry);
  }
  return [...byId.values()];
}

function uniqueScoredByItem(scored: ScoredEntry[]): ScoredEntry[] {
  const byId = new Map<string, ScoredEntry>();
  for (const entry of scored) {
    const current = byId.get(entry.entry.item.id);
    if (!current || entry.confidence > current.confidence) byId.set(entry.entry.item.id, entry);
  }
  return [...byId.values()].sort((a, b) => b.confidence - a.confidence || a.entry.item.name.localeCompare(b.entry.item.name));
}

function alternativesFromScored(scored: ScoredEntry[]): CatalogAlternative[] {
  const top = scored.slice(0, 3);
  return top.map((entry) => ({
    item_id: entry.entry.item.id,
    item_name: entry.entry.item.name,
    confidence: Number(clampConfidence(entry.confidence).toFixed(3)),
    score: Number(clampConfidence(entry.confidence).toFixed(3)),
    term: entry.entry.term,
    matched_term: entry.entry.term,
    match_type: entry.match_type,
    token_coverage: Number(entry.semantic.tokenCoverage.toFixed(3)),
    generic_token_overlap: entry.semantic.genericTokenOverlap,
    specific_token_overlap: entry.semantic.specificTokenOverlap,
    missing_specific_tokens: entry.semantic.missingSpecificTokens,
    semantic_validation_passed: entry.semantic.passed,
    reason: top.length > 1 && entry.confidence === top[0].confidence
      ? 'same_priority_or_score'
      : entry.semantic.passed
        ? entry.match_type
        : entry.semantic.reason,
  }));
}

function alternativeConfidence(normalized: string, entry: CatalogSearchEntry): number {
  if (entry.normalized === normalized) {
    if (entry.type === 'name') return 1;
    if (entry.type === 'alias') return 0.96;
    if (entry.type === 'correction') return 0.95;
    if (entry.type === 'parenthetical' || entry.type === 'generated' || entry.type === 'short') return 0.94;
    return 0.93;
  }

  const compact = normalized.replace(/\s+/g, '');
  if (entry.type === 'name' && entry.compact === compact) return 0.99;
  if (entry.compact === compact) return 0.92;

  const tokenKey = tokenSortKey(normalized);
  const semantic = analyzeSemanticTokens(normalized, entry.normalized);
  if (entry.tokenKey === tokenKey && tokenKey.includes(' ')) return semantic.passed ? 0.9 : 0.69;
  if (isPrefixOrSuffixMatch(normalized, entry.normalized)) return semantic.passed ? 0.88 : 0.69;

  const pluralNormalized = pluralNormalizedText(normalized);
  const pluralCompact = pluralNormalized.replace(/\s+/g, '');
  if (entry.pluralNormalized === pluralNormalized || entry.pluralCompact === pluralCompact) return semantic.passed ? 0.87 : 0.69;

  const fuzzyScore = similarity(normalized, entry.normalized);
  return semantic.passed ? fuzzyScore : Math.min(fuzzyScore, 0.69);
}

function alternativeMatchType(normalized: string, entry: CatalogSearchEntry): MatchType {
  if (entry.normalized === normalized) {
    if (entry.type === 'name') return 'exact_name';
    if (entry.type === 'alias') return 'exact_alias';
    if (entry.type === 'correction') return 'correction';
    if (entry.type === 'parenthetical' || entry.type === 'generated' || entry.type === 'short') return 'parenthetical_or_generated_exact';
    return 'normalized_exact';
  }

  const compact = normalized.replace(/\s+/g, '');
  if (entry.compact === compact) return 'compact_exact';

  const tokenKey = tokenSortKey(normalized);
  if (entry.tokenKey === tokenKey && tokenKey.includes(' ')) return 'token_set';
  if (isPrefixOrSuffixMatch(normalized, entry.normalized)) return 'prefix';

  const pluralNormalized = pluralNormalizedText(normalized);
  const pluralCompact = pluralNormalized.replace(/\s+/g, '');
  if (entry.pluralNormalized === pluralNormalized || entry.pluralCompact === pluralCompact) return 'plural_normalized';

  return 'fuzzy';
}

export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const normalizedA = normalizeCatalogText(a);
  const normalizedB = normalizeCatalogText(b);
  if (normalizedA === normalizedB) return 1;

  const compactA = normalizedA.replace(/\s+/g, '');
  const compactB = normalizedB.replace(/\s+/g, '');
  if (compactA === compactB) return 0.96;

  const editScore = editSimilarity(compactA, compactB);
  const tokenScore = tokenDice(normalizedA, normalizedB);
  const jaroScore = jaroWinkler(compactA, compactB);
  const lengthRatio = Math.min(compactA.length, compactB.length) / Math.max(compactA.length, compactB.length);
  const prefixBoost = lengthRatio >= 0.65 && (compactB.startsWith(compactA) || compactA.startsWith(compactB)) ? 0.05 : 0;
  return clampConfidence(Math.max(editScore, tokenScore, jaroScore) + prefixBoost);
}

export function analyzeSemanticTokens(inputText: string, candidateText: string): SemanticTokenAnalysis {
  const inputTokens = semanticTokens(inputText);
  const candidateTokens = semanticTokens(candidateText);
  const inputSpecificTokens = inputTokens.filter((token) => !GENERIC_TOKENS.has(token));
  const inputGenericTokens = inputTokens.filter((token) => GENERIC_TOKENS.has(token));
  const candidateTokenSet = new Set(candidateTokens);
  const genericTokenOverlap: string[] = [];
  const specificTokenOverlap: string[] = [];
  const missingSpecificTokens: string[] = [];
  let coveredCount = 0;

  for (const token of inputTokens) {
    const covered = tokenCoveredByCandidate(token, candidateTokens, candidateTokenSet);
    if (covered) {
      coveredCount += 1;
      if (GENERIC_TOKENS.has(token)) genericTokenOverlap.push(token);
      else specificTokenOverlap.push(token);
    } else if (!GENERIC_TOKENS.has(token)) {
      missingSpecificTokens.push(token);
    }
  }

  const tokenCoverage = inputTokens.length > 0 ? coveredCount / inputTokens.length : 0;
  const hasSpecificTokens = inputSpecificTokens.length > 0;
  const passed = inputTokens.length === 0
    ? false
    : hasSpecificTokens
      ? missingSpecificTokens.length === 0 && tokenCoverage >= 0.75
      : inputTokens.every((token) => candidateTokenSet.has(token));
  const reason = passed
    ? 'semantic_match'
    : missingSpecificTokens.length > 0
      ? 'missing_specific_token'
      : 'generic_token_only';

  return {
    inputTokens,
    candidateTokens,
    inputGenericTokens,
    inputSpecificTokens,
    genericTokenOverlap: [...new Set(genericTokenOverlap)],
    specificTokenOverlap: [...new Set(specificTokenOverlap)],
    missingSpecificTokens: [...new Set(missingSpecificTokens)],
    tokenCoverage,
    passed,
    reason,
  };
}

function semanticTokens(value: string): string[] {
  return pluralNormalizedText(value)
    .split(' ')
    .filter((token) => token.length > 1 && !GENERIC_TOKENS.has(token) || GENERIC_TOKENS.has(token));
}

function tokenCoveredByCandidate(token: string, candidateTokens: string[], candidateTokenSet: Set<string>): boolean {
  if (candidateTokenSet.has(token)) return true;
  if (GENERIC_TOKENS.has(token)) return false;
  return candidateTokens.some((candidateToken) => {
    const lengthRatio = Math.min(token.length, candidateToken.length) / Math.max(token.length, candidateToken.length);
    return lengthRatio >= 0.65 && similarity(token, candidateToken) >= 0.88;
  });
}

function editSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const distance = levenshtein(a, b);
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) return 1;
  const score = 1 - distance / maxLength;
  if (distance <= 1 && Math.min(a.length, b.length) >= 4) return Math.max(score, 0.88);
  if (distance <= 2 && Math.min(a.length, b.length) >= 7) return Math.max(score, 0.82);
  return score;
}

function tokenDice(a: string, b: string): number {
  const aTokens = new Set(pluralNormalizedText(a).split(' ').filter(Boolean));
  const bTokens = new Set(pluralNormalizedText(b).split(' ').filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let overlap = 0;
  aTokens.forEach((token) => {
    if (bTokens.has(token)) overlap += 1;
  });
  return (2 * overlap) / (aTokens.size + bTokens.size);
}

function levenshtein(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

function isVerySmallTypo(input: string, candidate: string): boolean {
  const inputCompact = compactCatalogText(input);
  const candidateCompact = compactCatalogText(candidate);
  if (!inputCompact || !candidateCompact) return false;
  const lengthGap = Math.abs(inputCompact.length - candidateCompact.length);
  if (lengthGap > 2) return false;
  const longerLength = Math.max(inputCompact.length, candidateCompact.length);
  if (longerLength < 4) return false;
  const distance = levenshtein(inputCompact, candidateCompact);
  return distance <= (longerLength <= 6 ? 1 : 2);
}

function withMatchDebug(
  rawItemText: string,
  result: CatalogMatchResult,
  candidates: ScoredEntry[],
): CatalogMatchResult {
  if (!isCatalogMatchDebugEnabled()) return result;
  const topCandidates = candidates.slice(0, 3).map((candidate) => ({
    item_id: candidate.entry.item.id,
    item_name: candidate.entry.item.name,
    term: candidate.entry.term,
    score: Number(clampConfidence(candidate.confidence).toFixed(3)),
    match_type: candidate.match_type,
    semantic_passed: candidate.semantic.passed,
    reason: candidate.semantic.reason,
  }));
  console.log('[parse-order] catalog_match_debug', JSON.stringify({
    raw_item_text: rawItemText,
    normalized_item_text: normalizeCatalogText(rawItemText),
    top_candidates: topCandidates,
    selected_item_id: result.item_id,
    selected_item_name: result.item_name,
    confidence_score: Number((result.confidence ?? 0).toFixed(3)),
    match_tier: result.confidence_tier ?? (result.item_id ? 'high' : 'low'),
    decision_reason: result.decision_reason ?? result.reason ?? result.issue,
    match_type: result.match_type,
  }));
  return result;
}

function isCatalogMatchDebugEnabled(): boolean {
  const runtime = globalThis as {
    process?: { env?: Record<string, string | undefined> };
    Deno?: { env?: { get?: (key: string) => string | undefined } };
  };
  const nodeEnv = runtime.process?.env;
  if (nodeEnv?.NODE_ENV === 'test' || nodeEnv?.JEST_WORKER_ID) return false;
  if (nodeEnv?.QUICK_ORDER_DEBUG_MATCHING === 'true' || nodeEnv?.NODE_ENV === 'development') return true;
  const denoGet = runtime.Deno?.env?.get;
  return denoGet?.('QUICK_ORDER_DEBUG_MATCHING') === 'true' || denoGet?.('ENVIRONMENT') === 'development';
}

function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const matchDistance = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatches = Array.from({ length: a.length }, () => false);
  const bMatches = Array.from({ length: b.length }, () => false);
  let matches = 0;

  for (let i = 0; i < a.length; i += 1) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);
    for (let j = start; j < end; j += 1) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let bIndex = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!aMatches[i]) continue;
    while (!bMatches[bIndex]) bIndex += 1;
    if (a[i] !== b[bIndex]) transpositions += 1;
    bIndex += 1;
  }

  const jaro = (
    matches / a.length +
    matches / b.length +
    (matches - transpositions / 2) / matches
  ) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i += 1) {
    if (a[i] !== b[i]) break;
    prefix += 1;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, value));
}
