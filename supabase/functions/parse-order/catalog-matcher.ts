import type {
  CatalogAlternative,
  CatalogItem,
  CatalogMatchResult,
  MatchType,
  ParserCorrection,
} from './types.ts';

type SearchEntry = {
  value: string;
  normalized: string;
  compact: string;
  forms: Set<string>;
  item: CatalogItem;
  type: 'name' | 'alias' | 'parenthetical' | 'correction';
};

export function normalizeSearchText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactSearchText(value: string): string {
  return normalizeSearchText(value).replace(/\s+/g, '');
}

function singularizeToken(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.endsWith('ches') || token.endsWith('shes') || token.endsWith('xes') || token.endsWith('ses')) {
    return token.slice(0, -2);
  }
  if (token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function comparableForms(value: string): Set<string> {
  const normalized = normalizeSearchText(value);
  const singular = normalized
    .split(' ')
    .filter(Boolean)
    .map(singularizeToken)
    .join(' ');
  const forms = new Set<string>();
  for (const form of [normalized, singular]) {
    if (!form) continue;
    forms.add(form);
    forms.add(form.replace(/\s+/g, ''));
  }
  return forms;
}

function uniqueAlternatives(entries: { item: CatalogItem; confidence: number }[]): CatalogAlternative[] {
  const byId = new Map<string, CatalogAlternative>();
  for (const entry of entries) {
    const current = byId.get(entry.item.id);
    if (!current || entry.confidence > current.confidence) {
      byId.set(entry.item.id, {
        item_id: entry.item.id,
        item_name: entry.item.name,
        confidence: Number(entry.confidence.toFixed(3)),
      });
    }
  }
  return [...byId.values()]
    .sort((a, b) => b.confidence - a.confidence || a.item_name.localeCompare(b.item_name))
    .slice(0, 3);
}

/**
 * Extracts all searchable name variants from an item name + aliases.
 *
 * "White Fish (Izumidai)" → ["white fish (izumidai)", "white fish", "izumidai"]
 * "Tuna / Maguro"         → ["tuna / maguro", "tuna", "maguro"]
 * "Item [Alias]"          → ["item [alias]", "item", "alias"]
 * "Tuna - Maguro"         → ["tuna - maguro", "tuna", "maguro"]
 * "Tuna, Maguro"          → ["tuna, maguro", "tuna", "maguro"]
 *
 * The full name is always included. Sub-terms shorter than 2 characters
 * are dropped to avoid noise. Results are lowercased but not deduplicated
 * (the caller handles that via the normalized/compact fields).
 */
export function getCatalogSearchTerms(itemName: string, aliases: string[]): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();

  function addTerm(raw: string): void {
    const trimmed = raw.trim();
    if (trimmed.length < 2) return;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    terms.push(trimmed);
  }

  // Always include the full name.
  addTerm(itemName);

  // Split on parentheses, brackets, slashes, dashes, commas.
  const segments = itemName.split(/[()\[\]\/\-,]+/).map((s) => s.trim()).filter(Boolean);
  if (segments.length > 1) {
    addTerm(segments.join(' '));
    for (const segment of segments) {
      addTerm(segment);
    }
  }

  // Include each alias.
  for (const alias of aliases) {
    addTerm(alias);
  }

  for (const term of [...terms]) {
    const normalized = normalizeSearchText(term);
    const compact = normalized.replace(/\s+/g, '');
    if (compact && compact !== normalized) addTerm(compact);
  }

  return terms;
}

export function buildCatalogSearchEntries(
  catalog: CatalogItem[],
  corrections: ParserCorrection[] = [],
): SearchEntry[] {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const entries: SearchEntry[] = [];

  for (const item of catalog) {
    const terms = getCatalogSearchTerms(item.name, item.aliases ?? []);
    // First term is always the full name.
    entries.push(makeEntry(terms[0], item, 'name'));
    for (let i = 1; i < terms.length; i++) {
      const term = terms[i];
      // Check if this term came from an explicit alias.
      const isAlias = (item.aliases ?? []).some(
        (alias) => alias.trim().toLowerCase() === term.toLowerCase(),
      );
      entries.push(makeEntry(term, item, isAlias ? 'alias' : 'parenthetical'));
    }
  }

  for (const correction of corrections) {
    if (!correction.raw_token.trim() || !correction.user_corrected_item_id) continue;
    const item = byId.get(correction.user_corrected_item_id);
    if (item) entries.push(makeEntry(correction.raw_token, item, 'correction'));
  }

  return entries;
}

