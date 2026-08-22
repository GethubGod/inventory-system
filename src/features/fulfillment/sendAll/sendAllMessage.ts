// Pure message + finalize-payload builders for the Rapid Send All flow (Phase 1).
// Mirrors the default (no per-item unit switching) output of
// app/(manager)/fulfillment-confirmation.tsx so a Send All message matches what the
// confirmation screen would produce out of the box. Unit labels are resolved via
// the shared @/features/fulfillment/unitLabels helpers — the same module the
// confirmation screen uses — so label text can never diverge between the two.
// No React/React Native imports — unit-tested in src/__tests__/sendAllMessage.test.ts.

import {
  buildUnitLabelAvailabilityMap,
  resolveExportUnitLabel,
  type InventoryUnitInfo,
} from '../unitLabels';

export type { InventoryUnitInfo } from '../unitLabels';

export type SendAllLocationGroup = 'sushi' | 'poki';

const LOCATION_GROUP_LABELS: Record<SendAllLocationGroup, string> = {
  sushi: 'Sushi',
  poki: 'Poki',
};

export interface SendAllRegularItem {
  id: string;
  inventoryItemId: string;
  name: string;
  category: string;
  locationGroup: SendAllLocationGroup;
  quantity: number;
  unitType: 'base' | 'pack';
  unitLabel: string;
  notes: { text: string }[];
  sourceOrderItemIds: string[];
  sourceOrderIds: string[];
  sourceDraftItemIds: string[];
}

export interface SendAllRemainingItem {
  orderItemId: string;
  orderId: string;
  inventoryItemId: string;
  name: string;
  category: string;
  locationGroup: SendAllLocationGroup;
  locationId: string;
  locationName: string;
  quantity?: number;
  unitType: 'base' | 'pack';
  unitLabel: string;
  reportedRemaining: number;
  decidedQuantity: number | null;
  note: string | null;
}

/**
 * Section heading rendered above each location group in the items text.
 * Exported so consumers that need heading-free output (e.g. the direct-send
 * message builder) can strip exactly what this module emits instead of
 * hardcoding the format.
 */
export function buildLocationGroupHeading(group: SendAllLocationGroup): string {
  return `--- ${LOCATION_GROUP_LABELS[group].toUpperCase()} ---`;
}

export function formatSendAllQuantity(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value)
    ? `${value}`
    : `${value}`.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}

export function countUnresolvedRemaining(remainingItems: SendAllRemainingItem[]): number {
  return remainingItems.filter(
    (item) =>
      item.decidedQuantity == null ||
      !Number.isFinite(item.decidedQuantity) ||
      item.decidedQuantity <= 0
  ).length;
}

interface GroupedLine {
  name: string;
  quantity: number;
  unitLabel: string;
}

