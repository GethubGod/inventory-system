import { matchCatalogIndex, normalizeSearchText } from './catalog-matcher.ts';
import type { CatalogSearchIndex } from './catalog-search-index.ts';
import { normalizeUnitForComparison, type UnitAliasMap } from './units.ts';
import type {
  CatalogItem,
  CatalogMatchResult,
  ComposerMode,
  QuickOrderAliasRule,
  QuickOrderReorderRule,
  QuickOrderResolutionMetadata,
  QuickOrderStatusTerm,
  QuickOrderUnitRule,
} from './types.ts';

export type RuleResolverContext = {
  employeeNameKeys?: string[];
  employeeUserId?: string | null;
  locationId?: string | null;
  mode: ComposerMode;
  settings?: Record<string, unknown>;
};

export type UnitResolutionResult = {
  unit: string | null;
  multiplier: number;
  source: NonNullable<QuickOrderResolutionMetadata['unit_source']>;
  rule?: QuickOrderUnitRule | null;
  metadata: QuickOrderResolutionMetadata;
};

export type StatusTermResolutionResult = {
  term: QuickOrderStatusTerm;
  rawPhrase: string;
  metadata: QuickOrderResolutionMetadata;
} | null;

export type ReorderRecommendationResult =
  | {
      status: 'recommend';
      rule: QuickOrderReorderRule;
      suggestedQuantity: number;
      unit: string | null;
      reason: string;
      convertedRemainingQty: number | null;
      metadata: QuickOrderResolutionMetadata;
    }
  | {
      status: 'no_order_needed' | 'needs_input' | 'no_matching_rule' | 'cannot_evaluate';
      rule?: QuickOrderReorderRule | null;
      reason: string;
      convertedRemainingQty?: number | null;
      metadata: QuickOrderResolutionMetadata;
    };

export function normalizeRuleKey(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/\s+/g, ' ');
}

export function resolveItemCandidate(input: {
  inputText: string;
  catalogIndex: CatalogSearchIndex;
  aliasRules?: QuickOrderAliasRule[];
  context: RuleResolverContext;
}): CatalogMatchResult {
  const key = normalizeSearchText(input.inputText);
  const rules = input.aliasRules ?? [];

  const employeeFirst = input.context.mode === 'inventory';
  if (employeeFirst && inventoryEmployeePersonalizationEnabled(input.context)) {
    const employeeMatch = findAliasRuleMatch(rules, key, input.context, 'employee');
    if (employeeMatch) return aliasRuleToMatch(employeeMatch, input.catalogIndex, 'employee');
  }

  const officialMatch = matchCatalogIndex(input.inputText, input.catalogIndex);
  if (officialMatch.match_type === 'exact_name' || officialMatch.match_type === 'compact_exact') {
    return withFuzzyPolicy(officialMatch, input.context);
  }

  if (globalAliasesEnabled(input.context)) {
    const globalMatch = findAliasRuleMatch(rules, key, input.context, 'global');
    if (globalMatch) return aliasRuleToMatch(globalMatch, input.catalogIndex, 'global');
  }

  if (!employeeFirst && orderEmployeePersonalizationEnabled(input.context)) {
    const employeeMatch = findAliasRuleMatch(rules, key, input.context, 'employee');
    if (employeeMatch) return aliasRuleToMatch(employeeMatch, input.catalogIndex, 'employee');
  }

  return withFuzzyPolicy(officialMatch, input.context);
}

