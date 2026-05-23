import { createClientKey } from './conflicts.ts';
import {
  deriveAllowedUnitLabels,
  deriveAllowedUnits,
  displayUnitLabel,
  formatAllowedUnitList,
  formatQuantityWithUnit,
  normalizeUnitForComparison,
} from './units.ts';
import type {
  BlockedOperation,
  CatalogItem,
  ItemAllowedUnitRule,
  ItemOrderLimit,
  ParsedItem,
  ParseResponse,
  PendingQuickOrderClarification,
  QuickOrderOperation,
  QuickOrderSource,
  SafetyWarning,
  SafetyWarningType,
} from './types.ts';

export type SafetyValidationInput = {
  parseResponse: ParseResponse;
  catalog: CatalogItem[];
  locationId: string;
  source: QuickOrderSource;
  limits: ItemOrderLimit[];
  allowedUnitRules: ItemAllowedUnitRule[];
  userRole?: string | null;
};

export type SafetyValidationResult = {
  response: ParseResponse;
  warnings: SafetyWarning[];
  blockedOperations: BlockedOperation[];
  pendingClarifications: PendingQuickOrderClarification[];
};

type SafetyDecision =
  | { action: 'allow' }
  | {
      action: 'confirm' | 'manager_approval' | 'block';
      warningType: SafetyWarningType;
      message: string;
      severity: SafetyWarning['severity'];
      allowedUnits?: string[];
      providedUnit?: string | null;
    };

const LOW_CONFIDENCE_READY_THRESHOLD = 0.8;

export function deduplicatePendingClarifications(
  clarifications: PendingQuickOrderClarification[],
): PendingQuickOrderClarification[] {
  const seen = new Map<string, PendingQuickOrderClarification>();
  for (const clarification of clarifications) {
    const lineId = clarification.incoming_item?.line_id ?? '';
    const key = `${clarification.type}:${clarification.item_name ?? ''}:${lineId}`;
    if (!seen.has(key)) seen.set(key, clarification);
  }
  return [...seen.values()];
}

export function applyStockSafetyLimits(input: {
  stockUpdates: import('./types.ts').StockOperation[];
  catalog: CatalogItem[];
  locationId: string;
  source: QuickOrderSource;
  limits: ItemOrderLimit[];
  allowedUnitRules: ItemAllowedUnitRule[];
  userRole?: string | null;
}): {
  accepted: import('./types.ts').StockOperation[];
  blocked: BlockedOperation[];
  warnings: SafetyWarning[];
} {
  const accepted: import('./types.ts').StockOperation[] = [];
  const blocked: BlockedOperation[] = [];
  const warnings: SafetyWarning[] = [];

  for (const update of input.stockUpdates) {
    const catalogItem = input.catalog.find((entry) => entry.id === update.item_id) ?? null;
    const decision = evaluateQuantity({
      itemId: update.item_id,
      itemName: update.item_name,
      quantity: update.quantity,
      unit: update.unit,
      source: input.source,
      limit: findLimit(input.limits, update.item_id, input.locationId),
      unitRule: findUnitRule(input.allowedUnitRules, update.item_id, update.unit),
      userRole: input.userRole,
      catalogItem,
    });
    if (decision.action === 'allow') {
      accepted.push(update);
      continue;
    }
    warnings.push({
      type: decision.warningType,
      message: decision.message,
      item_id: update.item_id,
      item_name: update.item_name,
      quantity: update.quantity,
      unit: update.unit,
      severity: decision.severity,
    });
    if (decision.action === 'block' || decision.action === 'manager_approval') {
      blocked.push({
        type: 'stock_update',
        item_id: update.item_id,
        item_name: update.item_name,
        attempted_quantity: update.quantity,
        unit: update.unit,
        reason: decision.warningType,
        message: decision.message,
      });
    }
  }

  return { accepted, blocked, warnings };
}

