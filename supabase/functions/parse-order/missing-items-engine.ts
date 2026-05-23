import type { CatalogItem, ParsedItem } from './types.ts';
import { normalizeUnitForComparison } from './units.ts';

export type MissingItemTimeRange = 'yesterday' | 'last_week' | 'recent' | 'usual' | 'last_month';
export type MissingItemConfidence = 'high' | 'medium' | 'low';
export type MissingItemSource = 'last_week' | 'same_weekday' | 'usual_pattern' | 'imported_history';

export type MissingItemSuggestion = {
  itemId: string;
  itemName: string;
  suggestedQuantity: number;
  unit: string | null;
  confidence: MissingItemConfidence;
  reason: string;
  source: MissingItemSource;
  occurrenceCount: number;
  sampleSize: number;
};

export type MissingItemHistoryOrder = {
  id: string;
  placedAt: string;
  locationId?: string | null;
  supplierId?: string | null;
  employeeId?: string | null;
  source?: 'submitted_orders' | 'manager_import';
  items: {
    itemId: string;
    itemName: string;
    quantity: number;
    unit: string | null;
    supplierId?: string | null;
  }[];
};

export type MissingItemEngineInput = {
  currentItems: ParsedItem[];
  historyOrders: MissingItemHistoryOrder[];
  catalog: CatalogItem[];
  locationId: string;
  supplierId?: string | null;
  employeeId?: string | null;
  timeRange?: MissingItemTimeRange | null;
  ignoredItemIds?: string[];
  now?: Date;
  maxSuggestions?: number;
};

const MISSING_ITEM_PATTERNS = [
  /\bwhat (?:am i|are we) missing\b/i,
  /\bdid (?:i|we) forget\b/i,
  /\bam i missing\b/i,
  /\bare we missing\b/i,
  /\bwhat did (?:i|we) miss\b/i,
  /\bcheck if (?:i|we) forgot\b/i,
  /\bdoes this look complete\b/i,
  /\bis this order complete\b/i,
  /\bcompare this to\b/i,
  /\bcompare (?:this|my order|the order) (?:to|with)\b/i,
  /\bwhat(?:'s| is) different from\b/i,
  /\banything else (?:i|we) usually order\b/i,
  /\bwhat do (?:i|we) normally order that is not here\b/i,
  /\bwhat should (?:i|we) add\b/i,
  /\bwhat else should (?:i|we) (?:buy|order|add)\b/i,
];

export function isMissingItemCheckRequest(message: string): boolean {
  const normalized = message.normalize('NFKC').trim();
  return MISSING_ITEM_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function extractMissingItemTimeRange(message: string): MissingItemTimeRange | null {
  const text = message.normalize('NFKC').trim().toLowerCase();
  if (/\byesterday\b/.test(text)) return 'yesterday';
  if (/\blast week\b/.test(text)) return 'last_week';
  if (/\blast month\b/.test(text)) return 'last_month';
  if (/\busual|usually|normally|typical\b/.test(text)) return 'usual';
  if (/\brecent|lately|last few\b/.test(text)) return 'recent';
  return null;
}

export function buildMissingItemCartHash(items: ParsedItem[]): string {
  return items
    .filter((item) => item.item_id && item.quantity != null)
    .map((item) => [
      item.item_id,
      Number(item.quantity ?? 0).toFixed(4),
      normalizeUnitForComparison(item.unit ?? ''),
    ].join(':'))
    .sort()
    .join('|');
}

export function buildMissingItemSuggestions(input: MissingItemEngineInput): MissingItemSuggestion[] {
  const now = input.now ?? new Date();
  const currentItemIds = new Set(
    input.currentItems
      .map((item) => item.item_id)
      .filter((id): id is string => Boolean(id)),
  );
  const ignored = new Set(input.ignoredItemIds ?? []);
  const catalogById = new Map(input.catalog.map((item) => [item.id, item]));
  const similarOrders = selectSimilarOrders(input.historyOrders, input, now).slice(0, 8);
  if (similarOrders.length < 3) return [];

  const statsByItem = new Map<string, {
    itemId: string;
    itemName: string;
    occurrenceCount: number;
    quantities: number[];
    units: (string | null)[];
    importedCount: number;
    lastWeekCount: number;
  }>();

  for (const order of similarOrders) {
    const seen = new Set<string>();
    for (const item of order.items) {
      if (!item.itemId || seen.has(item.itemId)) continue;
      seen.add(item.itemId);
      if (currentItemIds.has(item.itemId) || ignored.has(item.itemId)) continue;
      const catalogItem = catalogById.get(item.itemId);
      if (!catalogItem) continue;
      const stat = statsByItem.get(item.itemId) ?? {
        itemId: item.itemId,
        itemName: catalogItem.name || item.itemName,
        occurrenceCount: 0,
        quantities: [],
        units: [],
        importedCount: 0,
        lastWeekCount: 0,
      };
      stat.occurrenceCount += 1;
      if (Number.isFinite(item.quantity) && item.quantity > 0) stat.quantities.push(item.quantity);
      stat.units.push(item.unit);
      if (order.source === 'manager_import') stat.importedCount += 1;
      if (isWithinLastWeek(order.placedAt, now)) stat.lastWeekCount += 1;
      statsByItem.set(item.itemId, stat);
    }
  }

  const sampleSize = similarOrders.length;
  return [...statsByItem.values()]
    .map((stat): MissingItemSuggestion | null => {
      if (!passesMvpCandidateRules(stat.occurrenceCount, sampleSize, stat.lastWeekCount)) return null;
      const ratio = stat.occurrenceCount / Math.max(1, sampleSize);
      const confidence: MissingItemConfidence = ratio >= 0.8 && stat.occurrenceCount >= 3
        ? 'high'
        : ratio >= 0.66 && stat.occurrenceCount >= 4
          ? 'medium'
          : 'low';
      if (confidence === 'low') return null;
      const source = stat.importedCount >= Math.ceil(stat.occurrenceCount / 2)
        ? 'imported_history'
        : input.timeRange === 'last_week' || stat.lastWeekCount > 0
          ? 'last_week'
          : input.timeRange === 'usual'
            ? 'usual_pattern'
            : 'same_weekday';
      const suggestedQuantity = median(stat.quantities) ?? 1;
      const unit = mostCommonUnit(stat.units);
      return {
        itemId: stat.itemId,
        itemName: stat.itemName,
        suggestedQuantity,
        unit,
        confidence,
        reason: buildReason(stat.itemName, stat.occurrenceCount, sampleSize, source, now),
        source,
        occurrenceCount: stat.occurrenceCount,
        sampleSize,
      };
    })
    .filter((entry): entry is MissingItemSuggestion => Boolean(entry))
    .sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence)
      || (b.occurrenceCount / b.sampleSize) - (a.occurrenceCount / a.sampleSize)
      || a.itemName.localeCompare(b.itemName))
    .slice(0, input.maxSuggestions ?? 5);
}