export function resolveUnit(input: {
  item: CatalogItem;
  typedUnit: string | null | undefined;
  quantity?: number | null;
  unitRules?: QuickOrderUnitRule[];
  unitAliases?: UnitAliasMap;
  context: RuleResolverContext;
}): UnitResolutionResult {
  if (!input.typedUnit) return resolveMissingUnit(input);
  const normalizedTyped = normalizeUnitForComparison(input.typedUnit, input.unitAliases) ?? normalizeRuleKey(input.typedUnit);
  const matchingRule = findUnitRule({
    rules: input.unitRules ?? [],
    itemId: input.item.id,
    fromUnit: normalizedTyped,
    context: input.context,
    defaultOnly: false,
  });

  if (!matchingRule) {
    return {
      unit: normalizedTyped,
      multiplier: 1,
      source: 'typed',
      rule: null,
      metadata: {
        reason_codes: ['typed_unit_used'],
        resolution_trace: [`Used typed unit ${normalizedTyped}.`],
        unit_source: 'typed',
        confidence: 0.9,
        user_visible_note: null,
      },
    };
  }

  const unit = normalizeUnitForComparison(matchingRule.to_unit, input.unitAliases) ?? normalizeRuleKey(matchingRule.to_unit);
  const employee = matchingRule.scope_type === 'employee';
  const note = employee
    ? `Converted ${input.item.name} ${normalizedTyped} to ${unit} using an employee unit rule.`
    : normalizedTyped === unit
      ? null
      : `Converted ${normalizedTyped} to ${unit}.`;
  return {
    unit,
    multiplier: Number(matchingRule.multiplier ?? 1),
    source: employee ? 'employee_rule' : 'global_rule',
    rule: matchingRule,
    metadata: {
      reason_codes: [employee ? 'employee_unit_rule' : 'global_unit_rule'],
      resolution_trace: [`${normalizedTyped} -> ${unit} x${matchingRule.multiplier ?? 1}`],
      unit_source: employee ? 'employee_rule' : 'global_rule',
      confidence: 0.96,
      user_visible_note: note,
    },
  };
}

export function resolveMissingUnit(input: {
  item: CatalogItem;
  unitRules?: QuickOrderUnitRule[];
  unitAliases?: UnitAliasMap;
  context: RuleResolverContext;
}): UnitResolutionResult {
  const matchingRule = findUnitRule({
    rules: input.unitRules ?? [],
    itemId: input.item.id,
    fromUnit: null,
    context: input.context,
    defaultOnly: true,
  });
  if (matchingRule) {
    const unit = normalizeUnitForComparison(matchingRule.to_unit, input.unitAliases) ?? normalizeRuleKey(matchingRule.to_unit);
    const employee = matchingRule.scope_type === 'employee';
    return {
      unit,
      multiplier: Number(matchingRule.multiplier ?? 1),
      source: employee ? 'employee_rule' : 'global_rule',
      rule: matchingRule,
      metadata: {
        reason_codes: [employee ? 'employee_missing_unit_default' : 'global_missing_unit_default'],
        resolution_trace: [`Missing unit default -> ${unit}`],
        unit_source: employee ? 'employee_rule' : 'global_rule',
        confidence: 0.95,
        user_visible_note: `Used ${unit} because ${input.item.name}'s default order unit is ${unit}.`,
      },
    };
  }

  const fallback = input.context.mode === 'order'
    ? input.item.default_order_unit ?? input.item.order_unit ?? input.item.default_unit ?? input.item.pack_unit ?? input.item.base_unit ?? null
    : input.item.default_unit ?? input.item.base_unit ?? input.item.pack_unit ?? input.item.default_order_unit ?? null;
  const unit = normalizeUnitForComparison(fallback, input.unitAliases) ?? fallback;
  return {
    unit,
    multiplier: 1,
    source: 'item_default',
    rule: null,
    metadata: {
      reason_codes: unit ? ['item_default_unit'] : ['missing_unit_unresolved'],
      resolution_trace: unit ? [`Item default -> ${unit}`] : ['No item default unit found.'],
      unit_source: 'item_default',
      confidence: unit ? 0.86 : 0.2,
      user_visible_note: unit ? `Used ${unit} because ${input.item.name}'s default order unit is ${unit}.` : null,
    },
  };
}

