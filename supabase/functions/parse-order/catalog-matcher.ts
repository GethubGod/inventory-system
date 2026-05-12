import {
  buildCatalogSearchIndex,
  analyzeSemanticTokens,
  findCatalogAlternatives,
  getCatalogSearchTerms,
  isStrongDeterministicMatch,
  matchCatalogIndex,
  normalizeCatalogText,
  similarity,
} from './catalog-search-index.ts';
import type {
  CatalogAlternative,
  CatalogItem,
  CatalogMatchResult,
  ParserCorrection,
} from './types.ts';

export {
  buildCatalogSearchIndex,
  analyzeSemanticTokens,
  findCatalogAlternatives,
  getCatalogSearchTerms,
  isStrongDeterministicMatch,
  matchCatalogIndex,
  normalizeCatalogText as normalizeSearchText,
  similarity,
};

export function matchCatalogItem(
  itemText: string,
  catalog: CatalogItem[],
  corrections: ParserCorrection[] = [],
): CatalogMatchResult {
  return matchCatalogIndex(itemText, buildCatalogSearchIndex(catalog, corrections));
}

export function getTopCatalogAlternatives(
  itemText: string,
  catalog: CatalogItem[],
  corrections: ParserCorrection[] = [],
  limit = 3,
): CatalogAlternative[] {
  return findCatalogAlternatives(itemText, buildCatalogSearchIndex(catalog, corrections), limit);
}