export function buildSendAllItemsText(
  regularItems: SendAllRegularItem[],
  remainingItems: SendAllRemainingItem[],
  unitInfoById: Record<string, InventoryUnitInfo> = {}
): string {
  const groupOrder: SendAllLocationGroup[] = ['sushi', 'poki'];

  // Same registration order as the confirmation screen: regular items first,
  // then remaining items, across all location groups.
  const availabilityByInventoryItemId = buildUnitLabelAvailabilityMap([
    ...regularItems,
    ...remainingItems,
  ]);

  const resolveLabel = (item: {
    inventoryItemId: string;
    unitType: 'base' | 'pack';
    unitLabel: string;
  }): string =>
    resolveExportUnitLabel({
      unitInfo: unitInfoById[item.inventoryItemId],
      availability: availabilityByInventoryItemId[item.inventoryItemId],
      unitType: item.unitType,
      unitLabel: item.unitLabel,
    });

  // Mirrors the confirmation screen's groupedRegularItems sort (name →
  // inventoryItemId → unitType → unitLabel). Remaining items are NOT sorted
  // there — they render in source order — so we keep source order too.
  const sortRegularRows = (rows: SendAllRegularItem[]) =>
    [...rows].sort((a, b) => {
      const byName = a.name.localeCompare(b.name);
      if (byName !== 0) return byName;
      const byInventoryId = a.inventoryItemId.localeCompare(b.inventoryItemId);
      if (byInventoryId !== 0) return byInventoryId;
      if (a.unitType !== b.unitType) return a.unitType.localeCompare(b.unitType);
      return a.unitLabel.localeCompare(b.unitLabel);
    });

  const sections = groupOrder
    .map((group) => {
      const orderedEntries: ({ type: 'grouped'; key: string } | { type: 'raw'; line: string })[] = [];
      const groupedLines = new Map<string, GroupedLine>();

      const addGroupedLine = ({
        name,
        quantity,
        unitLabel,
        unitType,
      }: {
        name: string;
        quantity: number;
        unitLabel: string;
        unitType: 'base' | 'pack';
      }) => {
        const key = `${name.trim().toLowerCase()}|${unitType}|${unitLabel.trim().toLowerCase()}`;
        const existing = groupedLines.get(key);
        if (existing) {
          existing.quantity += quantity;
          return;
        }
        groupedLines.set(key, { name, quantity, unitLabel });
        orderedEntries.push({ type: 'grouped', key });
      };

      sortRegularRows(regularItems.filter((item) => item.locationGroup === group)).forEach(
        (item) => {
          if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
            orderedEntries.push({
              type: 'raw',
              line: `- ${item.name}: ${formatSendAllQuantity(item.quantity)} ${item.unitLabel}`,
            });
            return;
          }
          addGroupedLine({
            name: item.name,
            quantity: item.quantity,
            unitLabel: resolveLabel(item),
            unitType: item.unitType,
          });
        }
      );

      remainingItems.filter((item) => item.locationGroup === group).forEach((item) => {
        const decided = item.decidedQuantity;
        if (decided == null || !Number.isFinite(decided) || decided <= 0) {
          orderedEntries.push({
            type: 'raw',
            line: `- ${item.name}: [set qty] ${resolveLabel(item)}`,
          });
          return;
        }
        addGroupedLine({
          name: item.name,
          quantity: decided,
          unitLabel: resolveLabel(item),
          unitType: item.unitType,
        });
      });

      const lines = orderedEntries
        .map((entry) => {
          if (entry.type === 'raw') return entry.line;
          const grouped = groupedLines.get(entry.key);
          if (!grouped) return null;
          return `- ${grouped.name}: ${formatSendAllQuantity(grouped.quantity)} ${grouped.unitLabel}`;
        })
        .filter((entry): entry is string => Boolean(entry));

      if (lines.length === 0) return null;
      return `${buildLocationGroupHeading(group)}\n${lines.join('\n')}`;
    })
    .filter(Boolean)
    .join('\n\n');

  return sections.length > 0 ? sections : 'No items to order.';
}

export function buildSendAllMessage({
  template,
  supplierLabel,
  regularItems,
  remainingItems,
  unitInfoById = {},
  now = new Date(),
}: {
  template: string;
  supplierLabel: string;
  regularItems: SendAllRegularItem[];
  remainingItems: SendAllRemainingItem[];
  unitInfoById?: Record<string, InventoryUnitInfo>;
  now?: Date;
}): string {
  const today = now.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const variables: Record<string, string> = {
    supplier: supplierLabel,
    date: today,
    items: buildSendAllItemsText(regularItems, remainingItems, unitInfoById),
  };

  const filled = Object.entries(variables).reduce((text, [key, value]) => {
    const pattern = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    return text.replace(pattern, value);
  }, template);

  return filled.replace(/\\n/g, '\n');
}

export interface SendAllFinalizePayload {
  regularPayload: {
    id: string;
    inventoryItemId: string;
    name: string;
    category: string;
    locationGroup: SendAllLocationGroup;
    quantity: number;
    unitType: 'base' | 'pack';
    unitLabel: string;
    notes: string[];
    sourceOrderItemIds: string[];
    sourceOrderIds: string[];
    sourceDraftItemIds: string[];
  }[];
  remainingPayload: {
    orderItemId: string;
    orderId: string;
    inventoryItemId: string;
    name: string;
    category: string;
    locationGroup: SendAllLocationGroup;
    locationId: string;
    locationName: string;
    quantity: number;
    decidedQuantity: number;
    reportedRemaining: number;
    unitType: 'base' | 'pack';
    unitLabel: string;
    note: string | null;
  }[];
  historyLineItems: {
    itemId: string;
    itemName: string;
    unit: string;
    quantity: number;
    locationId: string | null;
    locationName: string | null;
    locationGroup: SendAllLocationGroup;
    unitType: 'base' | 'pack';
    note: string | null;
  }[];
  locationLabels: string[];
  consumedOrderItemIds: string[];
  consumedDraftItemIds: string[];
  sourceOrderIds: string[];
  totalItemCount: number;
}