export function resolveStatusTerm(input: {
  inputText: string;
  statusTerms?: QuickOrderStatusTerm[];
  context: RuleResolverContext;
}): StatusTermResolutionResult {
  if (input.context.settings?.status_terms_enabled === false) return null;
  const segmentKey = normalizeRuleKey(input.inputText);
  if (!segmentKey) return null;
  const matches = (input.statusTerms ?? [])
    .filter((term) => term.active !== false)
    .map((term) => ({ term, key: normalizeRuleKey(term.phrase_key ?? term.phrase) }))
    .filter((entry) => entry.key && (segmentKey === entry.key || segmentKey.startsWith(`${entry.key} `)))
    .sort((a, b) => b.key.length - a.key.length);
  const selected = matches[0];
  if (!selected) return null;
  const rawPhrase = input.inputText.trim().slice(0, selected.key.length).trim() || selected.term.phrase;
  return {
    term: selected.term,
    rawPhrase,
    metadata: {
      reason_codes: ['status_term_applied'],
      resolution_trace: [`Matched status phrase "${selected.term.phrase}".`],
      status_term_applied: selected.term.phrase,
      confidence: 0.95,
      user_visible_note: selected.term.recommendation_action === 'no_order'
        ? `No order suggested because "${selected.term.phrase}" means enough stock.`
        : null,
    },
  };
}

export function normalizeTrackingUnitKey(value: string | null | undefined): string | null {
  const normalized = normalizeRuleKey(value ?? '');
  return normalized || null;
}

export function expectedTrackingUnitForRule(
  rule: QuickOrderReorderRule,
  unitRules: QuickOrderUnitRule[],
  context: RuleResolverContext,
): string | null {
  const countedUnit = rule.counted_unit
    ? (normalizeUnitForComparison(rule.counted_unit) ?? normalizeRuleKey(rule.counted_unit))
    : null;
  if (!countedUnit) return null;

  const customUnitRule = unitRules.find((unitRule) =>
    unitRule.active !== false &&
    unitRule.item_id === rule.item_id &&
    unitRule.is_custom_counting_unit === true &&
    modeMatches(unitRule.mode_scope, context.mode) &&
    locationMatches(unitRule.location_id, context.locationId) &&
    (unitRule.scope_type === 'global' || employeeMatches(unitRule, context)) &&
    (
      normalizeTrackingUnitKey(unitRule.tracking_unit) === countedUnit ||
      normalizeRuleKey(unitRule.to_unit ?? '') === countedUnit ||
      normalizeRuleKey(unitRule.from_unit ?? '') === countedUnit
    )
  );

  if (customUnitRule) {
    return normalizeTrackingUnitKey(customUnitRule.tracking_unit ?? customUnitRule.to_unit ?? countedUnit);
  }
  return null;
}

