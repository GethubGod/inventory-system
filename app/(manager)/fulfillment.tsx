import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { RealtimeChannel } from '@supabase/supabase-js';
import * as Haptics from 'expo-haptics';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore, useDisplayStore, useOrderStore } from '@/store';
import { CATEGORY_LABELS, colors } from '@/constants';
import { InventoryItem, ItemCategory, OrderWithDetails, SupplierCategory } from '@/types';
import { supabase } from '@/lib/supabase';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';
import { OrderLaterScheduleModal } from '@/components/OrderLaterScheduleModal';
import { ItemActionSheet, OrderLaterAddToSheet } from '@/components';
import type { ItemActionSheetSection, OrderLaterSupplierOption } from '@/components';
import { loadSupplierLookup, invalidateSupplierCache } from '@/services/supplierResolver';

interface AggregatedLocationBreakdown {
  locationId: string;
  locationName: string;
  shortCode: string;
  quantity: number;
  remainingReported: number;
  hasUndecidedRemaining: boolean;
  notes: string[];
  orderedBy: string[];
}

interface AggregatedItem {
  aggregateKey: string;
  effectiveSupplierId: string;
  inventoryItem: InventoryItem;
  totalQuantity: number;
  unitType: 'base' | 'pack';
  isRemainingMode: boolean;
  remainingReportedTotal: number;
  notes: string[];
  locationBreakdown: AggregatedLocationBreakdown[];
  sourceOrderItemIds: string[];
  sourceOrderIds: string[];
  secondarySupplierName: string | null;
  secondarySupplierId: string | null;
  isOverridden: boolean;
  primarySupplierId: string;
}

interface CategoryGroup {
  category: ItemCategory;
  items: AggregatedItem[];
}

interface SupplierGroup {
  supplierId: string;
  supplierName: string;
  supplierType: SupplierCategory | null;
  isInactive: boolean;
  isUnknown: boolean;
  categoryGroups: CategoryGroup[];
  totalItems: number;
}

type LocationGroup = 'sushi' | 'poki';

interface LocationGroupedItem {
  key: string;
  aggregateKey: string;
  effectiveSupplierId: string;
  locationGroup: LocationGroup;
  inventoryItem: InventoryItem;
  totalQuantity: number;
  unitType: 'base' | 'pack';
  isRemainingMode: boolean;
  remainingReportedTotal: number;
  notes: string[];
  locationBreakdown: AggregatedLocationBreakdown[];
  sourceOrderItemIds: string[];
  sourceOrderIds: string[];
  secondarySupplierName: string | null;
  secondarySupplierId: string | null;
  isOverridden: boolean;
  primarySupplierId: string;
}

interface LocationItemCard {
  key: string;
  inventoryItemId: string;
  name: string;
  rows: LocationGroupedItem[];
}

