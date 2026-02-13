import { supabase } from '@/lib/supabase';
import { OrderWithDetails } from '@/types';
import {
  SupplierLookupMaps,
  SupplierResolutionIssue,
  collectInventorySupplierIssues,
  loadSupplierLookup,
  logUnresolvedSupplierReport,
  resolveOrderItemSupplier,
  summarizeSupplierIssues,
} from '@/services/supplierResolver';

export type FulfillmentLocationGroup = 'sushi' | 'poki';

export interface SupplierDraftForConfirmation {
  id: string;
  inventoryItemId: string | null;
  name: string;
  category: string;
  quantity: number;
  unitType: 'base' | 'pack';
  unitLabel: string;
  locationGroup: FulfillmentLocationGroup;
  locationId: string | null;
  locationName: string | null;
  note: string | null;
}

export interface ConfirmationRegularItemData {
  id: string;
  inventoryItemId: string;
  name: string;
  category: string;
  locationGroup: FulfillmentLocationGroup;
  quantity: number;
  unitType: 'base' | 'pack';
  unitLabel: string;
  sumOfContributorQuantities: number;
  sourceOrderItemIds: string[];
  sourceOrderIds: string[];
  sourceDraftItemIds: string[];
  contributors: {
    userId: string | null;
    name: string;
    quantity: number;
  }[];
  notes: {
    id: string;
    author: string;
    text: string;
    locationName: string;
    shortCode: string;
  }[];
  details: {
    locationId: string;
    locationName: string;
    orderedBy: string;
    quantity: number;
    shortCode: string;
  }[];
  secondarySupplierName: string | null;
  secondarySupplierId: string | null;
}

export interface ConfirmationRemainingItemData {
  orderItemId: string;
  orderId: string;
  inventoryItemId: string;
  name: string;
  category: string;
  locationGroup: FulfillmentLocationGroup;
  locationId: string;
  locationName: string;
  shortCode: string;
  unitType: 'base' | 'pack';
  unitLabel: string;
  reportedRemaining: number;
  decidedQuantity: number | null;
  note: string | null;
  orderedBy: string;
  secondarySupplierName: string | null;
  secondarySupplierId: string | null;
}

