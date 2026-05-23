import type {
  CatalogItem,
  ComposerMode,
  InventoryReorderRule,
  InventoryStatusItem,
  ItemAllowedUnitRule,
  ItemOrderProfile,
  ItemOrderLimit,
  ItemReorderRule,
  Recommendation,
  ReorderRoundingPolicy,
  SafetyWarning,
  StockOperation,
} from './types.ts';
import { normalizeUnitForComparison } from './units.ts';

export type RecommendationHistoryOrder = {
  created_at?: string;
  items?: {
    item_id?: string;
    item_name?: string;
    quantity?: number;
    unit?: string | null;
    unit_type?: string | null;
  }[];
};

export type CalculateOrderRecommendationInput = {
  itemId: string;
  item?: CatalogItem | null;
  currentQuantity: number;
  currentUnit: string | null;
  locationId: string;
  supplierId?: string | null;
  reorderRules?: ItemReorderRule[];
  orderProfiles?: ItemOrderProfile[];
  recentOrders?: RecommendationHistoryOrder[];
  limits?: ItemOrderLimit[];
  allowedUnitRules?: ItemAllowedUnitRule[];
};

export type EvaluateReorderRuleInput = {
  remainingQty: number | null;
  remainingUnit: string | null;
  itemId: string;
  itemName?: string | null;
  locationId: string | null;
  mode: ComposerMode;
  rules: InventoryReorderRule[];
  allowedUnitRules?: ItemAllowedUnitRule[];
};

export type EvaluateReorderRuleResult =
  | {
      status: 'recommend';
      rule: InventoryReorderRule;
      suggestedQuantity: number;
      unit: string | null;
      reason: string;
      convertedRemainingQty: number | null;
    }
  | {
      status: 'no_order_needed' | 'use_existing_recommendation_engine' | 'no_matching_rule' | 'unit_mismatch' | 'cannot_evaluate';
      rule?: InventoryReorderRule | null;
      reason: string;
      convertedRemainingQty?: number | null;
    };

export type CalculateOrderRecommendationResult =
  | {
      status: 'recommend';
      suggestedQuantity: number;
      rawNeeded: number;
      unit: string | null;
      targetQuantity: number;
      targetUnit: string | null;
      reason: string;
      recommendationType: Recommendation['recommendation_type'];
    }
  | {
      status: 'no_order_needed' | 'cannot_calculate' | 'unit_conversion_missing';
      suggestedQuantity: 0;
      unit: string | null;
      targetQuantity?: number | null;
      targetUnit?: string | null;
      reason: string;
      recommendationType?: Recommendation['recommendation_type'];
    };

