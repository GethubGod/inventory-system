import type {
  CandidateParsedLine,
  CatalogItem,
  CatalogMatchResult,
  ParsedItem,
  ParseFlag,
  ParseSource,
} from './types.ts';
import { isKnownUnit, isUnitAllowedForItem, normalizeUnit } from './units.ts';

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

  if (!catalogItem) {
    flags.push({
      type: match.alternatives?.length ? 'ambiguous_item' : 'unresolved_item',
      message: match.alternatives?.length
        ? `Which item did you mean by ${candidate.item_text}?`
        : `I couldn't match "${candidate.item_text}" to the catalog.`,
      raw_token: candidate.raw_text,
      possible_matches: match.alternatives,
      reason: match.alternatives?.length ? 'ambiguous' : 'no_match',
    });
  }

  if (quantity == null) {
    needsClarification = true;
    issue = issue ?? 'Missing quantity.';
    flags.push({
      type: 'missing_quantity',
      message: catalogItem ? `How much ${catalogItem.name}?` : 'Quantity is missing or invalid.',
      raw_token: candidate.raw_text,
      item_id: catalogItem?.id,
      reason: 'quantity_missing',
    });
  }

  if (!unit) {
    needsClarification = true;
    issue = issue ?? 'Missing unit.';
    flags.push({
      type: 'missing_unit',
      message: catalogItem ? `What unit for ${catalogItem.name}?` : 'Unit is missing.',
      raw_token: candidate.raw_text,
      item_id: catalogItem?.id,
      reason: 'unit_missing',
    });
  } else if (!isKnownUnit(unit)) {
    needsClarification = true;
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
    issue = issue ?? `${unit} is not configured for ${catalogItem.name}.`;
    flags.push({
      type: 'unsupported_unit',
      message: `${catalogItem.name} is not configured for ${unit}.`,
      raw_token: candidate.raw_text,
      item_id: catalogItem.id,
      reason: 'unsupported_unit',
    });
  }

  const confidence = Math.min(candidate.parse_confidence, match.confidence || 0.5);
  const source: ParseSource = input.parseSource ?? (match.match_type === 'fuzzy' ? 'fuzzy' : 'deterministic');
  const displayName = catalogItem?.name ?? match.item_name ?? candidate.item_text ?? 'Unresolved item';

  return {
    item: {
      id: `parsed:${candidate.line_index}:${candidate.normalized_text}`,
      item_id: catalogItem?.id ?? null,
      item_name: catalogItem?.name ?? match.item_name ?? null,
      display_name: displayName,
      name: displayName,
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
        quantity,
        unit,
        issue,
      }),
      match_type: match.match_type,
    },
    flags,
  };
}

function getParsedItemStatus(input: {
  unresolved: boolean;
  matchNeedsClarification: boolean;
  quantity: number | null;
  unit: string | null;
  issue?: string;
}) {
  if (input.unresolved) return input.matchNeedsClarification ? 'ambiguous' : 'review';
  if (input.quantity == null) return 'missing_quantity';
  if (!input.unit) return 'missing_unit';
  if (input.matchNeedsClarification || input.issue) return 'review';
  return 'valid';
}

export function validateLlmItem(input: {
  raw: Record<string, unknown>;
  catalog: CatalogItem[];
}): { item: ParsedItem; flags: ParseFlag[] } {
  const itemId = typeof input.raw.item_id === 'string' ? input.raw.item_id : null;
  const catalogItem = itemId ? input.catalog.find((item) => item.id === itemId) ?? null : null;
  const rawToken = stringValue(input.raw.raw_token) ?? stringValue(input.raw.raw_text) ?? stringValue(input.raw.item_name) ?? '';
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
      issue: itemId ? 'LLM returned item outside catalog.' : 'LLM did not resolve item.',
    };

  return validateParsedLine({
    candidate: {
      raw_text: rawToken,
      normalized_text: rawToken.toLowerCase(),
      item_text: stringValue(input.raw.item_name) ?? rawToken,
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
