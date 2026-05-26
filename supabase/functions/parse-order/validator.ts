import type {
  CandidateParsedLine,
  CatalogAlternative,
  CatalogItem,
  CatalogMatchResult,
  ParsedItem,
  ParseFlag,
  ParseSource,
  QuickOrderUnitRule,
} from './types.ts';
import { matchCatalogItem } from './catalog-matcher.ts';
import type { CatalogSearchIndex } from './catalog-search-index.ts';
import { resolveMissingUnit, resolveUnit, type RuleResolverContext } from './rule-resolver.ts';
import {
  deriveAllowedUnitLabels,
  deriveAllowedUnits,
  displayUnitLabel,
  formatAllowedUnitList,
  getUnitWords,
  isKnownUnit,
  isUnitAllowedForItem,
  normalizeUnit,
  singleAllowedUnit,
  DEFAULT_UNIT_ALIASES,
  type UnitAliasMap,
} from './units.ts';

export function validateParsedLine(input: {
  candidate: CandidateParsedLine;
  match: CatalogMatchResult;
  catalog: CatalogItem[];
  parseSource?: ParseSource;
  unitAliases?: UnitAliasMap;
  unitRules?: QuickOrderUnitRule[];
  resolverContext?: RuleResolverContext;
}): { item: ParsedItem; flags: ParseFlag[] } {
  const unitAliases = input.unitAliases ?? DEFAULT_UNIT_ALIASES;
  const { candidate, match, catalog } = input;
  const flags: ParseFlag[] = [];
  const catalogItem = match.item_id ? catalog.find((item) => item.id === match.item_id) ?? null : null;
  let quantity = candidate.quantity != null && candidate.quantity > 0 ? candidate.quantity : null;
  const rawUnit = candidate.unit_raw ?? candidate.unit;
  const normalizedUnit = normalizeUnit(candidate.unit, unitAliases);
  let unit = normalizedUnit ?? rawUnit?.trim().toLowerCase() ?? null;
  const unitResolution = catalogItem && input.unitRules?.length && input.resolverContext
    ? (unit
        ? resolveUnit({ item: catalogItem, typedUnit: unit, unitRules: input.unitRules, unitAliases, context: input.resolverContext })
        : resolveMissingUnit({ item: catalogItem, unitRules: input.unitRules, unitAliases, context: input.resolverContext }))
    : null;
  if (unitResolution?.unit) unit = unitResolution.unit;
  if (quantity != null && unitResolution) quantity *= unitResolution.multiplier;
  // No unit typed, but the item can only be ordered in one unit — there is
  // nothing to choose, so adopt it instead of asking the employee to pick.
  if (!unit && catalogItem) {
    unit = singleAllowedUnit(catalogItem) ?? unit;
  }
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
  } else if (!isKnownUnit(unit, unitAliases)) {
    needsClarification = true;
    invalidUnit = true;
    const validUnits = deriveAllowedUnitLabels(catalogItem);
    const unitList = validUnits.length > 0 ? ` Use ${formatAllowedUnitList(validUnits)}.` : ' Use a valid unit.';
    issue = issue ?? (catalogItem
      ? `${catalogItem.name} cannot be ordered as ${displayUnitLabel(unit)}.${unitList}`
      : `"${displayUnitLabel(unit)}" is not a recognized order unit.`);
    flags.push({
      type: 'invalid_unit',
      message: `"${displayUnitLabel(unit)}" is not a recognized order unit.`,
      raw_token: candidate.raw_text,
      item_id: catalogItem?.id,
      reason: 'invalid_unit',
    });
  } else if (catalogItem && !isUnitAllowedForItem(catalogItem, unit)) {
    needsClarification = true;
    invalidUnit = true;
    const validUnits = deriveAllowedUnitLabels(catalogItem);
    const unitList = validUnits.length > 0 ? ` Use ${formatAllowedUnitList(validUnits)}.` : ' Use a valid unit.';
    issue = issue ?? `${catalogItem.name} cannot be ordered as ${displayUnitLabel(unit)}.${unitList}`;
    flags.push({
      type: 'unsupported_unit',
      message: `${catalogItem.name} cannot be ordered as ${displayUnitLabel(unit)}. Use ${formatAllowedUnitList(validUnits)}.`,
      raw_token: candidate.raw_text,
      item_id: catalogItem.id,
      reason: 'unsupported_unit',
    });
  }

  const confidence = Math.min(candidate.parse_confidence, match.confidence || 0.5);
  const source: ParseSource = input.parseSource ?? (match.match_type === 'fuzzy' ? 'fuzzy' : 'deterministic');
  const displayName = catalogItem?.name ?? match.item_name ?? candidate.item_text ?? 'Unresolved item';
  const aliasMetadata = catalogItem && match.matched_alias
    ? {
        reason_codes: [match.match_type === 'employee_alias' ? 'employee_alias' : 'global_alias'],
        resolution_trace: [`Matched "${match.matched_alias}" to ${catalogItem.name}.`],
        alias_source: match.match_type === 'employee_alias' ? 'employee' as const : 'global' as const,
        confidence: match.confidence,
        user_visible_note: match.match_type === 'employee_alias'
          ? `Matched "${match.matched_alias}" to ${catalogItem.name} using an employee inventory alias.`
          : `Matched "${match.matched_alias}" to ${catalogItem.name} using a global alias.`,
      }
    : catalogItem && match.match_type === 'fuzzy'
      ? {
          reason_codes: ['fuzzy_match'],
          resolution_trace: [`Closest match for "${candidate.item_text}" was ${catalogItem.name}.`],
          alias_source: 'fuzzy' as const,
          confidence: match.confidence,
          user_visible_note: match.needs_clarification
            ? `Please confirm ${catalogItem.name}; this was a low-confidence match.`
            : null,
        }
      : null;
  const reasonCodes = [...(aliasMetadata?.reason_codes ?? []), ...(unitResolution?.metadata.reason_codes ?? [])];
  const resolutionTrace = [...(aliasMetadata?.resolution_trace ?? []), ...(unitResolution?.metadata.resolution_trace ?? [])];

  const item: ParsedItem = {
    id: `parsed:${candidate.line_index}:${candidate.normalized_text}`,
    client_id: `parsed:${candidate.line_index}:${candidate.normalized_text}`,
    line_id: candidate.line_id,
    source_text: candidate.raw_text,
    item_id: catalogItem?.id ?? null,
    item_name: catalogItem?.name ?? match.item_name ?? null,
    display_name: displayName,
    name: displayName,
    item_text: candidate.item_text,
    raw_token: candidate.raw_text,
    raw_text: candidate.raw_text,
    quantity,
    unit,
    unit_raw: rawUnit,
    unit_normalized: normalizedUnit,
    valid_units: deriveAllowedUnits(catalogItem),
    confidence,
    needs_clarification: needsClarification,
    unresolved,
    notes: null,
    issue,
    issue_code: undefined,
    action: null,
    alternatives: match.alternatives,
    candidate_matches: match.alternatives,
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
    matched_alias: match.matched_alias ?? null,
    resolution: aliasMetadata ?? unitResolution?.metadata,
    reason_codes: reasonCodes.length > 0 ? reasonCodes : undefined,
    resolution_trace: resolutionTrace.length > 0 ? resolutionTrace : undefined,
    user_visible_note: aliasMetadata?.user_visible_note ?? unitResolution?.metadata.user_visible_note,
    diagnostics: {
      match_type: match.match_type,
      match_confidence: match.confidence,
      token_coverage: match.token_coverage,
      semantic_validation_passed: match.semantic_validation_passed,
      unit_validation_result: invalidUnit ? 'invalid' : unit ? 'valid_or_unchecked' : 'missing',
    },
  };

  return {
    item: normalizeParsedItemStatus(item, catalogItem, unitAliases),
    flags,
  };
}