export function resolveReorderRecommendation(input: {
  item: CatalogItem;
  remainingQty: number | null;
  remainingUnit: string | null;
  remainingUnitInferred?: boolean;
  remainingTrackingUnit?: string | null;
  fromStatusPhrase?: boolean;
  rules?: QuickOrderReorderRule[];
  unitRules?: QuickOrderUnitRule[];
  unitAliases?: UnitAliasMap;
  context: RuleResolverContext;
}): ReorderRecommendationResult {
  if (input.context.mode !== 'inventory') {
    return {
      status: 'no_matching_rule',
      reason: 'Reorder rules only apply in inventory mode.',
      metadata: { reason_codes: ['order_mode_no_reorder'], reorder_rule_source: 'none', confidence: 1 },
    };
  }

  const candidates = scopedRules(input.rules ?? [], input.item.id, input.context);
  if (candidates.length === 0) {
    return {
      status: 'no_matching_rule',
      reason: 'No Quick Order V2 reorder rule is configured for this item.',
      metadata: { reason_codes: ['no_reorder_rule'], reorder_rule_source: 'none', confidence: 0.4 },
    };
  }

  let cannotEvaluate: { rule: QuickOrderReorderRule; reason: string } | null = null;
  let trackingUnitMismatch: { rule: QuickOrderReorderRule; reason: string } | null = null;
  for (const rule of candidates) {
    const comparison = compareRule(rule, input);
    if (comparison.status !== 'ok') {
      if (comparison.status === 'tracking_unit_mismatch') {
        if (!trackingUnitMismatch) trackingUnitMismatch = { rule, reason: comparison.reason };
        continue;
      }
      if (comparison.status === 'cannot_evaluate' && !cannotEvaluate) {
        // Remember the first cannot_evaluate but keep trying lower-priority
        // candidates so a unit-mismatch on the top rule does not block a
        // valid global rule or `target_stock` fallback.
        cannotEvaluate = { rule, reason: comparison.reason };
      }
      continue;
    }
    if (!comparison.matches) continue;

    if (rule.action_type === 'no_order') {
      const reason = rule.notes || `${input.item.name} has enough stock. No order is needed.`;
      return {
        status: 'no_order_needed',
        rule,
        reason,
        convertedRemainingQty: comparison.remainingQty,
        metadata: metadataForReorder(rule, reason, 0.94),
      };
    }
    if (rule.action_type === 'ask') {
      const reason = rule.notes || `${input.item.name} needs manager input before I can recommend an order.`;
      return {
        status: 'needs_input',
        rule,
        reason,
        convertedRemainingQty: comparison.remainingQty,
        metadata: metadataForReorder(rule, reason, 0.7),
      };
    }
    if (rule.action_type === 'top_up_to_target') {
      const target = numberOrNull(rule.target_qty);
      const targetUnit = rule.target_unit ?? rule.order_unit ?? input.remainingUnit;
      if (target == null || !targetUnit) {
        const reason = `${input.item.name} matched a top-up rule, but target quantity or unit is missing.`;
        return { status: 'cannot_evaluate', rule, reason, metadata: metadataForReorder(rule, reason, 0.3) };
      }
      const suggested = Math.max(0, target - (comparison.remainingQty ?? 0));
      if (suggested <= 0) {
        const reason = rule.notes || `${input.item.name} is already at or above target. No order is needed.`;
        return { status: 'no_order_needed', rule, reason, convertedRemainingQty: comparison.remainingQty, metadata: metadataForReorder(rule, reason, 0.9) };
      }
      const reason = rule.notes || `Suggested ${formatQuantity(suggested, targetUnit)} of ${input.item.name} to top up to ${formatQuantity(target, targetUnit)}.`;
      return {
        status: 'recommend',
        rule,
        suggestedQuantity: suggested,
        unit: targetUnit,
        reason,
        convertedRemainingQty: comparison.remainingQty,
        metadata: metadataForReorder(rule, reason, 0.92),
      };
    }

    const orderQty = numberOrNull(rule.order_qty);
    if (orderQty == null || !rule.order_unit) {
      const reason = `${input.item.name} matched a fixed order rule, but order quantity or unit is missing.`;
      return { status: 'cannot_evaluate', rule, reason, metadata: metadataForReorder(rule, reason, 0.3) };
    }
    const reason = rule.notes || (input.fromStatusPhrase
      ? `Suggested ${formatQuantity(orderQty, rule.order_unit)} of ${input.item.name} because "${input.item.name}" was reported as running low.`
      : `Suggested ${formatQuantity(orderQty, rule.order_unit)} of ${input.item.name} because ${formatQuantity(comparison.remainingQty ?? 0, rule.counted_unit ?? input.remainingUnit)} remain.`);
    const metadata = metadataForReorder(rule, reason, 0.94);
    if (input.fromStatusPhrase) {
      metadata.reason_codes = [...(metadata.reason_codes ?? []), 'status_phrase_reorder'];
      metadata.user_visible_note = metadata.user_visible_note ?? `Recommended based on a low-stock status phrase for ${input.item.name}.`;
    }
    return {
      status: 'recommend',
      rule,
      suggestedQuantity: orderQty,
      unit: rule.order_unit,
      reason,
      convertedRemainingQty: comparison.remainingQty,
      metadata,
    };
  }

  if (trackingUnitMismatch && !cannotEvaluate) {
    return {
      status: 'cannot_evaluate',
      rule: trackingUnitMismatch.rule,
      reason: trackingUnitMismatch.reason,
      metadata: {
        ...metadataForReorder(trackingUnitMismatch.rule, trackingUnitMismatch.reason, 0.35),
        reason_codes: ['tracking_unit_mismatch'],
      },
    };
  }

  if (cannotEvaluate) {
    return {
      status: 'cannot_evaluate',
      rule: cannotEvaluate.rule,
      reason: cannotEvaluate.reason,
      metadata: metadataForReorder(cannotEvaluate.rule, cannotEvaluate.reason, 0.35),
    };
  }
  const best = candidates[0];
  const reason = best
    ? `${input.item.name} did not match the active ${best.scope_type === 'employee' ? 'employee' : 'global'} reorder rule.`
    : `${input.item.name} did not match an active reorder rule.`;
  return {
    status: 'no_matching_rule',
    rule: best ?? null,
    reason,
    metadata: best ? metadataForReorder(best, reason, 0.8) : { reason_codes: ['no_matching_reorder_rule'], reorder_rule_source: 'none' },
  };
}