function makeEntry(value: string, item: CatalogItem, type: SearchEntry['type']): SearchEntry {
  return {
    value,
    normalized: normalizeSearchText(value),
    compact: compactSearchText(value),
    forms: comparableForms(value),
    item,
    type,
  };
}

function exactResult(entry: SearchEntry, matchType: MatchType, confidence: number): CatalogMatchResult {
  return {
    item_id: entry.item.id,
    item_name: entry.item.name,
    matched_alias: entry.type === 'alias' || entry.type === 'parenthetical' || entry.type === 'correction' ? entry.value : undefined,
    match_type: matchType,
    confidence,
    needs_clarification: false,
  };
}

export function matchCatalogItem(
  itemText: string,
  catalog: CatalogItem[],
  corrections: ParserCorrection[] = [],
): CatalogMatchResult {
  const normalized = normalizeSearchText(itemText);
  const compact = compactSearchText(itemText);
  const inputForms = comparableForms(itemText);
  if (!normalized) return unresolved(itemText, 'Missing item name.');

  const entries = buildCatalogSearchEntries(catalog, corrections);

  const exactName = entries.filter((entry) => entry.type === 'name' && entry.normalized === normalized);
  if (exactName.length === 1) return exactResult(exactName[0], 'exact_name', 1);
  if (exactName.length > 1) return ambiguous(exactName.map((entry) => ({ item: entry.item, confidence: 0.99 })), 'Ambiguous item name.');

  const exactAlias = entries.filter((entry) => entry.type === 'alias' && entry.normalized === normalized);
  if (exactAlias.length === 1) return exactResult(exactAlias[0], 'exact_alias', 0.99);
  if (exactAlias.length > 1) return ambiguous(exactAlias.map((entry) => ({ item: entry.item, confidence: 0.98 })), 'Alias matches multiple items.');

  // Parenthetical / bracketed sub-terms (e.g. "Izumidai" from "White Fish (Izumidai)").
  const exactParenthetical = entries.filter((entry) => entry.type === 'parenthetical' && entry.normalized === normalized);
  if (exactParenthetical.length === 1) return exactResult(exactParenthetical[0], 'exact_alias', 0.98);
  if (exactParenthetical.length > 1) return ambiguous(exactParenthetical.map((entry) => ({ item: entry.item, confidence: 0.97 })), 'Parenthetical term matches multiple items.');

  const exactCorrection = entries.filter((entry) => entry.type === 'correction' && entry.normalized === normalized);
  if (exactCorrection.length === 1) return exactResult(exactCorrection[0], 'correction', 0.97);
  if (exactCorrection.length > 1) return ambiguous(exactCorrection.map((entry) => ({ item: entry.item, confidence: 0.96 })), 'Recent corrections disagree.');

  const normalizedExact = entries.filter(
    (entry) => entry.compact === compact || setsIntersect(inputForms, entry.forms),
  );
  const normalizedExactItems = uniqueEntriesByItem(normalizedExact);
  if (normalizedExactItems.length === 1) {
    const entry = normalizedExactItems[0];
    return exactResult(entry, entry.type === 'alias' ? 'exact_alias' : 'normalized', 0.94);
  }
  if (normalizedExactItems.length > 1) {
    return ambiguous(normalizedExactItems.map((entry) => ({ item: entry.item, confidence: 0.93 })), 'Text matches multiple catalog entries.');
  }

  const tokenMatches = entries.filter((entry) => isUnambiguousTokenMatch(normalized, entry.normalized));
  const tokenAlternatives = uniqueAlternatives(tokenMatches.map((entry) => ({ item: entry.item, confidence: 0.86 })));
  if (tokenAlternatives.length === 1) {
    const item = catalog.find((entry) => entry.id === tokenAlternatives[0].item_id)!;
    return {
      item_id: item.id,
      item_name: item.name,
      match_type: 'token',
      confidence: 0.86,
      needs_clarification: false,
    };
  }
  if (tokenAlternatives.length > 1) {
    return {
      item_id: null,
      item_name: null,
      match_type: 'token',
      confidence: tokenAlternatives[0].confidence,
      needs_clarification: true,
      issue: 'Item text matches multiple catalog items.',
      alternatives: tokenAlternatives,
    };
  }

  return fuzzyMatch(normalized, entries);
}