export function validateQuickOrderSafety(input: SafetyValidationInput): SafetyValidationResult {
  const warnings: SafetyWarning[] = [];
  const blockedOperations: BlockedOperation[] = [];
  const pendingClarifications: PendingQuickOrderClarification[] = deduplicatePendingClarifications([
    ...(input.parseResponse.pending_clarifications ?? input.parseResponse.pending_actions ?? []),
  ]);
  const acceptedItems: ParsedItem[] = [];

  for (const item of input.parseResponse.parsed_items) {
    const parserClarification = buildParserClarification(item, input);
    if (parserClarification) {
      pendingClarifications.push(parserClarification);
      if (item.status === 'invalid_unit') {
        warnings.push({
          type: 'unusual_unit',
          message: parserClarification.message,
          item_id: item.item_id,
          item_name: item.item_name ?? item.display_name ?? item.raw_token,
          quantity: item.quantity,
          unit: item.unit,
          severity: 'warning',
        });
      }
      continue;
    }

    const decision = evaluateParsedItem(item, input);
    if (decision.action === 'allow') {
      acceptedItems.push(item);
      continue;
    }

    warnings.push(warningFromDecision(item, decision));

    if (decision.action === 'block' || decision.action === 'manager_approval') {
      blockedOperations.push({
        type: 'cart_add',
        item_id: item.item_id,
        item_name: item.item_name ?? item.display_name ?? item.raw_token,
        attempted_quantity: item.quantity,
        unit: item.unit,
        reason: decision.warningType,
        message: decision.message,
      });
    } else {
      pendingClarifications.push(buildSafetyClarification(item, decision));
    }
  }

  const safeOperations = (input.parseResponse.operations ?? []).map((operation) => {
    const decision = evaluateOperation(operation, input);
    if (decision.action === 'allow') return operation;
    warnings.push(warningFromOperation(operation, decision));
    blockedOperations.push({
      type: 'cart_update',
      item_id: operation.target_item_id,
      item_name: operation.target_display_name,
      attempted_quantity: operation.quantity,
      unit: operation.unit,
      reason: decision.warningType,
      message: decision.message,
    });
    return {
      ...operation,
      status: decision.action === 'block' || decision.action === 'manager_approval' ? 'failed' as const : 'pending' as const,
      message: decision.message,
    };
  });

  const hasBlocked = blockedOperations.length > 0;
  const hasClarifications = pendingClarifications.length > 0;
  const status = hasBlocked && acceptedItems.length === 0 && safeOperations.every((op) => op.status !== 'applied')
    ? 'needs_clarification'
    : hasClarifications
      ? 'needs_clarification'
      : input.parseResponse.status;

  const dedupedClarifications = deduplicatePendingClarifications(pendingClarifications);

  return {
    response: {
      ...input.parseResponse,
      status,
      parsed_items: acceptedItems,
      pending_actions: dedupedClarifications,
      pending_clarifications: dedupedClarifications,
      operations: safeOperations,
      diagnostics: {
        ...(input.parseResponse.diagnostics ?? {}),
        items_after_validation: acceptedItems.length,
        items_accepted: acceptedItems.length,
        pending_action_count: dedupedClarifications.length,
        rejected_reasons: [
          ...(input.parseResponse.diagnostics?.rejected_reasons ?? []),
          ...warnings.map((warning) => warning.type),
        ],
      },
    },
    warnings,
    blockedOperations,
    pendingClarifications: dedupedClarifications,
  };
}

function evaluateParsedItem(item: ParsedItem, input: SafetyValidationInput): SafetyDecision {
  if (!item.item_id || item.needs_clarification || item.unresolved) return { action: 'allow' };
  const lowConfidence = (item.parse_source === 'llm' || item.match_type === 'llm' || item.match_type === 'fuzzy') &&
    (item.confidence ?? 0) < LOW_CONFIDENCE_READY_THRESHOLD;
  if (lowConfidence) {
    return {
      action: 'confirm',
      warningType: 'low_confidence_match',
      severity: 'warning',
      message: `I matched ${item.raw_token || item.item_text || 'that item'} to ${item.item_name ?? 'an item'}. Please confirm before adding it.`,
    };
  }

  const catalogItem = input.catalog.find((entry) => entry.id === item.item_id) ?? null;
  const unitDecision = evaluateAllowedUnit(item.item_id, item.unit, input.allowedUnitRules, catalogItem);
  if (unitDecision) return unitDecision;

  return evaluateQuantity({
    itemId: item.item_id,
    itemName: item.item_name ?? item.display_name ?? item.raw_token,
    quantity: item.quantity,
    unit: item.unit,
    source: input.source,
    limit: findLimit(input.limits, item.item_id, input.locationId),
    unitRule: findUnitRule(input.allowedUnitRules, item.item_id, item.unit),
    userRole: input.userRole,
    catalogItem,
  });
}