export function buildQuickOrderRecommendations(input: {
  catalog: CatalogItem[];
  stockUpdates: StockOperation[];
  statusItems?: InventoryStatusItem[];
  recentOrders: RecommendationHistoryOrder[];
  limits: ItemOrderLimit[];
  allowedUnitRules: ItemAllowedUnitRule[];
  inventoryReorderRules?: InventoryReorderRule[];
  reorderRules?: ItemReorderRule[];
  orderProfiles?: ItemOrderProfile[];
  locationId?: string | null;
  mode?: ComposerMode;
  maxItems?: number;
  includeHistoryCandidates?: boolean;
}): { recommendations: Recommendation[]; warnings: SafetyWarning[] } {
  const warnings: SafetyWarning[] = [];
  const statusItems = input.statusItems ?? [];
  const handledNoOrderStatusKeys = new Set<string>();
  for (const statusItem of statusItems) {
    if (!statusItem.item_id) {
      warnings.push({
        type: 'recommendation_unavailable',
        message: `I understood "${statusItem.phrase}" as an inventory status, but I could not match ${statusItem.item_text || 'the item'}.`,
        item_id: null,
        item_name: statusItem.item_name ?? statusItem.item_text,
        severity: 'info',
      });
      continue;
    }
    if (statusItem.recommendation_action === 'no_order') {
      handledNoOrderStatusKeys.add(statusItem.item_id);
      warnings.push({
        type: 'no_order_needed',
        message: `${statusItem.item_name ?? statusItem.item_text} — no order needed. "${statusItem.phrase}" means enough stock.`,
        item_id: statusItem.item_id,
        item_name: statusItem.item_name ?? statusItem.item_text,
        quantity: statusItem.remaining_qty,
        unit: statusItem.remaining_unit,
        severity: 'info',
      });
      continue;
    }
    if (statusItem.recommendation_action === 'ask_quantity') {
      warnings.push({
        type: 'recommendation_unavailable',
        message: `${statusItem.item_name ?? statusItem.item_text} needs a remaining quantity before I can recommend an order.`,
        item_id: statusItem.item_id,
        item_name: statusItem.item_name ?? statusItem.item_text,
        severity: 'info',
      });
    }
  }

  const candidateItemIds = new Set<string>();

  for (const update of input.stockUpdates) candidateItemIds.add(update.item_id);
  if (input.includeHistoryCandidates !== false) {
    for (const order of input.recentOrders.slice(0, 6)) {
      for (const item of order.items ?? []) {
        if (item.item_id) candidateItemIds.add(item.item_id);
      }
    }
  }

  const recommendations: Recommendation[] = [];
  for (const itemId of candidateItemIds) {
    const catalogItem = input.catalog.find((item) => item.id === itemId);
    if (!catalogItem) continue;
    const stock = latestStockForItem(input.stockUpdates, itemId);
    if (stock && !handledNoOrderStatusKeys.has(itemId)) {
      const sheetRuleResult = evaluateReorderRule({
        remainingQty: stock.quantity,
        remainingUnit: stock.unit,
        itemId,
        itemName: catalogItem.name,
        locationId: input.locationId ?? null,
        mode: input.mode ?? 'inventory',
        rules: input.inventoryReorderRules ?? [],
        allowedUnitRules: input.allowedUnitRules,
      });
      if (sheetRuleResult.status === 'recommend') {
        const limit = findLimit(input.limits, itemId);
        const safety = applyRecommendationSafety(sheetRuleResult.suggestedQuantity, sheetRuleResult.unit, limit, catalogItem);
        if (safety.warning) warnings.push({ ...safety.warning, item_id: catalogItem.id, item_name: catalogItem.name });
        recommendations.push({
          item_id: catalogItem.id,
          item_name: catalogItem.name,
          suggested_quantity: safety.cappedQuantity,
          unit: sheetRuleResult.unit,
          confidence: stock.confidence >= 0.9 ? 0.94 : 0.86,
          reason: sheetRuleResult.reason,
          inputs: {
            current_stock: sheetRuleResult.convertedRemainingQty ?? stock.quantity,
            expected_usage: null,
            safety_stock: null,
            previous_average: null,
            day_of_week_pattern: null,
            next_delivery_date: null,
          },
          safety_status: safety.status,
          recommendation_type: 'stock_reorder_rule',
          auto_apply_eligible: false,
        });
        continue;
      }
      if (sheetRuleResult.status === 'no_order_needed') {
        warnings.push({
          type: 'no_order_needed',
          message: sheetRuleResult.reason,
          item_id: catalogItem.id,
          item_name: catalogItem.name,
          quantity: stock.quantity,
          unit: stock.unit,
          severity: 'info',
        });
        continue;
      }
      if (sheetRuleResult.status === 'no_matching_rule') {
        warnings.push({
          type: 'no_order_needed',
          message: sheetRuleResult.reason,
          item_id: catalogItem.id,
          item_name: catalogItem.name,
          quantity: stock.quantity,
          unit: stock.unit,
          severity: 'info',
        });
        continue;
      }
      if (sheetRuleResult.status === 'unit_mismatch' || sheetRuleResult.status === 'cannot_evaluate') {
        warnings.push({
          type: 'recommendation_unavailable',
          message: sheetRuleResult.reason,
          item_id: catalogItem.id,
          item_name: catalogItem.name,
          quantity: stock.quantity,
          unit: stock.unit,
          severity: 'info',
        });
        continue;
      }
    }
    const reorderRule = findReorderRule(input.reorderRules ?? [], itemId);
    const profile = findOrderProfile(input.orderProfiles ?? [], itemId);
    const limit = findLimit(input.limits, itemId);
    const unit = reorderRule?.target_stock_unit
      ?? reorderRule?.usual_order_unit
      ?? profile?.usual_unit
      ?? defaultUnitForItem(catalogItem, input.allowedUnitRules, limit);
    const currentStockInOrderUnit = stock
      ? convertStockQuantityToUnit(stock, unit, input.allowedUnitRules)
      : null;

    if (stock && currentStockInOrderUnit == null && stock.unit && unit && normalizeUnitForComparison(stock.unit) !== normalizeUnitForComparison(unit)) {
      warnings.push({
        type: 'unusual_unit',
        message: `${catalogItem.name} stock was counted as ${stock.unit}, but I do not have a conversion to ${unit}.`,
        item_id: catalogItem.id,
        item_name: catalogItem.name,
        quantity: stock.quantity,
        unit: stock.unit,
        severity: 'warning',
      });
      continue;
    }

    const stockRecommendation = stock
      ? calculateOrderRecommendation({
          itemId,
          item: catalogItem,
          currentQuantity: currentStockInOrderUnit ?? stock.quantity,
          currentUnit: unit,
          locationId: reorderRule?.location_id ?? profile?.location_id ?? '',
          supplierId: catalogItem.supplier_id,
          reorderRules: input.reorderRules ?? [],
          orderProfiles: input.orderProfiles ?? [],
          recentOrders: input.recentOrders,
          limits: input.limits,
          allowedUnitRules: input.allowedUnitRules,
        })
      : null;

    if (stockRecommendation?.status === 'recommend' && stock) {
      const safety = applyRecommendationSafety(stockRecommendation.suggestedQuantity, stockRecommendation.unit, limit, catalogItem);
      if (safety.warning) warnings.push({ ...safety.warning, item_id: catalogItem.id, item_name: catalogItem.name });
      recommendations.push({
        item_id: catalogItem.id,
        item_name: catalogItem.name,
        suggested_quantity: safety.cappedQuantity,
        unit: stockRecommendation.unit,
        confidence: stock.confidence >= 0.9 ? 0.92 : 0.84,
        reason: stockRecommendation.reason,
        inputs: {
          current_stock: currentStockInOrderUnit ?? stock.quantity,
          expected_usage: stockRecommendation.targetQuantity,
          safety_stock: positiveNumber(reorderRule?.min_stock_quantity),
          previous_average: positiveNumber(reorderRule?.usual_order_quantity)
            ?? positiveNumber(profile?.usual_quantity)
            ?? averageRecentQuantity(input.recentOrders, itemId, stockRecommendation.unit),
          day_of_week_pattern: null,
          next_delivery_date: null,
        },
        safety_status: safety.status,
        recommendation_type: stockRecommendation.recommendationType,
        auto_apply_eligible: false,
      });
      continue;
    }

    if (stockRecommendation && stockRecommendation.status !== 'recommend' && stock) {
      warnings.push({
        type: stockRecommendation.status === 'no_order_needed' ? 'no_order_needed' : 'recommendation_unavailable',
        message: stockRecommendation.reason,
        item_id: catalogItem.id,
        item_name: catalogItem.name,
        quantity: stock.quantity,
        unit: stock.unit,
        severity: 'info',
      });
      continue;
    }

    const expectedUsage = averageRecentQuantity(input.recentOrders, itemId, unit);
    const previousAverage =
      expectedUsage
      ?? positiveNumber(profile?.usual_quantity)
      ?? positiveNumber(profile?.p50_quantity)
      ?? positiveNumber(limit?.historical_median_quantity)
      ?? positiveNumber(limit?.typical_min_quantity)
      ?? 1;
    const safetyStock = positiveNumber(catalogItem.safety_stock)
      ?? positiveNumber(limit?.typical_min_quantity)
      ?? Math.max(0, Math.ceil(previousAverage * 0.25));
    const targetLevel = positiveNumber(catalogItem.target_stock)
      ?? (previousAverage + safetyStock);
    const currentStock = currentStockInOrderUnit;
    const rawSuggested = Math.max(0, targetLevel - (currentStock ?? 0));
    const rounded = roundRecommendation(rawSuggested, unit);
    if (rounded <= 0) continue;

    const safety = applyRecommendationSafety(rounded, unit, limit, catalogItem);
    if (safety.warning) warnings.push({ ...safety.warning, item_id: catalogItem.id, item_name: catalogItem.name });
    const capped = safety.cappedQuantity;
    const safetyStatus = safety.status;

    recommendations.push({
      item_id: catalogItem.id,
      item_name: catalogItem.name,
      suggested_quantity: capped,
      unit,
      confidence: stock ? 0.82 : 0.68,
      reason: stock
        ? (catalogItem.target_stock != null
            ? `Based on target stock of ${catalogItem.target_stock} and current stock.`
            : `Based on current stock and recent order history.`)
        : (catalogItem.target_stock != null
            ? `Based on target stock of ${catalogItem.target_stock}.`
            : `Based on recent order history for this location.`),
      inputs: {
        current_stock: currentStock,
        expected_usage: expectedUsage,
        safety_stock: safetyStock,
        previous_average: previousAverage,
        day_of_week_pattern: null,
        next_delivery_date: null,
      },
      safety_status: safetyStatus,
      recommendation_type: profile ? 'history_profile' : 'recent_history',
      auto_apply_eligible: false,
    });
  }

  return {
    recommendations: recommendations
      .sort((a, b) => b.confidence - a.confidence || a.item_name.localeCompare(b.item_name))
      .slice(0, input.maxItems ?? 6),
    warnings,
  };
}

