import { supabase } from '@/lib/supabase';
import { UnitType } from '@/types';

export interface UnitConversionLookup {
  [inventoryItemId: string]: Record<string, number>;
}

interface ResolveUnitConversionMultiplierInput {
  inventoryItemId: string;
  fromUnitLabel: string;
  toUnitLabel: string;
  fromUnitType: UnitType;
  toUnitType: UnitType;
  packSize?: number | null;
  lookup: UnitConversionLookup;
}

let unitConversionsTableAvailable: boolean | null = null;

function normalizeUnitLabel(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function toPositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function conversionKey(fromUnitLabel: string, toUnitLabel: string): string {
  return `${fromUnitLabel}=>${toUnitLabel}`;
}

function isMissingUnitConversionsTable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const typed = error as { code?: string; message?: string };
  if (typed.code === '42P01') return true;
  const message = typeof typed.message === 'string' ? typed.message.toLowerCase() : '';
  return message.includes('unit_conversions');
}

export async function loadUnitConversionLookup(
  inventoryItemIds: string[]
): Promise<UnitConversionLookup> {
  const ids = Array.from(
    new Set(
      inventoryItemIds
        .filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
    )
  );

  if (ids.length === 0 || unitConversionsTableAvailable === false) {
    return {};
  }

  const { data, error } = await (supabase as any)
    .from('unit_conversions')
    .select('inventory_item_id,from_unit,to_unit,multiplier')
    .in('inventory_item_id', ids)
    .limit(Math.min(5000, Math.max(200, ids.length * 20)));

  if (error) {
    if (isMissingUnitConversionsTable(error)) {
      unitConversionsTableAvailable = false;
      return {};
    }
    throw error;
  }

  unitConversionsTableAvailable = true;
  const lookup: UnitConversionLookup = {};

  (Array.isArray(data) ? data : []).forEach((row: any) => {
    const inventoryItemId =
      typeof row?.inventory_item_id === 'string' ? row.inventory_item_id.trim() : '';
    if (!inventoryItemId) return;

    const fromUnitLabel = normalizeUnitLabel(row?.from_unit);
    const toUnitLabel = normalizeUnitLabel(row?.to_unit);
    const multiplier = toPositiveNumber(row?.multiplier);

    if (!fromUnitLabel || !toUnitLabel || multiplier === null) return;

    if (!lookup[inventoryItemId]) {
      lookup[inventoryItemId] = {};
    }
    lookup[inventoryItemId][conversionKey(fromUnitLabel, toUnitLabel)] = multiplier;
  });

  return lookup;
}

export function resolveUnitConversionMultiplier(
  input: ResolveUnitConversionMultiplierInput
): number | null {
  const fromUnitLabel = normalizeUnitLabel(input.fromUnitLabel);
  const toUnitLabel = normalizeUnitLabel(input.toUnitLabel);

  if (!fromUnitLabel || !toUnitLabel) return null;
  if (fromUnitLabel === toUnitLabel || input.fromUnitType === input.toUnitType) return 1;

  const itemLookup = input.lookup[input.inventoryItemId] || {};
  const explicitMultiplier = toPositiveNumber(itemLookup[conversionKey(fromUnitLabel, toUnitLabel)]);
  if (explicitMultiplier !== null) return explicitMultiplier;

  const reverseMultiplier = toPositiveNumber(itemLookup[conversionKey(toUnitLabel, fromUnitLabel)]);
  if (reverseMultiplier !== null) {
    return 1 / reverseMultiplier;
  }

  const safePackSize = toPositiveNumber(input.packSize ?? null);
  if (!safePackSize || safePackSize <= 1) return null;

  if (input.fromUnitType === 'base' && input.toUnitType === 'pack') {
    return 1 / safePackSize;
  }
  if (input.fromUnitType === 'pack' && input.toUnitType === 'base') {
    return safePackSize;
  }

  return null;
}

export function applyUnitConversion(quantity: number, multiplier: number): number {
  if (!Number.isFinite(quantity)) return 0;
  if (!Number.isFinite(multiplier) || multiplier <= 0) return quantity;
  return quantity * multiplier;
}