interface ConfirmationRegularItem {
  id: string;
  inventoryItemId: string;
  name: string;
  category: ItemCategory;
  locationGroup: LocationGroup;
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

interface SupplierOption {
  id: string;
  name: string;
  supplierType: SupplierCategory | null;
  isDefault: boolean;
  active: boolean;
}

interface RemainingConfirmationItem {
  orderItemId: string;
  orderId: string;
  inventoryItemId: string;
  name: string;
  category: ItemCategory;
  locationGroup: LocationGroup;
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

const LOCATION_GROUP_LABELS: Record<LocationGroup, string> = {
  sushi: 'Sushi',
  poki: 'Poki',
};

const LEGACY_SUPPLIER_TYPES: SupplierCategory[] = [
  'fish_supplier',
  'main_distributor',
  'asian_market',
];

const SUPPLIER_EMOJI: Record<SupplierCategory, string> = {
  fish_supplier: '🐟',
  main_distributor: '📦',
  asian_market: '🍜',
};

const SUPPLIER_COLORS: Record<SupplierCategory, { bg: string; text: string; border: string }> = {
  fish_supplier: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  main_distributor: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  asian_market: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
};

const DEFAULT_SUPPLIER_COLOR = {
  bg: 'bg-gray-50',
  text: 'text-gray-800',
  border: 'border-gray-200',
};

const getLocationGroup = (locationName?: string, shortCode?: string): LocationGroup => {
  const name = (locationName || '').toLowerCase();
  const code = (shortCode || '').toLowerCase();

  if (name.includes('poki') || name.includes('poke') || code.startsWith('p')) {
    return 'poki';
  }
  if (name.includes('sushi') || code.startsWith('s')) {
    return 'sushi';
  }

  return 'sushi';
};

function toLocationGroup(value: unknown): LocationGroup | null {
  if (value === 'sushi' || value === 'poki') return value;
  return null;
}

function toSafeNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function toItemCategory(value: unknown): ItemCategory {
  switch (value) {
    case 'fish':
    case 'protein':
    case 'produce':
    case 'dry':
    case 'dairy_cold':
    case 'frozen':
    case 'sauces':
    case 'packaging':
    case 'alcohol':
      return value;
    default:
      return 'dry';
  }
}

function isSupplierCategory(value: unknown): value is SupplierCategory {
  return value === 'fish_supplier' || value === 'main_distributor' || value === 'asian_market';
}

function toSupplierId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSupplierNameKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export default function FulfillmentScreen() {
  const { user, locations } = useAuthStore(useShallow((state) => ({
    user: state.user,
    locations: state.locations,
  })));
  const { uiScale, buttonSize, textScale } = useDisplayStore(useShallow((state) => ({
    uiScale: state.uiScale,
    buttonSize: state.buttonSize,
    textScale: state.textScale,
  })));
  const {
    orders,
    orderLaterQueue,
    supplierDrafts,
    getSupplierDraftItems,
    loadFulfillmentData,
    fetchPendingFulfillmentOrders,
    moveOrderLaterItemToSupplierDraft,
    removeOrderLaterItem,
    updateOrderLaterItemSchedule,
    markOrderItemsStatus,
    setSupplierOverride,
    clearSupplierOverride,
    createOrderLaterItem,
  } = useOrderStore(useShallow((state) => ({
    orders: state.orders,
    orderLaterQueue: state.orderLaterQueue,
    supplierDrafts: state.supplierDrafts,
    getSupplierDraftItems: state.getSupplierDraftItems,
    loadFulfillmentData: state.loadFulfillmentData,
    fetchPendingFulfillmentOrders: state.fetchPendingFulfillmentOrders,
    moveOrderLaterItemToSupplierDraft: state.moveOrderLaterItemToSupplierDraft,
    removeOrderLaterItem: state.removeOrderLaterItem,
    updateOrderLaterItemSchedule: state.updateOrderLaterItemSchedule,
    markOrderItemsStatus: state.markOrderItemsStatus,
    setSupplierOverride: state.setSupplierOverride,
    clearSupplierOverride: state.clearSupplierOverride,
    createOrderLaterItem: state.createOrderLaterItem,
  })));
  const [refreshing, setRefreshing] = useState(false);
  const [dataReady, setDataReady] = useState(false);
  const [supplierOptions, setSupplierOptions] = useState<SupplierOption[]>([]);
  const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(new Set());
  const [expandedLocationSections, setExpandedLocationSections] = useState<Set<string>>(new Set());
  const [editedQuantities, setEditedQuantities] = useState<Record<string, number>>({});
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [orderLaterExpanded, setOrderLaterExpanded] = useState(false);
  const [addToTargetItemId, setAddToTargetItemId] = useState<string | null>(null);
  const [addToSupplier, setAddToSupplier] = useState<string>('');
  const [addToSupplierError, setAddToSupplierError] = useState<string | null>(null);
  const [isAddingToSupplierDraft, setIsAddingToSupplierDraft] = useState(false);
  const [scheduleEditItemId, setScheduleEditItemId] = useState<string | null>(null);
  const [overflowItem, setOverflowItem] = useState<LocationGroupedItem | null>(null);
  const [breakdownItem, setBreakdownItem] = useState<LocationGroupedItem | null>(null);
  const [noteEditorItem, setNoteEditorItem] = useState<LocationGroupedItem | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const refreshQueuedRef = useRef(false);
  const sendTapLockUntilRef = useRef(0);
  const actionLocksRef = useRef<Set<string>>(new Set());
  const useStackedSupplierActions =
    uiScale === 'large' || buttonSize === 'large' || textScale >= 1.1;
  const managerLocationIds = useMemo(
    () =>
      locations
        .map((location) => (typeof location.id === 'string' ? location.id.trim() : ''))
        .filter((id) => id.length > 0),
    [locations]
  );
  const runLockedAction = useCallback(async (lockKey: string, action: () => Promise<void>) => {
    if (actionLocksRef.current.has(lockKey)) {
      return false;
    }

    actionLocksRef.current.add(lockKey);
    try {
      await action();
      return true;
    } finally {
      actionLocksRef.current.delete(lockKey);
    }
  }, []);

  const fetchPendingOrders = useCallback(async () => {
    try {
      await fetchPendingFulfillmentOrders(managerLocationIds);
    } catch (error) {
      console.error('Error fetching orders:', error);
    }
  }, [fetchPendingFulfillmentOrders, managerLocationIds]);

  const fetchSuppliers = useCallback(async () => {
    try {
      // Reuse the cached supplier lookup (same data loadPendingFulfillmentData uses)
      // so we don't make a duplicate DB query.
      const lookup = await loadSupplierLookup();
      const normalized = lookup.suppliers.map((row) => ({
        id: row.id,
        name: row.name,
        supplierType: isSupplierCategory(row.supplierType) ? row.supplierType : null,
        isDefault: row.isDefault,
        active: row.active,
      } satisfies SupplierOption));
      setSupplierOptions(normalized);
    } catch (error) {
      console.error('Error fetching suppliers:', error);
    }
  }, []);

  const runRefreshCycle = useCallback(async () => {
    try {
      // loadFulfillmentData syncs past-order queue, then fetchPendingFulfillmentOrders
      // re-fetches submitted orders and filters out consumed items.
      // Run them sequentially so past orders are synced before the filter runs.
      if (user?.id) {
        await loadFulfillmentData(user.id, managerLocationIds);
      }
      await Promise.all([fetchPendingOrders(), fetchSuppliers()]);
    } catch (error) {
      console.error('Error refreshing fulfillment data:', error);
    } finally {
      setDataReady(true);
    }
  }, [fetchPendingOrders, fetchSuppliers, loadFulfillmentData, managerLocationIds, user?.id]);
  const refreshAll = useCallback(async () => {
    if (refreshPromiseRef.current) {
      refreshQueuedRef.current = true;
      await refreshPromiseRef.current;
      return;
    }

    const run = async () => {
      do {
        refreshQueuedRef.current = false;
        await runRefreshCycle();
      } while (refreshQueuedRef.current);
    };

    const refreshPromise = run().finally(() => {
      refreshPromiseRef.current = null;
    });

    refreshPromiseRef.current = refreshPromise;
    await refreshPromise;
  }, [runRefreshCycle]);

  useFocusEffect(
    useCallback(() => {
      // Reset gate on every focus so stale data is hidden while fetching
      setDataReady(false);
      void refreshAll();
    }, [refreshAll])
  );

  // Realtime: when fulfillment-related tables change, do a full refresh
  // so order state/order-later state stays in sync across manager devices.
  useEffect(() => {
    if (realtimeChannelRef.current) {
      supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }

    const scheduleRefresh = () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      refreshTimeoutRef.current = setTimeout(() => {
        void refreshAll();
      }, 300);
    };

    const scheduleSupplierRefresh = () => {
      invalidateSupplierCache();
      scheduleRefresh();
    };

    const locationIds = managerLocationIds;
    const orderScopeFilter =
      locationIds.length > 0 ? `location_id=in.(${locationIds.join(',')})` : undefined;

    const channel = supabase
      .channel(`manager-fulfillment-sync-${locationIds.length > 0 ? locationIds.join(',') : 'all'}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          ...(orderScopeFilter ? { filter: orderScopeFilter } : {}),
        },
        scheduleRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_items' },
        scheduleRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'suppliers' },
        scheduleSupplierRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_later_items' },
        scheduleRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'past_orders' },
        scheduleRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'past_order_items' },
        scheduleRefresh
      )
      .subscribe();

    realtimeChannelRef.current = channel;

    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
    };
  }, [managerLocationIds, refreshAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshAll();
    } finally {
      setRefreshing(false);
    }
  }, [refreshAll]);

  const pendingOrders = useMemo(() => {
    return (orders as OrderWithDetails[]).filter((order) => order.status === 'submitted');
  }, [orders]);

  const supplierOptionById = useMemo(() => {
    const map = new Map<string, SupplierOption>();
    supplierOptions.forEach((supplier) => {
      map.set(supplier.id, supplier);
      const normalizedId = supplier.id.toLowerCase();
      if (normalizedId !== supplier.id) {
        map.set(normalizedId, supplier);
      }
    });
    return map;
  }, [supplierOptions]);

  const getSupplierOption = useCallback(
    (supplierId: string) => {
      const direct = supplierOptionById.get(supplierId);
      if (direct) return direct;
      return supplierOptionById.get(supplierId.toLowerCase()) ?? null;
    },
    [supplierOptionById]
  );

  const supplierOptionByName = useMemo(() => {
    const map = new Map<string, SupplierOption>();
    supplierOptions.forEach((supplier) => {
      const key = normalizeSupplierNameKey(supplier.name);
      if (!key || map.has(key)) return;
      map.set(key, supplier);
    });
    return map;
  }, [supplierOptions]);

  const defaultSupplierIdByType = useMemo(() => {
    const map = new Map<SupplierCategory, string>();
    LEGACY_SUPPLIER_TYPES.forEach((supplierType) => {
      const match =
        supplierOptions.find(
          (option) => option.active && option.supplierType === supplierType && option.isDefault
        ) ||
        supplierOptions.find((option) => option.active && option.supplierType === supplierType) ||
        supplierOptions.find((option) => option.supplierType === supplierType);
      if (!match) return;
      map.set(supplierType, match.id);
    });
    return map;
  }, [supplierOptions]);

  const resolveSupplierId = useCallback(
    (item: InventoryItem) => {
      const row = item as InventoryItem & Record<string, unknown>;

      const candidateIds = [
        row.supplier_id,
        row.supplierId,
        row.supplier_uuid,
        row.supplierUuid,
      ];
      for (const rawValue of candidateIds) {
        const supplierId = toSupplierId(rawValue);
        if (!supplierId) continue;
        const option = getSupplierOption(supplierId);
        if (option) return option.id;

        const mappedByName = supplierOptionByName.get(normalizeSupplierNameKey(supplierId));
        if (mappedByName) return mappedByName.id;
      }

      const candidateNames = [
        row.supplier_name,
        row.supplierName,
        row.default_supplier,
        row.defaultSupplier,
        row.supplier,
        row.vendor_name,
        row.vendorName,
      ];
      for (const rawValue of candidateNames) {
        const match = supplierOptionByName.get(normalizeSupplierNameKey(rawValue));
        if (match) return match.id;
      }

      const supplierTypeValue = row.supplier_category ?? item.supplier_category;
      if (isSupplierCategory(supplierTypeValue)) {
        const fallback = defaultSupplierIdByType.get(supplierTypeValue);
        if (fallback) return fallback;
      }

      return 'unknown:missing';
    },
    [defaultSupplierIdByType, getSupplierOption, supplierOptionByName]
  );

  const resolveSecondarySupplier = useCallback(
    (item: InventoryItem): { id: string; name: string } | null => {
      const row = item as InventoryItem & Record<string, unknown>;
      const candidates = [row.secondary_supplier, row.secondarySupplier];
      for (const rawValue of candidates) {
        const match = supplierOptionByName.get(normalizeSupplierNameKey(rawValue));
        if (match) return { id: match.id, name: match.name };
      }
      return null;
    },
    [supplierOptionByName]
  );

  const resolveSupplierType = useCallback(
    (supplierId: string): SupplierCategory | null => {
      const optionType = getSupplierOption(supplierId)?.supplierType;
      if (optionType) return optionType;
      return null;
    },
    [getSupplierOption]
  );

  const resolveSupplierName = useCallback(
    (supplierId: string) => {
      const optionName = getSupplierOption(supplierId)?.name;
      if (optionName) return optionName;
      if (supplierId.startsWith('unresolved:')) {
        return 'UNRESOLVED SUPPLIER';
      }
      if (supplierId.startsWith('unknown:')) {
        return 'Unknown Supplier';
      }
      const shortId = supplierId.slice(0, 8);
      return `Unknown Supplier (${shortId})`;
    },
    [getSupplierOption]
  );

  const isSupplierInactive = useCallback(
    (supplierId: string) => {
      const option = getSupplierOption(supplierId);
      return Boolean(option && option.active === false);
    },
    [getSupplierOption]
  );

  const isUnknownSupplier = useCallback(
    (supplierId: string) =>
      supplierId.startsWith('unknown:') ||
      supplierId.startsWith('unresolved:') ||
      !getSupplierOption(supplierId),
    [getSupplierOption]
  );

  const getOrderItemSupplierResolution = useCallback(
    (orderItem: Record<string, unknown>, inventoryItem: InventoryItem) => {
      const existing = (orderItem as any).__supplier_resolution;
      if (existing && typeof existing.effectiveSupplierId === 'string') {
        return {
          primarySupplierId: toSupplierId(existing.primarySupplierId),
          secondarySupplierId: toSupplierId(existing.secondarySupplierId),
          secondarySupplierName:
            typeof existing.secondarySupplierName === 'string' &&
            existing.secondarySupplierName.trim().length > 0
              ? existing.secondarySupplierName.trim()
              : null,
          effectiveSupplierId: existing.effectiveSupplierId,
          effectiveSupplierName:
            typeof existing.effectiveSupplierName === 'string' &&
            existing.effectiveSupplierName.trim().length > 0
              ? existing.effectiveSupplierName.trim()
              : resolveSupplierName(existing.effectiveSupplierId),
          isOverridden: existing.isOverridden === true,
        };
      }

      const fallbackPrimary = resolveSupplierId(inventoryItem);
      const secondary = resolveSecondarySupplier(inventoryItem);
      const overrideId = toSupplierId((orderItem as any).supplier_override_id);
      const hasOverride = Boolean(overrideId && getSupplierOption(overrideId));
      const effectiveSupplierId = hasOverride ? (overrideId as string) : fallbackPrimary;

      return {
        primarySupplierId: fallbackPrimary,
        secondarySupplierId: secondary?.id ?? null,
        secondarySupplierName: secondary?.name ?? null,
        effectiveSupplierId,
        effectiveSupplierName: resolveSupplierName(effectiveSupplierId),
        isOverridden: hasOverride,
      };
    },
    [getSupplierOption, resolveSecondarySupplier, resolveSupplierId, resolveSupplierName]
  );

  const availableSuppliers = useMemo(() => {
    const map = new Map<string, SupplierOption>();

    supplierOptions.filter((row) => row.active).forEach((row) => {
      map.set(row.id, row);
    });

    const ensureSupplier = (supplierId: string) => {
      if (map.has(supplierId)) return;
      const existing = getSupplierOption(supplierId);
      const supplierType = resolveSupplierType(supplierId);
      map.set(supplierId, {
        id: supplierId,
        name: existing?.name || resolveSupplierName(supplierId),
        supplierType: existing?.supplierType || supplierType,
        isDefault: existing?.isDefault === true,
        active: existing ? existing.active : true,
      });
    };

    Object.keys(supplierDrafts || {}).forEach((supplierId) => {
      if (supplierId.trim().length > 0) ensureSupplier(supplierId);
    });

    orderLaterQueue.forEach((item) => {
      const supplierId = toSupplierId(item.preferredSupplierId);
      if (supplierId) ensureSupplier(supplierId);
    });

    return Array.from(map.values()).sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [
    orderLaterQueue,
    resolveSupplierName,
    resolveSupplierType,
    supplierDrafts,
    getSupplierOption,
    supplierOptions,
  ]);

  const supplierGroups = useMemo(() => {
    const itemMap = new Map<string, AggregatedItem>();

    pendingOrders.forEach((order) => {
      order.order_items?.forEach((orderItem) => {
        const item = orderItem.inventory_item;
        if (!item) return;

        const isRemainingMode = orderItem.input_mode === 'remaining';
        const lineNote =
          typeof orderItem.note === 'string' && orderItem.note.trim().length > 0
            ? orderItem.note.trim()
            : null;
        const remainingReported = isRemainingMode ? Math.max(0, toSafeNumber(orderItem.remaining_reported, 0)) : 0;
        const decidedQuantity =
          orderItem.decided_quantity == null ? null : toSafeNumber(orderItem.decided_quantity, 0);
        const hasUndecidedRemaining = isRemainingMode && orderItem.decided_quantity == null;
        const lineQuantity = isRemainingMode
          ? decidedQuantity == null
            ? 0
            : Math.max(0, decidedQuantity)
          : Math.max(0, toSafeNumber(orderItem.quantity, 0));

        const aggregateModeKey = isRemainingMode ? 'remaining' : 'quantity';
        const resolution = getOrderItemSupplierResolution(
          orderItem as unknown as Record<string, unknown>,
          item
        );
        const supplierId = resolution.effectiveSupplierId;
        const aggregateKey = [
          item.id,
          item.name.trim().toLowerCase(),
          supplierId,
          item.category,
          aggregateModeKey,
          orderItem.unit_type,
          item.base_unit,
          item.pack_unit,
          item.pack_size,
        ].join('|');
        const existing = itemMap.get(aggregateKey);

        if (existing) {
          existing.totalQuantity += lineQuantity;
          existing.remainingReportedTotal += remainingReported;
          existing.sourceOrderItemIds.push(orderItem.id);
          if (!existing.sourceOrderIds.includes(order.id)) {
            existing.sourceOrderIds.push(order.id);
          }
          if (lineNote && !existing.notes.includes(lineNote)) {
            existing.notes.push(lineNote);
          }

          const locationEntry = existing.locationBreakdown.find((lb) => lb.locationId === order.location_id);
          if (locationEntry) {
            locationEntry.quantity += lineQuantity;
            locationEntry.remainingReported += remainingReported;
            locationEntry.hasUndecidedRemaining =
              locationEntry.hasUndecidedRemaining || hasUndecidedRemaining;
            if (lineNote && !locationEntry.notes.includes(lineNote)) {
              locationEntry.notes.push(lineNote);
            }
            const orderedByName = order.user?.name || 'Unknown';
            if (!locationEntry.orderedBy.includes(orderedByName)) {
              locationEntry.orderedBy.push(orderedByName);
            }
          } else {
            existing.locationBreakdown.push({
              locationId: order.location_id,
              locationName: order.location?.name || 'Unknown',
              shortCode: order.location?.short_code || '??',
              quantity: lineQuantity,
              remainingReported,
              hasUndecidedRemaining,
              notes: lineNote ? [lineNote] : [],
              orderedBy: [order.user?.name || 'Unknown'],
            });
          }
          return;
        }

        const primaryResolved = resolution.primarySupplierId ?? resolution.effectiveSupplierId;

        itemMap.set(aggregateKey, {
          aggregateKey,
          effectiveSupplierId: resolution.effectiveSupplierId,
          inventoryItem: item,
          totalQuantity: lineQuantity,
          unitType: orderItem.unit_type,
          isRemainingMode,
          remainingReportedTotal: remainingReported,
          notes: lineNote ? [lineNote] : [],
          locationBreakdown: [
            {
              locationId: order.location_id,
              locationName: order.location?.name || 'Unknown',
              shortCode: order.location?.short_code || '??',
              quantity: lineQuantity,
              remainingReported,
              hasUndecidedRemaining,
              notes: lineNote ? [lineNote] : [],
              orderedBy: [order.user?.name || 'Unknown'],
            },
          ],
          sourceOrderItemIds: [orderItem.id],
          sourceOrderIds: [order.id],
          secondarySupplierName: resolution.secondarySupplierName,
          secondarySupplierId: resolution.secondarySupplierId,
          isOverridden: resolution.isOverridden,
          primarySupplierId: primaryResolved,
        });
      });
    });

    const supplierMap = new Map<string, Map<ItemCategory, AggregatedItem[]>>();
    const supplierTypeById = new Map<string, SupplierCategory | null>();

    Array.from(itemMap.values()).forEach((aggregatedItem) => {
      const supplierId = aggregatedItem.effectiveSupplierId;
      const itemCategory = aggregatedItem.inventoryItem.category;
      const supplierType = resolveSupplierType(supplierId);
      supplierTypeById.set(supplierId, supplierType);

      if (!supplierMap.has(supplierId)) {
        supplierMap.set(supplierId, new Map());
      }

      const categoryMap = supplierMap.get(supplierId)!;
      if (!categoryMap.has(itemCategory)) {
        categoryMap.set(itemCategory, []);
      }
      categoryMap.get(itemCategory)!.push(aggregatedItem);
    });

    const groups: SupplierGroup[] = [];
    const supplierIds = new Set<string>([
      ...Array.from(supplierMap.keys()),
      ...Object.keys(supplierDrafts || {}),
    ]);

    Array.from(supplierIds.values())
      .sort((a, b) => {
        const aInactive = isSupplierInactive(a);
        const bInactive = isSupplierInactive(b);
        if (aInactive !== bInactive) return aInactive ? 1 : -1;
        return resolveSupplierName(a).localeCompare(resolveSupplierName(b));
      })
      .forEach((supplierId) => {
      const categoryMap = supplierMap.get(supplierId);
      const draftCount = getSupplierDraftItems(supplierId).length;
      if ((!categoryMap || categoryMap.size === 0) && draftCount === 0) return;

      const supplierType = supplierId.startsWith('unknown:') || supplierId.startsWith('unresolved:')
        ? null
        : supplierTypeById.get(supplierId) ?? resolveSupplierType(supplierId);
      const categoryGroups: CategoryGroup[] = [];
      let totalItems = draftCount;

      if (categoryMap) {
        Array.from(categoryMap.entries()).forEach(([category, items]) => {
          items.sort((a, b) => a.inventoryItem.name.localeCompare(b.inventoryItem.name));
          categoryGroups.push({ category, items });
          totalItems += items.length;
        });
      }

      categoryGroups.sort((a, b) =>
        (CATEGORY_LABELS[a.category] || a.category).localeCompare(CATEGORY_LABELS[b.category] || b.category)
      );

      groups.push({
        supplierId,
        supplierName: resolveSupplierName(supplierId),
        supplierType,
        isInactive: isSupplierInactive(supplierId),
        isUnknown: isUnknownSupplier(supplierId),
        categoryGroups,
        totalItems,
      });
    });

    // Drop unknown/unresolved suppliers — these are items whose supplier
    // couldn't be matched to a real suppliers row and can't be ordered.
    return groups.filter((g) => !g.isUnknown);
  }, [
    getSupplierDraftItems,
    getOrderItemSupplierResolution,
    pendingOrders,
    isSupplierInactive,
    isUnknownSupplier,
    resolveSupplierName,
    resolveSupplierType,
    supplierDrafts,
  ]);

  const buildLocationGroupedItems = useCallback((supplierGroup: SupplierGroup) => {
    const groupedItems: LocationGroupedItem[] = [];

    supplierGroup.categoryGroups.forEach((categoryGroup) => {
      categoryGroup.items.forEach((item) => {
        const groupMap: Record<
          LocationGroup,
          {
            quantity: number;
            remainingReportedTotal: number;
            notes: Set<string>;
            breakdown: AggregatedLocationBreakdown[];
          }
        > = {
          sushi: { quantity: 0, remainingReportedTotal: 0, notes: new Set(), breakdown: [] },
          poki: { quantity: 0, remainingReportedTotal: 0, notes: new Set(), breakdown: [] },
        };

        item.locationBreakdown.forEach((loc) => {
          const group = getLocationGroup(loc.locationName, loc.shortCode);
          groupMap[group].quantity += loc.quantity;
          groupMap[group].remainingReportedTotal += loc.remainingReported;
          loc.notes.forEach((note) => groupMap[group].notes.add(note));
          groupMap[group].breakdown.push(loc);
        });

        (Object.keys(groupMap) as LocationGroup[]).forEach((group) => {
          const info = groupMap[group];
          if (!item.isRemainingMode && info.quantity <= 0) return;
          if (item.isRemainingMode && info.breakdown.length === 0) return;

          groupedItems.push({
            key: `${item.aggregateKey}-${group}`,
            aggregateKey: item.aggregateKey,
            effectiveSupplierId: item.effectiveSupplierId,
            locationGroup: group,
            inventoryItem: item.inventoryItem,
            totalQuantity: info.quantity,
            unitType: item.unitType,
            isRemainingMode: item.isRemainingMode,
            remainingReportedTotal: info.remainingReportedTotal,
            notes: Array.from(info.notes),
            locationBreakdown: info.breakdown,
            sourceOrderItemIds: item.sourceOrderItemIds,
            sourceOrderIds: item.sourceOrderIds,
            secondarySupplierName: item.secondarySupplierName,
            secondarySupplierId: item.secondarySupplierId,
            isOverridden: item.isOverridden,
            primarySupplierId: item.primarySupplierId,
          });
        });
      });
    });

    const draftItems = getSupplierDraftItems(supplierGroup.supplierId);
    draftItems.forEach((draftItem) => {
      const shortCode =
        typeof draftItem.locationName === 'string' && draftItem.locationName.trim().length > 0
          ? draftItem.locationName.trim().slice(0, 2).toUpperCase()
          : draftItem.locationGroup === 'poki'
            ? 'P'
            : 'S';
      groupedItems.push({
        key: `draft-${draftItem.id}`,
        aggregateKey: `draft-${draftItem.id}`,
        effectiveSupplierId: supplierGroup.supplierId,
        locationGroup: draftItem.locationGroup,
        inventoryItem: {
          id: draftItem.inventoryItemId || `draft-${draftItem.id}`,
          name: draftItem.name,
          category: toItemCategory(draftItem.category),
          supplier_category: supplierGroup.supplierType || 'main_distributor',
          base_unit: draftItem.unitType === 'base' ? draftItem.unitLabel : 'unit',
          pack_unit: draftItem.unitType === 'pack' ? draftItem.unitLabel : 'pack',
          pack_size: 1,
          active: true,
          created_at: draftItem.createdAt,
        },
        totalQuantity: draftItem.quantity,
        unitType: draftItem.unitType,
        isRemainingMode: false,
        remainingReportedTotal: 0,
        notes: draftItem.note ? [draftItem.note] : [],
        locationBreakdown: [
          {
            locationId: draftItem.locationId || `draft-${draftItem.id}`,
            locationName: draftItem.locationName || LOCATION_GROUP_LABELS[draftItem.locationGroup],
            shortCode,
            quantity: draftItem.quantity,
            remainingReported: 0,
            hasUndecidedRemaining: false,
            notes: draftItem.note ? [draftItem.note] : [],
            orderedBy: ['Order Later'],
          },
        ],
        sourceOrderItemIds: [],
        sourceOrderIds: [],
        secondarySupplierName: null,
        secondarySupplierId: null,
        isOverridden: false,
        primarySupplierId: supplierGroup.supplierId,
      });
    });

    return groupedItems;
  }, [getSupplierDraftItems]);

  const groupLocationItemsIntoCards = useCallback((rows: LocationGroupedItem[]) => {
    const cardMap = new Map<string, LocationItemCard>();

    rows.forEach((row) => {
      const key = row.inventoryItem.id;
      const existing = cardMap.get(key);
      if (existing) {
        existing.rows.push(row);
        return;
      }

      cardMap.set(key, {
        key: `${row.locationGroup}-${key}`,
        inventoryItemId: key,
        name: row.inventoryItem.name,
        rows: [row],
      });
    });

    return Array.from(cardMap.values())
      .map((card) => ({
        ...card,
        rows: [...card.rows].sort((a, b) => {
          if (a.isRemainingMode !== b.isRemainingMode) return a.isRemainingMode ? -1 : 1;
          if (a.unitType !== b.unitType) return a.unitType.localeCompare(b.unitType);
          return a.inventoryItem.name.localeCompare(b.inventoryItem.name);
        }),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  const toggleSupplier = useCallback((supplierId: string) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setExpandedSuppliers((prev) => {
      const next = new Set(prev);
      if (next.has(supplierId)) {
        next.delete(supplierId);
      } else {
        next.add(supplierId);
      }
      return next;
    });
  }, []);

  const toggleLocationSection = useCallback((sectionKey: string) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setExpandedLocationSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) {
        next.delete(sectionKey);
      } else {
        next.add(sectionKey);
      }
      return next;
    });
  }, []);

  const handleQuantityChange = useCallback((item: LocationGroupedItem, newQuantity: number) => {
    if (item.isRemainingMode) return;
    setEditedQuantities((prev) => ({
      ...prev,
      [item.key]: Math.max(0, newQuantity),
    }));
  }, []);

  const getDisplayQuantity = useCallback(
    (item: LocationGroupedItem) => editedQuantities[item.key] ?? item.totalQuantity,
    [editedQuantities]
  );

  const toggleNoteExpansion = useCallback((noteKey: string) => {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(noteKey)) {
        next.delete(noteKey);
      } else {
        next.add(noteKey);
      }
      return next;
    });
  }, []);

  const buildRegularConfirmationItems = useCallback(
    (supplierGroup: SupplierGroup) => {
      const quantityOverrideById = new Map<string, number>();
      buildLocationGroupedItems(supplierGroup).forEach((item) => {
        if (item.isRemainingMode) return;
        const mergeKey = [item.locationGroup, item.inventoryItem.id, item.unitType].join('|');
        quantityOverrideById.set(mergeKey, Math.max(0, getDisplayQuantity(item)));
      });

      const merged = new Map<
        string,
        {
          id: string;
          inventoryItemId: string;
          name: string;
          category: ItemCategory;
          locationGroup: LocationGroup;
          unitType: 'base' | 'pack';
          unitLabel: string;
          contributors: Map<string, { userId: string | null; name: string; quantity: number }>;
          details: Map<
            string,
            {
              locationId: string;
              locationName: string;
              shortCode: string;
              quantity: number;
              orderedBy: Set<string>;
            }
          >;
          notes: Map<
            string,
            {
              id: string;
              author: string;
              text: string;
              locationName: string;
              shortCode: string;
            }
          >;
          sourceOrderItemIds: Set<string>;
          sourceOrderIds: Set<string>;
          sourceDraftItemIds: Set<string>;
          rawQuantity: number;
          inventoryItemRef: InventoryItem | null;
        }
      >();

      pendingOrders.forEach((order) => {
        order.order_items?.forEach((orderItem) => {
          const inventoryItem = orderItem.inventory_item;
          if (!inventoryItem) return;
          const resolution = getOrderItemSupplierResolution(
            orderItem as unknown as Record<string, unknown>,
            inventoryItem
          );
          const effectiveSupplierId = resolution.effectiveSupplierId;
          if (effectiveSupplierId !== supplierGroup.supplierId) return;
          if (orderItem.input_mode === 'remaining') return;

          const locationGroup = getLocationGroup(order.location?.name, order.location?.short_code);
          const unitType = orderItem.unit_type === 'base' ? 'base' : 'pack';
          const mergeKey = [locationGroup, inventoryItem.id, unitType].join('|');
          const lineQuantity = Math.max(0, toSafeNumber(orderItem.quantity, 0));
          if (lineQuantity <= 0) return;

          const orderedByName = order.user?.name?.trim() || 'Unknown';
          const userId = typeof order.user?.id === 'string' ? order.user.id : null;
          const locationId = order.location_id;
          const locationName = order.location?.name || 'Unknown';
          const shortCode = order.location?.short_code || '??';
          const note = typeof orderItem.note === 'string' ? orderItem.note.trim() : '';

          const existing = merged.get(mergeKey);
          if (!existing) {
            const contributorMap = new Map<string, { userId: string | null; name: string; quantity: number }>();
            const contributorKey = userId || `name:${orderedByName.toLowerCase()}`;
            contributorMap.set(contributorKey, {
              userId,
              name: orderedByName,
              quantity: lineQuantity,
            });

            const detailMap = new Map<
              string,
              {
                locationId: string;
                locationName: string;
                shortCode: string;
                quantity: number;
                orderedBy: Set<string>;
              }
            >();
            detailMap.set(locationId, {
              locationId,
              locationName,
              shortCode,
              quantity: lineQuantity,
              orderedBy: new Set([orderedByName]),
            });

            const noteMap = new Map<
              string,
              {
                id: string;
                author: string;
                text: string;
                locationName: string;
                shortCode: string;
              }
            >();
            if (note.length > 0) {
              const noteId = `${orderItem.id}:${note}`;
              noteMap.set(noteId, {
                id: noteId,
                author: orderedByName,
                text: note,
                locationName,
                shortCode,
              });
            }

            merged.set(mergeKey, {
              id: mergeKey,
              inventoryItemId: inventoryItem.id,
              name: inventoryItem.name,
              category: inventoryItem.category,
              locationGroup,
              unitType,
              unitLabel: unitType === 'pack' ? inventoryItem.pack_unit : inventoryItem.base_unit,
              contributors: contributorMap,
              details: detailMap,
              notes: noteMap,
              sourceOrderItemIds: new Set([orderItem.id]),
              sourceOrderIds: new Set([order.id]),
              sourceDraftItemIds: new Set<string>(),
              rawQuantity: lineQuantity,
              inventoryItemRef: inventoryItem,
            });
            return;
          }

          existing.rawQuantity += lineQuantity;
          existing.sourceOrderItemIds.add(orderItem.id);
          existing.sourceOrderIds.add(order.id);

          const contributorKey = userId || `name:${orderedByName.toLowerCase()}`;
          const existingContributor = existing.contributors.get(contributorKey);
          if (existingContributor) {
            existingContributor.quantity += lineQuantity;
          } else {
            existing.contributors.set(contributorKey, {
              userId,
              name: orderedByName,
              quantity: lineQuantity,
            });
          }

          const existingDetail = existing.details.get(locationId);
          if (existingDetail) {
            existingDetail.quantity += lineQuantity;
            existingDetail.orderedBy.add(orderedByName);
          } else {
            existing.details.set(locationId, {
              locationId,
              locationName,
              shortCode,
              quantity: lineQuantity,
              orderedBy: new Set([orderedByName]),
            });
          }

          if (note.length > 0) {
            const noteId = `${orderItem.id}:${note}`;
            if (!existing.notes.has(noteId)) {
              existing.notes.set(noteId, {
                id: noteId,
                author: orderedByName,
                text: note,
                locationName,
                shortCode,
              });
            }
          }
        });
      });

      const draftItems = getSupplierDraftItems(supplierGroup.supplierId);
      draftItems.forEach((draftItem) => {
        const locationGroup = draftItem.locationGroup;
        const unitType = draftItem.unitType;
        const baseKey = draftItem.inventoryItemId || draftItem.name.toLowerCase().trim();
        const mergeKey = [locationGroup, baseKey, unitType].join('|');
        const lineQuantity = Math.max(0, toSafeNumber(draftItem.quantity, 0));
        if (lineQuantity <= 0) return;

        const locationId = draftItem.locationId || `draft-${draftItem.id}`;
        const locationName = draftItem.locationName || LOCATION_GROUP_LABELS[locationGroup];
        const shortCode = locationName.slice(0, 2).toUpperCase();
        const orderedByName = 'Order Later';
        const note = typeof draftItem.note === 'string' ? draftItem.note.trim() : '';

        const existing = merged.get(mergeKey);
        if (!existing) {
          const contributorMap = new Map<string, { userId: string | null; name: string; quantity: number }>();
          contributorMap.set(`draft:${draftItem.id}`, {
            userId: null,
            name: orderedByName,
            quantity: lineQuantity,
          });

          const detailMap = new Map<
            string,
            {
              locationId: string;
              locationName: string;
              shortCode: string;
              quantity: number;
              orderedBy: Set<string>;
            }
          >();
          detailMap.set(locationId, {
            locationId,
            locationName,
            shortCode,
            quantity: lineQuantity,
            orderedBy: new Set([orderedByName]),
          });

          const noteMap = new Map<
            string,
            {
              id: string;
              author: string;
              text: string;
              locationName: string;
              shortCode: string;
            }
          >();
          if (note.length > 0) {
            const noteId = `draft:${draftItem.id}:${note}`;
            noteMap.set(noteId, {
              id: noteId,
              author: orderedByName,
              text: note,
              locationName,
              shortCode,
            });
          }

          merged.set(mergeKey, {
            id: mergeKey,
            inventoryItemId: draftItem.inventoryItemId || `draft-${draftItem.id}`,
            name: draftItem.name,
            category: toItemCategory(draftItem.category),
            locationGroup,
            unitType,
            unitLabel: draftItem.unitLabel,
            contributors: contributorMap,
            details: detailMap,
            notes: noteMap,
            sourceOrderItemIds: new Set<string>(),
            sourceOrderIds: new Set<string>(),
            sourceDraftItemIds: new Set([draftItem.id]),
            rawQuantity: lineQuantity,
            inventoryItemRef: null,
          });
          return;
        }

        existing.rawQuantity += lineQuantity;
        existing.sourceDraftItemIds.add(draftItem.id);

        const draftContributorKey = `draft:${draftItem.id}`;
        const existingContributor = existing.contributors.get(draftContributorKey);
        if (existingContributor) {
          existingContributor.quantity += lineQuantity;
        } else {
          existing.contributors.set(draftContributorKey, {
            userId: null,
            name: orderedByName,
            quantity: lineQuantity,
          });
        }

        const existingDetail = existing.details.get(locationId);
        if (existingDetail) {
          existingDetail.quantity += lineQuantity;
          existingDetail.orderedBy.add(orderedByName);
        } else {
          existing.details.set(locationId, {
            locationId,
            locationName,
            shortCode,
            quantity: lineQuantity,
            orderedBy: new Set([orderedByName]),
          });
        }

        if (note.length > 0) {
          const noteId = `draft:${draftItem.id}:${note}`;
          if (!existing.notes.has(noteId)) {
            existing.notes.set(noteId, {
              id: noteId,
              author: orderedByName,
              text: note,
              locationName,
              shortCode,
            });
          }
        }
      });

      return Array.from(merged.values())
        .map((entry) => {
          const contributors = Array.from(entry.contributors.values())
            .filter((person) => person.quantity > 0)
            .sort((a, b) => a.name.localeCompare(b.name));
          const details = Array.from(entry.details.values())
            .map((row) => ({
              locationId: row.locationId,
              locationName: row.locationName,
              shortCode: row.shortCode,
              quantity: row.quantity,
              orderedBy: Array.from(row.orderedBy.values()).join(', '),
            }))
            .sort((a, b) => a.locationName.localeCompare(b.locationName));
          const notes = Array.from(entry.notes.values()).sort((a, b) => {
            if (a.author !== b.author) return a.author.localeCompare(b.author);
            return a.text.localeCompare(b.text);
          });
          const overrideQty = quantityOverrideById.get(entry.id);
          const quantity = Math.max(0, overrideQty ?? entry.rawQuantity);

          const secondary = entry.inventoryItemRef
            ? resolveSecondarySupplier(entry.inventoryItemRef)
            : null;

          return {
            id: entry.id,
            inventoryItemId: entry.inventoryItemId,
            name: entry.name,
            category: entry.category,
            locationGroup: entry.locationGroup,
            quantity,
            unitType: entry.unitType,
            unitLabel: entry.unitLabel,
            sumOfContributorQuantities: Math.max(0, entry.rawQuantity),
            sourceOrderItemIds: Array.from(entry.sourceOrderItemIds),
            sourceOrderIds: Array.from(entry.sourceOrderIds),
            sourceDraftItemIds: Array.from(entry.sourceDraftItemIds),
            contributors,
            notes,
            details,
            secondarySupplierName: secondary?.name ?? null,
            secondarySupplierId: secondary?.id ?? null,
          } satisfies ConfirmationRegularItem;
        })
        .filter((item) => item.quantity > 0)
        .sort((a, b) => {
          if (a.locationGroup !== b.locationGroup) {
            return a.locationGroup.localeCompare(b.locationGroup);
          }
          return a.name.localeCompare(b.name);
        });
    },
    [
      buildLocationGroupedItems,
      getDisplayQuantity,
      getOrderItemSupplierResolution,
      getSupplierDraftItems,
      pendingOrders,
      resolveSecondarySupplier,
    ]
  );

  const buildRemainingConfirmationItems = useCallback(
    (supplierGroup: SupplierGroup) => {
      const rows: RemainingConfirmationItem[] = [];

      pendingOrders.forEach((order) => {
        order.order_items?.forEach((orderItem) => {
          const inventoryItem = orderItem.inventory_item;
          if (!inventoryItem) return;
          const resolution = getOrderItemSupplierResolution(
            orderItem as unknown as Record<string, unknown>,
            inventoryItem
          );
          const effectiveSupplierId = resolution.effectiveSupplierId;
          if (effectiveSupplierId !== supplierGroup.supplierId) return;
          if (orderItem.input_mode !== 'remaining') return;

          const decidedQuantity =
            orderItem.decided_quantity == null ? null : Math.max(0, toSafeNumber(orderItem.decided_quantity, 0));
          const note =
            typeof orderItem.note === 'string' && orderItem.note.trim().length > 0 ? orderItem.note.trim() : null;
          const unitType = orderItem.unit_type === 'base' ? 'base' : 'pack';
          const unitLabel = unitType === 'pack' ? inventoryItem.pack_unit : inventoryItem.base_unit;

          rows.push({
            orderItemId: orderItem.id,
            orderId: order.id,
            inventoryItemId: inventoryItem.id,
            name: inventoryItem.name,
            category: inventoryItem.category,
            locationGroup: getLocationGroup(order.location?.name, order.location?.short_code),
            locationId: order.location_id,
            locationName: order.location?.name || 'Unknown',
            shortCode: order.location?.short_code || '??',
            unitType,
            unitLabel,
            reportedRemaining: Math.max(0, toSafeNumber(orderItem.remaining_reported, 0)),
            decidedQuantity,
            note,
            orderedBy: order.user?.name || 'Unknown',
            secondarySupplierName: resolution.secondarySupplierName ?? null,
            secondarySupplierId: resolution.secondarySupplierId ?? null,
          });
        });
      });

      rows.sort((a, b) => {
        if (a.locationGroup !== b.locationGroup) {
          return a.locationGroup.localeCompare(b.locationGroup);
        }
        return a.name.localeCompare(b.name);
      });

      return rows;
    },
    [getOrderItemSupplierResolution, pendingOrders]
  );

  const handleSend = useCallback(
    (supplierGroup: SupplierGroup) => {
      const nowMs = Date.now();
      if (nowMs < sendTapLockUntilRef.current) {
        return;
      }
      sendTapLockUntilRef.current = nowMs + 700;

      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }

      const regularItems = buildRegularConfirmationItems(supplierGroup);
      const remainingItems = buildRemainingConfirmationItems(supplierGroup);

      if (regularItems.length === 0 && remainingItems.length === 0) {
        Alert.alert('Nothing to Confirm', 'There are no items in this supplier section.');
        return;
      }

      router.push({
        pathname: '/(manager)/fulfillment-confirmation',
        params: {
          supplier: supplierGroup.supplierId,
          supplierLabel: supplierGroup.supplierName,
          from: 'fulfillment',
          items: encodeURIComponent(JSON.stringify(regularItems)),
          remaining: encodeURIComponent(JSON.stringify(remainingItems)),
        },
      } as any);
    },
    [buildRegularConfirmationItems, buildRemainingConfirmationItems]
  );

  const addToTargetItem = useMemo(
    () => orderLaterQueue.find((item) => item.id === addToTargetItemId) ?? null,
    [addToTargetItemId, orderLaterQueue]
  );
  const addToSupplierOptions = useMemo<OrderLaterSupplierOption[]>(
    () =>
      availableSuppliers.map((supplier) => ({
        id: supplier.id,
        name: supplier.active ? supplier.name : `${supplier.name} (Inactive)`,
      })),
    [availableSuppliers]
  );
  const scheduleEditItem = useMemo(
    () => orderLaterQueue.find((item) => item.id === scheduleEditItemId) ?? null,
    [orderLaterQueue, scheduleEditItemId]
  );
  const resolveAddToLocationGroup = useCallback((item: (typeof orderLaterQueue)[number]): LocationGroup => {
    const preferred = toLocationGroup(item.preferredLocationGroup);
    if (preferred) return preferred;

    const payload = item.payload as Record<string, unknown> | null | undefined;
    const payloadGroup = payload ? toLocationGroup(payload.locationGroup) : null;
    if (payloadGroup) return payloadGroup;

    return getLocationGroup(item.locationName ?? undefined);
  }, []);

  useEffect(() => {
    if (availableSuppliers.length === 0) return;
    const hasSelection = availableSuppliers.some((supplier) => supplier.id === addToSupplier);
    if (!hasSelection) {
      setAddToSupplier(availableSuppliers[0].id);
    }
  }, [addToSupplier, availableSuppliers]);

  useEffect(() => {
    if (!addToTargetItem) return;

    const defaultSupplierId = toSupplierId(addToTargetItem.preferredSupplierId)
      ?? toSupplierId(addToTargetItem.suggestedSupplierId);
    if (
      defaultSupplierId &&
      availableSuppliers.some((supplier) => supplier.id === defaultSupplierId)
    ) {
      setAddToSupplier(defaultSupplierId);
    } else if (availableSuppliers.length > 0) {
      setAddToSupplier(availableSuppliers[0].id);
    } else {
      setAddToSupplier('');
    }
    setAddToSupplierError(null);
  }, [addToTargetItem, availableSuppliers]);

  const openAddToModal = useCallback((itemId: string) => {
    setAddToTargetItemId(itemId);
    setAddToSupplierError(null);
    setIsAddingToSupplierDraft(false);
  }, []);

  const closeAddToModal = useCallback(() => {
    setAddToTargetItemId(null);
    setAddToSupplierError(null);
    setIsAddingToSupplierDraft(false);
  }, []);

  const handleAddToSupplierChange = useCallback((supplierId: string) => {
    setAddToSupplier(supplierId);
    setAddToSupplierError(null);
  }, []);

  const handleConfirmAddTo = useCallback(async () => {
    if (!addToTargetItem || isAddingToSupplierDraft) return;
    if (!addToSupplier) {
      setAddToSupplierError('Supplier is required.');
      return;
    }

    setAddToSupplierError(null);
    setIsAddingToSupplierDraft(true);

    try {
      const locationGroup = resolveAddToLocationGroup(addToTargetItem);

      await moveOrderLaterItemToSupplierDraft(
        addToTargetItem.id,
        addToSupplier,
        locationGroup,
        {
          locationId: addToTargetItem.locationId ?? null,
          locationName: addToTargetItem.locationName ?? null,
        }
      );

      closeAddToModal();
      try {
        await fetchPendingFulfillmentOrders(managerLocationIds);
      } catch {
        // Best effort refresh; realtime sync also updates this screen.
      }

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert(
        'Added',
        `${addToTargetItem.itemName} was added back to ${resolveSupplierName(addToSupplier)}.`
      );
    } catch (error) {
      console.error('Failed to add order-later item to supplier draft.', error);
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'Unable to add this item right now. Please try again.';
      setAddToSupplierError(message);
    } finally {
      setIsAddingToSupplierDraft(false);
    }
  }, [
    fetchPendingFulfillmentOrders,
    addToSupplier,
    addToTargetItem,
    closeAddToModal,
    isAddingToSupplierDraft,
    managerLocationIds,
    moveOrderLaterItemToSupplierDraft,
    resolveAddToLocationGroup,
    resolveSupplierName,
  ]);

  const handleRemoveOrderLater = useCallback((itemId: string, itemName: string) => {
    Alert.alert('Remove Item', `Remove ${itemName} from Order Later?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void removeOrderLaterItem(itemId);
        },
      },
    ]);
  }, [removeOrderLaterItem]);

  const formatScheduleLabel = useCallback((scheduledAt: string) => {
    const date = new Date(scheduledAt);
    if (Number.isNaN(date.getTime())) return 'Not scheduled';
    return date.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }, []);

  const [orderLaterScheduleItem, setOrderLaterScheduleItem] = useState<LocationGroupedItem | null>(null);

  const getHasMultiEmployeeBreakdown = useCallback((item: LocationGroupedItem) => {
    const names = new Set<string>();
    item.locationBreakdown.forEach((row) => {
      row.orderedBy.forEach((name) => {
        const normalized = name.trim();
        if (normalized.length > 0) {
          names.add(normalized.toLowerCase());
        }
      });
    });
    return names.size > 1;
  }, []);

  const handleMoveToSecondarySupplier = useCallback(
    (item: LocationGroupedItem) => {
      if (!item.secondarySupplierId || !item.secondarySupplierName || item.sourceOrderItemIds.length === 0) {
        return;
      }

      Alert.alert(
        `Move to ${item.secondarySupplierName}?`,
        `${item.inventoryItem.name} will be reassigned to the secondary supplier.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Move',
            onPress: () => {
              const lockIds = [...item.sourceOrderItemIds].sort().join(',');
              void runLockedAction(`move-secondary:${lockIds}`, async () => {
                const success = await setSupplierOverride(item.sourceOrderItemIds, item.secondarySupplierId!);
                if (!success) {
                  Alert.alert('Error', 'Failed to move item. Please try again.');
                  return;
                }

                if (Platform.OS !== 'web') {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }
                await fetchPendingFulfillmentOrders(managerLocationIds);
              });
            },
          },
        ]
      );
    },
    [fetchPendingFulfillmentOrders, managerLocationIds, runLockedAction, setSupplierOverride]
  );

  const handleMoveBackToPrimarySupplier = useCallback(
    (item: LocationGroupedItem) => {
      if (!item.isOverridden || item.sourceOrderItemIds.length === 0) return;
      const primaryName = resolveSupplierName(item.primarySupplierId);

      Alert.alert(
        `Move back to ${primaryName}?`,
        `${item.inventoryItem.name} will return to its primary supplier.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Move Back',
            onPress: () => {
              const lockIds = [...item.sourceOrderItemIds].sort().join(',');
              void runLockedAction(`move-primary:${lockIds}`, async () => {
                const success = await clearSupplierOverride(item.sourceOrderItemIds);
                if (!success) {
                  Alert.alert('Error', 'Failed to move item back. Please try again.');
                  return;
                }

                if (Platform.OS !== 'web') {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }
                await fetchPendingFulfillmentOrders(managerLocationIds);
              });
            },
          },
        ]
      );
    },
    [clearSupplierOverride, fetchPendingFulfillmentOrders, managerLocationIds, resolveSupplierName, runLockedAction]
  );

  const handleRemoveSupplierItem = useCallback(
    (item: LocationGroupedItem) => {
      if (item.sourceOrderItemIds.length === 0) return;

      Alert.alert(
        'Remove Item',
        `Remove ${item.inventoryItem.name} from this supplier order?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => {
              const lockIds = [...item.sourceOrderItemIds].sort().join(',');
              void runLockedAction(`remove-item:${lockIds}`, async () => {
                const removed = await markOrderItemsStatus(item.sourceOrderItemIds, 'cancelled');
                if (!removed) {
                  Alert.alert('Error', 'Failed to remove item. Please try again.');
                  return;
                }

                if (Platform.OS !== 'web') {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                }
                await fetchPendingFulfillmentOrders(managerLocationIds);
              });
            },
          },
        ]
      );
    },
    [fetchPendingFulfillmentOrders, managerLocationIds, markOrderItemsStatus, runLockedAction]
  );

  const handleOpenItemNoteEditor = useCallback((item: LocationGroupedItem) => {
    setOverflowItem(null);
    setNoteEditorItem(item);
    setNoteDraft(item.notes.map((note) => note.trim()).filter((note) => note.length > 0).join(' • '));
  }, []);

  const handleSaveItemNote = useCallback(async () => {
    if (!noteEditorItem) return;
    if (noteEditorItem.sourceOrderItemIds.length === 0) {
      setNoteEditorItem(null);
      setNoteDraft('');
      return;
    }

    const normalized = noteDraft.trim();
    setIsSavingNote(true);
    try {
      const { error } = await supabase
        .from('order_items')
        .update({ note: normalized.length > 0 ? normalized : null } as any)
        .in('id', noteEditorItem.sourceOrderItemIds);

      if (error) throw error;

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      setNoteEditorItem(null);
      setNoteDraft('');
      await fetchPendingFulfillmentOrders(managerLocationIds);
    } catch (error: any) {
      Alert.alert('Unable to Save Note', error?.message || 'Please try again.');
    } finally {
      setIsSavingNote(false);
    }
  }, [fetchPendingFulfillmentOrders, managerLocationIds, noteDraft, noteEditorItem]);

  const breakdownRows = useMemo(() => {
    if (!breakdownItem) return [] as { name: string; quantity: number; locations: string[] }[];
    const sourceIds = new Set(breakdownItem.sourceOrderItemIds);
    const rowsByName = new Map<string, { name: string; quantity: number; locations: Set<string> }>();

    pendingOrders.forEach((order) => {
      order.order_items?.forEach((orderItem) => {
        if (!sourceIds.has(orderItem.id)) return;

        const orderedBy = order.user?.name?.trim() || 'Unknown';
        const locationName = order.location?.name || 'Unknown';
        const quantity =
          orderItem.input_mode === 'remaining'
            ? Math.max(
                0,
                toSafeNumber(
                  orderItem.decided_quantity == null
                    ? orderItem.remaining_reported
                    : orderItem.decided_quantity,
                  0
                )
              )
            : Math.max(0, toSafeNumber(orderItem.quantity, 0));
        if (quantity <= 0) return;

        const existing = rowsByName.get(orderedBy);
        if (existing) {
          existing.quantity += quantity;
          existing.locations.add(locationName);
        } else {
          rowsByName.set(orderedBy, {
            name: orderedBy,
            quantity,
            locations: new Set([locationName]),
          });
        }
      });
    });

    return Array.from(rowsByName.values())
      .map((entry) => ({
        name: entry.name,
        quantity: entry.quantity,
        locations: Array.from(entry.locations).sort((a, b) => a.localeCompare(b)),
      }))
      .sort((a, b) => {
        if (b.quantity !== a.quantity) return b.quantity - a.quantity;
        return a.name.localeCompare(b.name);
      });
  }, [breakdownItem, pendingOrders]);

  const getUnitConflictRows = useCallback(
    (item: LocationGroupedItem) => {
      const supplierGroup = supplierGroups.find((group) => group.supplierId === item.effectiveSupplierId);
      if (!supplierGroup) return [] as LocationGroupedItem[];

      return buildLocationGroupedItems(supplierGroup).filter((row) => {
        if (row.key === item.key) return false;
        if (row.locationGroup !== item.locationGroup) return false;
        if (row.inventoryItem.id !== item.inventoryItem.id) return false;
        return row.unitType !== item.unitType;
      });
    },
    [buildLocationGroupedItems, supplierGroups]
  );

  const overflowActionSections = useMemo<ItemActionSheetSection[]>(() => {
    if (!overflowItem) return [];

    const hasSourceOrderItems = overflowItem.sourceOrderItemIds.length > 0;
    const sections: ItemActionSheetSection[] = [];
    const logisticsItems = [];

    if (hasSourceOrderItems) {
      logisticsItems.push({
        id: 'move-to-order-later',
        label: 'Move to Order Later',
        icon: 'time-outline',
        detail: 'Schedule this line for later and remove it from active fulfillment.',
        onPress: () => {
          setOverflowItem(null);
          setOrderLaterScheduleItem(overflowItem);
        },
      });
    }

    if (getHasMultiEmployeeBreakdown(overflowItem)) {
      logisticsItems.push({
        id: 'view-breakdown',
        label: 'View breakdown',
        icon: 'list-outline',
        detail: 'See quantity by employee for this item line.',
        onPress: () => {
          setOverflowItem(null);
          setBreakdownItem(overflowItem);
        },
      });
    }

    if (getUnitConflictRows(overflowItem).length > 0) {
      logisticsItems.push({
        id: 'resolve-units',
        label: 'Resolve units / Combine',
        icon: 'git-merge-outline',
        detail: 'Convert units in Review before sending, when a conversion exists.',
        onPress: () => {
          setOverflowItem(null);
          Alert.alert(
            'Resolve in Review',
            'Open this supplier\'s Review screen and use "Resolve units / Combine" to convert unit lines when a conversion rule exists.'
          );
        },
      });
    }

    if (logisticsItems.length > 0) {
      sections.push({
        id: 'logistics',
        title: 'Logistics',
        items: logisticsItems,
      });
    }

    const supplierItems = [];
    if (
      overflowItem.secondarySupplierId &&
      overflowItem.secondarySupplierName &&
      !overflowItem.isOverridden &&
      hasSourceOrderItems
    ) {
      supplierItems.push({
        id: 'move-secondary',
        label: `Move to ${overflowItem.secondarySupplierName}`,
        icon: 'swap-horizontal',
        onPress: () => {
          setOverflowItem(null);
          handleMoveToSecondarySupplier(overflowItem);
        },
      });
    }
    if (overflowItem.isOverridden && hasSourceOrderItems) {
      supplierItems.push({
        id: 'move-primary',
        label: `Move back to ${resolveSupplierName(overflowItem.primarySupplierId)}`,
        icon: 'arrow-undo-outline',
        onPress: () => {
          setOverflowItem(null);
          handleMoveBackToPrimarySupplier(overflowItem);
        },
      });
    }
    if (supplierItems.length > 0) {
      sections.push({
        id: 'supplier',
        title: 'Supplier',
        items: supplierItems,
      });
    }

    if (hasSourceOrderItems) {
      sections.push({
        id: 'notes',
        title: 'Item',
        items: [
          {
            id: 'note',
            label: overflowItem.notes.length > 0 ? 'Edit Note' : 'Add Note',
            icon: 'create-outline',
            onPress: () => handleOpenItemNoteEditor(overflowItem),
          },
        ],
      });

      sections.push({
        id: 'danger',
        title: 'Danger Zone',
        items: [
          {
            id: 'remove',
            label: 'Remove item from this supplier order',
            icon: 'trash-outline',
            destructive: true,
            onPress: () => {
              setOverflowItem(null);
              handleRemoveSupplierItem(overflowItem);
            },
          },
        ],
      });
    }

    return sections;
  }, [
    getHasMultiEmployeeBreakdown,
    getUnitConflictRows,
    handleMoveBackToPrimarySupplier,
    handleMoveToSecondarySupplier,
    handleOpenItemNoteEditor,
    handleRemoveSupplierItem,
    overflowItem,
    resolveSupplierName,
  ]);

  const handleItemOverflowMenu = useCallback((item: LocationGroupedItem) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setOverflowItem(item);
  }, []);

  const handleOrderLaterFromFulfillment = useCallback(
    async (scheduledAtIso: string) => {
      const item = orderLaterScheduleItem;
      if (!item || !user?.id) return;

      const unitLabel = item.unitType === 'pack' ? item.inventoryItem.pack_unit : item.inventoryItem.base_unit;

      const createdOrderLaterItem = await createOrderLaterItem({
        createdBy: user.id,
        scheduledAt: scheduledAtIso,
        quantity: Math.max(0, getDisplayQuantity(item)),
        itemId: item.inventoryItem.id,
        itemName: item.inventoryItem.name,
        unit: unitLabel,
        locationId: item.locationBreakdown[0]?.locationId ?? null,
        locationName: item.locationBreakdown[0]?.locationName ?? null,
        notes: item.notes.join('; ') || null,
        suggestedSupplierId: item.effectiveSupplierId,
        preferredSupplierId: null,
        preferredLocationGroup: item.locationGroup,
        sourceOrderItemIds: item.sourceOrderItemIds,
      });

      if (item.sourceOrderItemIds.length > 0) {
        const moved = await markOrderItemsStatus(item.sourceOrderItemIds, 'order_later');
        if (!moved) {
          if (createdOrderLaterItem?.id) {
            await removeOrderLaterItem(createdOrderLaterItem.id);
          }
          await fetchPendingFulfillmentOrders(managerLocationIds);
          Alert.alert(
            'Already Updated',
            'These items were already changed on another device. The list has been refreshed.'
          );
          return;
        }
      }

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      setOrderLaterScheduleItem(null);
      await fetchPendingFulfillmentOrders(managerLocationIds);
      Alert.alert('Moved to Order Later', `${item.inventoryItem.name} moved to order later.`);
    },
    [
      createOrderLaterItem,
      fetchPendingFulfillmentOrders,
      getDisplayQuantity,
      markOrderItemsStatus,
      managerLocationIds,
      orderLaterScheduleItem,
      removeOrderLaterItem,
      user?.id,
    ]
  );

  const renderItem = useCallback(
    (item: LocationGroupedItem, showLocationBreakdown: boolean) => {
      const unitLabel = item.unitType === 'pack' ? item.inventoryItem.pack_unit : item.inventoryItem.base_unit;
      const displayQty = getDisplayQuantity(item);
      const numericQty = Number.isFinite(displayQty) ? displayQty : 0;
      const displayQtyText = Number.isFinite(displayQty) ? displayQty.toString() : '0';

      const itemNotes = item.notes.map((note) => note.trim()).filter((note) => note.length > 0);
      const itemNotePreview = itemNotes.join(' • ');
      const itemNoteKey = `${item.key}-note`;
      const itemNoteExpanded = expandedNotes.has(itemNoteKey);
      const itemNoteCanExpand = itemNotePreview.length > 120 || itemNotes.length > 1;

      const hasMenuActions =
        item.sourceOrderItemIds.length > 0 ||
        (item.secondarySupplierId && !item.isOverridden) ||
        item.isOverridden;

      return (
        <View key={item.key}>
          <View className="flex-row items-center py-3 px-4 border-b border-gray-100 bg-white">
            <View className="flex-1 pr-2">
              <View className="flex-row items-center">
                <Text className="font-medium text-gray-900 flex-1" numberOfLines={1}>
                  {item.inventoryItem.name}
                </Text>
                {hasMenuActions && (
                  <TouchableOpacity
                    onPress={() => handleItemOverflowMenu(item)}
                    className="p-1.5 -mr-1"
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="ellipsis-horizontal" size={16} color={colors.gray[500]} />
                  </TouchableOpacity>
                )}
              </View>

              {item.isRemainingMode && (
                <View className="flex-row items-center mt-1">
                  <View className="px-1.5 py-0.5 rounded-full bg-amber-100">
                    <Text className="text-[10px] font-semibold text-amber-700">Remaining</Text>
                  </View>
                  <Text className="ml-2 text-[11px] text-amber-700">
                    Reported: {item.remainingReportedTotal} {unitLabel}
                  </Text>
                </View>
              )}

              {itemNotes.length > 0 && (
                <View className="mt-1.5 rounded-md bg-blue-50 border border-blue-100 px-2.5 py-2">
                  <Text className="text-[11px] font-semibold text-blue-700 mb-1">Notes</Text>
                  <Text className="text-[12px] leading-4 text-blue-900" numberOfLines={itemNoteExpanded ? undefined : 3}>
                    {itemNotePreview}
                  </Text>
                  {itemNoteCanExpand && (
                    <TouchableOpacity onPress={() => toggleNoteExpansion(itemNoteKey)} className="mt-1 self-start">
                      <Text className="text-[11px] font-semibold text-blue-700">
                        {itemNoteExpanded ? 'Show less' : 'Show more'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>

            {!item.isRemainingMode && (
              <View className="flex-row items-center">
                <TouchableOpacity
                  onPress={() => handleQuantityChange(item, numericQty - 1)}
                  className="w-7 h-7 bg-gray-100 rounded items-center justify-center"
                >
                  <Ionicons name="remove" size={14} color={colors.gray[600]} />
                </TouchableOpacity>

                <TextInput
                  className="w-12 h-7 text-center text-sm font-bold text-gray-900"
                  value={displayQtyText}
                  onChangeText={(text) => {
                    const sanitized = text.replace(/[^0-9.]/g, '');
                    const num = parseFloat(sanitized);
                    handleQuantityChange(item, Number.isFinite(num) ? num : 0);
                  }}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                />

                <TouchableOpacity
                  onPress={() => handleQuantityChange(item, numericQty + 1)}
                  className="w-7 h-7 bg-gray-100 rounded items-center justify-center"
                >
                  <Ionicons name="add" size={14} color={colors.gray[600]} />
                </TouchableOpacity>

                <Text className="text-xs text-gray-500 ml-1 w-10">{unitLabel}</Text>
              </View>
            )}
          </View>

          {showLocationBreakdown && item.locationBreakdown.length > 1 && (
            <View className="bg-gray-50 px-12 py-2 border-b border-gray-100">
              {item.locationBreakdown.map((loc) => {
                const locationNotes = loc.notes.map((note) => note.trim()).filter((note) => note.length > 0);
                const locationNotePreview = locationNotes.join(' • ');
                const locationNoteKey = `${item.key}-loc-${loc.locationId}-note`;
                const locationNoteExpanded = expandedNotes.has(locationNoteKey);
                const locationNoteCanExpand = locationNotePreview.length > 90 || locationNotes.length > 1;

                return (
                  <View key={`${item.key}-${loc.locationId}`} className="py-1.5">
                    <View className="flex-row items-center">
                      <View className="w-6 h-6 bg-primary-100 rounded-full items-center justify-center mr-2">
                        <Text className="text-xs font-bold text-primary-700">{loc.shortCode}</Text>
                      </View>
                      <View className="flex-1">
                        <Text className="text-xs text-gray-600">{loc.locationName}</Text>
                        {item.isRemainingMode && (
                          <Text className="text-[11px] text-amber-700">
                            Reported {loc.remainingReported} {unitLabel}
                          </Text>
                        )}
                      </View>
                      <Text className="text-xs font-medium text-gray-700">
                        {item.isRemainingMode ? `${loc.remainingReported}` : `${loc.quantity}`}
                      </Text>
                    </View>

                    {locationNotes.length > 0 && (
                      <View className="ml-8 mt-1 rounded-md bg-blue-50 border border-blue-100 px-2 py-1.5">
                        <Text
                          className="text-[11px] leading-4 text-blue-800"
                          numberOfLines={locationNoteExpanded ? undefined : 2}
                        >
                          {locationNotePreview}
                        </Text>
                        {locationNoteCanExpand && (
                          <TouchableOpacity
                            onPress={() => toggleNoteExpansion(locationNoteKey)}
                            className="mt-1 self-start"
                          >
                            <Text className="text-[11px] font-semibold text-blue-700">
                              {locationNoteExpanded ? 'Show less' : 'Show more'}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </View>
      );
    },
    [expandedNotes, getDisplayQuantity, handleItemOverflowMenu, handleQuantityChange, toggleNoteExpansion]
  );

  const renderSupplierSection = useCallback(
    (supplierGroup: SupplierGroup) => {
      const isExpanded = expandedSuppliers.has(supplierGroup.supplierId);
      const colorScheme = supplierGroup.supplierType
        ? SUPPLIER_COLORS[supplierGroup.supplierType]
        : DEFAULT_SUPPLIER_COLOR;
      const emoji = supplierGroup.supplierType ? SUPPLIER_EMOJI[supplierGroup.supplierType] : '🏪';
      const label = supplierGroup.supplierName;
      const statusLabel = supplierGroup.isInactive ? 'Inactive' : supplierGroup.isUnknown ? 'Unknown' : null;
      const locationItems = buildLocationGroupedItems(supplierGroup);
      const supplierItemCount = new Set(
        locationItems.map((item) => item.inventoryItem.id)
      ).size;
      const supplierRemainingCount = new Set(
        locationItems
          .filter((item) => item.isRemainingMode)
          .map((item) => item.inventoryItem.id)
      ).size;
      const sections = [
        { group: 'sushi' as LocationGroup, items: locationItems.filter((item) => item.locationGroup === 'sushi') },
        { group: 'poki' as LocationGroup, items: locationItems.filter((item) => item.locationGroup === 'poki') },
      ].filter((section) => section.items.length > 0);

      return (
        <View key={supplierGroup.supplierId} className="mb-4">
          <TouchableOpacity
            className={`p-4 rounded-xl ${colorScheme.bg} border ${colorScheme.border}`}
            onPress={() => toggleSupplier(supplierGroup.supplierId)}
            activeOpacity={0.7}
          >
            {useStackedSupplierActions ? (
              <View>
                <View className="flex-row items-center">
                  <Text className="text-2xl mr-3">{emoji}</Text>
                  <View className="flex-1 min-w-0">
                    <View className="flex-row items-center">
                      <Text className={`font-bold text-base ${colorScheme.text}`} numberOfLines={1}>
                        {label}
                      </Text>
                      {statusLabel && (
                        <View className="ml-2 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5">
                          <Text className="text-[10px] font-semibold text-amber-800">{statusLabel}</Text>
                        </View>
                      )}
                    </View>
                    <Text className="text-sm text-gray-500">
                      {supplierItemCount} item{supplierItemCount !== 1 ? 's' : ''} • {supplierRemainingCount} remaining
                    </Text>
                  </View>
                </View>

                <View className="mt-3 flex-row items-center">
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={colors.gray[500]}
                  />

                  <TouchableOpacity
                    onPress={(e) => {
                      e.stopPropagation();
                      handleSend(supplierGroup);
                    }}
                    className="ml-3 flex-1 bg-primary-500 rounded-xl border border-primary-600 flex-row items-center justify-center"
                    style={{ minHeight: 46, paddingHorizontal: 14, paddingVertical: 8 }}
                  >
                    <Ionicons name="paper-plane-outline" size={14} color="white" />
                    <Text className="text-sm font-bold text-white ml-1.5">Order</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center flex-1 min-w-0">
                  <Text className="text-2xl mr-3">{emoji}</Text>
                  <View className="flex-1 min-w-0">
                    <View className="flex-row items-center">
                      <Text className={`font-bold text-base ${colorScheme.text}`} numberOfLines={1}>
                        {label}
                      </Text>
                      {statusLabel && (
                        <View className="ml-2 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5">
                          <Text className="text-[10px] font-semibold text-amber-800">{statusLabel}</Text>
                        </View>
                      )}
                    </View>
                    <Text className="text-sm text-gray-500">
                      {supplierItemCount} item{supplierItemCount !== 1 ? 's' : ''} • {supplierRemainingCount} remaining
                    </Text>
                  </View>
                </View>

                <View className="flex-row items-center ml-3">
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={colors.gray[500]}
                  />

                  <TouchableOpacity
                    onPress={(e) => {
                      e.stopPropagation();
                      handleSend(supplierGroup);
                    }}
                    className="ml-3 px-4 py-2.5 bg-primary-500 rounded-xl border border-primary-600 flex-row items-center"
                  >
                    <Ionicons name="paper-plane-outline" size={14} color="white" />
                    <Text className="text-sm font-bold text-white ml-1.5">Order</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </TouchableOpacity>

          {isExpanded && (
            <View className="mt-3">
              {sections.map((section) => {
                const sectionKey = `${supplierGroup.supplierId}-${section.group}`;
                const sectionExpanded = expandedLocationSections.has(sectionKey);
                const locationLabel = LOCATION_GROUP_LABELS[section.group];
                const sectionInitial = locationLabel.charAt(0);
                const sortedItems = [...section.items].sort((a, b) =>
                  a.inventoryItem.name.localeCompare(b.inventoryItem.name)
                );
                const remainingItems = sortedItems.filter((item) => item.isRemainingMode);
                const regularItems = sortedItems.filter((item) => !item.isRemainingMode);
                const remainingCards = groupLocationItemsIntoCards(remainingItems);
                const regularCards = groupLocationItemsIntoCards(regularItems);
                const sectionItemCount = remainingCards.length + regularCards.length;

                return (
                  <View key={sectionKey} className="mb-3">
                    <TouchableOpacity
                      onPress={() => toggleLocationSection(sectionKey)}
                      className={`bg-white px-4 py-3 border border-gray-200 ${
                        sectionExpanded ? 'rounded-t-xl' : 'rounded-xl'
                      }`}
                      activeOpacity={0.7}
                    >
                      <View className="flex-row items-center justify-between">
                        <View className="flex-row items-center">
                          <View className="bg-primary-500 w-9 h-9 rounded-full items-center justify-center mr-3">
                            <Text className="text-white font-bold">{sectionInitial}</Text>
                          </View>
                          <View>
                            <Text className="text-base font-semibold text-gray-900">{locationLabel}</Text>
                            <Text className="text-sm text-gray-500">
                              {sectionItemCount} item{sectionItemCount !== 1 ? 's' : ''} • {remainingCards.length} remaining
                            </Text>
                          </View>
                        </View>
                        <Ionicons
                          name={sectionExpanded ? 'chevron-up' : 'chevron-down'}
                          size={18}
                          color={colors.gray[500]}
                        />
                      </View>
                    </TouchableOpacity>

                    {sectionExpanded && (
                      <View className="bg-white px-4 border border-gray-200 border-t-0 rounded-b-xl overflow-hidden">
                        {remainingCards.length > 0 && (
                          <View className="pt-3">
                            <View className="mx-2 mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 flex-row items-center justify-between">
                              <View className="flex-row items-center">
                                <Ionicons name="alert-circle-outline" size={14} color="#B45309" />
                                <Text className="ml-2 text-xs font-semibold text-amber-800">Remaining Items</Text>
                              </View>
                              <Text className="text-xs font-semibold text-amber-800">{remainingCards.length}</Text>
                            </View>
                            <View className="rounded-lg overflow-hidden border border-amber-100">
                              {remainingCards.map((card, cardIndex) => (
                                <View
                                  key={`remaining-card-${card.key}`}
                                  className={cardIndex < remainingCards.length - 1 ? 'border-b border-amber-100' : ''}
                                >
                                  <View className="px-3 py-2 bg-amber-50 border-b border-amber-100 flex-row items-center justify-between">
                                    <Text className="text-xs font-semibold text-amber-900 flex-1 pr-2" numberOfLines={1}>
                                      {card.name}
                                    </Text>
                                    {card.rows.length > 1 && (
                                      <View className="rounded-full bg-amber-100 px-2 py-1 border border-amber-200">
                                        <Text className="text-[10px] font-semibold text-amber-800">
                                          {card.rows.length} units
                                        </Text>
                                      </View>
                                    )}
                                  </View>
                                  {card.rows.map((item) => renderItem(item, true))}
                                </View>
                              ))}
                            </View>
                          </View>
                        )}

                        {regularCards.length > 0 && (
                          <View className="pt-3 pb-3">
                            <View className="mx-2 mb-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 flex-row items-center justify-between">
                              <Text className="text-xs font-semibold text-gray-700">Regular Items</Text>
                              <Text className="text-xs font-semibold text-gray-700">{regularCards.length}</Text>
                            </View>
                            <View className="rounded-lg overflow-hidden border border-gray-100">
                              {regularCards.map((card, cardIndex) => (
                                <View
                                  key={`regular-card-${card.key}`}
                                  className={cardIndex < regularCards.length - 1 ? 'border-b border-gray-100' : ''}
                                >
                                  <View className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex-row items-center justify-between">
                                    <Text className="text-xs font-semibold text-gray-800 flex-1 pr-2" numberOfLines={1}>
                                      {card.name}
                                    </Text>
                                    {card.rows.length > 1 && (
                                      <View className="rounded-full bg-primary-100 px-2 py-1 border border-primary-200">
                                        <Text className="text-[10px] font-semibold text-primary-700">
                                          {card.rows.length} units
                                        </Text>
                                      </View>
                                    )}
                                  </View>
                                  {card.rows.map((item) => renderItem(item, true))}
                                </View>
                              ))}
                            </View>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </View>
      );
    },
    [
      buildLocationGroupedItems,
      expandedLocationSections,
      expandedSuppliers,
      groupLocationItemsIntoCards,
      handleSend,
      renderItem,
      toggleLocationSection,
      toggleSupplier,
      useStackedSupplierActions,
    ]
  );

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      <ManagerScaleContainer>
        <View className="bg-white px-4 py-3 border-b border-gray-100 flex-row items-center">
          <View className="flex-row items-center flex-1">
            <Text className="text-[22px] font-bold text-gray-900">Fulfillment</Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/(manager)/past-orders')}
            className="flex-row items-center bg-gray-100 rounded-full px-4"
            style={{ minHeight: 44 }}
            activeOpacity={0.7}
          >
            <Ionicons name="time-outline" size={16} color={colors.gray[700]} />
            <Text className="ml-2 text-sm font-semibold text-gray-700">Past Orders</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F97316" />
          }
        >
          <View className="bg-white rounded-2xl border border-gray-100 mb-4 overflow-hidden">
            <TouchableOpacity
              onPress={() => setOrderLaterExpanded((prev) => !prev)}
              className="px-4 py-3 flex-row items-center justify-between"
            >
              <View className="flex-row items-center">
                <Ionicons name="time-outline" size={16} color={colors.gray[700]} />
                <Text className="text-base font-semibold text-gray-900 ml-2">Order Later</Text>
              </View>
              <View className="flex-row items-center">
                <View className="px-2 py-1 rounded-full bg-gray-100 mr-2">
                  <Text className="text-[11px] font-semibold text-gray-700">
                    {orderLaterQueue.length} item{orderLaterQueue.length === 1 ? '' : 's'}
                  </Text>
                </View>
                <Text className="text-xs font-semibold text-primary-600 mr-1">
                  {orderLaterExpanded ? 'Hide' : 'View'}
                </Text>
                <Ionicons
                  name={orderLaterExpanded ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.gray[500]}
                />
              </View>
            </TouchableOpacity>

            {orderLaterExpanded && (
              <View className="px-4 pb-4 border-t border-gray-100">
                {orderLaterQueue.length === 0 ? (
                  <View className="py-4 items-center">
                    <Text className="text-sm text-gray-500">No queued order-later items.</Text>
                  </View>
                ) : (
                  orderLaterQueue.map((item, index) => (
                    <View
                      key={item.id}
                      className={`py-3 ${index < orderLaterQueue.length - 1 ? 'border-b border-gray-100' : ''}`}
                    >
                      <Text className="text-sm font-semibold text-gray-900">{item.itemName}</Text>
                      <Text className="text-xs text-gray-500 mt-1">
                        {item.locationName || 'Unassigned location'} • {item.unit}
                      </Text>
                      {item.notes && (
                        <Text className="text-xs text-blue-700 mt-1">Note: {item.notes}</Text>
                      )}
                      <Text className="text-xs text-amber-700 mt-1.5">
                        Order on: {formatScheduleLabel(item.scheduledAt)}
                      </Text>

                      <View className="flex-row flex-wrap mt-3 -mr-2">
                        <TouchableOpacity
                          onPress={() => openAddToModal(item.id)}
                          className="px-3 py-2 rounded-lg bg-primary-500 mr-2 mb-2"
                        >
                          <Text className="text-[11px] font-semibold text-white">Add to...</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setScheduleEditItemId(item.id)}
                          className="px-3 py-2 rounded-lg bg-gray-100 mr-2 mb-2"
                        >
                          <Text className="text-[11px] font-semibold text-gray-700">Edit schedule</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleRemoveOrderLater(item.id, item.itemName)}
                          className="px-3 py-2 rounded-lg bg-red-50 border border-red-100 mr-2 mb-2"
                        >
                          <Text className="text-[11px] font-semibold text-red-600">Remove</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))
                )}
              </View>
            )}
          </View>

          {!dataReady ? (
            <View className="items-center py-16">
              <ActivityIndicator size="large" color={colors.primary[500]} />
              <Text className="text-gray-400 text-center text-sm mt-4">Searching for orders...</Text>
            </View>
          ) : supplierGroups.length === 0 ? (
            <View className="flex-1 items-center justify-center" style={{ minHeight: 400, paddingVertical: 60 }}>
              <Text className="text-gray-700 text-center text-lg font-semibold">No orders to fulfill</Text>
              <Text className="text-gray-400 text-center text-sm mt-2">
                No pending supplier orders right now.
              </Text>
              <TouchableOpacity
                onPress={() => router.push('/(manager)/employee-reminders')}
                className="mt-8 px-7 py-3.5 bg-primary-500 rounded-xl flex-row items-center"
                style={{ shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 }}
              >
                <Ionicons name="megaphone-outline" size={18} color="white" />
                <Text className="text-white font-semibold ml-2 text-base">Remind Employees</Text>
              </TouchableOpacity>
              <Text className="text-gray-300 text-xs mt-4">Pull down to refresh</Text>
            </View>
          ) : (
            supplierGroups.map((group) => renderSupplierSection(group))
          )}
        </ScrollView>

        <ItemActionSheet
          visible={Boolean(overflowItem)}
          title="Item Actions"
          subtitle={overflowItem ? overflowItem.inventoryItem.name : undefined}
          sections={overflowActionSections}
          onClose={() => setOverflowItem(null)}
        />

        <Modal
          visible={Boolean(breakdownItem)}
          transparent
          animationType="fade"
          onRequestClose={() => setBreakdownItem(null)}
        >
          <Pressable className="flex-1 bg-black/35 justify-end" onPress={() => setBreakdownItem(null)}>
            <Pressable
              className="bg-white rounded-t-3xl px-4 pt-4 pb-5"
              onPress={(event) => event.stopPropagation()}
            >
              <View className="flex-row items-center justify-between mb-3">
                <View className="flex-1 pr-2">
                  <Text className="text-lg font-bold text-gray-900">Employee Breakdown</Text>
                  <Text className="text-xs text-gray-500 mt-0.5">
                    {breakdownItem?.inventoryItem.name || ''}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setBreakdownItem(null)} className="p-2">
                  <Ionicons name="close" size={20} color={colors.gray[500]} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
                {breakdownRows.length === 0 ? (
                  <View className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-5 items-center">
                    <Text className="text-sm text-gray-500 text-center">
                      No per-employee details are available for this line.
                    </Text>
                  </View>
                ) : (
                  breakdownRows.map((row, index) => (
                    <View
                      key={`${row.name}-${index}`}
                      className={`py-3 ${
                        index < breakdownRows.length - 1 ? 'border-b border-gray-100' : ''
                      }`}
                    >
                      <View className="flex-row items-center justify-between">
                        <Text className="text-sm font-semibold text-gray-900">{row.name}</Text>
                        <Text className="text-sm font-semibold text-gray-700">
                          {row.quantity} {breakdownItem?.unitType === 'pack'
                            ? breakdownItem?.inventoryItem.pack_unit
                            : breakdownItem?.inventoryItem.base_unit}
                        </Text>
                      </View>
                      {row.locations.length > 0 && (
                        <Text className="text-xs text-gray-500 mt-1">
                          {row.locations.join(' • ')}
                        </Text>
                      )}
                    </View>
                  ))
                )}
              </ScrollView>

              <TouchableOpacity
                onPress={() => setBreakdownItem(null)}
                className="mt-3 py-3 rounded-xl bg-gray-100 items-center"
              >
                <Text className="text-sm font-semibold text-gray-700">Close</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>

        <Modal
          visible={Boolean(noteEditorItem)}
          transparent
          animationType="fade"
          onRequestClose={() => {
            setNoteEditorItem(null);
            setNoteDraft('');
          }}
        >
          <Pressable
            className="flex-1 bg-black/35 justify-end"
            onPress={() => {
              setNoteEditorItem(null);
              setNoteDraft('');
            }}
          >
            <Pressable className="bg-white rounded-t-3xl px-4 pt-4 pb-5" onPress={(event) => event.stopPropagation()}>
              <View className="flex-row items-center justify-between mb-3">
                <View className="flex-1 pr-2">
                  <Text className="text-lg font-bold text-gray-900">
                    {noteEditorItem?.notes.length ? 'Edit Note' : 'Add Note'}
                  </Text>
                  <Text className="text-xs text-gray-500 mt-0.5">
                    {noteEditorItem?.inventoryItem.name || ''}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    setNoteEditorItem(null);
                    setNoteDraft('');
                  }}
                  className="p-2"
                >
                  <Ionicons name="close" size={20} color={colors.gray[500]} />
                </TouchableOpacity>
              </View>

              <TextInput
                value={noteDraft}
                onChangeText={setNoteDraft}
                placeholder="Add supplier note..."
                placeholderTextColor={colors.gray[400]}
                multiline
                maxLength={240}
                textAlignVertical="top"
                className="min-h-[110px] rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-900"
              />
              <Text className="text-xs text-gray-400 mt-2">{noteDraft.length}/240</Text>

              <View className="flex-row mt-4">
                <TouchableOpacity
                  onPress={() => {
                    setNoteEditorItem(null);
                    setNoteDraft('');
                  }}
                  className="flex-1 py-3 rounded-xl bg-gray-100 items-center justify-center mr-2"
                >
                  <Text className="text-sm font-semibold text-gray-700">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSaveItemNote}
                  disabled={isSavingNote}
                  className={`flex-1 py-3 rounded-xl items-center justify-center ${
                    isSavingNote ? 'bg-primary-300' : 'bg-primary-500'
                  }`}
                >
                  <Text className="text-sm font-semibold text-white">
                    {isSavingNote ? 'Saving...' : 'Save Note'}
                  </Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        <OrderLaterAddToSheet
          visible={Boolean(addToTargetItem)}
          itemName={addToTargetItem?.itemName}
          suppliers={addToSupplierOptions}
          selectedSupplierId={addToSupplier || null}
          supplierError={addToSupplierError}
          isSubmitting={isAddingToSupplierDraft}
          onSupplierChange={handleAddToSupplierChange}
          onConfirm={() => { void handleConfirmAddTo(); }}
          onClose={closeAddToModal}
        />

        <OrderLaterScheduleModal
          visible={Boolean(scheduleEditItem)}
          title="Edit Order Later"
          subtitle={
            scheduleEditItem
              ? `Update reminder for ${scheduleEditItem.itemName}.`
              : 'Update order-later reminder.'
          }
          confirmLabel="Save Schedule"
          initialScheduledAt={scheduleEditItem?.scheduledAt}
          onClose={() => setScheduleEditItemId(null)}
          onConfirm={async (scheduledAtIso) => {
            if (!scheduleEditItem) return;
            await updateOrderLaterItemSchedule(scheduleEditItem.id, scheduledAtIso);
            if (Platform.OS !== 'web') {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
            Alert.alert(
              'Schedule Updated',
              `${scheduleEditItem.itemName} will remind on ${formatScheduleLabel(scheduledAtIso)}.`
            );
          }}
        />

        <OrderLaterScheduleModal
          visible={Boolean(orderLaterScheduleItem)}
          title="Move to Order Later"
          subtitle={
            orderLaterScheduleItem
              ? `Schedule a reminder for ${orderLaterScheduleItem.inventoryItem.name}.`
              : 'Schedule an order-later reminder.'
          }
          confirmLabel="Move to Order Later"
          onClose={() => setOrderLaterScheduleItem(null)}
          onConfirm={handleOrderLaterFromFulfillment}
        />
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