export function evaluateReorderRule(input: EvaluateReorderRuleInput): EvaluateReorderRuleResult {
  const mode = input.mode;
  const allRules = (input.rules ?? []).filter((rule) =>
    rule.active !== false &&
    rule.inventory_item_id === input.itemId &&
    (rule.applies_to_mode === 'both' ||
      (mode === 'inventory' && rule.applies_to_mode === 'inventory_only') ||
      (mode === 'order' && rule.applies_to_mode === 'order_only'))
  );
  if (allRules.length === 0) {
    return { status: 'use_existing_recommendation_engine', reason: 'No sheet reorder rules are configured for this item.' };
  }

  const exactLocation = input.locationId
    ? allRules.filter((rule) => rule.location_id === input.locationId)
    : [];
  const scoped = exactLocation.length > 0
    ? exactLocation
    : allRules.filter((rule) => rule.location_id == null);
  if (scoped.length === 0) {
    return { status: 'use_existing_recommendation_engine', reason: 'No matching sheet reorder rule is configured for this location.' };
  }

  const sorted = [...scoped].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  let sawComparableRule = false;
  let lastNonMatchReason = '';
  for (const rule of sorted) {
    const comparison = compareRemainingToRule(input, rule);
    if (comparison.status === 'unit_mismatch') return comparison;
    if (comparison.status === 'cannot_evaluate') {
      lastNonMatchReason = comparison.reason;
      continue;
    }
    if (comparison.status !== 'ok') continue;
    sawComparableRule = true;
    if (!comparison.matches) {
      lastNonMatchReason = comparison.reason;
      continue;
    }

    if (rule.order_strategy === 'use_existing_recommendation_engine') {
      return {
        status: 'use_existing_recommendation_engine',
        rule,
        reason: rule.notes || 'Sheet rule matched and asked to use the existing recommendation engine.',
        convertedRemainingQty: comparison.remainingQty,
      };
    }

    if (rule.order_strategy === 'no_order') {
      return {
        status: 'no_order_needed',
        rule,
        reason: rule.notes || `${input.itemName ?? 'Item'} has enough stock. No order is needed.`,
        convertedRemainingQty: comparison.remainingQty,
      };
    }

    const orderQty = positiveNumber(rule.order_qty);
    if (orderQty == null || !rule.order_unit) {
      return {
        status: 'cannot_evaluate',
        rule,
        reason: `${input.itemName ?? 'Item'} matched a fixed order rule, but the rule is missing order quantity or unit.`,
        convertedRemainingQty: comparison.remainingQty,
      };
    }
    return {
      status: 'recommend',
      rule,
      suggestedQuantity: orderQty,
      unit: rule.order_unit,
      convertedRemainingQty: comparison.remainingQty,
      reason: rule.notes || buildRuleReason(input.itemName ?? 'Item', comparison.remainingQty, rule),
    };
  }

  return {
    status: sawComparableRule ? 'no_matching_rule' : 'cannot_evaluate',
    reason: lastNonMatchReason || `${input.itemName ?? 'Item'} did not match any active sheet reorder rule.`,
  };
}