function findAliasRuleMatch(
  rules: QuickOrderAliasRule[],
  aliasKey: string,
  context: RuleResolverContext,
  scope: 'employee' | 'global',
): QuickOrderAliasRule | null {
  const matches = rules
    .filter((rule) =>
      rule.active !== false &&
      rule.scope_type === scope &&
      normalizeSearchText(rule.alias_key ?? rule.alias_text) === aliasKey &&
      modeMatches(rule.mode_scope, context.mode) &&
      locationMatches(rule.location_id, context.locationId) &&
      (scope === 'global' || employeeMatches(rule, context))
    )
    .sort((a, b) => locationScore(b, context.locationId) - locationScore(a, context.locationId));
  return matches[0] ?? null;
}

function aliasRuleToMatch(
  rule: QuickOrderAliasRule,
  catalogIndex: CatalogSearchIndex,
  source: 'employee' | 'global',
): CatalogMatchResult {
  const item = catalogIndex.catalog.find((entry) => entry.id === rule.item_id);
  if (!item) {
    return {
      item_id: null,
      item_name: null,
      match_type: 'no_match',
      confidence: 0,
      needs_clarification: true,
      issue: `Alias "${rule.alias_text}" points to an item that is not available in this location.`,
    };
  }
  return {
    item_id: item.id,
    item_name: item.name,
    display_name: item.name,
    matched_alias: rule.alias_text,
    matched_term: rule.alias_text,
    match_type: source === 'employee' ? 'employee_alias' : 'exact_alias',
    confidence: source === 'employee' ? 0.99 : 0.97,
    needs_clarification: false,
    token_coverage: 1,
    generic_token_overlap: [],
    specific_token_overlap: normalizeSearchText(rule.alias_text).split(' ').filter(Boolean),
    missing_specific_tokens: [],
    semantic_validation_passed: true,
    confidence_tier: 'high',
    decision_reason: source === 'employee' ? 'v2_employee_alias' : 'v2_global_alias',
  };
}

function findUnitRule(input: {
  rules: QuickOrderUnitRule[];
  itemId: string;
  fromUnit: string | null;
  context: RuleResolverContext;
  defaultOnly: boolean;
}): QuickOrderUnitRule | null {
  const fromKey = input.fromUnit ? normalizeRuleKey(input.fromUnit) : null;
  const matches = input.rules
    .filter((rule) =>
      rule.active !== false &&
      modeMatches(rule.mode_scope, input.context.mode) &&
      locationMatches(rule.location_id, input.context.locationId) &&
      (rule.item_id === input.itemId || rule.item_id == null) &&
      (input.defaultOnly
        ? rule.is_default_when_missing === true && rule.item_id === input.itemId
        : normalizeRuleKey(rule.from_unit_key ?? rule.from_unit) === fromKey) &&
      (rule.scope_type === 'global' || employeeMatches(rule, input.context))
    )
    .sort((a, b) => rulePriorityScore(b, input.itemId, input.context) - rulePriorityScore(a, input.itemId, input.context));
  return matches[0] ?? null;
}

