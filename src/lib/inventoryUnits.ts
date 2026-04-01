import type { UnitType } from '@/types';

type InventoryUnitSource = {
  base_unit?: unknown;
  pack_unit?: unknown;
  pack_size?: unknown;
};

function normalizeUnitLabel(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

export function normalizeInventoryPackSize(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return parsed;
}

export function hasInventoryUnit(item: InventoryUnitSource, unitType: UnitType): boolean {
  if (unitType === 'pack') {
    return normalizeUnitLabel(item.pack_unit).length > 0;
  }
  return normalizeUnitLabel(item.base_unit).length > 0;
}

export function getAvailableInventoryUnitTypes(item: InventoryUnitSource): UnitType[] {
  const available: UnitType[] = [];
  if (hasInventoryUnit(item, 'pack')) {
    available.push('pack');
  }
  if (hasInventoryUnit(item, 'base')) {
    available.push('base');
  }
  return available;
}

export function resolvePreferredInventoryUnitType(
  item: InventoryUnitSource,
  preferred: UnitType = 'pack'
): UnitType {
  if (hasInventoryUnit(item, preferred)) {
    return preferred;
  }

  if (preferred === 'pack' && hasInventoryUnit(item, 'base')) {
    return 'base';
  }

  if (preferred === 'base' && hasInventoryUnit(item, 'pack')) {
    return 'pack';
  }

  return preferred;
}

export function getInventoryUnitLabel(
  item: InventoryUnitSource,
  unitType: UnitType
): string {
  const requestedLabel =
    unitType === 'pack'
      ? normalizeUnitLabel(item.pack_unit)
      : normalizeUnitLabel(item.base_unit);

  if (requestedLabel.length > 0) {
    return requestedLabel;
  }

  const fallbackLabel =
    unitType === 'pack'
      ? normalizeUnitLabel(item.base_unit)
      : normalizeUnitLabel(item.pack_unit);

  if (fallbackLabel.length > 0) {
    return fallbackLabel;
  }

  return unitType === 'pack' ? 'pack' : 'unit';
}

export function getInventoryUnitSummary(item: InventoryUnitSource): string {
  const baseUnit = normalizeUnitLabel(item.base_unit);
  const packUnit = normalizeUnitLabel(item.pack_unit);
  const packSize = normalizeInventoryPackSize(item.pack_size);

  if (baseUnit && packUnit) {
    return `${packSize} ${baseUnit}/${packUnit}`;
  }

  if (packUnit) {
    return `Per ${packUnit}`;
  }

  if (baseUnit) {
    return `Per ${baseUnit}`;
  }

  return 'Unit not set';
}

export function getInventoryConversionSummary(item: InventoryUnitSource): string | null {
  const baseUnit = normalizeUnitLabel(item.base_unit);
  const packUnit = normalizeUnitLabel(item.pack_unit);
  const packSize = normalizeInventoryPackSize(item.pack_size);

  if (baseUnit && packUnit) {
    return `1 ${packUnit} = ${packSize} ${baseUnit}`;
  }

  if (packUnit) {
    return `Ordering unit: ${packUnit}`;
  }

  if (baseUnit) {
    return `Ordering unit: ${baseUnit}`;
  }

  return null;
}

export function normalizeInventoryItemUnits(input: {
  base_unit?: unknown;
  pack_unit?: unknown;
  pack_size?: unknown;
}) {
  const base_unit = normalizeUnitLabel(input.base_unit);
  const pack_unit = normalizeUnitLabel(input.pack_unit);

  if (!base_unit && !pack_unit) {
    throw new Error('At least one unit is required.');
  }

  return {
    base_unit,
    pack_unit,
    pack_size: normalizeInventoryPackSize(input.pack_size),
  };
}