export function calculateOrderRecommendation(
  input: CalculateOrderRecommendationInput,
): CalculateOrderRecommendationResult {
  const item = input.item ?? null;
  const itemName = item?.name ?? 'this item';
  const reorderRule = findReorderRule(input.reorderRules ?? [], input.itemId);
  const profile = findOrderProfile(input.orderProfiles ?? [], input.itemId);
  const limit = findLimit(input.limits ?? [], input.itemId);
  const target = resolveRecommendationTarget({
    itemId: input.itemId,
    item,
    reorderRule,
    profile,
    limit,
    recentOrders: input.recentOrders ?? [],
    currentUnit: input.currentUnit,
  });

  if (!target) {
    return {
      status: 'cannot_calculate',
      suggestedQuantity: 0,
      unit: input.currentUnit,
      reason: `I found ${itemName} at ${formatQuantity(input.currentQuantity, input.currentUnit)} remaining, but I don’t know the target quantity yet, so I can’t calculate how many to order.`,
    };
  }

  const current = Math.max(0, input.currentQuantity);
  const rawNeeded = target.quantity - current;
  if (rawNeeded <= 0) {
    return {
      status: 'no_order_needed',
      suggestedQuantity: 0,
      unit: target.unit,
      targetQuantity: target.quantity,
      targetUnit: target.unit,
      reason: `You already have ${formatQuantity(current, target.unit)} of ${itemName}, which matches the usual target. No order is needed.`,
      recommendationType: target.recommendationType,
    };
  }

  const suggestedQuantity = calculateSuggestedOrder({
    rawNeeded,
    minOrderQuantity: reorderRule?.min_order_quantity ?? 1,
    orderIncrement: reorderRule?.order_increment ?? 1,
    allowFractionalOrder: reorderRule?.allow_fractional_order === true,
    roundingPolicy: reorderRule?.rounding_policy ?? defaultRoundingPolicy(target.unit),
    currentStockQuantity: current,
    minStockQuantity: reorderRule?.min_stock_quantity ?? null,
  });

  if (suggestedQuantity <= 0) {
    return {
      status: 'no_order_needed',
      suggestedQuantity: 0,
      unit: target.unit,
      targetQuantity: target.quantity,
      targetUnit: target.unit,
      reason: `You already have ${formatQuantity(current, target.unit)} of ${itemName}, which matches the usual target. No order is needed.`,
      recommendationType: target.recommendationType,
    };
  }

  return {
    status: 'recommend',
    suggestedQuantity,
    rawNeeded,
    unit: target.unit,
    targetQuantity: target.quantity,
    targetUnit: target.unit,
    reason: `Usual target is ${formatQuantity(target.quantity, target.unit)}.`,
    recommendationType: target.recommendationType,
  };
}