export function normalizeParsedItemStatus(
  item: ParsedItem,
  catalogItem: CatalogItem | null | undefined,
  unitAliases: UnitAliasMap = DEFAULT_UNIT_ALIASES,
): ParsedItem {
  const quantity = item.quantity != null && Number.isFinite(item.quantity) && item.quantity > 0
    ? item.quantity
    : null;
  const rawUnit = item.unit_raw ?? item.unit;
  const normalizedUnit = normalizeUnit(item.unit, unitAliases);
  let unit = normalizedUnit ?? rawUnit?.trim().toLowerCase() ?? null;
  const hasItem = Boolean(item.item_id && catalogItem);
  // Single-unit items have nothing to choose — fill in their only unit rather
  // than surfacing a "Choose unit" prompt.
  if (!unit && hasItem) {
    unit = singleAllowedUnit(catalogItem) ?? unit;
  }
  let status: ParsedItem['status'];
  let needsClarification = true;
  let unresolved = !hasItem;
  let issue = item.issue;
  let issueCode: ParsedItem['issue_code'];

  if (!hasItem) {
    status = hasStrongCandidateMatch(item.alternatives) ? 'ambiguous' : 'no_match';
    issueCode = status;
    issue = issue ?? (status === 'ambiguous'
      ? `Which ${item.item_text ?? item.raw_token ?? 'item'} did you mean?`
      : `I couldn’t find "${item.item_text ?? item.raw_token ?? 'that item'}" in this location’s inventory.`);
  } else if (quantity == null && !unit && deriveAllowedUnits(catalogItem).length === 0) {
    status = 'missing_quantity_and_unit';
    unresolved = false;
    issueCode = status;
    issue = `How much ${catalogItem?.name ?? item.item_name ?? 'this item'} would you like, and what unit?`;
  } else if (quantity == null) {
    status = 'missing_quantity';
    unresolved = false;
    issueCode = status;
    issue = `How much ${catalogItem?.name ?? item.item_name ?? 'this item'} would you like?`;
  } else if (!unit) {
    status = 'missing_unit';
    unresolved = false;
    issueCode = status;
    issue = `What unit would you like for ${catalogItem?.name ?? item.item_name ?? 'this item'}?`;
  } else if (!isKnownUnit(unit, unitAliases) || !isUnitAllowedForItem(catalogItem, unit)) {
    status = 'invalid_unit';
    unresolved = false;
    issueCode = status;
    const validUnits = deriveAllowedUnitLabels(catalogItem);
    const unitList = validUnits.length > 0 ? ` Use ${formatAllowedUnitList(validUnits)}.` : ' Use a valid unit.';
    issue = `${catalogItem?.name ?? item.item_name ?? 'This item'} cannot be ordered as ${displayUnitLabel(unit)}.${unitList}`;
  } else {
    status = 'valid';
    needsClarification = false;
    unresolved = false;
    issue = undefined;
    issueCode = undefined;
  }

  return {
    ...item,
    client_id: item.client_id ?? item.id ?? item.line_id,
    source_text: item.source_text ?? item.raw_text ?? item.raw_token,
    item_name: catalogItem?.name ?? item.item_name,
    display_name: catalogItem?.name ?? item.display_name,
    name: catalogItem?.name ?? item.name,
    quantity,
    unit,
    unit_raw: rawUnit,
    unit_normalized: normalizedUnit,
    valid_units: deriveAllowedUnits(catalogItem),
    status,
    needs_clarification: needsClarification,
    unresolved,
    issue,
    issue_code: issueCode,
    action: actionForStatus(status),
    candidate_matches: item.candidate_matches ?? item.alternatives,
    diagnostics: {
      ...(item.diagnostics ?? {}),
      final_status: status,
      unit_validation_result: status === 'invalid_unit' ? 'invalid' : unit ? 'valid' : 'missing',
      valid_units: deriveAllowedUnits(catalogItem),
    },
  };
}