export interface PendingFulfillmentDataResult {
  orders: OrderWithDetails[];
  supplierLookup: SupplierLookupMaps;
  unresolvedIssues: SupplierResolutionIssue[];
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function toNonNegative(value: unknown, fallback = 0): number {
  return Math.max(0, toNumber(value, fallback));
}

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeLocationGroup(locationName?: string | null, shortCode?: string | null): FulfillmentLocationGroup {
  const name = (locationName || '').toLowerCase();
  const code = (shortCode || '').toLowerCase();

  if (name.includes('poki') || name.includes('poke') || code.startsWith('p')) {
    return 'poki';
  }

  if (name.includes('sushi') || code.startsWith('s')) {
    return 'sushi';
  }

  return 'sushi';
}

async function loadOrderLaterSourceOrderItemIds(): Promise<Set<string>> {
  const ids = new Set<string>();

  const { data, error } = await (supabase as any)
    .from('order_later_items')
    .select('source_order_item_id,original_order_item_ids,status')
    .in('status', ['queued', 'added'])
    .limit(10000);

  if (error) {
    return ids;
  }

  (Array.isArray(data) ? data : []).forEach((row: any) => {
    const sourceOrderItemId = toTrimmedString(row?.source_order_item_id);
    if (sourceOrderItemId) {
      ids.add(sourceOrderItemId);
    }

    if (Array.isArray(row?.original_order_item_ids)) {
      row.original_order_item_ids.forEach((rawId: unknown) => {
        const parsed = toTrimmedString(rawId);
        if (parsed) ids.add(parsed);
      });
    }
  });

  return ids;
}

function shouldIncludeOrderItem(
  orderItem: Record<string, unknown>,
  options: {
    consumedOrderItemIds: Set<string>;
    orderLaterSourceOrderItemIds: Set<string>;
  }
): boolean {
  const orderItemId = toTrimmedString(orderItem.id);
  if (!orderItemId) return false;

  if (options.consumedOrderItemIds.has(orderItemId)) return false;
  if (options.orderLaterSourceOrderItemIds.has(orderItemId)) return false;

  const statusValue = toTrimmedString(orderItem.status)?.toLowerCase();
  if (statusValue && statusValue !== 'pending') return false;

  const inputMode = orderItem.input_mode === 'remaining' ? 'remaining' : 'quantity';

  if (inputMode === 'remaining') {
    const remainingReported = toNumber(orderItem.remaining_reported, Number.NaN);
    const decidedQuantity = toNumber(orderItem.decided_quantity, Number.NaN);
    return Number.isFinite(remainingReported) || (Number.isFinite(decidedQuantity) && decidedQuantity > 0);
  }

  const quantity = toNumber(orderItem.quantity, 0);
  return quantity > 0;
}

function toSupplierGroupingDebugKey(orderItem: Record<string, unknown>): string {
  const resolution = (orderItem as any).__supplier_resolution;
  if (resolution && typeof resolution.effectiveSupplierId === 'string') {
    return resolution.effectiveSupplierId;
  }
  return 'unresolved:missing-resolution';
}

function buildDebugLogs(orders: OrderWithDetails[]) {
  const items: Record<string, unknown>[] = [];

  orders.forEach((order) => {
    const orderItems = Array.isArray((order as any).order_items) ? ((order as any).order_items as any[]) : [];
    orderItems.forEach((orderItem) => {
      items.push(orderItem);
    });
  });

  const groupingCounts = new Map<string, number>();
  items.forEach((orderItem) => {
    const key = toSupplierGroupingDebugKey(orderItem);
    groupingCounts.set(key, (groupingCounts.get(key) || 0) + 1);
  });

  const sample = items.slice(0, 5).map((orderItem) => {
    const inventoryItem = (orderItem as any).inventory_item || {};
    const resolution = (orderItem as any).__supplier_resolution || {};

    return {
      orderItemId: toTrimmedString(orderItem.id),
      inventoryItemId: toTrimmedString(inventoryItem.id),
      itemName: toTrimmedString(inventoryItem.name),
      orderItemStatus: toTrimmedString(orderItem.status),
      orderItemQuantity: toNumber(orderItem.quantity, 0),
      defaultSupplier: toTrimmedString(inventoryItem.default_supplier),
      secondarySupplier: toTrimmedString(inventoryItem.secondary_supplier),
      supplierOverrideId: toTrimmedString(orderItem.supplier_override_id),
      primarySupplierId: toTrimmedString(resolution.primarySupplierId),
      effectiveSupplierId: toTrimmedString(resolution.effectiveSupplierId),
      effectiveSupplierName: toTrimmedString(resolution.effectiveSupplierName),
    };
  });

  return {
    totalPendingOrderItems: items.length,
    groupingCounts: Object.fromEntries(groupingCounts.entries()),
    sample,
  };
}

export async function loadPendingFulfillmentData(options?: {
  consumedOrderItemIds?: Set<string>;
  includeInventoryAudit?: boolean;
  locationIds?: string[];
}): Promise<PendingFulfillmentDataResult> {
  const consumedOrderItemIds = options?.consumedOrderItemIds ?? new Set<string>();
  const includeInventoryAudit = options?.includeInventoryAudit !== false;
  const locationIds = Array.from(
    new Set(
      (options?.locationIds || [])
        .filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
    )
  );

  const [supplierLookup, orderLaterSourceOrderItemIds] = await Promise.all([
    loadSupplierLookup(),
    loadOrderLaterSourceOrderItemIds(),
  ]);

  // Select only the columns actually consumed by fulfillment grouping and
  // confirmation screens.  Reduces payload size significantly for locations
  // with many submitted orders.
  let query = supabase
    .from('orders')
    .select(`
      id,status,location_id,created_at,
      user:users!orders_user_id_fkey(id,name),
      location:locations(id,name,short_code),
      order_items(
        id,order_id,quantity,unit_type,input_mode,
        remaining_reported,decided_quantity,decided_by,decided_at,
        note,supplier_override_id,status,inventory_item_id,
        inventory_item:inventory_items(
          id,name,category,base_unit,pack_unit,pack_size,
          supplier_category,default_supplier,secondary_supplier,
          supplier_id,active
        )
      )
    `)
    .eq('status', 'submitted');

  if (locationIds.length > 0) {
    query = query.in('location_id', locationIds);
  }

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  const unresolvedIssues: SupplierResolutionIssue[] = [];

  const filteredOrders = ((data || []) as unknown as OrderWithDetails[])
    .map((order) => {
      const rawItems = Array.isArray((order as any).order_items) ? ((order as any).order_items as any[]) : [];

      const nextOrderItems = rawItems.filter((orderItem) => {
        if (!orderItem || typeof orderItem !== 'object') return false;
        const inventoryItem = orderItem.inventory_item;
        if (!inventoryItem || typeof inventoryItem !== 'object') return false;

        if (!shouldIncludeOrderItem(orderItem, { consumedOrderItemIds, orderLaterSourceOrderItemIds })) {
          return false;
        }

        const resolution = resolveOrderItemSupplier({
          inventoryItem: inventoryItem as Record<string, unknown>,
          orderItem: orderItem as Record<string, unknown>,
          lookup: supplierLookup,
          issues: unresolvedIssues,
        });

        (orderItem as any).__supplier_resolution = resolution;
        return true;
      });

      return {
        ...order,
        order_items: nextOrderItems,
      };
    })
    .filter((order) => {
      const orderItems = Array.isArray((order as any).order_items) ? ((order as any).order_items as any[]) : [];
      return orderItems.length > 0;
    });

  if (includeInventoryAudit) {
    const inventoryIssues = await collectInventorySupplierIssues(supplierLookup);
    unresolvedIssues.push(...inventoryIssues);
  }

  if (__DEV__) {
    const debug = buildDebugLogs(filteredOrders);
    console.log('[Fulfillment] pending order_items loaded:', debug.totalPendingOrderItems);
    console.log('[Fulfillment] sample items:', JSON.stringify(debug.sample, null, 2));
    console.log('[Fulfillment] grouping counts:', JSON.stringify(debug.groupingCounts, null, 2));

    const unresolvedReport = summarizeSupplierIssues(unresolvedIssues);
    logUnresolvedSupplierReport(unresolvedReport, { prefix: '[Fulfillment]' });
  }

  return {
    orders: filteredOrders,
    supplierLookup,
    unresolvedIssues,
  };
}

function getOrderItemResolution(
  orderItem: Record<string, unknown>,
  inventoryItem: Record<string, unknown>,
  supplierLookup: SupplierLookupMaps,
  issues?: SupplierResolutionIssue[]
) {
  const existing = (orderItem as any).__supplier_resolution;
  if (existing && typeof existing.effectiveSupplierId === 'string') {
    return existing;
  }

  const resolved = resolveOrderItemSupplier({
    inventoryItem,
    orderItem,
    lookup: supplierLookup,
    issues,
  });
  (orderItem as any).__supplier_resolution = resolved;
  return resolved;
}

export function buildSupplierConfirmationData(params: {
  supplierId: string;
  orders: OrderWithDetails[];
  supplierLookup: SupplierLookupMaps;
  supplierDraftItems?: SupplierDraftForConfirmation[];
}): {
  regularItems: ConfirmationRegularItemData[];
  remainingItems: ConfirmationRemainingItemData[];
} {
  const { supplierId, orders, supplierLookup } = params;
  const supplierDraftItems = Array.isArray(params.supplierDraftItems) ? params.supplierDraftItems : [];

  const unresolvedIssues: SupplierResolutionIssue[] = [];

  const mergedRegular = new Map<
    string,
    {
      id: string;
      inventoryItemId: string;
      name: string;
      category: string;
      locationGroup: FulfillmentLocationGroup;
      unitType: 'base' | 'pack';
      unitLabel: string;
      rawQuantity: number;
      contributors: Map<string, { userId: string | null; name: string; quantity: number }>;
      details: Map<string, { locationId: string; locationName: string; shortCode: string; quantity: number; orderedBy: Set<string> }>;
      notes: Map<string, { id: string; author: string; text: string; locationName: string; shortCode: string }>;
      sourceOrderItemIds: Set<string>;
      sourceOrderIds: Set<string>;
      sourceDraftItemIds: Set<string>;
      secondarySupplierId: string | null;
      secondarySupplierName: string | null;
    }
  >();

  const remainingItems: ConfirmationRemainingItemData[] = [];

  orders.forEach((order) => {
    const orderItems = Array.isArray((order as any).order_items) ? ((order as any).order_items as any[]) : [];

    orderItems.forEach((orderItem) => {
      const inventoryItem = (orderItem as any).inventory_item as Record<string, unknown> | undefined;
      if (!inventoryItem) return;

      const resolution = getOrderItemResolution(orderItem as Record<string, unknown>, inventoryItem, supplierLookup, unresolvedIssues);
      if (resolution.effectiveSupplierId !== supplierId) return;

      const unitType: 'base' | 'pack' = orderItem.unit_type === 'pack' ? 'pack' : 'base';
      const unitLabelCandidate = unitType === 'pack' ? inventoryItem.pack_unit : inventoryItem.base_unit;
      const unitLabel = toTrimmedString(unitLabelCandidate) || (unitType === 'pack' ? 'pack' : 'unit');
      const itemName = toTrimmedString(inventoryItem.name) || 'Unknown Item';
      const itemId = toTrimmedString(inventoryItem.id) || itemName.toLowerCase().replace(/\s+/g, '-');
      const category = toTrimmedString(inventoryItem.category) || 'dry';
      const locationId = toTrimmedString((order as any).location_id) || 'unknown-location';
      const locationName = toTrimmedString((order as any)?.location?.name) || 'Unknown';
      const shortCode = toTrimmedString((order as any)?.location?.short_code) || '??';
      const locationGroup = normalizeLocationGroup(locationName, shortCode);

      const orderItemId = toTrimmedString(orderItem.id);
      const orderId = toTrimmedString((order as any).id);

      if (orderItem.input_mode === 'remaining') {
        if (!orderItemId || !orderId) return;
        const decidedRaw = toNumber(orderItem.decided_quantity, Number.NaN);
        const decidedQuantity = Number.isFinite(decidedRaw) ? Math.max(0, decidedRaw) : null;
        const note = toTrimmedString(orderItem.note);

        remainingItems.push({
          orderItemId,
          orderId,
          inventoryItemId: itemId,
          name: itemName,
          category,
          locationGroup,
          locationId,
          locationName,
          shortCode,
          unitType,
          unitLabel,
          reportedRemaining: toNonNegative(orderItem.remaining_reported, 0),
          decidedQuantity,
          note,
          orderedBy: toTrimmedString((order as any)?.user?.name) || 'Unknown',
          secondarySupplierId: resolution.secondarySupplierId,
          secondarySupplierName: resolution.secondarySupplierName,
        });

        return;
      }

      const quantity = toNonNegative(orderItem.quantity, 0);
      if (quantity <= 0) return;

      const mergeKey = [locationGroup, itemId, unitType].join('|');
      const contributorName = toTrimmedString((order as any)?.user?.name) || 'Unknown';
      const contributorId = toTrimmedString((order as any)?.user?.id);
      const contributorKey = contributorId || `name:${contributorName.toLowerCase()}`;

      if (!mergedRegular.has(mergeKey)) {
        mergedRegular.set(mergeKey, {
          id: mergeKey,
          inventoryItemId: itemId,
          name: itemName,
          category,
          locationGroup,
          unitType,
          unitLabel,
          rawQuantity: quantity,
          contributors: new Map([
            [
              contributorKey,
              {
                userId: contributorId,
                name: contributorName,
                quantity,
              },
            ],
          ]),
          details: new Map([
            [
              locationId,
              {
                locationId,
                locationName,
                shortCode,
                quantity,
                orderedBy: new Set([contributorName]),
              },
            ],
          ]),
          notes: new Map(),
          sourceOrderItemIds: new Set(orderItemId ? [orderItemId] : []),
          sourceOrderIds: new Set(orderId ? [orderId] : []),
          sourceDraftItemIds: new Set<string>(),
          secondarySupplierId: resolution.secondarySupplierId,
          secondarySupplierName: resolution.secondarySupplierName,
        });
      } else {
        const existing = mergedRegular.get(mergeKey)!;
        existing.rawQuantity += quantity;

        const existingContributor = existing.contributors.get(contributorKey);
        if (existingContributor) {
          existingContributor.quantity += quantity;
        } else {
          existing.contributors.set(contributorKey, {
            userId: contributorId,
            name: contributorName,
            quantity,
          });
        }

        const existingDetail = existing.details.get(locationId);
        if (existingDetail) {
          existingDetail.quantity += quantity;
          existingDetail.orderedBy.add(contributorName);
        } else {
          existing.details.set(locationId, {
            locationId,
            locationName,
            shortCode,
            quantity,
            orderedBy: new Set([contributorName]),
          });
        }

        if (orderItemId) {
          existing.sourceOrderItemIds.add(orderItemId);
        }
        if (orderId) {
          existing.sourceOrderIds.add(orderId);
        }
      }

      const note = toTrimmedString(orderItem.note);
      if (note) {
        const existing = mergedRegular.get(mergeKey)!;
        const noteId = `${orderItemId || mergeKey}:${note}`;
        if (!existing.notes.has(noteId)) {
          existing.notes.set(noteId, {
            id: noteId,
            author: contributorName,
            text: note,
            locationName,
            shortCode,
          });
        }
      }
    });
  });

  supplierDraftItems.forEach((draftItem) => {
    const itemId = toTrimmedString(draftItem.inventoryItemId) || `draft-${draftItem.id}`;
    const itemName = toTrimmedString(draftItem.name) || 'Order Later Item';
    const category = toTrimmedString(draftItem.category) || 'dry';
    const unitType: 'base' | 'pack' = draftItem.unitType === 'pack' ? 'pack' : 'base';
    const unitLabel = toTrimmedString(draftItem.unitLabel) || (unitType === 'pack' ? 'pack' : 'unit');
    const locationGroup = draftItem.locationGroup === 'poki' ? 'poki' : 'sushi';
    const locationId = toTrimmedString(draftItem.locationId) || `draft-${draftItem.id}`;
    const locationName =
      toTrimmedString(draftItem.locationName) || (locationGroup === 'poki' ? 'Poki' : 'Sushi');
    const shortCode = locationName.slice(0, 2).toUpperCase();
    const quantity = toNonNegative(draftItem.quantity, 0);

    if (quantity <= 0) return;

    const mergeKey = [locationGroup, itemId, unitType].join('|');
    if (!mergedRegular.has(mergeKey)) {
      mergedRegular.set(mergeKey, {
        id: mergeKey,
        inventoryItemId: itemId,
        name: itemName,
        category,
        locationGroup,
        unitType,
        unitLabel,
        rawQuantity: quantity,
        contributors: new Map([
          [
            `draft:${draftItem.id}`,
            {
              userId: null,
              name: 'Order Later',
              quantity,
            },
          ],
        ]),
        details: new Map([
          [
            locationId,
            {
              locationId,
              locationName,
              shortCode,
              quantity,
              orderedBy: new Set(['Order Later']),
            },
          ],
        ]),
        notes: new Map(),
        sourceOrderItemIds: new Set<string>(),
        sourceOrderIds: new Set<string>(),
        sourceDraftItemIds: new Set([draftItem.id]),
        secondarySupplierId: null,
        secondarySupplierName: null,
      });
    } else {
      const existing = mergedRegular.get(mergeKey)!;
      existing.rawQuantity += quantity;

      const contributorKey = `draft:${draftItem.id}`;
      const existingContributor = existing.contributors.get(contributorKey);
      if (existingContributor) {
        existingContributor.quantity += quantity;
      } else {
        existing.contributors.set(contributorKey, {
          userId: null,
          name: 'Order Later',
          quantity,
        });
      }

      const detail = existing.details.get(locationId);
      if (detail) {
        detail.quantity += quantity;
        detail.orderedBy.add('Order Later');
      } else {
        existing.details.set(locationId, {
          locationId,
          locationName,
          shortCode,
          quantity,
          orderedBy: new Set(['Order Later']),
        });
      }

      existing.sourceDraftItemIds.add(draftItem.id);
    }

    const note = toTrimmedString(draftItem.note);
    if (note) {
      const existing = mergedRegular.get(mergeKey)!;
      const noteId = `draft:${draftItem.id}:${note}`;
      if (!existing.notes.has(noteId)) {
        existing.notes.set(noteId, {
          id: noteId,
          author: 'Order Later',
          text: note,
          locationName,
          shortCode,
        });
      }
    }
  });

  if (__DEV__) {
    const unresolvedReport = summarizeSupplierIssues(unresolvedIssues);
    logUnresolvedSupplierReport(unresolvedReport, { prefix: '[Fulfillment:Confirm]' });
  }

  const regularItems: ConfirmationRegularItemData[] = Array.from(mergedRegular.values())
    .map((entry) => ({
      id: entry.id,
      inventoryItemId: entry.inventoryItemId,
      name: entry.name,
      category: entry.category,
      locationGroup: entry.locationGroup,
      quantity: Math.max(0, entry.rawQuantity),
      unitType: entry.unitType,
      unitLabel: entry.unitLabel,
      sumOfContributorQuantities: Math.max(0, entry.rawQuantity),
      sourceOrderItemIds: Array.from(entry.sourceOrderItemIds.values()),
      sourceOrderIds: Array.from(entry.sourceOrderIds.values()),
      sourceDraftItemIds: Array.from(entry.sourceDraftItemIds.values()),
      contributors: Array.from(entry.contributors.values()).sort((a, b) => a.name.localeCompare(b.name)),
      notes: Array.from(entry.notes.values()).sort((a, b) => {
        if (a.author !== b.author) return a.author.localeCompare(b.author);
        return a.text.localeCompare(b.text);
      }),
      details: Array.from(entry.details.values())
        .map((detail) => ({
          locationId: detail.locationId,
          locationName: detail.locationName,
          orderedBy: Array.from(detail.orderedBy.values()).join(', '),
          quantity: detail.quantity,
          shortCode: detail.shortCode,
        }))
        .sort((a, b) => a.locationName.localeCompare(b.locationName)),
      secondarySupplierId: entry.secondarySupplierId,
      secondarySupplierName: entry.secondarySupplierName,
    }))
    .filter((item) => item.quantity > 0)
    .sort((a, b) => {
      if (a.locationGroup !== b.locationGroup) return a.locationGroup.localeCompare(b.locationGroup);
      return a.name.localeCompare(b.name);
    });

  remainingItems.sort((a, b) => {
    if (a.locationGroup !== b.locationGroup) return a.locationGroup.localeCompare(b.locationGroup);
    return a.name.localeCompare(b.name);
  });

  return {
    regularItems,
    remainingItems,
  };
}