function compareRemainingToRule(
  input: EvaluateReorderRuleInput,
  rule: InventoryReorderRule,
): (
  | { status: 'ok'; matches: boolean; remainingQty: number | null; reason: string }
  | { status: 'unit_mismatch' | 'cannot_evaluate'; reason: string; rule: InventoryReorderRule }
) {
  if (rule.trigger_type === 'always') {
    return { status: 'ok', matches: true, remainingQty: input.remainingQty, reason: 'Rule always applies.' };
  }
  if (input.remainingQty == null || !Number.isFinite(input.remainingQty)) {
    return {
      status: 'cannot_evaluate',
      rule,
      reason: `${input.itemName ?? 'Item'} needs a remaining quantity before I can check the reorder rule.`,
    };
  }
  const triggerQty = typeof rule.trigger_qty === 'number' && Number.isFinite(rule.trigger_qty)
    ? rule.trigger_qty
    : null;
  if (triggerQty == null) {
    return {
      status: 'cannot_evaluate',
      rule,
      reason: `${input.itemName ?? 'Item'} has a reorder rule with no trigger quantity.`,
    };
  }

  const converted = convertRemainingQtyToTriggerUnit({
    itemId: input.itemId,
    remainingQty: input.remainingQty,
    remainingUnit: input.remainingUnit,
    triggerUnit: rule.trigger_unit ?? null,
    allowedUnitRules: input.allowedUnitRules ?? [],
  });
  if (converted.status === 'unit_mismatch') {
    return {
      status: 'unit_mismatch',
      rule,
      reason: `${input.itemName ?? 'Item'} was counted as ${input.remainingUnit ?? 'an unknown unit'}, but the reorder rule uses ${rule.trigger_unit ?? 'an unknown unit'}. Add a unit conversion before comparing them.`,
    };
  }

  const remainingQty = converted.quantity;
  let matches = false;
  switch (rule.trigger_type) {
    case 'below':
      matches = remainingQty < triggerQty;
      break;
    case 'at_or_below':
      matches = remainingQty <= triggerQty;
      break;
    case 'equal':
      matches = remainingQty === triggerQty;
      break;
    case 'at_or_above':
      matches = remainingQty >= triggerQty;
      break;
    case 'between': {
      const max = typeof rule.trigger_qty_max === 'number' && Number.isFinite(rule.trigger_qty_max)
        ? rule.trigger_qty_max
        : null;
      if (max == null) {
        return {
          status: 'cannot_evaluate',
          rule,
          reason: `${input.itemName ?? 'Item'} has a between rule without a max trigger quantity.`,
        };
      }
      matches = remainingQty >= triggerQty && remainingQty <= max;
      break;
    }
    default:
      matches = false;
  }

  return {
    status: 'ok',
    matches,
    remainingQty,
    reason: matches
      ? 'Rule matched.'
      : buildNoMatchReason(input.itemName ?? 'Item', remainingQty, rule),
  };
}

function convertRemainingQtyToTriggerUnit(input: {
  itemId: string;
  remainingQty: number;
  remainingUnit: string | null;
  triggerUnit: string | null;
  allowedUnitRules: ItemAllowedUnitRule[];
}): { status: 'ok'; quantity: number } | { status: 'unit_mismatch' } {
  const remainingUnit = normalizeUnitForComparison(input.remainingUnit);
  const triggerUnit = normalizeUnitForComparison(input.triggerUnit);
  if (!remainingUnit || !triggerUnit || remainingUnit === triggerUnit) {
    return { status: 'ok', quantity: input.remainingQty };
  }
  const remainingRule = input.allowedUnitRules.find((rule) =>
    rule.item_id === input.itemId &&
    normalizeUnitForComparison(rule.unit) === remainingUnit
  );
  const triggerRule = input.allowedUnitRules.find((rule) =>
    rule.item_id === input.itemId &&
    normalizeUnitForComparison(rule.unit) === triggerUnit
  );
  const remainingConversion = positiveNumber(remainingRule?.conversion_to_base_unit);
  const triggerConversion = positiveNumber(triggerRule?.conversion_to_base_unit);
  if (remainingConversion == null || triggerConversion == null) {
    return { status: 'unit_mismatch' };
  }
  return { status: 'ok', quantity: (input.remainingQty * remainingConversion) / triggerConversion };
}

function buildRuleReason(itemName: string, remainingQty: number | null, rule: InventoryReorderRule): string {
  const remaining = remainingQty == null ? 'the reported stock' : formatQuantity(remainingQty, rule.trigger_unit ?? null);
  if (rule.trigger_type === 'below') {
    return `${itemName}: remaining ${remaining} is below ${formatQuantity(rule.trigger_qty ?? 0, rule.trigger_unit ?? null)}.`;
  }
  if (rule.trigger_type === 'at_or_below') {
    return `${itemName}: remaining ${remaining} is at or below ${formatQuantity(rule.trigger_qty ?? 0, rule.trigger_unit ?? null)}.`;
  }
  if (rule.trigger_type === 'equal') {
    return `${itemName}: remaining ${remaining} matches the reorder rule.`;
  }
  if (rule.trigger_type === 'at_or_above') {
    return `${itemName}: remaining ${remaining} is at or above ${formatQuantity(rule.trigger_qty ?? 0, rule.trigger_unit ?? null)}.`;
  }
  if (rule.trigger_type === 'between') {
    return `${itemName}: remaining ${remaining} is between ${formatQuantity(rule.trigger_qty ?? 0, rule.trigger_unit ?? null)} and ${formatQuantity(rule.trigger_qty_max ?? 0, rule.trigger_unit ?? null)}.`;
  }
  return `${itemName}: sheet reorder rule matched.`;
}