function buildParserClarification(
  item: ParsedItem,
  input: SafetyValidationInput,
): PendingQuickOrderClarification | null {
  if (item.item_id && item.status === 'invalid_unit') {
    const catalogItem = input.catalog.find((entry) => entry.id === item.item_id) ?? null;
    const allowedUnits = allowedUnitsForSafety(item.item_id, input.allowedUnitRules, catalogItem);
    const itemName = item.item_name ?? item.display_name ?? catalogItem?.name ?? item.raw_token;
    return {
      id: createClientKey('invalid_unit'),
      type: 'invalid_unit',
      item_id: item.item_id,
      item_name: itemName,
      incoming_item: item,
      message: item.issue ?? `${itemName} cannot be ordered as ${displayUnitLabel(item.unit) || 'that unit'}. Use ${formatAllowedUnitList(allowedUnits)}.`,
      actions: [
        ...allowedUnits.slice(0, 4).map((unit) => ({
          id: 'use_unit' as const,
          label: `Use ${displayUnitLabel(unit)}`,
          unit,
          preview: item.quantity != null ? `${item.quantity} ${displayUnitLabel(unit)}` : displayUnitLabel(unit),
        })),
        { id: 'cancel' as const, label: 'Cancel' },
      ],
    };
  }

  if (!item.item_id || item.unresolved || item.status === 'no_match' || item.status === 'ambiguous') {
    const rawLabel = item.item_text ?? item.raw_token ?? item.raw_text ?? 'that item';
    const top = item.alternatives?.[0] ?? item.candidate_matches?.[0];
    const confidence = top?.confidence ?? top?.score ?? 0;
    if (top && confidence >= 0.75) {
      return {
        id: createClientKey('item_suggestion'),
        type: 'ambiguous_item',
        item_id: null,
        item_name: rawLabel,
        incoming_item: {
          ...item,
          item_id: top.item_id,
          item_name: top.item_name,
          display_name: top.item_name,
          name: top.item_name,
          unresolved: false,
          needs_clarification: item.quantity == null || !item.unit,
          status: item.quantity == null ? 'missing_quantity' : !item.unit ? 'missing_unit' : 'valid',
          action: item.quantity == null ? 'Add quantity' : !item.unit ? 'Choose unit' : null,
        },
        message: `I couldn't recognize "${rawLabel}". Did you mean ${top.item_name}?`,
        actions: [
          { id: 'use_item' as const, label: `Use ${top.item_name}` },
        ],
      };
    }
    return {
      id: createClientKey('item_not_found'),
      type: 'item_not_found',
      item_id: null,
      item_name: rawLabel,
      message: `I couldn't recognize "${rawLabel}". Try the item name again.`,
      actions: [],
    };
  }

  return null;
}

function allowedUnitsForSafety(
  itemId: string,
  rules: ItemAllowedUnitRule[],
  catalogItem: CatalogItem | null,
): string[] {
  const ruleUnits = rules
    .filter((rule) => rule.item_id === itemId && typeof rule.unit === 'string' && rule.unit.trim().length > 0)
    .map((rule) => rule.unit.trim());
  return ruleUnits.length > 0 ? [...new Set(ruleUnits)] : deriveAllowedUnitLabels(catalogItem);
}

function evaluateOperation(operation: QuickOrderOperation, input: SafetyValidationInput): SafetyDecision {
  if (operation.status !== 'applied' || !operation.target_item_id || operation.quantity == null) return { action: 'allow' };
  const catalogItem = input.catalog.find((entry) => entry.id === operation.target_item_id) ?? null;
  const unitDecision = evaluateAllowedUnit(operation.target_item_id, operation.unit ?? null, input.allowedUnitRules, catalogItem);
  if (unitDecision) return unitDecision;
  return evaluateQuantity({
    itemId: operation.target_item_id,
    itemName: operation.target_display_name,
    quantity: operation.quantity,
    unit: operation.unit ?? null,
    source: input.source,
    limit: findLimit(input.limits, operation.target_item_id, input.locationId),
    unitRule: findUnitRule(input.allowedUnitRules, operation.target_item_id, operation.unit ?? null),
    userRole: input.userRole,
    catalogItem,
  });
}

