import { createClientKey } from './conflicts.ts';
import { normalizeUnitForComparison } from './units.ts';
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
    };

const LOW_CONFIDENCE_READY_THRESHOLD = 0.8;

export function validateQuickOrderSafety(input: SafetyValidationInput): SafetyValidationResult {
  const warnings: SafetyWarning[] = [];
  const blockedOperations: BlockedOperation[] = [];
  const pendingClarifications: PendingQuickOrderClarification[] = [
    ...(input.parseResponse.pending_clarifications ?? input.parseResponse.pending_actions ?? []),
  ];
  const acceptedItems: ParsedItem[] = [];

  for (const item of input.parseResponse.parsed_items) {
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

  return {
    response: {
      ...input.parseResponse,
      status,
      parsed_items: acceptedItems,
      pending_actions: pendingClarifications,
      pending_clarifications: pendingClarifications,
      operations: safeOperations,
      diagnostics: {
        ...(input.parseResponse.diagnostics ?? {}),
        items_after_validation: acceptedItems.length,
        items_accepted: acceptedItems.length,
        pending_action_count: pendingClarifications.length,
        rejected_reasons: [
          ...(input.parseResponse.diagnostics?.rejected_reasons ?? []),
          ...warnings.map((warning) => warning.type),
        ],
      },
    },
    warnings,
    blockedOperations,
    pendingClarifications,
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

  const unitDecision = evaluateAllowedUnit(item.item_id, item.unit, input.allowedUnitRules);
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
  });
}

function evaluateOperation(operation: QuickOrderOperation, input: SafetyValidationInput): SafetyDecision {
  if (operation.status !== 'applied' || !operation.target_item_id || operation.quantity == null) return { action: 'allow' };
  const unitDecision = evaluateAllowedUnit(operation.target_item_id, operation.unit ?? null, input.allowedUnitRules);
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
  });
}

function evaluateAllowedUnit(
  itemId: string,
  unit: string | null | undefined,
  rules: ItemAllowedUnitRule[],
): SafetyDecision | null {
  const itemRules = rules.filter((rule) => rule.item_id === itemId);
  if (itemRules.length === 0) return null;
  const normalizedUnit = normalizeUnitForComparison(unit);
  if (normalizedUnit && itemRules.some((rule) => normalizeUnitForComparison(rule.unit) === normalizedUnit)) return null;
  return {
    action: 'confirm',
    warningType: 'unusual_unit',
    severity: 'warning',
    message: `That unit is unusual for this item. Please choose an allowed unit.`,
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
}): SafetyDecision {
  const quantity = input.quantity;
  if (quantity == null || !Number.isFinite(quantity)) return { action: 'allow' };

  const hardMax = minPositive(input.limit?.hard_max_quantity, input.limit?.max_single_order_quantity, input.unitRule?.hard_max_quantity);
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

  const softMax = minPositive(input.limit?.soft_max_quantity, input.unitRule?.soft_max_quantity);
  const p95 = positiveNumber(input.limit?.historical_p95_quantity);
  if (input.source === 'voice' && p95 != null && quantity > p95) {
    return {
      action: 'confirm',
      warningType: 'voice_number_risk',
      severity: 'warning',
      message: `I heard ${formatQuantity(quantity, input.unit)} for ${input.itemName}, which is higher than usual. Please confirm it.`,
    };
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

function formatQuantity(quantity: number | null | undefined, unit: string | null | undefined): string {
  if (quantity == null) return unit?.trim() || 'that quantity';
  return `${quantity}${unit ? ` ${unit}` : ''}`;
}

function formatLimit(limit: number, unit: string | null | undefined): string {
  return ` of ${formatQuantity(limit, unit)}`;
}
