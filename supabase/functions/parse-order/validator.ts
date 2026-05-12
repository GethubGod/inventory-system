import type {
  CandidateParsedLine,
  CatalogItem,
  CatalogMatchResult,
  ParsedItem,
  ParseFlag,
  ParseSource,
} from './types.ts';
import { analyzeSemanticTokens } from './catalog-matcher.ts';
import { isKnownUnit, isUnitAllowedForItem, normalizeUnit, UNIT_WORDS } from './units.ts';

export function validateParsedLine(input: {
  candidate: CandidateParsedLine;
  match: CatalogMatchResult;
  catalog: CatalogItem[];
  parseSource?: ParseSource;
}): { item: ParsedItem; flags: ParseFlag[] } {
  const { candidate, match, catalog } = input;
  const flags: ParseFlag[] = [];
  const catalogItem = match.item_id ? catalog.find((item) => item.id === match.item_id) ?? null : null;
  const quantity = candidate.quantity != null && candidate.quantity > 0 ? candidate.quantity : null;
  const unit = candidate.unit ? normalizeUnit(candidate.unit) : null;
  const unresolved = !catalogItem;
  let needsClarification = unresolved || match.needs_clarification;
  let issue = match.issue;
  let invalidUnit = false;

  if (!catalogItem) {
    flags.push({
      type: match.alternatives?.length ? 'ambiguous_item' : 'unresolved_item',
      message: match.alternatives?.length
        ? `Which item did you mean by "${candidate.item_text}"?`
        : `I could not find "${candidate.item_text}" in the inventory catalog.`,
      raw_token: candidate.raw_text,
      possible_matches: match.alternatives,
      reason: match.alternatives?.length ? 'ambiguous' : 'no_match',
    });
  }

  if (quantity == null) {
    needsClarification = true;
    issue = issue ?? (catalogItem ? `How much ${catalogItem.name} would you like?` : 'Missing quantity.');
    flags.push({
      type: 'missing_quantity',
      message: catalogItem ? `How much ${catalogItem.name} would you like?` : 'Quantity is missing or invalid.',
      raw_token: candidate.raw_text,
      item_id: catalogItem?.id,
      reason: 'quantity_missing',
    });
  }

  if (!unit) {
    needsClarification = true;
    issue = issue ?? (catalogItem ? `What unit would you like for ${catalogItem.name}?` : 'Missing unit.');
    flags.push({
      type: 'missing_unit',
      message: catalogItem ? `What unit would you like for ${catalogItem.name}?` : 'Unit is missing.',
      raw_token: candidate.raw_text,
      item_id: catalogItem?.id,
      reason: 'unit_missing',
    });
  } else if (!isKnownUnit(unit)) {
    needsClarification = true;
    invalidUnit = true;
    issue = issue ?? 'Unit is not supported.';
    flags.push({
      type: 'invalid_unit',
      message: `"${unit}" is not a recognized order unit.`,
      raw_token: candidate.raw_text,
      item_id: catalogItem?.id,
      reason: 'invalid_unit',
    });
  } else if (catalogItem && !isUnitAllowedForItem(catalogItem, unit)) {
    needsClarification = true;
    invalidUnit = true;
    issue = issue ?? `${catalogItem.name} cannot be ordered in ${unit}. Choose a valid unit.`;
    flags.push({
      type: 'unsupported_unit',
      message: `${catalogItem.name} cannot be ordered in ${unit}. Choose a valid unit.`,
      raw_token: candidate.raw_text,
      item_id: catalogItem.id,
      reason: 'unsupported_unit',
    });
  }

  const confidence = Math.min(candidate.parse_confidence, match.confidence || 0.5);
  const source: ParseSource = input.parseSource ?? (match.match_type === 'fuzzy' ? 'fuzzy' : 'deterministic');
  const displayName = catalogItem?.name ?? match.item_name ?? candidate.item_text ?? 'Unresolved item';

  const item: ParsedItem = {
    id: `parsed:${candidate.line_index}:${candidate.normalized_text}`,
    line_id: candidate.line_id,
    item_id: catalogItem?.id ?? null,
    item_name: catalogItem?.name ?? match.item_name ?? null,
    display_name: displayName,
    name: displayName,
    item_text: candidate.item_text,
    raw_token: candidate.raw_text,
    raw_text: candidate.raw_text,
    quantity,
    unit,
    confidence,
    needs_clarification: needsClarification,
    unresolved,
    notes: null,
    issue,
    alternatives: match.alternatives,
    parse_source: source,
    status: getParsedItemStatus({
      unresolved,
      matchNeedsClarification: match.needs_clarification,
      alternatives: match.alternatives,
      quantity,
      unit,
      invalidUnit,
      issue,
    }),
    match_type: match.match_type,
  };

  return {
    item: normalizeParsedItemStatus(item, catalogItem),
    flags,
  };
}

