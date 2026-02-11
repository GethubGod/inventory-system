import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { useAuthStore, useDisplayStore, useOrderStore } from '@/store';
import { CATEGORY_LABELS, colors, SUPPLIER_CATEGORY_LABELS } from '@/constants';
import { InventoryItem, ItemCategory, OrderWithDetails, SupplierCategory } from '@/types';
import { supabase } from '@/lib/supabase';
import { BrandLogo } from '@/components/BrandLogo';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';
import { OrderLaterScheduleModal } from '@/components/OrderLaterScheduleModal';

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
  inventoryItem: InventoryItem;
  totalQuantity: number;
  unitType: 'base' | 'pack';
  isRemainingMode: boolean;
  remainingReportedTotal: number;
  notes: string[];
  locationBreakdown: AggregatedLocationBreakdown[];
}

interface CategoryGroup {
  category: ItemCategory;
  items: AggregatedItem[];
}

interface SupplierGroup {
  supplierCategory: SupplierCategory;
  categoryGroups: CategoryGroup[];
  totalItems: number;
}

type LocationGroup = 'sushi' | 'poki';

interface LocationGroupedItem {
  key: string;
  aggregateKey: string;
  locationGroup: LocationGroup;
  inventoryItem: InventoryItem;
  totalQuantity: number;
  unitType: 'base' | 'pack';
  isRemainingMode: boolean;
  remainingReportedTotal: number;
  notes: string[];
  locationBreakdown: AggregatedLocationBreakdown[];
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
  contributors: Array<{
    userId: string | null;
    name: string;
    quantity: number;
  }>;
  notes: Array<{
    id: string;
    author: string;
    text: string;
    locationName: string;
    shortCode: string;
  }>;
  details: Array<{
    locationId: string;
    locationName: string;
    orderedBy: string;
    quantity: number;
    shortCode: string;
  }>;
}

interface AddLocationOption {
  id: string | null;
  name: string;
  shortCode: string;
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
}

const LOCATION_GROUP_LABELS: Record<LocationGroup, string> = {
  sushi: 'Sushi',
  poki: 'Poki',
};

const SUPPLIER_ORDER: SupplierCategory[] = ['fish_supplier', 'main_distributor', 'asian_market'];
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

