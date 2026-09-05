import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HistoricalOrderItem, HistoricalOrderSummary, PredictedOrderItem } from '@/features/ordering/orderInsights';
import type { LocationReminderBanner } from '@/services/locationReminderService';

interface CachedHomeInsights {
  predictedItems: PredictedOrderItem[];
  reorderOrder: HistoricalOrderSummary | null;
  activeReminder: LocationReminderBanner | null;
  cachedAt: number;
}

const HOME_CACHE_STORAGE_KEY = 'home-insights-cache-v2';
const HOME_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const cache = new Map<string, CachedHomeInsights>();
let generation = 0;

export function getHomeInsightsGeneration(): number { return generation; }

export function getHomeInsights(userId: string | null | undefined, locationId: string): CachedHomeInsights | undefined {
  if (!userId) return undefined;
  return cache.get(`${userId}:${locationId}`);
}

export function setHomeInsights(
  userId: string | null,
  locationId: string,
  data: CachedHomeInsights,
  requestGeneration = generation,
): void {
  if (!userId || requestGeneration !== generation) return;
  cache.set(`${userId}:${locationId}`, data);
  void AsyncStorage.setItem(HOME_CACHE_STORAGE_KEY, JSON.stringify(Object.fromEntries(cache))).catch(() => {});
}

export function clearHomeInsightsCache(): void {
  generation += 1;
  cache.clear();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isHistoricalOrderItem(value: unknown): value is HistoricalOrderItem {
  return isRecord(value) &&
    typeof value.inventoryItemId === 'string' &&
    typeof value.name === 'string' &&
    typeof value.category === 'string' &&
    typeof value.supplierCategory === 'string' &&
    isFiniteNumber(value.quantity) &&
    (value.unitType === 'base' || value.unitType === 'pack') &&
    typeof value.baseUnit === 'string' &&
    typeof value.packUnit === 'string' &&
    isFiniteNumber(value.packSize) &&
    (value.note === null || typeof value.note === 'string');
}

function isPredictedOrderItem(value: unknown): value is PredictedOrderItem {
  return isRecord(value) && isHistoricalOrderItem(value) &&
    isFiniteNumber(value.occurrenceCount) && Number.isInteger(value.occurrenceCount) && value.occurrenceCount >= 0;
}

function isHistoricalOrderSummary(value: unknown): value is HistoricalOrderSummary {
  return isRecord(value) && typeof value.id === 'string' && isDateString(value.createdAt) &&
    typeof value.locationId === 'string' && Array.isArray(value.items) && value.items.every(isHistoricalOrderItem) &&
    isFiniteNumber(value.itemCount) && Number.isInteger(value.itemCount) && value.itemCount >= 0;
}

function isLocationReminder(value: unknown): value is LocationReminderBanner {
  return isRecord(value) && typeof value.id === 'string' && typeof value.message === 'string' &&
    (value.senderName === null || typeof value.senderName === 'string') && isDateString(value.createdAt);
}

function isCachedHomeInsights(value: unknown): value is CachedHomeInsights {
  return isRecord(value) && Array.isArray(value.predictedItems) && value.predictedItems.every(isPredictedOrderItem) &&
    (value.reorderOrder === null || isHistoricalOrderSummary(value.reorderOrder)) &&
    (value.activeReminder === null || isLocationReminder(value.activeReminder)) && isFiniteNumber(value.cachedAt);
}

export async function hydrateHomeInsightsCache(): Promise<void> {
  const hydrationGeneration = generation;
  try {
    const raw = await AsyncStorage.getItem(HOME_CACHE_STORAGE_KEY);
    if (!raw || hydrationGeneration !== generation) return;
    const entries: unknown = JSON.parse(raw);
    if (!isRecord(entries)) return;
    const now = Date.now();
    for (const [key, entry] of Object.entries(entries)) {
      if (key.includes(':') && isCachedHomeInsights(entry) &&
          now - entry.cachedAt < HOME_CACHE_MAX_AGE_MS && !cache.has(key)) {
        cache.set(key, entry);
      }
    }
  } catch {
    // Local cached cards are optional; the screen fetches current data.
  }
}

void hydrateHomeInsightsCache();