function selectSimilarOrders(
  orders: MissingItemHistoryOrder[],
  input: MissingItemEngineInput,
  now: Date,
): MissingItemHistoryOrder[] {
  const currentDow = now.getDay();
  const range = rangeForTime(input.timeRange ?? 'recent', now);
  return orders
    .filter((order) => order.locationId == null || order.locationId === input.locationId)
    .filter((order) => !input.supplierId || !order.supplierId || order.supplierId === input.supplierId)
    .filter((order) => {
      const placed = new Date(order.placedAt);
      if (!Number.isFinite(placed.getTime())) return false;
      if (range && (placed < range.start || placed >= range.end)) return false;
      if (!input.timeRange || input.timeRange === 'recent' || input.timeRange === 'usual') {
        return placed.getDay() === currentDow || order.source === 'manager_import';
      }
      return true;
    })
    .sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime());
}

function rangeForTime(timeRange: MissingItemTimeRange, now: Date): { start: Date; end: Date } | null {
  const end = new Date(now);
  if (timeRange === 'yesterday') {
    const start = startOfLocalDay(addDays(now, -1));
    return { start, end: startOfLocalDay(now) };
  }
  if (timeRange === 'last_week') return { start: addDays(now, -14), end: addDays(now, -6) };
  if (timeRange === 'last_month') return { start: addDays(now, -45), end };
  return { start: addDays(now, -56), end };
}

function passesMvpCandidateRules(occurrenceCount: number, sampleSize: number, lastWeekCount: number): boolean {
  return (
    (sampleSize >= 4 && occurrenceCount >= 3) ||
    (sampleSize >= 6 && occurrenceCount >= 4) ||
    (lastWeekCount > 0 && occurrenceCount >= 3)
  );
}

function buildReason(itemName: string, occurrenceCount: number, sampleSize: number, source: MissingItemSource, now: Date): string {
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  if (source === 'imported_history') {
    return `Included in ${occurrenceCount} of the last ${sampleSize} similar imported history orders.`;
  }
  if (source === 'last_week') {
    return `Included last week and in ${occurrenceCount} of the last ${sampleSize} similar orders.`;
  }
  if (source === 'usual_pattern') {
    return `Included in ${occurrenceCount} of the last ${sampleSize} usual similar orders.`;
  }
  return `Included in ${occurrenceCount} of your last ${sampleSize} similar ${weekday} orders.`;
}

function isWithinLastWeek(value: string, now: Date): boolean {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return false;
  return time >= addDays(now, -8).getTime() && time < addDays(now, -1).getTime();
}

function confidenceRank(value: MissingItemConfidence): number {
  return value === 'high' ? 3 : value === 'medium' ? 2 : 1;
}

function median(values: number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mostCommonUnit(values: (string | null)[]): string | null {
  const counts = new Map<string, { raw: string; count: number }>();
  for (const value of values) {
    if (!value?.trim()) continue;
    const key = normalizeUnitForComparison(value);
    if (!key) continue;
    const current = counts.get(key) ?? { raw: value.trim(), count: 0 };
    current.count += 1;
    counts.set(key, current);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.raw ?? null;
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfLocalDay(value: Date): Date {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}