export function normalizeParsedItemStatus(item: ParsedItem, catalogItem: CatalogItem | null | undefined): ParsedItem {
  const quantity = item.quantity != null && Number.isFinite(item.quantity) && item.quantity > 0
    ? item.quantity
    : null;
  const unit = normalizeUnit(item.unit);
  const hasItem = Boolean(item.item_id && catalogItem);
  let status: ParsedItem['status'];
  let needsClarification = true;
  let unresolved = !hasItem;
  let issue = item.issue;

  if (!hasItem) {
    status = item.alternatives?.length ? 'ambiguous' : 'no_match';
    issue = issue ?? (status === 'ambiguous' ? 'Which item did you mean?' : 'Item could not be matched.');
  } else if (quantity == null) {
    status = 'missing_quantity';
    unresolved = false;
    issue = `How much ${catalogItem?.name ?? item.item_name ?? 'this item'} would you like?`;
  } else if (!unit) {
    status = 'missing_unit';
    unresolved = false;
    issue = `What unit would you like for ${catalogItem?.name ?? item.item_name ?? 'this item'}?`;
  } else if (!isKnownUnit(unit) || !isUnitAllowedForItem(catalogItem, unit)) {
    status = 'invalid_unit';
    unresolved = false;
    issue = `${catalogItem?.name ?? item.item_name ?? 'This item'} cannot be ordered in ${unit}. Choose a valid unit.`;
  } else {
    status = 'valid';
    needsClarification = false;
    unresolved = false;
    issue = undefined;
  }

  return {
    ...item,
    item_name: catalogItem?.name ?? item.item_name,
    display_name: catalogItem?.name ?? item.display_name,
    name: catalogItem?.name ?? item.name,
    quantity,
    unit,
    status,
    needs_clarification: needsClarification,
    unresolved,
    issue,
  };
}

function getParsedItemStatus(input: {
  unresolved: boolean;
  matchNeedsClarification: boolean;
  alternatives?: unknown[];
  quantity: number | null;
  unit: string | null;
  invalidUnit: boolean;
  issue?: string;
}) {
  if (input.unresolved) return input.alternatives?.length ? 'ambiguous' : 'no_match';
  if (input.quantity == null) return 'missing_quantity';
  if (!input.unit) return 'missing_unit';
  if (input.invalidUnit) return 'invalid_unit';
  if (input.matchNeedsClarification) return 'ambiguous';
  if (input.issue) return 'review';
  return 'valid';
}

export function validateLlmItem(input: {
  raw: Record<string, unknown>;
  catalog: CatalogItem[];
}): { item: ParsedItem; flags: ParseFlag[] } {
  const itemId = typeof input.raw.item_id === 'string' ? input.raw.item_id : null;
  const rawToken = stringValue(input.raw.raw_token) ?? stringValue(input.raw.raw_text) ?? stringValue(input.raw.item_name) ?? '';
  const semanticInput = semanticInputFromRaw(rawToken) || stringValue(input.raw.item_text) || stringValue(input.raw.item_name) || rawToken;
  const proposedCatalogItem = itemId ? input.catalog.find((item) => item.id === itemId) ?? null : null;
  const semantic = proposedCatalogItem ? analyzeSemanticTokens(semanticInput, proposedCatalogItem.name) : null;
  const catalogItem = proposedCatalogItem && semantic?.passed ? proposedCatalogItem : null;
  const quantity = numberValue(input.raw.quantity);
  const unit = normalizeUnit(stringValue(input.raw.unit));
  const match: CatalogMatchResult = catalogItem
    ? {
      item_id: catalogItem.id,
      item_name: catalogItem.name,
      match_type: 'llm',
      confidence: numberValue(input.raw.confidence) ?? 0.7,
      needs_clarification: false,
    }
    : {
      item_id: null,
      item_name: stringValue(input.raw.item_name) ?? rawToken,
      match_type: 'unresolved',
      confidence: 0,
      needs_clarification: true,
      issue: itemId
        ? semantic && !semantic.passed
          ? `LLM suggestion failed semantic validation: ${semantic.reason}.`
          : 'LLM returned item outside catalog.'
        : 'LLM did not resolve item.',
    };

  return validateParsedLine({
    candidate: {
      line_id: typeof input.raw.line_id === 'string' ? input.raw.line_id : `llm_${rawToken.slice(0, 30)}`,
      raw_text: rawToken,
      normalized_text: rawToken.toLowerCase(),
      item_text: semanticInput,
      quantity,
      unit,
      parse_source: 'deterministic',
      parse_confidence: numberValue(input.raw.confidence) ?? 0.7,
      line_index: 0,
    },
    match,
    catalog: input.catalog,
    parseSource: 'llm',
  });
}

function semanticInputFromRaw(value: string): string {
  const unitPattern = UNIT_WORDS.join('|');
  return value
    .replace(/\b\d+(?:\.\d+)?\s*(?:[a-zA-Z]+)?\b/g, ' ')
    .replace(new RegExp(`\\b(?:${unitPattern})\\b`, 'gi'), ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}
