import type {
  CatalogItem,
  ItemAllowedUnitRule,
  ItemOrderLimit,
  Recommendation,
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

export function buildQuickOrderRecommendations(input: {
  catalog: CatalogItem[];
  stockUpdates: StockOperation[];
  recentOrders: RecommendationHistoryOrder[];
  limits: ItemOrderLimit[];
  allowedUnitRules: ItemAllowedUnitRule[];
  maxItems?: number;
}): { recommendations: Recommendation[]; warnings: SafetyWarning[] } {
  const warnings: SafetyWarning[] = [];
  const candidateItemIds = new Set<string>();

  for (const update of input.stockUpdates) candidateItemIds.add(update.item_id);
  for (const order of input.recentOrders.slice(0, 6)) {
    for (const item of order.items ?? []) {
      if (item.item_id) candidateItemIds.add(item.item_id);
    }
  }

  const recommendations: Recommendation[] = [];
  for (const itemId of candidateItemIds) {
    const catalogItem = input.catalog.find((item) => item.id === itemId);
    if (!catalogItem) continue;
    const stock = latestStockForItem(input.stockUpdates, itemId);
    const limit = findLimit(input.limits, itemId);
    const unit = defaultUnitForItem(catalogItem, input.allowedUnitRules, limit);
    const currentStockInOrderUnit = stock
      ? convertStockQuantityToUnit(stock, unit, input.allowedUnitRules)
      : null;
    const expectedUsage = averageRecentQuantity(input.recentOrders, itemId, unit);
    const previousAverage = expectedUsage ?? positiveNumber(limit?.historical_median_quantity) ?? positiveNumber(limit?.typical_min_quantity) ?? 1;
    const safetyStock = positiveNumber(limit?.typical_min_quantity) ?? Math.max(0, Math.ceil(previousAverage * 0.25));
    const currentStock = currentStockInOrderUnit;
    const rawSuggested = Math.max(0, previousAverage + safetyStock - (currentStock ?? 0));
    const rounded = roundRecommendation(rawSuggested, unit);
    if (rounded <= 0) continue;

    const hardMax = positiveNumber(limit?.hard_max_quantity) ?? positiveNumber(limit?.max_single_order_quantity);
    const softMax = positiveNumber(limit?.soft_max_quantity);
    const managerApproval = positiveNumber(limit?.manager_approval_quantity);
    const capped = hardMax != null ? Math.min(rounded, hardMax) : rounded;
    const safetyStatus: Recommendation['safety_status'] =
      hardMax != null && rounded > hardMax
        ? 'blocked'
        : managerApproval != null && rounded > managerApproval
          ? 'manager_approval'
          : softMax != null && rounded > softMax
            ? 'confirm'
            : 'normal';

    if (safetyStatus !== 'normal') {
      warnings.push({
        type: safetyStatus === 'blocked'
          ? 'above_hard_max'
          : safetyStatus === 'manager_approval'
            ? 'manager_approval_required'
            : 'above_soft_max',
        message: `${catalogItem.name} recommendation is above the configured normal range.`,
        item_id: catalogItem.id,
        item_name: catalogItem.name,
        quantity: capped,
        unit,
        severity: safetyStatus === 'blocked' ? 'blocked' : 'warning',
      });
    }

    recommendations.push({
      item_id: catalogItem.id,
      item_name: catalogItem.name,
      suggested_quantity: capped,
      unit,
      confidence: stock ? 0.82 : 0.68,
      reason: stock
        ? `Based on current stock and recent order history.`
        : `Based on recent order history for this location.`,
      inputs: {
        current_stock: currentStock,
        expected_usage: expectedUsage,
        safety_stock: safetyStock,
        previous_average: previousAverage,
        day_of_week_pattern: null,
        next_delivery_date: null,
      },
      safety_status: safetyStatus,
    });
  }

  return {
    recommendations: recommendations
      .sort((a, b) => b.confidence - a.confidence || a.item_name.localeCompare(b.item_name))
      .slice(0, input.maxItems ?? 6),
    warnings,
  };
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

function defaultUnitForItem(
  item: CatalogItem,
  rules: ItemAllowedUnitRule[],
  limit: ItemOrderLimit | null,
): string | null {
  const defaultRule = rules.find((rule) => rule.item_id === item.id && rule.is_default);
  if (defaultRule?.unit) return defaultRule.unit;
  if (limit?.default_order_unit) return limit.default_order_unit;
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

function roundRecommendation(quantity: number, unit: string | null): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  const normalizedUnit = normalizeUnitForComparison(unit);
  if (normalizedUnit === 'lb' || normalizedUnit === 'oz') return Math.round(quantity * 2) / 2;
  return Math.ceil(quantity);
}

function positiveNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