function buildNoMatchReason(itemName: string, remainingQty: number, rule: InventoryReorderRule): string {
  const remaining = formatQuantity(remainingQty, rule.trigger_unit ?? null);
  if (rule.trigger_type === 'below') {
    return `${itemName} — no order needed. Remaining ${remaining} is not below ${formatQuantity(rule.trigger_qty ?? 0, rule.trigger_unit ?? null)}.`;
  }
  if (rule.trigger_type === 'at_or_below') {
    return `${itemName} — no order needed. Remaining ${remaining} is above ${formatQuantity(rule.trigger_qty ?? 0, rule.trigger_unit ?? null)}.`;
  }
  if (rule.trigger_type === 'equal') {
    return `${itemName} — no order needed. Remaining ${remaining} does not equal ${formatQuantity(rule.trigger_qty ?? 0, rule.trigger_unit ?? null)}.`;
  }
  if (rule.trigger_type === 'at_or_above') {
    return `${itemName} — no order needed. Remaining ${remaining} is below ${formatQuantity(rule.trigger_qty ?? 0, rule.trigger_unit ?? null)}.`;
  }
  if (rule.trigger_type === 'between') {
    return `${itemName} — no order needed. Remaining ${remaining} is outside the configured range.`;
  }
  return `${itemName} did not match the reorder rule.`;
}

function resolveRecommendationTarget(input: {
  itemId: string;
  item: CatalogItem | null;
  reorderRule: ItemReorderRule | null;
  profile: ItemOrderProfile | null;
  limit: ItemOrderLimit | null;
  recentOrders: RecommendationHistoryOrder[];
  currentUnit: string | null;
}): {
  quantity: number;
  unit: string | null;
  recommendationType: Recommendation['recommendation_type'];
} | null {
  const ruleTarget = positiveNumber(input.reorderRule?.target_stock_quantity);
  if (ruleTarget != null) {
    return {
      quantity: ruleTarget,
      unit: input.reorderRule?.target_stock_unit ?? input.reorderRule?.usual_order_unit ?? input.currentUnit,
      recommendationType: 'stock_reorder_rule',
    };
  }

  const profileTarget = positiveNumber(input.profile?.usual_quantity);
  if (profileTarget != null) {
    return {
      quantity: profileTarget,
      unit: input.profile?.usual_unit ?? input.currentUnit,
      recommendationType: 'history_profile',
    };
  }

  const catalogTarget = positiveNumber(input.item?.target_stock);
  if (catalogTarget != null) {
    return {
      quantity: catalogTarget,
      unit: input.item?.default_order_unit ?? input.currentUnit,
      recommendationType: 'stock_reorder_rule',
    };
  }

  const limitTarget = positiveNumber(input.limit?.historical_median_quantity);
  if (limitTarget != null) {
    return {
      quantity: limitTarget,
      unit: input.limit?.default_order_unit ?? input.currentUnit,
      recommendationType: 'history_profile',
    };
  }

  const historyTarget = medianRecentQuantity(input.recentOrders, input.itemId, input.currentUnit);
  if (historyTarget != null) {
    return {
      quantity: historyTarget,
      unit: input.currentUnit,
      recommendationType: 'recent_history',
    };
  }

  return null;
}

export type ReorderRecommendationInput = {
  item: Pick<CatalogItem, 'name'>;
  rule: ItemReorderRule;
  currentStockQuantity: number;
  currentStockUnit: string | null;
};

export type ReorderRecommendationResult = {
  suggestedQuantity: number;
  rawNeeded: number;
  roundedNeeded: number;
  unit: string | null;
  reason: string;
};

export function getReorderRecommendation(input: ReorderRecommendationInput): ReorderRecommendationResult | null {
  const target = positiveNumber(input.rule.target_stock_quantity);
  if (target == null) return null;
  const current = Math.max(0, input.currentStockQuantity);
  const rawNeeded = target - current;
  const unit = input.rule.usual_order_unit ?? input.rule.target_stock_unit ?? input.currentStockUnit;
  const roundedNeeded = calculateSuggestedOrder({
    rawNeeded,
    minOrderQuantity: input.rule.min_order_quantity ?? 1,
    orderIncrement: input.rule.order_increment ?? 1,
    allowFractionalOrder: input.rule.allow_fractional_order === true,
    roundingPolicy: input.rule.rounding_policy ?? 'nearest',
    currentStockQuantity: current,
    minStockQuantity: input.rule.min_stock_quantity ?? null,
  });

  const reason = roundedNeeded <= 0
    ? `${input.item.name} is already at or above its target stock.`
    : `You usually keep ${input.item.name} around ${formatNumber(target)} ${unit ?? 'units'}. Since you have ${formatNumber(current)} ${unit ?? 'units'}, I suggest ${formatNumber(roundedNeeded)} ${unit ?? 'units'}.`;

  return {
    suggestedQuantity: roundedNeeded,
    rawNeeded,
    roundedNeeded,
    unit,
    reason,
  };
}