function uniqueEntriesByItem(entries: SearchEntry[]): SearchEntry[] {
  const byId = new Map<string, SearchEntry>();
  for (const entry of entries) {
    if (!byId.has(entry.item.id)) byId.set(entry.item.id, entry);
  }
  return [...byId.values()];
}

function setsIntersect(a: Set<string>, b: Set<string>): boolean {
  for (const value of a) {
    if (b.has(value)) return true;
  }
  return false;
}

function isUnambiguousTokenMatch(needle: string, haystack: string): boolean {
  if (!needle || !haystack) return false;
  if (haystack.startsWith(`${needle} `) || haystack === needle) return true;
  const needleTokens = needle.split(' ');
  const haystackTokens = new Set(haystack.split(' '));
  return needleTokens.length > 1 && needleTokens.every((token) => haystackTokens.has(token));
}

function fuzzyMatch(needle: string, entries: SearchEntry[]): CatalogMatchResult {
  const scored = entries
    .map((entry) => ({ entry, confidence: similarity(needle, entry.normalized) }))
    .filter((entry) => entry.confidence >= 0.55)
    .sort((a, b) => b.confidence - a.confidence);

  const alternatives = uniqueAlternatives(scored.map((entry) => ({
    item: entry.entry.item,
    confidence: entry.confidence,
  })));

  if (alternatives.length === 0) return unresolved(needle, 'Item could not be matched to the catalog.');

  const [best, second] = alternatives;
  if (best.confidence < 0.65) return unresolved(needle, 'Item match is too uncertain.', alternatives);
  if (second && best.confidence - second.confidence < 0.08) {
    return {
      item_id: null,
      item_name: null,
      match_type: 'fuzzy',
      confidence: best.confidence,
      needs_clarification: true,
      issue: 'Item match is ambiguous.',
      alternatives,
    };
  }

  const needsReview = best.confidence < 0.8;
  return {
    item_id: best.item_id,
    item_name: best.item_name,
    match_type: 'fuzzy',
    confidence: best.confidence,
    needs_clarification: needsReview,
    issue: needsReview ? 'Review fuzzy item match.' : undefined,
    alternatives: needsReview ? alternatives : undefined,
  };
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const compactA = compactSearchText(a);
  const compactB = compactSearchText(b);
  if (compactA === compactB) return 0.96;
  const distance = levenshtein(compactA, compactB);
  const maxLength = Math.max(compactA.length, compactB.length);
  const editScore = maxLength === 0 ? 0 : 1 - distance / maxLength;
  if (distance <= 1 && Math.min(compactA.length, compactB.length) >= 3) {
    return Math.max(editScore, 0.86);
  }
  const tokenScore = tokenDice(a, b);
  const prefixBoost = compactB.startsWith(compactA) || compactA.startsWith(compactB) ? 0.08 : 0;
  return Math.min(0.99, Math.max(editScore, tokenScore) + prefixBoost);
}

function tokenDice(a: string, b: string): number {
  const aTokens = new Set(normalizeSearchText(a).split(' ').filter(Boolean));
  const bTokens = new Set(normalizeSearchText(b).split(' ').filter(Boolean));
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

function unresolved(
  itemText: string,
  issue: string,
  alternatives: CatalogAlternative[] = [],
): CatalogMatchResult {
  return {
    item_id: null,
    item_name: itemText || null,
    match_type: 'unresolved',
    confidence: alternatives[0]?.confidence ?? 0,
    needs_clarification: true,
    issue,
    alternatives: alternatives.length > 0 ? alternatives : undefined,
  };
}

function ambiguous(entries: { item: CatalogItem; confidence: number }[], issue: string): CatalogMatchResult {
  const alternatives = uniqueAlternatives(entries);
  return {
    item_id: null,
    item_name: null,
    match_type: 'unresolved',
    confidence: alternatives[0]?.confidence ?? 0,
    needs_clarification: true,
    issue,
    alternatives,
  };
}