function scopedRules(
  rules: QuickOrderReorderRule[],
  itemId: string,
  context: RuleResolverContext,
): QuickOrderReorderRule[] {
  const matches = rules
    .filter((rule) =>
      rule.active !== false &&
      rule.item_id === itemId &&
      modeMatches(rule.mode_scope, context.mode) &&
      locationMatches(rule.location_id, context.locationId) &&
      (rule.scope_type === 'global' || employeeMatches(rule, context))
    )
    .sort((a, b) => {
      const scopeDiff = rulePriorityScore(b, itemId, context) - rulePriorityScore(a, itemId, context);
      if (scopeDiff !== 0) return scopeDiff;
      return (a.priority ?? 100) - (b.priority ?? 100);
    });

  const hasEmployee = matches.some((rule) => rule.scope_type === 'employee');
  return hasEmployee ? matches.filter((rule) => rule.scope_type === 'employee') : matches.filter((rule) => rule.scope_type === 'global');
}

function compareRule(
  rule: QuickOrderReorderRule,
  input: {
    remainingQty: number | null;
    remainingUnit: string | null;
    remainingUnitInferred?: boolean;
    remainingTrackingUnit?: string | null;
    fromStatusPhrase?: boolean;
    unitRules?: QuickOrderUnitRule[];
    unitAliases?: UnitAliasMap;
    context: RuleResolverContext;
  },
): { status: 'ok'; matches: boolean; remainingQty: number | null; reason: string } | { status: 'cannot_evaluate' | 'tracking_unit_mismatch'; reason: string } {
  const expectedTracking = expectedTrackingUnitForRule(rule, input.unitRules ?? [], input.context);
  const actualTracking = normalizeTrackingUnitKey(input.remainingTrackingUnit);
  if (expectedTracking !== actualTracking) {
    const space = expectedTracking ?? 'default unit';
    const snapshotSpace = actualTracking ?? 'default unit';
    return {
      status: 'tracking_unit_mismatch',
      reason: `${rule.scope_type === 'employee' ? 'Employee' : 'Global'} reorder rule for ${rule.counted_unit ?? 'this item'} expects a ${space} count, but the available snapshot is in ${snapshotSpace} space.`,
    };
  }

  if (rule.trigger_type === 'status') return { status: 'ok', matches: true, remainingQty: input.remainingQty, reason: 'Status rule matched.' };

  if (input.fromStatusPhrase && input.remainingQty == null) {
    if (rule.action_type === 'fixed_order_qty' || rule.action_type === 'top_up_to_target') {
      return { status: 'ok', matches: true, remainingQty: null, reason: 'Status phrase indicates low stock.' };
    }
  }

  if (input.remainingQty == null) return { status: 'cannot_evaluate', reason: 'Remaining quantity is missing.' };

  let remainingQty = input.remainingQty;
  const targetUnit = normalizeUnitForComparison(rule.counted_unit, input.unitAliases) ?? normalizeRuleKey(rule.counted_unit);
  const remainingUnit = normalizeUnitForComparison(input.remainingUnit, input.unitAliases) ?? normalizeRuleKey(input.remainingUnit);
  if (targetUnit && remainingUnit && targetUnit !== remainingUnit) {
    const conversion = findUnitRule({
      rules: input.unitRules ?? [],
      itemId: rule.item_id,
      fromUnit: remainingUnit,
      context: input.context,
      defaultOnly: false,
    });
    if (conversion && normalizeRuleKey(conversion.to_unit) === targetUnit) {
      remainingQty = remainingQty * Number(conversion.multiplier ?? 1);
    } else if (input.remainingUnitInferred) {
      // The employee never typed a unit — the parser guessed `remainingUnit`.
      // A configured reorder rule's unit is the stronger signal of how this item
      // is actually counted, so adopt the rule's unit (no conversion) instead of
      // blocking on a mismatch the employee never actually stated.
      remainingQty = input.remainingQty;
    } else {
      return { status: 'cannot_evaluate', reason: `Cannot compare ${remainingUnit} remaining to ${targetUnit} rule for this item.` };
    }
  }

  const min = numberOrNull(rule.trigger_qty_min);
  const max = numberOrNull(rule.trigger_qty_max);
  if (rule.trigger_type === 'below') return { status: 'ok', matches: min != null && remainingQty < min, remainingQty, reason: 'below threshold' };
  if (rule.trigger_type === 'at_or_below') return { status: 'ok', matches: min != null && remainingQty <= min, remainingQty, reason: 'at or below threshold' };
  if (rule.trigger_type === 'equal') return { status: 'ok', matches: min != null && remainingQty === min, remainingQty, reason: 'equal threshold' };
  if (rule.trigger_type === 'between') return { status: 'ok', matches: min != null && max != null && remainingQty >= min && remainingQty <= max, remainingQty, reason: 'between thresholds' };
  return { status: 'ok', matches: false, remainingQty, reason: 'no matching trigger' };
}