export function calculateSuggestedOrder(input: {
  rawNeeded: number;
  minOrderQuantity?: number | null;
  orderIncrement?: number | null;
  allowFractionalOrder?: boolean;
  roundingPolicy?: ReorderRoundingPolicy | null;
  currentStockQuantity?: number | null;
  minStockQuantity?: number | null;
}): number {
  if (!Number.isFinite(input.rawNeeded) || input.rawNeeded <= 0) return 0;
  const increment = positiveNumber(input.orderIncrement) ?? 1;
  const minOrder = Math.max(0, input.minOrderQuantity ?? 1);
  const rounded = applyRoundingPolicy({
    quantity: input.rawNeeded,
    increment,
    policy: input.roundingPolicy ?? 'nearest',
    currentStockQuantity: input.currentStockQuantity ?? null,
    minStockQuantity: input.minStockQuantity ?? null,
  });
  const flooredForFraction = input.allowFractionalOrder === true ? rounded : Math.ceil(rounded);
  if (flooredForFraction <= 0) return 0;
  return Math.max(minOrder, flooredForFraction);
}

export function applyRoundingPolicy(input: {
  quantity: number;
  increment: number;
  policy: ReorderRoundingPolicy;
  currentStockQuantity?: number | null;
  minStockQuantity?: number | null;
}): number {
  const quantity = Math.max(0, input.quantity);
  const increment = positiveNumber(input.increment) ?? 1;
  if (quantity <= 0) return 0;
  const floor = Math.floor(quantity / increment) * increment;
  const ceil = Math.ceil(quantity / increment) * increment;
  switch (input.policy) {
    case 'none':
      return quantity;
    case 'ceil':
      return ceil;
    case 'floor':
      return floor > 0 ? floor : ceil;
    case 'half_up':
      return Math.floor((quantity / increment) + 0.5) * increment || ceil;
    case 'floor_conservative':
      return floor > 0 ? floor : ceil;
    case 'ceil_prevent_stockout':
      return ceil;
    case 'floor_normal_ceil_if_low':
      return input.minStockQuantity != null && input.currentStockQuantity != null && input.currentStockQuantity <= input.minStockQuantity
        ? ceil
        : floor > 0 ? floor : ceil;
    case 'custom_threshold': {
      const remainder = quantity - floor;
      return remainder >= increment * 0.35 ? ceil : floor > 0 ? floor : ceil;
    }
    case 'nearest':
    default:
      return Math.round(quantity / increment) * increment || ceil;
  }
}

function latestStockForItem(updates: StockOperation[], itemId: string): StockOperation | null {
  for (let index = updates.length - 1; index >= 0; index -= 1) {
    if (updates[index].item_id === itemId) return updates[index];
  }
  return null;
}

function averageRecentQuantity(
  orders: RecommendationHistoryOrder[],
  itemId: string,
  unit: string | null,
): number | null {
  const normalizedUnit = normalizeUnitForComparison(unit);
  const quantities: number[] = [];
  for (const order of orders) {
    for (const item of order.items ?? []) {
      if (item.item_id !== itemId) continue;
      if (normalizedUnit && item.unit && normalizeUnitForComparison(item.unit) !== normalizedUnit) continue;
      if (typeof item.quantity === 'number' && Number.isFinite(item.quantity) && item.quantity > 0) {
        quantities.push(item.quantity);
      }
    }
  }
  if (quantities.length === 0) return null;
  return quantities.reduce((sum, qty) => sum + qty, 0) / quantities.length;
}

function medianRecentQuantity(
  orders: RecommendationHistoryOrder[],
  itemId: string,
  unit: string | null,
): number | null {
  const normalizedUnit = normalizeUnitForComparison(unit);
  const quantities: number[] = [];
  for (const order of orders) {
    for (const item of order.items ?? []) {
      if (item.item_id !== itemId) continue;
      if (normalizedUnit && item.unit && normalizeUnitForComparison(item.unit) !== normalizedUnit) continue;
      if (typeof item.quantity === 'number' && Number.isFinite(item.quantity) && item.quantity > 0) {
        quantities.push(item.quantity);
      }
    }
  }
  if (quantities.length === 0) return null;
  quantities.sort((a, b) => a - b);
  const middle = Math.floor(quantities.length / 2);
  return quantities.length % 2 === 1
    ? quantities[middle]
    : (quantities[middle - 1] + quantities[middle]) / 2;
}