function hasStrongCandidateMatch(alternatives: CatalogAlternative[] | undefined): boolean {
  return Boolean(alternatives?.some((alternative) =>
    (alternative.confidence ?? alternative.score ?? 0) >= 0.75 &&
    alternative.semantic_validation_passed !== false
  ));
}

export function actionForStatus(status: ParsedItem['status']): ParsedItem['action'] {
  switch (status) {
    case 'valid':
      return null;
    case 'missing_quantity':
    case 'missing_quantity_and_unit':
      return 'Add quantity';
    case 'missing_unit':
      return 'Choose unit';
    case 'invalid_unit':
      return 'Fix unit';
    case 'no_match':
    case 'ambiguous':
      return 'Choose item';
    case 'duplicate_needs_decision':
      return 'Add or replace';
    default:
      return null;
  }
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
  if (input.quantity == null && !input.unit) return 'missing_quantity_and_unit';
  if (input.quantity == null) return 'missing_quantity';
  if (!input.unit) return 'missing_unit';
  if (input.invalidUnit) return 'invalid_unit';
  if (input.matchNeedsClarification) return 'ambiguous';
  return 'valid';
}

export function validateLlmItem(input: {
  raw: Record<string, unknown>;
  catalog: CatalogItem[];
  catalogIndex?: CatalogSearchIndex;
  unitAliases?: UnitAliasMap;
}): { item: ParsedItem; flags: ParseFlag[] } {
  const unitAliases = input.unitAliases ?? DEFAULT_UNIT_ALIASES;
  const rawToken = stringValue(input.raw.raw_token) ?? stringValue(input.raw.raw_text) ?? stringValue(input.raw.item_name) ?? '';
  const semanticInput = semanticInputFromRaw(rawToken, unitAliases) || stringValue(input.raw.item_text) || stringValue(input.raw.item_name) || rawToken;
  const quantity = numberValue(input.raw.quantity);
  const rawUnit = stringValue(input.raw.unit);
  const unit = normalizeUnit(rawUnit, unitAliases) ?? rawUnit;
  const match = matchCatalogItem(semanticInput, input.catalog, [], input.catalogIndex);
  const catalogItem = match.item_id ? input.catalog.find((item) => item.id === match.item_id) ?? null : null;
  const validatedMatch: CatalogMatchResult = catalogItem
    ? {
      item_id: catalogItem.id,
      item_name: catalogItem.name,
      match_type: 'llm',
      confidence: Math.min(numberValue(input.raw.confidence) ?? 0.7, match.confidence),
      needs_clarification: false,
      alternatives: match.alternatives,
    }
    : {
      item_id: null,
      item_name: semanticInput || rawToken,
      match_type: 'unresolved',
      confidence: 0,
      needs_clarification: true,
      issue: 'LLM extraction did not resolve to a validated catalog item.',
      alternatives: match.alternatives,
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
    match: validatedMatch,
    catalog: input.catalog,
    parseSource: 'llm',
    unitAliases,
  });
}

function semanticInputFromRaw(value: string, unitAliases: UnitAliasMap): string {
  const unitPattern = getUnitWords(unitAliases).join('|');
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