function evaluateAllowedUnit(
  itemId: string,
  unit: string | null | undefined,
  rules: ItemAllowedUnitRule[],
  catalogItem: CatalogItem | null,
): SafetyDecision | null {
  const itemRules = rules.filter((rule) => rule.item_id === itemId);
  const normalizedUnit = normalizeUnitForComparison(unit);
  const itemName = catalogItem?.name ?? 'This item';
  if (itemRules.length === 0) {
    const catalogUnits = deriveAllowedUnits(catalogItem);
    if (catalogUnits.length === 0 || !normalizedUnit || catalogUnits.includes(normalizedUnit)) return null;
    const labels = deriveAllowedUnitLabels(catalogItem);
    return {
      action: 'confirm',
      warningType: 'unusual_unit',
      severity: 'warning',
      providedUnit: unit ?? null,
      allowedUnits: labels,
      message: `${itemName} cannot be ordered as ${displayUnitLabel(unit) || 'that unit'}. Use ${formatAllowedUnitList(labels)}.`,
    };
  }
  if (normalizedUnit && itemRules.some((rule) => normalizeUnitForComparison(rule.unit) === normalizedUnit)) return null;
  const labels = itemRules
    .map((rule) => rule.unit)
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return {
    action: 'confirm',
    warningType: 'unusual_unit',
    severity: 'warning',
    providedUnit: unit ?? null,
    allowedUnits: labels,
    message: `${itemName} cannot be ordered as ${displayUnitLabel(unit) || 'that unit'}. Use ${formatAllowedUnitList(labels)}.`,
  };
}

function evaluateQuantity(input: {
  itemId: string;
  itemName: string;
  quantity: number | null | undefined;
  unit: string | null | undefined;
  source: QuickOrderSource;
  limit: ItemOrderLimit | null;
  unitRule: ItemAllowedUnitRule | null;
  userRole?: string | null;
  catalogItem?: CatalogItem | null;
}): SafetyDecision {
  const quantity = input.quantity;
  if (quantity == null || !Number.isFinite(quantity)) return { action: 'allow' };

  const hardMaxOverride = minPositive(input.limit?.hard_max_quantity, input.limit?.max_single_order_quantity, input.unitRule?.hard_max_quantity);
  const hardMax = hardMaxOverride ?? positiveNumber(input.catalogItem?.hard_cap);
  if (hardMax != null && quantity > hardMax) {
    return {
      action: 'block',
      warningType: 'above_hard_max',
      severity: 'blocked',
      message: `I heard ${formatQuantity(quantity, input.unit)} for ${input.itemName}, but that is above the safe limit${formatLimit(hardMax, input.unit)}.`,
    };
  }

  const managerApproval = positiveNumber(input.limit?.manager_approval_quantity);
  if (managerApproval != null && quantity > managerApproval && input.userRole !== 'manager') {
    return {
      action: 'manager_approval',
      warningType: 'manager_approval_required',
      severity: 'blocked',
      message: `${input.itemName} at ${formatQuantity(quantity, input.unit)} needs manager approval.`,
    };
  }

  const softMaxOverride = minPositive(input.limit?.soft_max_quantity, input.unitRule?.soft_max_quantity);
  const softMax = softMaxOverride ?? positiveNumber(input.catalogItem?.soft_cap);
  const p95 = positiveNumber(input.limit?.historical_p95_quantity);
  if (input.source === 'voice' && p95 != null && quantity > p95) {
    return {
      action: 'confirm',
      warningType: 'voice_number_risk',
      severity: 'warning',
      message: `I heard ${formatQuantity(quantity, input.unit)} for ${input.itemName}, which is higher than usual. Please confirm it.`,
    };
  }

  if (input.source === 'voice' && p95 == null && input.limit == null) {
    const genericVoiceThreshold = genericVoiceQuantityThreshold(input.unit);
    if (genericVoiceThreshold != null && quantity > genericVoiceThreshold) {
      return {
        action: 'confirm',
        warningType: 'voice_number_risk',
        severity: 'warning',
        message: `I heard ${formatQuantity(quantity, input.unit)} for ${input.itemName}, which is higher than expected for voice entry. Please confirm it.`,
      };
    }
  }

  if (softMax != null && quantity > softMax) {
    return {
      action: 'confirm',
      warningType: 'above_soft_max',
      severity: 'warning',
      message: `${input.itemName} at ${formatQuantity(quantity, input.unit)} is above the normal range. Please confirm before adding it.`,
    };
  }

  return { action: 'allow' };
}