function defaultUnitForItem(
  item: CatalogItem,
  rules: ItemAllowedUnitRule[],
  limit: ItemOrderLimit | null,
): string | null {
  const defaultRule = rules.find((rule) => rule.item_id === item.id && rule.is_default);
  if (defaultRule?.unit) return defaultRule.unit;
  if (limit?.default_order_unit) return limit.default_order_unit;
  if (item.default_order_unit) return item.default_order_unit;
  if (item.order_unit) return item.order_unit;
  if (item.default_unit && !isTinyUsageUnit(item.default_unit)) return item.default_unit;
  if (item.pack_unit) return item.pack_unit;
  return item.default_unit ?? item.base_unit ?? null;
}

function convertStockQuantityToUnit(
  stock: StockOperation,
  targetUnit: string | null,
  rules: ItemAllowedUnitRule[],
): number | null {
  const stockUnit = normalizeUnitForComparison(stock.unit);
  const normalizedTarget = normalizeUnitForComparison(targetUnit);
  if (!stockUnit || !normalizedTarget) return null;
  if (stockUnit === normalizedTarget) return stock.quantity;

  const stockRule = rules.find((rule) =>
    rule.item_id === stock.item_id &&
    normalizeUnitForComparison(rule.unit) === stockUnit
  );
  const targetRule = rules.find((rule) =>
    rule.item_id === stock.item_id &&
    normalizeUnitForComparison(rule.unit) === normalizedTarget
  );
  const stockConversion = positiveNumber(stockRule?.conversion_to_base_unit);
  const targetConversion = positiveNumber(targetRule?.conversion_to_base_unit);
  if (stockConversion == null || targetConversion == null) return null;
  return (stock.quantity * stockConversion) / targetConversion;
}

function isTinyUsageUnit(unit: string): boolean {
  const normalized = normalizeUnitForComparison(unit);
  return normalized === 'oz' || normalized === 'pc' || normalized === 'piece';
}

function findLimit(limits: ItemOrderLimit[], itemId: string): ItemOrderLimit | null {
  return limits.find((limit) => limit.item_id === itemId) ?? null;
}

function findReorderRule(rules: ItemReorderRule[], itemId: string): ItemReorderRule | null {
  return rules.find((rule) => rule.item_id === itemId && rule.location_id) ?? rules.find((rule) => rule.item_id === itemId) ?? null;
}

function findOrderProfile(profiles: ItemOrderProfile[], itemId: string): ItemOrderProfile | null {
  return profiles.find((profile) => profile.item_id === itemId && profile.location_id) ?? profiles.find((profile) => profile.item_id === itemId) ?? null;
}

function applyRecommendationSafety(
  quantity: number,
  unit: string | null,
  limit: ItemOrderLimit | null,
  catalogItem?: CatalogItem | null,
): {
  cappedQuantity: number;
  status: Recommendation['safety_status'];
  warning: SafetyWarning | null;
} {
  const hardMaxOverride = positiveNumber(limit?.hard_max_quantity) ?? positiveNumber(limit?.max_single_order_quantity);
  const hardMax = hardMaxOverride ?? positiveNumber(catalogItem?.hard_cap);
  const softMaxOverride = positiveNumber(limit?.soft_max_quantity);
  const softMax = softMaxOverride ?? positiveNumber(catalogItem?.soft_cap);
  const managerApproval = positiveNumber(limit?.manager_approval_quantity);
  const cappedQuantity = hardMax != null ? Math.min(quantity, hardMax) : quantity;
  const status: Recommendation['safety_status'] =
    hardMax != null && quantity > hardMax
      ? 'blocked'
      : managerApproval != null && quantity > managerApproval
        ? 'manager_approval'
        : softMax != null && quantity > softMax
          ? 'confirm'
          : 'normal';
  if (status === 'normal') return { cappedQuantity, status, warning: null };
  const nameLabel = catalogItem?.name ?? 'Recommendation';
  return {
    cappedQuantity,
    status,
    warning: {
      type: status === 'blocked'
        ? 'above_hard_max'
        : status === 'manager_approval'
          ? 'manager_approval_required'
          : 'above_soft_max',
      message: `${nameLabel} recommendation is above the configured normal range.`,
      quantity: cappedQuantity,
      unit,
      severity: status === 'blocked' ? 'blocked' : 'warning',
    },
  };
}

function roundRecommendation(quantity: number, unit: string | null): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  const normalizedUnit = normalizeUnitForComparison(unit);
  if (normalizedUnit === 'lb' || normalizedUnit === 'oz') return Math.round(quantity * 2) / 2;
  return Math.ceil(quantity);
}

function defaultRoundingPolicy(unit: string | null): ReorderRoundingPolicy {
  const normalizedUnit = normalizeUnitForComparison(unit);
  if (normalizedUnit === 'lb' || normalizedUnit === 'oz') return 'half_up';
  return 'floor_conservative';
}

function positiveNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function formatQuantity(quantity: number, unit: string | null): string {
  const value = formatNumber(quantity);
  if (!unit) return value;
  if (quantity === 1) {
    if (unit === 'cs' || unit === 'case') return `${value} case`;
    if (unit === 'lb') return `${value} pound`;
  }
  if (unit === 'cs' || unit === 'case') return `${value} cases`;
  if (unit === 'lb') return `${value} pounds`;
  return `${value} ${unit}`;
}
