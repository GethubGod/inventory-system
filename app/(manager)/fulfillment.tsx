import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { RealtimeChannel } from '@supabase/supabase-js';
import * as Haptics from 'expo-haptics';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore, useOrderStore } from '@/store';
import { CATEGORY_LABELS, colors } from '@/constants';
import { InventoryItem, ItemCategory, OrderWithDetails, SupplierCategory } from '@/types';
import { supabase } from '@/lib/supabase';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';
import { GlassSurface, ItemActionSheet, LoadingIndicator } from '@/components';
import type { ItemActionSheetSection } from '@/components';
import {
  FulfillmentHeader,
  FulfillmentOrderLaterCard,
  FulfillmentReminderBanner,
  FulfillmentSupplierSectionLabel,
  FulfillmentSupplierCard,
  OrderLaterAddToSheet,
  OrderLaterScheduleModal,
} from '@/features/fulfillment/components';
import type {
  FulfillmentSupplierEmployee,
  FulfillmentSupplierPreviewItem,
  OrderLaterSupplierOption,
} from '@/features/fulfillment/components';
import { listEmployeesWithReminderStatus } from '@/services';
import type { EmployeeReminderOverview } from '@/services';
import { loadSupplierLookup, invalidateSupplierCache } from '@/services/supplierResolver';
import { useManagedRefresh } from '@/hooks/useManagedRefresh';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassSpacing,
  glassTabBarHeight,
} from '@/theme/design';

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

const SUPPLIER_DISPLAY_PRIORITY = new Map<string, number>([
  ['asian markets', 0],
  ['ocean group', 1],
  ['mutual', 2],
  ['restaurant depot', 3],
]);

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

function getInitials(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);

  if (parts.length === 0) return 'NA';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

function getFirstName(name: string) {
  const [first] = name.trim().split(/\s+/);
  return first || name.trim();
}

function formatQuantity(value: number) {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value - Math.round(value)) < 0.000001) {
    return `${Math.round(value)}`;
  }

  const fixed = value.toFixed(2);
  return fixed.replace(/\.?0+$/, '');
}

function animateNextLayout() {
  LayoutAnimation.configureNext({
    duration: 240,
    create: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
    },
    update: {
      type: LayoutAnimation.Types.easeInEaseOut,
    },
    delete: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
    },
  });
}

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface SupplierCardData {
  group: SupplierGroup;
  employees: FulfillmentSupplierEmployee[];
  employeeSummary: string;
  previewItems: LocationGroupedItem[];
  supplierItemCount: number;
  remainingCount: number;
  statusLabel: string | null;
}

