import {
  buildCatalogSearchIndex,
  analyzeSemanticTokens,
  catalogNameStructuralSegmentMatches,
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
import type { CatalogSearchIndex } from './catalog-search-index.ts';

export {
  buildCatalogSearchIndex,
  analyzeSemanticTokens,
  catalogNameStructuralSegmentMatches,
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
  index?: CatalogSearchIndex,
): CatalogMatchResult {
  return matchCatalogIndex(itemText, index ?? buildCatalogSearchIndex(catalog, corrections));
}

export function getTopCatalogAlternatives(
  itemText: string,
  catalog: CatalogItem[],
  corrections: ParserCorrection[] = [],
  limit = 3,
  index?: CatalogSearchIndex,
): CatalogAlternative[] {
  return findCatalogAlternatives(itemText, index ?? buildCatalogSearchIndex(catalog, corrections), limit);
}