function metadataForReorder(
  rule: QuickOrderReorderRule,
  note: string,
  confidence: number,
): QuickOrderResolutionMetadata {
  const employee = rule.scope_type === 'employee';
  return {
    reason_codes: [employee ? 'employee_reorder_rule' : 'global_reorder_rule'],
    resolution_trace: [note],
    reorder_rule_source: employee ? 'employee_rule' : 'global_rule',
    confidence,
    user_visible_note: note,
  };
}

function rulePriorityScore(rule: { scope_type: string; item_id?: string | null; location_id?: string | null }, itemId: string, context: RuleResolverContext): number {
  return (rule.scope_type === 'employee' ? 1000 : 0)
    + (rule.item_id === itemId ? 100 : 0)
    + locationScore(rule, context.locationId);
}

function locationScore(rule: { location_id?: string | null }, locationId: string | null | undefined): number {
  return rule.location_id && locationId && rule.location_id === locationId ? 10 : 0;
}

function locationMatches(ruleLocationId: string | null | undefined, locationId: string | null | undefined): boolean {
  return ruleLocationId == null || (locationId != null && ruleLocationId === locationId);
}

function employeeMatches(
  rule: { employee_name_key?: string | null; employee_user_id?: string | null },
  context: RuleResolverContext,
): boolean {
  if (context.employeeUserId && rule.employee_user_id === context.employeeUserId) return true;
  const keys = new Set((context.employeeNameKeys ?? []).map(normalizeRuleKey).filter(Boolean));
  return Boolean(rule.employee_name_key && keys.has(normalizeRuleKey(rule.employee_name_key)));
}

function modeMatches(scope: string | null | undefined, mode: ComposerMode): boolean {
  return scope === 'both' || scope === mode;
}

function inventoryEmployeePersonalizationEnabled(context: RuleResolverContext): boolean {
  return context.settings?.inventory_mode_employee_personalization !== false;
}

function orderEmployeePersonalizationEnabled(context: RuleResolverContext): boolean {
  return context.settings?.order_mode_employee_personalization === true;
}

function globalAliasesEnabled(context: RuleResolverContext): boolean {
  return context.settings?.global_aliases_enabled !== false;
}

function withFuzzyPolicy(match: CatalogMatchResult, context: RuleResolverContext): CatalogMatchResult {
  if (
    context.settings?.fuzzy_match_requires_confirmation !== false &&
    match.match_type === 'fuzzy' &&
    match.confidence < 0.9
  ) {
    return {
      ...match,
      needs_clarification: true,
      issue: match.issue ?? `Please confirm ${match.item_name ?? 'the matched item'}.`,
    };
  }
  return match;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatQuantity(quantity: number, unit: string | null | undefined): string {
  return `${Number.isInteger(quantity) ? String(quantity) : String(quantity)}${unit ? ` ${unit}` : ''}`;
}