export default function FulfillmentScreen() {
  const ds = useScaledStyles();
  const { user, locations } = useAuthStore(useShallow((state) => ({
    user: state.user,
    locations: state.locations,
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
  const [dataReady, setDataReady] = useState(false);
  const [supplierOptions, setSupplierOptions] = useState<SupplierOption[]>([]);
  const [expandedSupplierId, setExpandedSupplierId] = useState<string | null>(null);
  const [reminderOverview, setReminderOverview] = useState<EmployeeReminderOverview | null>(null);
  const [reminderLoadFailed, setReminderLoadFailed] = useState(false);
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
  const hasLoadedOnceRef = useRef(false);
  const sendTapLockUntilRef = useRef(0);
  const actionLocksRef = useRef<Set<string>>(new Set());
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

  const fetchReminderOverview = useCallback(async () => {
    try {
      const overview = await listEmployeesWithReminderStatus();
      const scopedEmployees =
        managerLocationIds.length === 0
          ? overview.employees
          : overview.employees.filter((row) => {
              if (!row.locationId) return true;
              return managerLocationIds.includes(row.locationId);
            });

      const activeEmployees = scopedEmployees.filter((row) => !row.isSuspended);
      const pendingEmployees = activeEmployees.filter((row) => row.status !== 'ok');

      setReminderOverview({
        ...overview,
        employees: activeEmployees,
        stats: {
          pendingReminders: pendingEmployees.length,
          overdueEmployees: activeEmployees.filter((row) => row.status === 'overdue').length,
          notificationsOff: activeEmployees.filter((row) => row.notificationsOff).length,
        },
      });
      setReminderLoadFailed(false);
    } catch (error) {
      console.warn('[Fulfillment] Unable to load reminder overview.', error);
      setReminderLoadFailed(true);
      setReminderOverview(null);
    }
  }, [managerLocationIds]);

  const runRefreshCycle = useCallback(async () => {
    try {
      // loadFulfillmentData syncs past-order queue, then fetchPendingFulfillmentOrders
      // re-fetches submitted orders and filters out consumed items.
      // Run them sequentially so past orders are synced before the filter runs.
      if (user?.id) {
        await loadFulfillmentData(user.id, managerLocationIds);
      }
      await Promise.all([fetchPendingOrders(), fetchSuppliers(), fetchReminderOverview()]);
    } catch (error) {
      console.error('Error refreshing fulfillment data:', error);
    } finally {
      hasLoadedOnceRef.current = true;
      setDataReady(true);
    }
  }, [
    fetchPendingOrders,
    fetchReminderOverview,
    fetchSuppliers,
    loadFulfillmentData,
    managerLocationIds,
    user?.id,
  ]);
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
      if (!hasLoadedOnceRef.current) {
        setDataReady(false);
      }
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
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reminders' },
        scheduleRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reminder_events' },
        scheduleRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
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

  const { refreshing, onRefresh } = useManagedRefresh(refreshAll);

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

        const aName = resolveSupplierName(a);
        const bName = resolveSupplierName(b);
        const aPriority = SUPPLIER_DISPLAY_PRIORITY.get(normalizeSupplierNameKey(aName));
        const bPriority = SUPPLIER_DISPLAY_PRIORITY.get(normalizeSupplierNameKey(bName));

        if (aPriority != null || bPriority != null) {
          if (aPriority == null) return 1;
          if (bPriority == null) return -1;
          if (aPriority !== bPriority) return aPriority - bPriority;
        }

        const aType = resolveSupplierType(a);
        const bType = resolveSupplierType(b);
        const typeOrder = (value: SupplierCategory | null) => {
          if (value === 'asian_market') return 0;
          if (value === 'fish_supplier') return 1;
          if (value === 'main_distributor') return 2;
          return 3;
        };
        const typeDiff = typeOrder(aType) - typeOrder(bType);
        if (typeDiff !== 0) return typeDiff;

        return aName.localeCompare(bName);
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

  const buildSupplierPreviewItems = useCallback((supplierGroup: SupplierGroup) => {
    const previewItems: LocationGroupedItem[] = [];

    supplierGroup.categoryGroups.forEach((categoryGroup) => {
      categoryGroup.items.forEach((item) => {
        const dominantGroupTotals = item.locationBreakdown.reduce(
          (totals, location) => {
            const group = getLocationGroup(location.locationName, location.shortCode);
            const weight = Math.max(location.quantity, location.remainingReported, 1);
            totals[group] += weight;
            return totals;
          },
          { sushi: 0, poki: 0 }
        );

        previewItems.push({
          key: `preview-${item.aggregateKey}`,
          aggregateKey: item.aggregateKey,
          effectiveSupplierId: item.effectiveSupplierId,
          locationGroup: dominantGroupTotals.poki > dominantGroupTotals.sushi ? 'poki' : 'sushi',
          inventoryItem: item.inventoryItem,
          totalQuantity: item.totalQuantity,
          unitType: item.unitType,
          isRemainingMode: item.isRemainingMode,
          remainingReportedTotal: item.remainingReportedTotal,
          notes: item.notes,
          locationBreakdown: [...item.locationBreakdown].sort((a, b) =>
            a.locationName.localeCompare(b.locationName)
          ),
          sourceOrderItemIds: item.sourceOrderItemIds,
          sourceOrderIds: item.sourceOrderIds,
          secondarySupplierName: item.secondarySupplierName,
          secondarySupplierId: item.secondarySupplierId,
          isOverridden: item.isOverridden,
          primarySupplierId: item.primarySupplierId,
        });
      });
    });

    getSupplierDraftItems(supplierGroup.supplierId).forEach((draftItem) => {
      const shortCode =
        typeof draftItem.locationName === 'string' && draftItem.locationName.trim().length > 0
          ? draftItem.locationName.trim().slice(0, 2).toUpperCase()
          : draftItem.locationGroup === 'poki'
            ? 'P'
            : 'S';

      previewItems.push({
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

    return previewItems.sort((a, b) => {
      if (a.isRemainingMode !== b.isRemainingMode) return a.isRemainingMode ? -1 : 1;
      if (a.inventoryItem.name !== b.inventoryItem.name) {
        return a.inventoryItem.name.localeCompare(b.inventoryItem.name);
      }
      return a.unitType.localeCompare(b.unitType);
    });
  }, [getSupplierDraftItems]);

  const getItemPeopleNames = useCallback(
    (item: LocationGroupedItem, options?: { includeOrderLater?: boolean }) => {
      const people = new Map<string, string>();

      item.locationBreakdown.forEach((location) => {
        location.orderedBy.forEach((person) => {
          const normalized = person.trim();
          if (!normalized) return;
          if (!options?.includeOrderLater && normalized.toLowerCase() === 'order later') return;
          const key = normalized.toLowerCase();
          if (!people.has(key)) {
            people.set(key, normalized);
          }
        });
      });

      return Array.from(people.values()).sort((a, b) => a.localeCompare(b));
    },
    []
  );

  const supplierCardData = useMemo<SupplierCardData[]>(() => {
    return supplierGroups.map((group) => {
      const previewItems = buildSupplierPreviewItems(group);
      const peopleById = new Map<string, FulfillmentSupplierEmployee>();

      previewItems.forEach((item) => {
        const uniquePeople = getItemPeopleNames(item);
        uniquePeople.forEach((person) => {
          const id = person.toLowerCase();
          const existing = peopleById.get(id);
          if (existing) {
            existing.count += 1;
            return;
          }
          peopleById.set(id, {
            id,
            name: person,
            initials: getInitials(person),
            count: 1,
          });
        });
      });

      const employees = Array.from(peopleById.values()).sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.name.localeCompare(b.name);
      });

      const employeeSummary =
        employees.length === 0
          ? previewItems.every((item) => item.sourceOrderItemIds.length === 0)
            ? 'Order Later draft'
            : 'No employee assignments'
          : `${employees
              .slice(0, 2)
              .map((employee) =>
                employee.count > 1
                  ? `${getFirstName(employee.name)} (${employee.count})`
                  : getFirstName(employee.name)
              )
              .join(', ')}${employees.length > 2 ? ` +${employees.length - 2} more` : ''}`;

      return {
        group,
        employees,
        employeeSummary,
        previewItems,
        supplierItemCount: previewItems.length,
        remainingCount: previewItems.filter((item) => item.isRemainingMode).length,
        statusLabel: group.isInactive ? 'Inactive' : null,
      };
    });
  }, [buildSupplierPreviewItems, getItemPeopleNames, supplierGroups]);

  useEffect(() => {
    if (!expandedSupplierId) return;
    if (supplierCardData.some((entry) => entry.group.supplierId === expandedSupplierId)) return;
    setExpandedSupplierId(null);
  }, [expandedSupplierId, supplierCardData]);

  const toggleSupplier = useCallback((supplierId: string) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    animateNextLayout();
    setExpandedSupplierId((current) => (current === supplierId ? null : supplierId));
  }, []);

  const buildRegularConfirmationItems = useCallback(
    (supplierGroup: SupplierGroup) => {
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
          const quantity = Math.max(0, entry.rawQuantity);

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

      return buildSupplierPreviewItems(supplierGroup).filter((row) => {
        if (row.key === item.key) return false;
        if (row.inventoryItem.id !== item.inventoryItem.id) return false;
        return row.unitType !== item.unitType;
      });
    },
    [buildSupplierPreviewItems, supplierGroups]
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
        quantity: Math.max(0, item.isRemainingMode ? item.remainingReportedTotal : item.totalQuantity),
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
      markOrderItemsStatus,
      managerLocationIds,
      orderLaterScheduleItem,
      removeOrderLaterItem,
      user?.id,
    ]
  );

  const reminderBanner = useMemo(() => {
    if (!reminderOverview && !reminderLoadFailed) {
      return {
        tone: 'neutral' as const,
        title: 'Checking employee reminders',
        subtitle: 'We are syncing who still needs a nudge.',
      };
    }

    if (reminderLoadFailed) {
      return {
        tone: 'neutral' as const,
        title: 'Employee reminders unavailable',
        subtitle: 'Open reminders to retry and review the latest status.',
      };
    }

    const pendingEmployees = (reminderOverview?.employees ?? []).filter((row) => row.status !== 'ok');
    if (pendingEmployees.length === 0) {
      return {
        tone: 'neutral' as const,
        title: 'No employees need a reminder',
        subtitle: 'Everyone has ordered on schedule.',
      };
    }

    const names = pendingEmployees.slice(0, 3).map((row) => getFirstName(row.name));
    const reminderSuffix = pendingEmployees.some((row) => row.activeReminder)
      ? 'reminder already active'
      : 'usually order by Tuesday';
    const nameSummary =
      names.length > 0
        ? `${names.join(', ')}${pendingEmployees.length > 3 ? ` +${pendingEmployees.length - 3}` : ''}`
        : 'Tap to review reminders';

    return {
      tone: 'warning' as const,
      title: `${pendingEmployees.length} employee${pendingEmployees.length === 1 ? '' : 's'} haven't ordered`,
      subtitle: `${nameSummary} - ${reminderSuffix}`,
    };
  }, [reminderLoadFailed, reminderOverview]);

  const buildSupplierPreviewProps = useCallback(
    (item: LocationGroupedItem): FulfillmentSupplierPreviewItem => {
      const people = getItemPeopleNames(item, { includeOrderLater: true });
      const unitLabel = item.unitType === 'pack' ? item.inventoryItem.pack_unit : item.inventoryItem.base_unit;
      const quantityValue = item.isRemainingMode ? item.remainingReportedTotal : item.totalQuantity;
      const hasMenuActions =
        item.sourceOrderItemIds.length > 0 ||
        (item.secondarySupplierId && !item.isOverridden) ||
        item.isOverridden;

      return {
        id: item.key,
        name: item.inventoryItem.name,
        quantityLabel: `${formatQuantity(quantityValue)} ${unitLabel}`,
        summaryLabel:
          people.length > 0
            ? `${people
                .slice(0, 2)
                .map((person) => (person === 'Order Later' ? person : getFirstName(person)))
                .join(', ')}${people.length > 2 ? ` +${people.length - 2}` : ''}`
            : item.locationBreakdown.length > 1
              ? item.locationBreakdown
                  .slice(0, 2)
                  .map((location) => location.shortCode)
                  .join(' • ')
              : null,
        badgeToneIndex: (people[0] || item.locationBreakdown[0]?.shortCode || item.key)
          .split('')
          .reduce((total, character) => total + character.charCodeAt(0), 0),
        badgeLabel: people[0] ? getInitials(people[0]) : item.sourceOrderItemIds.length === 0 ? 'OL' : null,
        badgeOverflowCount: Math.max(0, people.length - 1),
        isRemaining: item.isRemainingMode,
        onPress: hasMenuActions ? () => handleItemOverflowMenu(item) : null,
      };
    },
    [getItemPeopleNames, handleItemOverflowMenu]
  );

  const toggleOrderLater = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    animateNextLayout();
    setOrderLaterExpanded((current) => !current);
  }, []);

  const showInitialLoading = !dataReady && supplierCardData.length === 0 && orderLaterQueue.length === 0;

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: glassColors.background }}
      edges={['top', 'left', 'right']}
    >
      <ManagerScaleContainer>
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: glassSpacing.screen,
            paddingTop: ds.spacing(12),
            paddingBottom: glassTabBarHeight + ds.spacing(20),
          }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[500]} />
          }
        >
          <FulfillmentHeader onHistoryPress={() => router.push('/(manager)/fulfillment-history')} />

          <FulfillmentReminderBanner
            title={reminderBanner.title}
            subtitle={reminderBanner.subtitle}
            tone={reminderBanner.tone}
            onPress={() => router.push('/(manager)/employee-reminders')}
          />

          <FulfillmentSupplierSectionLabel readyCount={supplierCardData.length} />

          {showInitialLoading ? (
            <View
              style={{
                minHeight: 180,
                alignItems: 'center',
                justifyContent: 'center',
                paddingVertical: ds.spacing(20),
              }}
            >
              <LoadingIndicator size="small" color={glassColors.accent} />
              <Text
                style={{
                  marginTop: ds.spacing(10),
                  color: glassColors.textSecondary,
                  fontSize: ds.fontSize(13),
                  fontWeight: '600',
                }}
              >
                Loading suppliers...
              </Text>
            </View>
          ) : supplierCardData.length === 0 ? (
            <GlassSurface intensity="subtle" style={{ borderRadius: glassRadii.surface }}>
              <View
                style={{
                  paddingHorizontal: ds.spacing(18),
                  paddingVertical: ds.spacing(24),
                }}
              >
                <Text
                  style={{
                    color: glassColors.textPrimary,
                    fontSize: ds.fontSize(18),
                    fontWeight: '700',
                  }}
                >
                  Nothing to display
                </Text>
                <Text
                  style={{
                    color: glassColors.textSecondary,
                    fontSize: ds.fontSize(14),
                    lineHeight: ds.fontSize(20),
                    marginTop: ds.spacing(6),
                  }}
                >
                  Nothing to display right now. Submitted orders and supplier drafts will appear here
                  once they are ready to review.
                </Text>
              </View>
            </GlassSurface>
          ) : (
            supplierCardData.map((entry) => (
              <View key={entry.group.supplierId} style={{ marginBottom: ds.spacing(10) }}>
                <FulfillmentSupplierCard
                  name={entry.group.supplierName}
                  statusLabel={entry.statusLabel}
                  employees={entry.employees}
                  employeeSummary={entry.employeeSummary}
                  summaryStats={`${entry.supplierItemCount} item${entry.supplierItemCount === 1 ? '' : 's'} • ${entry.remainingCount} remaining`}
                  items={entry.previewItems.map(buildSupplierPreviewProps)}
                  isExpanded={expandedSupplierId === entry.group.supplierId}
                  orderLabel={`Order ${entry.supplierItemCount} item${entry.supplierItemCount === 1 ? '' : 's'}`}
                  onToggle={() => toggleSupplier(entry.group.supplierId)}
                  onOrderPress={() => handleSend(entry.group)}
                />
              </View>
            ))
          )}

          <View style={{ marginTop: ds.spacing(6) }}>
            <FulfillmentOrderLaterCard
              count={orderLaterQueue.length}
              expanded={orderLaterExpanded}
              onToggle={toggleOrderLater}
              disabled={orderLaterQueue.length === 0}
            >
              {orderLaterQueue.length > 0 ? (
                orderLaterQueue.map((item, index) => (
                  <View
                    key={item.id}
                    style={{
                      paddingTop: ds.spacing(12),
                      paddingBottom: ds.spacing(12),
                      borderBottomWidth: index < orderLaterQueue.length - 1 ? glassHairlineWidth : 0,
                      borderBottomColor: glassColors.divider,
                    }}
                  >
                    <Text
                      style={{
                        color: glassColors.textPrimary,
                        fontSize: ds.fontSize(15),
                        fontWeight: '700',
                      }}
                    >
                      {item.itemName}
                    </Text>
                    <Text
                      style={{
                        color: glassColors.textSecondary,
                        fontSize: ds.fontSize(12),
                        marginTop: ds.spacing(4),
                      }}
                    >
                      {item.locationName || 'Unassigned location'} • {item.unit}
                    </Text>
                    {item.notes ? (
                      <Text
                        style={{
                          color: glassColors.infoText,
                          fontSize: ds.fontSize(12),
                          marginTop: ds.spacing(4),
                        }}
                      >
                        Note: {item.notes}
                      </Text>
                    ) : null}
                    <Text
                      style={{
                        color: glassColors.warningText,
                        fontSize: ds.fontSize(12),
                        marginTop: ds.spacing(6),
                      }}
                    >
                      Order on {formatScheduleLabel(item.scheduledAt)}
                    </Text>

                    <View
                      style={{
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        marginTop: ds.spacing(12),
                      }}
                    >
                      <TouchableOpacity
                        onPress={() => openAddToModal(item.id)}
                        activeOpacity={0.86}
                        style={{
                          backgroundColor: colors.primary[500],
                          borderRadius: glassRadii.button,
                          paddingHorizontal: ds.spacing(12),
                          paddingVertical: ds.spacing(9),
                          marginRight: ds.spacing(8),
                          marginBottom: ds.spacing(8),
                        }}
                      >
                        <Text
                          style={{
                            color: glassColors.textOnPrimary,
                            fontSize: ds.fontSize(12),
                            fontWeight: '700',
                          }}
                        >
                          Add to...
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => setScheduleEditItemId(item.id)}
                        activeOpacity={0.86}
                        style={{
                          backgroundColor: glassColors.mediumFill,
                          borderRadius: glassRadii.button,
                          paddingHorizontal: ds.spacing(12),
                          paddingVertical: ds.spacing(9),
                          marginRight: ds.spacing(8),
                          marginBottom: ds.spacing(8),
                        }}
                      >
                        <Text
                          style={{
                            color: glassColors.textPrimary,
                            fontSize: ds.fontSize(12),
                            fontWeight: '700',
                          }}
                        >
                          Edit schedule
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => handleRemoveOrderLater(item.id, item.itemName)}
                        activeOpacity={0.86}
                        style={{
                          backgroundColor: '#FFF1EE',
                          borderWidth: glassHairlineWidth,
                          borderColor: glassColors.accentBorder,
                          borderRadius: glassRadii.button,
                          paddingHorizontal: ds.spacing(12),
                          paddingVertical: ds.spacing(9),
                          marginBottom: ds.spacing(8),
                        }}
                      >
                        <Text
                          style={{
                            color: glassColors.accent,
                            fontSize: ds.fontSize(12),
                            fontWeight: '700',
                          }}
                        >
                          Remove
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              ) : null}
            </FulfillmentOrderLaterCard>
          </View>
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
