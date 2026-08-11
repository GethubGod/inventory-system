// Shared unit-label resolution for fulfillment message building.
// Single source of truth used by BOTH app/(manager)/fulfillment-confirmation.tsx
// and src/features/fulfillment/sendAll/sendAllMessage.ts so the Send All message
// text can never diverge from the confirmation screen's output.
// Pure module — no React/React Native imports.

export interface InventoryUnitInfo {
  id: string;
  base_unit: string;
  pack_unit: string;
  pack_size: number;
}

export interface UnitLabelAvailability {
  baseLabel: string | null;
  packLabel: string | null;
  hasBase: boolean;
  hasPack: boolean;
}

export interface UnitSelectorProps {
  baseUnitLabel: string;
  packUnitLabel: string;
  canSwitchUnit: boolean;
}

export function normalizeUnitLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function unitLabelsMatch(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  const normalizedLeft = normalizeUnitLabel(left)?.toLowerCase();
  const normalizedRight = normalizeUnitLabel(right)?.toLowerCase();
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft === normalizedRight;
}

export function resolveUnitSelectorProps({
  unitInfo,
  availability,
  currentUnitType,
  currentUnitLabel,
}: {
  unitInfo: InventoryUnitInfo | undefined;
  availability: UnitLabelAvailability | undefined;
  currentUnitType: 'base' | 'pack';
  currentUnitLabel: string;
}): UnitSelectorProps {
  const currentLabel = normalizeUnitLabel(currentUnitLabel) ?? (currentUnitType === 'pack' ? 'pack' : 'unit');
  const infoBaseLabel = normalizeUnitLabel(unitInfo?.base_unit);
  const infoPackLabel = normalizeUnitLabel(unitInfo?.pack_unit);

  let baseUnitLabel = infoBaseLabel ?? availability?.baseLabel ?? (currentUnitType === 'base' ? currentLabel : 'base');
  let packUnitLabel = infoPackLabel ?? availability?.packLabel ?? (currentUnitType === 'pack' ? currentLabel : 'pack');

  const hasAlternateUnitType = Boolean(availability?.hasBase && availability?.hasPack);
  const hasDistinctUnitLabelsFromInventory =
    Boolean(infoBaseLabel && infoPackLabel) && !unitLabelsMatch(infoBaseLabel, infoPackLabel);
  const knownOppositeLabel =
    currentUnitType === 'base'
      ? infoPackLabel ?? availability?.packLabel ?? null
      : infoBaseLabel ?? availability?.baseLabel ?? null;
  const hasDistinctKnownOppositeLabel =
    Boolean(knownOppositeLabel) && !unitLabelsMatch(knownOppositeLabel, currentLabel);

  // If both unit types are known but labels collapsed to one value, keep toggle enabled with a safe generic fallback.
  if (hasAlternateUnitType && unitLabelsMatch(baseUnitLabel, packUnitLabel)) {
    if (currentUnitType === 'base') {
      packUnitLabel = availability?.packLabel ?? infoPackLabel ?? 'pack';
    } else {
      baseUnitLabel = availability?.baseLabel ?? infoBaseLabel ?? 'base';
    }
  }

  const canSwitchUnit =
    hasAlternateUnitType || hasDistinctUnitLabelsFromInventory || hasDistinctKnownOppositeLabel;

  return { baseUnitLabel, packUnitLabel, canSwitchUnit };
}

export interface UnitLabelSourceRow {
  inventoryItemId: string;
  unitType: 'base' | 'pack';
  unitLabel: string;
}

// Mirrors the confirmation screen's unitLabelAvailabilityByInventoryItemId memo:
// first non-empty label per unit type wins, registration order matters.
export function buildUnitLabelAvailabilityMap(
  rows: UnitLabelSourceRow[]
): Record<string, UnitLabelAvailability> {
  const output: Record<string, UnitLabelAvailability> = {};

  rows.forEach(({ inventoryItemId, unitType, unitLabel }) => {
    const id = typeof inventoryItemId === 'string' ? inventoryItemId.trim() : '';
    if (!id) return;

    if (!output[id]) {
      output[id] = {
        baseLabel: null,
        packLabel: null,
        hasBase: false,
        hasPack: false,
      };
    }

    const normalizedLabel = normalizeUnitLabel(unitLabel);
    if (unitType === 'base') {
      output[id].hasBase = true;
      if (normalizedLabel && !output[id].baseLabel) {
        output[id].baseLabel = normalizedLabel;
      }
      return;
    }

    output[id].hasPack = true;
    if (normalizedLabel && !output[id].packLabel) {
      output[id].packLabel = normalizedLabel;
    }
  });

  return output;
}

// The label the confirmation screen prints for an item left on its own unit type
// (inventory base_unit/pack_unit override the order item's stored label).
export function resolveExportUnitLabel({
  unitInfo,
  availability,
  unitType,
  unitLabel,
}: {
  unitInfo: InventoryUnitInfo | undefined;
  availability: UnitLabelAvailability | undefined;
  unitType: 'base' | 'pack';
  unitLabel: string;
}): string {
  const props = resolveUnitSelectorProps({
    unitInfo,
    availability,
    currentUnitType: unitType,
    currentUnitLabel: unitLabel,
  });
  return unitType === 'pack' ? props.packUnitLabel : props.baseUnitLabel;
}