function buildSafetyClarification(item: ParsedItem, decision: Exclude<SafetyDecision, { action: 'allow' }>): PendingQuickOrderClarification {
  if (decision.warningType === 'unusual_unit') {
    const allowedUnits = decision.allowedUnits ?? [];
    return {
      id: createClientKey('unit'),
      type: 'invalid_unit',
      item_id: item.item_id,
      item_name: item.item_name ?? item.display_name ?? item.raw_token,
      incoming_item: item,
      message: decision.message,
      actions: [
        ...allowedUnits.slice(0, 4).map((unit) => ({
          id: 'use_unit' as const,
          label: `Use ${displayUnitLabel(unit)}`,
          unit,
          preview: item.quantity != null ? `${item.quantity} ${displayUnitLabel(unit)}` : displayUnitLabel(unit),
        })),
        { id: 'cancel', label: 'Cancel' },
      ],
    };
  }

  return {
    id: createClientKey('safety'),
    type: decision.warningType === 'low_confidence_match' ? 'low_confidence_match' : 'quantity_safety',
    item_id: item.item_id,
    item_name: item.item_name ?? item.display_name ?? item.raw_token,
    incoming_item: item,
    message: decision.message,
    actions: [
      { id: 'keep_separate', label: 'Add anyway', preview: formatQuantity(item.quantity, item.unit) },
      { id: 'cancel', label: 'Cancel' },
    ],
  };
}

function warningFromDecision(item: ParsedItem, decision: Exclude<SafetyDecision, { action: 'allow' }>): SafetyWarning {
  return {
    type: decision.warningType,
    message: decision.message,
    item_id: item.item_id,
    item_name: item.item_name ?? item.display_name ?? item.raw_token,
    quantity: item.quantity,
    unit: item.unit,
    severity: decision.severity,
  };
}

function warningFromOperation(operation: QuickOrderOperation, decision: Exclude<SafetyDecision, { action: 'allow' }>): SafetyWarning {
  return {
    type: decision.warningType,
    message: decision.message,
    item_id: operation.target_item_id,
    item_name: operation.target_display_name,
    quantity: operation.quantity,
    unit: operation.unit,
    severity: decision.severity,
  };
}

function findLimit(limits: ItemOrderLimit[], itemId: string, locationId: string): ItemOrderLimit | null {
  return limits.find((limit) => limit.item_id === itemId && limit.location_id === locationId)
    ?? limits.find((limit) => limit.item_id === itemId && !limit.location_id)
    ?? null;
}

function findUnitRule(
  rules: ItemAllowedUnitRule[],
  itemId: string,
  unit: string | null | undefined,
): ItemAllowedUnitRule | null {
  const normalizedUnit = normalizeUnitForComparison(unit);
  if (!normalizedUnit) return null;
  return rules.find((rule) => rule.item_id === itemId && normalizeUnitForComparison(rule.unit) === normalizedUnit) ?? null;
}

function minPositive(...values: (number | null | undefined)[]): number | null {
  const positive = values.map(positiveNumber).filter((value): value is number => value != null);
  return positive.length > 0 ? Math.min(...positive) : null;
}

function positiveNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function genericVoiceQuantityThreshold(unit: string | null | undefined): number | null {
  const normalized = normalizeUnitForComparison(unit);
  if (!normalized) return 24;
  if (normalized === 'lb' || normalized === 'oz' || normalized === 'pc') return 50;
  if (normalized === 'cs' || normalized === 'case' || normalized === 'pack' || normalized === 'box' || normalized === 'bag' || normalized === 'tray') {
    return 12;
  }
  return 24;
}

function formatQuantity(quantity: number | null | undefined, unit: string | null | undefined): string {
  return formatQuantityWithUnit(quantity, unit);
}

function formatLimit(limit: number, unit: string | null | undefined): string {
  return ` of ${formatQuantity(limit, unit)}`;
}