export default function FulfillmentScreen() {
  const { user, locations } = useAuthStore();
  const { uiScale, buttonSize, textScale } = useDisplayStore((state) => ({
    uiScale: state.uiScale,
    buttonSize: state.buttonSize,
    textScale: state.textScale,
  }));
  const {
    orders,
    orderLaterQueue,
    getSupplierDraftItems,
    loadFulfillmentData,
    fetchPendingFulfillmentOrders,
    moveOrderLaterItemToSupplierDraft,
    removeOrderLaterItem,
    updateOrderLaterItemSchedule,
  } = useOrderStore();
  const [refreshing, setRefreshing] = useState(false);
  const [expandedSuppliers, setExpandedSuppliers] = useState<Set<SupplierCategory>>(new Set());
  const [expandedLocationSections, setExpandedLocationSections] = useState<Set<string>>(new Set());
  const [editedQuantities, setEditedQuantities] = useState<Record<string, number>>({});
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [orderLaterExpanded, setOrderLaterExpanded] = useState(false);
  const [addToTargetItemId, setAddToTargetItemId] = useState<string | null>(null);
  const [addToSupplier, setAddToSupplier] = useState<SupplierCategory>('fish_supplier');
  const [addToLocationGroup, setAddToLocationGroup] = useState<LocationGroup>('sushi');
  const [addToLocationId, setAddToLocationId] = useState<string | null>(null);
  const [scheduleEditItemId, setScheduleEditItemId] = useState<string | null>(null);
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const useStackedSupplierActions =
    uiScale === 'large' || buttonSize === 'large' || textScale >= 1.1;
  const useCompactHeaderActions = uiScale === 'large' || textScale >= 1.1;

  const fetchPendingOrders = useCallback(async () => {
    try {
      await fetchPendingFulfillmentOrders();
    } catch (error) {
      console.error('Error fetching orders:', error);
    }
  }, [fetchPendingFulfillmentOrders]);

  const refreshAll = useCallback(async () => {
    try {
      if (user?.id) {
        await loadFulfillmentData(user.id);
      }
      await fetchPendingOrders();
    } catch (error) {
      console.error('Error refreshing fulfillment data:', error);
    }
  }, [fetchPendingOrders, loadFulfillmentData, user?.id]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useFocusEffect(
    useCallback(() => {
      void refreshAll();
    }, [refreshAll])
  );

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
        void fetchPendingOrders();
      }, 250);
    };

    const channel = supabase
      .channel('manager-fulfillment-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        scheduleRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_items' },
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
  }, [fetchPendingOrders]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshAll();
    setRefreshing(false);
  }, [refreshAll]);

  const pendingOrders = useMemo(() => {
    return (orders as OrderWithDetails[]).filter((order) => order.status === 'submitted');
  }, [orders]);

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
        const aggregateKey = [
          item.id,
          item.name.trim().toLowerCase(),
          item.supplier_category,
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

        itemMap.set(aggregateKey, {
          aggregateKey,
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
        });
      });
    });

    const supplierMap = new Map<SupplierCategory, Map<ItemCategory, AggregatedItem[]>>();

    Array.from(itemMap.values()).forEach((aggregatedItem) => {
      const supplierCategory = aggregatedItem.inventoryItem.supplier_category;
      const itemCategory = aggregatedItem.inventoryItem.category;

      if (!supplierMap.has(supplierCategory)) {
        supplierMap.set(supplierCategory, new Map());
      }

      const categoryMap = supplierMap.get(supplierCategory)!;
      if (!categoryMap.has(itemCategory)) {
        categoryMap.set(itemCategory, []);
      }
      categoryMap.get(itemCategory)!.push(aggregatedItem);
    });

    const groups: SupplierGroup[] = [];
    SUPPLIER_ORDER.forEach((supplierCategory) => {
      const categoryMap = supplierMap.get(supplierCategory);
      const draftCount = getSupplierDraftItems(supplierCategory).length;
      if ((!categoryMap || categoryMap.size === 0) && draftCount === 0) return;

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
        supplierCategory,
        categoryGroups,
        totalItems,
      });
    });

    return groups;
  }, [getSupplierDraftItems, pendingOrders]);

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
            locationGroup: group,
            inventoryItem: item.inventoryItem,
            totalQuantity: info.quantity,
            unitType: item.unitType,
            isRemainingMode: item.isRemainingMode,
            remainingReportedTotal: info.remainingReportedTotal,
            notes: Array.from(info.notes),
            locationBreakdown: info.breakdown,
          });
        });
      });
    });

    const draftItems = getSupplierDraftItems(supplierGroup.supplierCategory);
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
        locationGroup: draftItem.locationGroup,
        inventoryItem: {
          id: draftItem.inventoryItemId || `draft-${draftItem.id}`,
          name: draftItem.name,
          category: toItemCategory(draftItem.category),
          supplier_category: supplierGroup.supplierCategory,
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
      });
    });

    return groupedItems;
  }, [getSupplierDraftItems]);

  const toggleSupplier = useCallback((supplier: SupplierCategory) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setExpandedSuppliers((prev) => {
      const next = new Set(prev);
      if (next.has(supplier)) {
        next.delete(supplier);
      } else {
        next.add(supplier);
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
        }
      >();

      pendingOrders.forEach((order) => {
        order.order_items?.forEach((orderItem) => {
          const inventoryItem = orderItem.inventory_item;
          if (!inventoryItem) return;
          if (inventoryItem.supplier_category !== supplierGroup.supplierCategory) return;
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

      const draftItems = getSupplierDraftItems(supplierGroup.supplierCategory);
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
    [buildLocationGroupedItems, getDisplayQuantity, getSupplierDraftItems, pendingOrders]
  );

  const buildRemainingConfirmationItems = useCallback(
    (supplierGroup: SupplierGroup) => {
      const rows: RemainingConfirmationItem[] = [];

      pendingOrders.forEach((order) => {
        order.order_items?.forEach((orderItem) => {
          const inventoryItem = orderItem.inventory_item;
          if (!inventoryItem) return;
          if (inventoryItem.supplier_category !== supplierGroup.supplierCategory) return;
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
    [pendingOrders]
  );

  const handleSend = useCallback(
    (supplierGroup: SupplierGroup) => {
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
          supplier: supplierGroup.supplierCategory,
          items: encodeURIComponent(JSON.stringify(regularItems)),
          remaining: encodeURIComponent(JSON.stringify(remainingItems)),
        },
      } as any);
    },
    [buildRegularConfirmationItems, buildRemainingConfirmationItems]
  );

  const locationOptionsByGroup = useMemo<Record<LocationGroup, AddLocationOption[]>>(() => {
    const options: Record<LocationGroup, AddLocationOption[]> = {
      sushi: [],
      poki: [],
    };

    locations.forEach((location) => {
      const group = getLocationGroup(location.name, location.short_code);
      options[group].push({
        id: location.id,
        name: location.name,
        shortCode: location.short_code,
      });
    });

    return options;
  }, [locations]);

  const addToTargetItem = useMemo(
    () => orderLaterQueue.find((item) => item.id === addToTargetItemId) ?? null,
    [addToTargetItemId, orderLaterQueue]
  );
  const scheduleEditItem = useMemo(
    () => orderLaterQueue.find((item) => item.id === scheduleEditItemId) ?? null,
    [orderLaterQueue, scheduleEditItemId]
  );

  useEffect(() => {
    if (!addToTargetItem) return;

    if (addToTargetItem.preferredSupplierId) {
      setAddToSupplier(addToTargetItem.preferredSupplierId);
    }

    const preferredGroup = addToTargetItem.preferredLocationGroup || 'sushi';
    setAddToLocationGroup(preferredGroup);
  }, [addToTargetItem]);

  useEffect(() => {
    if (!addToTargetItemId) return;

    const options = locationOptionsByGroup[addToLocationGroup];
    if (options.length === 0) {
      setAddToLocationId(null);
      return;
    }

    const exists = options.some((option) => option.id === addToLocationId);
    if (!exists) {
      setAddToLocationId(options[0].id);
    }
  }, [addToLocationGroup, addToLocationId, addToTargetItemId, locationOptionsByGroup]);

  const openAddToModal = useCallback((itemId: string) => {
    setAddToTargetItemId(itemId);
    setAddToLocationId(null);
  }, []);

  const closeAddToModal = useCallback(() => {
    setAddToTargetItemId(null);
  }, []);

  const handleConfirmAddTo = useCallback(async () => {
    if (!addToTargetItem) return;

    const selectedLocation = locationOptionsByGroup[addToLocationGroup].find(
      (option) => option.id === addToLocationId
    );

    const draftItem = await moveOrderLaterItemToSupplierDraft(
      addToTargetItem.id,
      addToSupplier,
      addToLocationGroup,
      {
        locationId: selectedLocation?.id ?? null,
        locationName: selectedLocation?.name ?? null,
      }
    );

    if (draftItem) {
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert('Added', `${addToTargetItem.itemName} was added to ${SUPPLIER_CATEGORY_LABELS[addToSupplier]}.`);
    }

    closeAddToModal();
  }, [
    addToLocationGroup,
    addToLocationId,
    addToSupplier,
    addToTargetItem,
    closeAddToModal,
    locationOptionsByGroup,
    moveOrderLaterItemToSupplierDraft,
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

      return (
        <View key={item.key}>
          <View className="flex-row items-center py-3 px-4 border-b border-gray-100 bg-white">
            <View className="flex-1 pr-2">
              <Text className="font-medium text-gray-900" numberOfLines={1}>
                {item.inventoryItem.name}
              </Text>

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
    [expandedNotes, getDisplayQuantity, handleQuantityChange, toggleNoteExpansion]
  );

  const renderSupplierSection = useCallback(
    (supplierGroup: SupplierGroup) => {
      const isExpanded = expandedSuppliers.has(supplierGroup.supplierCategory);
      const colorScheme = SUPPLIER_COLORS[supplierGroup.supplierCategory];
      const emoji = SUPPLIER_EMOJI[supplierGroup.supplierCategory];
      const label = SUPPLIER_CATEGORY_LABELS[supplierGroup.supplierCategory];
      const locationItems = buildLocationGroupedItems(supplierGroup);
      const supplierItemCount = locationItems.length;
      const supplierRemainingCount = locationItems.filter((item) => item.isRemainingMode).length;
      const sections = [
        { group: 'sushi' as LocationGroup, items: locationItems.filter((item) => item.locationGroup === 'sushi') },
        { group: 'poki' as LocationGroup, items: locationItems.filter((item) => item.locationGroup === 'poki') },
      ].filter((section) => section.items.length > 0);

      return (
        <View key={supplierGroup.supplierCategory} className="mb-4">
          <TouchableOpacity
            className={`p-4 rounded-xl ${colorScheme.bg} border ${colorScheme.border}`}
            onPress={() => toggleSupplier(supplierGroup.supplierCategory)}
            activeOpacity={0.7}
          >
            {useStackedSupplierActions ? (
              <View>
                <View className="flex-row items-center">
                  <Text className="text-2xl mr-3">{emoji}</Text>
                  <View className="flex-1 min-w-0">
                    <Text className={`font-bold text-base ${colorScheme.text}`} numberOfLines={1}>
                      {label}
                    </Text>
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
                    <Ionicons name="checkmark-done-outline" size={14} color="white" />
                    <Text className="text-sm font-bold text-white ml-1.5">Confirm Order</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center flex-1 min-w-0">
                  <Text className="text-2xl mr-3">{emoji}</Text>
                  <View className="flex-1 min-w-0">
                    <Text className={`font-bold text-base ${colorScheme.text}`} numberOfLines={1}>
                      {label}
                    </Text>
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
                    <Ionicons name="checkmark-done-outline" size={14} color="white" />
                    <Text className="text-sm font-bold text-white ml-1.5">Confirm Order</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </TouchableOpacity>

          {isExpanded && (
            <View className="mt-3">
              {sections.map((section) => {
                const sectionKey = `${supplierGroup.supplierCategory}-${section.group}`;
                const sectionExpanded = expandedLocationSections.has(sectionKey);
                const locationLabel = LOCATION_GROUP_LABELS[section.group];
                const sectionInitial = locationLabel.charAt(0);
                const sortedItems = [...section.items].sort((a, b) =>
                  a.inventoryItem.name.localeCompare(b.inventoryItem.name)
                );
                const remainingItems = sortedItems.filter((item) => item.isRemainingMode);
                const regularItems = sortedItems.filter((item) => !item.isRemainingMode);

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
                              {sortedItems.length} item{sortedItems.length !== 1 ? 's' : ''} • {remainingItems.length} remaining
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
                        {remainingItems.length > 0 && (
                          <View className="pt-3">
                            <View className="mx-2 mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 flex-row items-center justify-between">
                              <View className="flex-row items-center">
                                <Ionicons name="alert-circle-outline" size={14} color="#B45309" />
                                <Text className="ml-2 text-xs font-semibold text-amber-800">Remaining Items</Text>
                              </View>
                              <Text className="text-xs font-semibold text-amber-800">{remainingItems.length}</Text>
                            </View>
                            <View className="rounded-lg overflow-hidden border border-amber-100">
                              {remainingItems.map((item) => renderItem(item, true))}
                            </View>
                          </View>
                        )}

                        {regularItems.length > 0 && (
                          <View className="pt-3 pb-3">
                            <View className="mx-2 mb-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 flex-row items-center justify-between">
                              <Text className="text-xs font-semibold text-gray-700">Regular Items</Text>
                              <Text className="text-xs font-semibold text-gray-700">{regularItems.length}</Text>
                            </View>
                            <View className="rounded-lg overflow-hidden border border-gray-100">
                              {regularItems.map((item) => renderItem(item, true))}
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
        <View className="bg-white px-4 py-3 border-b border-gray-100 flex-row items-center justify-between">
          <View className="flex-row items-center">
            <BrandLogo variant="header" size={28} style={{ marginRight: 8 }} />
            <Text className="text-xl font-bold text-gray-900">Fulfillment</Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/(manager)/fulfillment-history')}
            className="rounded-lg border border-gray-200 bg-gray-50 flex-row items-center justify-center"
            style={{
              minHeight: 40,
              paddingHorizontal: useCompactHeaderActions ? 10 : 12,
              paddingVertical: 8,
            }}
          >
            <Ionicons name="time-outline" size={14} color={colors.gray[600]} />
            <Text className="ml-1.5 text-xs font-semibold text-gray-700" numberOfLines={1}>
              Past Orders
            </Text>
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

          {supplierGroups.length === 0 ? (
            <View className="items-center py-12">
              <Text className="text-4xl mb-4">📋</Text>
              <Text className="text-gray-500 text-center text-lg font-medium">No pending orders</Text>
              <Text className="text-gray-400 text-center text-sm mt-2">
                Orders will appear here when employees submit them
              </Text>
            </View>
          ) : (
            supplierGroups.map((group) => renderSupplierSection(group))
          )}
        </ScrollView>

        <Modal
          visible={Boolean(addToTargetItem)}
          transparent
          animationType="fade"
          onRequestClose={closeAddToModal}
        >
          <Pressable className="flex-1 bg-black/35 justify-end" onPress={closeAddToModal}>
            <Pressable className="bg-gray-50 rounded-t-3xl px-4 pt-4 pb-5" onPress={(e) => e.stopPropagation()}>
              <View className="flex-row items-center justify-between mb-3">
                <View className="flex-1 pr-2">
                  <Text className="text-lg font-bold text-gray-900">Add to Supplier</Text>
                  <Text className="text-xs text-gray-500 mt-0.5">
                    {addToTargetItem ? addToTargetItem.itemName : ''}
                  </Text>
                </View>
                <TouchableOpacity onPress={closeAddToModal} className="p-2">
                  <Ionicons name="close" size={20} color={colors.gray[500]} />
                </TouchableOpacity>
              </View>

              <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Supplier</Text>
              <View className="flex-row mb-3">
                {SUPPLIER_ORDER.map((supplierId) => {
                  const selected = supplierId === addToSupplier;
                  return (
                    <TouchableOpacity
                      key={supplierId}
                      onPress={() => setAddToSupplier(supplierId)}
                      className={`px-3 py-2 rounded-lg mr-2 ${
                        selected ? 'bg-primary-500' : 'bg-white border border-gray-200'
                      }`}
                    >
                      <Text className={`text-xs font-semibold ${selected ? 'text-white' : 'text-gray-700'}`}>
                        {SUPPLIER_CATEGORY_LABELS[supplierId]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Location Bucket</Text>
              <View className="flex-row mb-3">
                {(['sushi', 'poki'] as LocationGroup[]).map((group) => {
                  const selected = group === addToLocationGroup;
                  return (
                    <TouchableOpacity
                      key={group}
                      onPress={() => setAddToLocationGroup(group)}
                      className={`px-3 py-2 rounded-lg mr-2 ${
                        selected ? 'bg-primary-500' : 'bg-white border border-gray-200'
                      }`}
                    >
                      <Text className={`text-xs font-semibold ${selected ? 'text-white' : 'text-gray-700'}`}>
                        {LOCATION_GROUP_LABELS[group]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Location</Text>
              {locationOptionsByGroup[addToLocationGroup].length === 0 ? (
                <View className="rounded-xl border border-dashed border-gray-300 bg-white px-3 py-3 mb-4">
                  <Text className="text-xs text-gray-500">
                    No {LOCATION_GROUP_LABELS[addToLocationGroup]} location is configured. Item will be added without a location.
                  </Text>
                </View>
              ) : (
                <View className="mb-4">
                  {locationOptionsByGroup[addToLocationGroup].map((option) => {
                    const selected = option.id === addToLocationId;
                    return (
                      <TouchableOpacity
                        key={`${option.id}-${option.shortCode}`}
                        onPress={() => setAddToLocationId(option.id)}
                        className={`flex-row items-center justify-between rounded-lg px-3 py-2 mb-2 ${
                          selected ? 'bg-primary-50 border border-primary-200' : 'bg-white border border-gray-200'
                        }`}
                      >
                        <Text className={`text-sm ${selected ? 'text-primary-700 font-semibold' : 'text-gray-700'}`}>
                          {option.name}
                        </Text>
                        <Text className={`text-xs ${selected ? 'text-primary-700' : 'text-gray-500'}`}>
                          {option.shortCode}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              <View className="flex-row">
                <TouchableOpacity
                  onPress={closeAddToModal}
                  className="flex-1 py-3 rounded-xl bg-gray-100 items-center justify-center mr-2"
                >
                  <Text className="font-semibold text-gray-700">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleConfirmAddTo}
                  className="flex-1 py-3 rounded-xl bg-primary-500 items-center justify-center"
                >
                  <Text className="font-semibold text-white">Add</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

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
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