// Mirrors buildFinalizePayloadFromItems in app/(manager)/fulfillment-confirmation.tsx
// so Send All archives orders with the exact same finalizeSupplierOrder inputs.
export function buildSendAllFinalizePayload(
  regularItems: SendAllRegularItem[],
  remainingItems: SendAllRemainingItem[]
): SendAllFinalizePayload {
  const regularPayload = regularItems.map((item) => ({
    id: item.id,
    inventoryItemId: item.inventoryItemId,
    name: item.name,
    category: item.category,
    locationGroup: item.locationGroup,
    quantity: item.quantity,
    unitType: item.unitType,
    unitLabel: item.unitLabel,
    notes: item.notes.map((note) => note.text),
    sourceOrderItemIds: item.sourceOrderItemIds,
    sourceOrderIds: item.sourceOrderIds,
    sourceDraftItemIds: item.sourceDraftItemIds,
  }));

  const remainingPayload = remainingItems.map((item) => ({
    orderItemId: item.orderItemId,
    orderId: item.orderId,
    inventoryItemId: item.inventoryItemId,
    name: item.name,
    category: item.category,
    locationGroup: item.locationGroup,
    locationId: item.locationId,
    locationName: item.locationName,
    quantity: item.decidedQuantity ?? 0,
    decidedQuantity: item.decidedQuantity ?? 0,
    reportedRemaining: item.reportedRemaining,
    unitType: item.unitType,
    unitLabel: item.unitLabel,
    note: item.note,
  }));

  const locationSet = new Set<string>();
  regularPayload.forEach((item) => {
    locationSet.add(item.locationGroup === 'poki' ? 'Poki' : 'Sushi');
  });
  remainingPayload.forEach((item) => {
    locationSet.add(item.locationGroup === 'poki' ? 'Poki' : 'Sushi');
  });

  const consumedOrderItemIds = Array.from(
    new Set([
      ...regularPayload.flatMap((item) => item.sourceOrderItemIds),
      ...remainingPayload.map((item) => item.orderItemId),
    ])
  );

  const consumedDraftItemIds = Array.from(
    new Set(regularPayload.flatMap((item) => item.sourceDraftItemIds))
  );

  const sourceOrderIds = Array.from(
    new Set([
      ...regularPayload.flatMap((item) => item.sourceOrderIds),
      ...remainingPayload.map((item) => item.orderId),
    ])
  );

  const historyLineItems = [
    ...regularPayload.map((item) => ({
      itemId: item.inventoryItemId,
      itemName: item.name,
      unit: item.unitLabel,
      quantity: item.quantity,
      locationId: null as string | null,
      locationName: null as string | null,
      locationGroup: item.locationGroup,
      unitType: item.unitType,
      note: item.notes.length > 0 ? item.notes[0] : null,
    })),
    ...remainingPayload.map((item) => ({
      itemId: item.inventoryItemId,
      itemName: item.name,
      unit: item.unitLabel,
      quantity: item.decidedQuantity,
      locationId: item.locationId as string | null,
      locationName: item.locationName as string | null,
      locationGroup: item.locationGroup,
      unitType: item.unitType,
      note: item.note,
    })),
  ].filter(
    (line) =>
      typeof line.itemId === 'string' &&
      line.itemId.trim().length > 0 &&
      Number.isFinite(line.quantity) &&
      line.quantity > 0
  );

  return {
    regularPayload,
    remainingPayload,
    historyLineItems,
    locationLabels: Array.from(locationSet),
    consumedOrderItemIds,
    consumedDraftItemIds,
    sourceOrderIds,
    totalItemCount: regularPayload.length + remainingPayload.length,
  };
}
