import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Platform,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuthStore, useOrderStore, useFulfillmentStore } from '@/store';
import { colors, CATEGORY_LABELS, SUPPLIER_CATEGORY_LABELS } from '@/constants';
import { OrderWithDetails, InventoryItem, SupplierCategory, ItemCategory } from '@/types';
import { supabase } from '@/lib/supabase';
import { SpinningFish } from '@/components';
import { BrandLogo } from '@/components/BrandLogo';

// Aggregated item type
interface AggregatedItem {
  aggregateKey: string;
  inventoryItem: InventoryItem;
  totalQuantity: number;
  unitType: 'base' | 'pack';
  hasRemainingMode: boolean;
  unresolvedRemainingCount: number;
  remainingReportedTotal: number;
  locationBreakdown: Array<{
    locationId: string;
    locationName: string;
    shortCode: string;
    quantity: number;
    remainingReported: number;
    hasUndecidedRemaining: boolean;
    orderedBy: string[];
    orderIds: string[];
  }>;
  orderIds: string[];
}

// Category group within a supplier
interface CategoryGroup {
  category: ItemCategory;
  items: AggregatedItem[];
}

// Supplier group containing categories
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
  hasRemainingMode: boolean;
  unresolvedRemainingCount: number;
  remainingReportedTotal: number;
  locationBreakdown: Array<{
    locationId: string;
    locationName: string;
    shortCode: string;
    quantity: number;
    remainingReported: number;
    hasUndecidedRemaining: boolean;
    orderedBy: string[];
    orderIds: string[];
  }>;
  orderIds: string[];
}

const LOCATION_GROUP_LABELS: Record<LocationGroup, string> = {
  sushi: 'Sushi',
  poki: 'Poki',
};

// Supplier category order and emoji
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

export default function FulfillmentScreen() {
  const { user } = useAuthStore();
  const { orders, updateOrderStatus } = useOrderStore();
  const { checkedOtherItems, toggleOtherItem, clearOtherItems } = useFulfillmentStore();

  const [refreshing, setRefreshing] = useState(false);
  const [expandedSuppliers, setExpandedSuppliers] = useState<Set<SupplierCategory>>(
    new Set(['fish_supplier', 'main_distributor', 'asian_market'])
  );
  const [isFulfilling, setIsFulfilling] = useState(false);
  const [editedQuantities, setEditedQuantities] = useState<Record<string, number>>({});
  const [reviewedRemainingKeys, setReviewedRemainingKeys] = useState<Set<string>>(new Set());

  // Fetch pending orders
  const fetchPendingOrders = async () => {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          user:users!orders_user_id_fkey(*),
          location:locations(*),
          order_items(
            *,
            inventory_item:inventory_items(*)
          )
        `)
        .eq('status', 'submitted')
        .order('created_at', { ascending: false });

      if (!error && data) {
        useOrderStore.setState({ orders: data });
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
    }
  };

  useEffect(() => {
    fetchPendingOrders();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchPendingOrders();
    setRefreshing(false);
  }, []);

  // Get pending orders
  const pendingOrders = useMemo(() => {
    return (orders as OrderWithDetails[]).filter(
      (order) => order.status === 'submitted'
    );
  }, [orders]);

  // Aggregate items by supplier then category
  const supplierGroups = useMemo(() => {
    // First, aggregate all items
    const itemMap = new Map<string, AggregatedItem>();

    pendingOrders.forEach((order) => {
      order.order_items?.forEach((orderItem) => {
        const item = orderItem.inventory_item;
        if (!item) return;

        const isRemainingMode = orderItem.input_mode === 'remaining';
        const remainingReported = isRemainingMode
          ? Math.max(0, Number(orderItem.remaining_reported ?? 0))
          : 0;
        const decidedQuantity =
          orderItem.decided_quantity == null
            ? null
            : Number(orderItem.decided_quantity);
        const hasUndecidedRemaining =
          isRemainingMode && (decidedQuantity == null || !Number.isFinite(decidedQuantity));
        const lineQuantity = isRemainingMode
          ? hasUndecidedRemaining
            ? 0
            : Math.max(0, decidedQuantity as number)
          : Math.max(0, Number(orderItem.quantity ?? 0));

        const aggregateKey = [
          item.name.trim().toLowerCase(),
          item.supplier_category,
          item.category,
          orderItem.unit_type,
          item.base_unit,
          item.pack_unit,
          item.pack_size,
        ].join('|');
        const existing = itemMap.get(aggregateKey);

        if (existing) {
          existing.totalQuantity += lineQuantity;
          existing.hasRemainingMode = existing.hasRemainingMode || isRemainingMode;
          existing.remainingReportedTotal += remainingReported;
          if (hasUndecidedRemaining) {
            existing.unresolvedRemainingCount += 1;
          }
          if (!existing.orderIds.includes(order.id)) {
            existing.orderIds.push(order.id);
          }

          const locationEntry = existing.locationBreakdown.find(
            (lb) => lb.locationId === order.location_id
          );
          if (locationEntry) {
            locationEntry.quantity += lineQuantity;
            locationEntry.remainingReported += remainingReported;
            locationEntry.hasUndecidedRemaining =
              locationEntry.hasUndecidedRemaining || hasUndecidedRemaining;
            const orderedByName = order.user?.name || 'Unknown';
            if (!locationEntry.orderedBy.includes(orderedByName)) {
              locationEntry.orderedBy.push(orderedByName);
            }
            if (!locationEntry.orderIds.includes(order.id)) {
              locationEntry.orderIds.push(order.id);
            }
          } else {
            existing.locationBreakdown.push({
              locationId: order.location_id,
              locationName: order.location?.name || 'Unknown',
              shortCode: order.location?.short_code || '??',
              quantity: lineQuantity,
              remainingReported,
              hasUndecidedRemaining,
              orderedBy: [order.user?.name || 'Unknown'],
              orderIds: [order.id],
            });
          }
        } else {
          itemMap.set(aggregateKey, {
            aggregateKey,
            inventoryItem: item,
            totalQuantity: lineQuantity,
            unitType: orderItem.unit_type,
            hasRemainingMode: isRemainingMode,
            unresolvedRemainingCount: hasUndecidedRemaining ? 1 : 0,
            remainingReportedTotal: remainingReported,
            locationBreakdown: [
              {
                locationId: order.location_id,
                locationName: order.location?.name || 'Unknown',
                shortCode: order.location?.short_code || '??',
                quantity: lineQuantity,
                remainingReported,
                hasUndecidedRemaining,
                orderedBy: [order.user?.name || 'Unknown'],
                orderIds: [order.id],
              },
            ],
            orderIds: [order.id],
          });
        }
      });
    });

    // Group by supplier category then by item category
    const supplierMap = new Map<SupplierCategory, Map<ItemCategory, AggregatedItem[]>>();

    Array.from(itemMap.values()).forEach((aggregatedItem) => {
      const supplierCat = aggregatedItem.inventoryItem.supplier_category;
      const itemCat = aggregatedItem.inventoryItem.category;

      if (!supplierMap.has(supplierCat)) {
        supplierMap.set(supplierCat, new Map());
      }

      const categoryMap = supplierMap.get(supplierCat)!;
      if (!categoryMap.has(itemCat)) {
        categoryMap.set(itemCat, []);
      }

      categoryMap.get(itemCat)!.push(aggregatedItem);
    });

    // Convert to array format sorted by supplier order
    const groups: SupplierGroup[] = [];

    SUPPLIER_ORDER.forEach((supplierCat) => {
      const categoryMap = supplierMap.get(supplierCat);
      if (!categoryMap || categoryMap.size === 0) return;

      const categoryGroups: CategoryGroup[] = [];
      let totalItems = 0;

      Array.from(categoryMap.entries()).forEach(([category, items]) => {
        // Sort items alphabetically
        items.sort((a, b) => a.inventoryItem.name.localeCompare(b.inventoryItem.name));
        categoryGroups.push({ category, items });
        totalItems += items.length;
      });

      // Sort category groups by category name
      categoryGroups.sort((a, b) =>
        (CATEGORY_LABELS[a.category] || a.category).localeCompare(CATEGORY_LABELS[b.category] || b.category)
      );

      groups.push({
        supplierCategory: supplierCat,
        categoryGroups,
        totalItems,
      });
    });

    return groups;
  }, [pendingOrders]);

  // Toggle supplier expansion
  const toggleSupplier = useCallback((supplier: SupplierCategory) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setExpandedSuppliers((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(supplier)) {
        newSet.delete(supplier);
      } else {
        newSet.add(supplier);
      }
      return newSet;
    });
  }, []);

  // Handle toggle check
  const handleToggleCheck = useCallback((item: LocationGroupedItem) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    toggleOtherItem(item.key);
  }, [toggleOtherItem]);

  // Handle quantity change
  const handleQuantityChange = useCallback((item: LocationGroupedItem, newQuantity: number) => {
    setEditedQuantities((prev) => ({
      ...prev,
      [item.key]: Math.max(0, newQuantity),
    }));
    if (item.unresolvedRemainingCount > 0) {
      setReviewedRemainingKeys((prev) => {
        if (prev.has(item.key)) return prev;
        const next = new Set(prev);
        next.add(item.key);
        return next;
      });
    }
  }, []);

  // Get displayed quantity (edited or original)
  const getDisplayQuantity = useCallback((itemKey: string, fallbackQuantity: number) => {
    return editedQuantities[itemKey] ?? fallbackQuantity;
  }, [editedQuantities]);

  const isDecisionPending = useCallback((item: LocationGroupedItem) => {
    if (!item.hasRemainingMode) return false;
    if (item.unresolvedRemainingCount <= 0) return false;
    return !reviewedRemainingKeys.has(item.key);
  }, [reviewedRemainingKeys]);

  const buildLocationGroupedItems = useCallback((supplierGroup: SupplierGroup) => {
    const groupedItems: LocationGroupedItem[] = [];

    supplierGroup.categoryGroups.forEach((categoryGroup) => {
      categoryGroup.items.forEach((item) => {
        const groupMap: Record<LocationGroup, {
          quantity: number;
          remainingReportedTotal: number;
          unresolvedRemainingCount: number;
          breakdown: AggregatedItem['locationBreakdown'];
          orderIds: Set<string>;
        }> = {
          sushi: { quantity: 0, remainingReportedTotal: 0, unresolvedRemainingCount: 0, breakdown: [], orderIds: new Set() },
          poki: { quantity: 0, remainingReportedTotal: 0, unresolvedRemainingCount: 0, breakdown: [], orderIds: new Set() },
        };

        item.locationBreakdown.forEach((loc) => {
          const group = getLocationGroup(loc.locationName, loc.shortCode);
          groupMap[group].quantity += loc.quantity;
          groupMap[group].remainingReportedTotal += loc.remainingReported;
          if (loc.hasUndecidedRemaining) {
            groupMap[group].unresolvedRemainingCount += 1;
          }
          groupMap[group].breakdown.push(loc);
          loc.orderIds.forEach((id) => groupMap[group].orderIds.add(id));
        });

        (Object.keys(groupMap) as LocationGroup[]).forEach((group) => {
          const info = groupMap[group];
          if (info.quantity <= 0 && info.unresolvedRemainingCount === 0) return;
          groupedItems.push({
            key: `${item.aggregateKey}-${group}`,
            aggregateKey: item.aggregateKey,
            locationGroup: group,
            inventoryItem: item.inventoryItem,
            totalQuantity: info.quantity,
            unitType: item.unitType,
            hasRemainingMode: item.hasRemainingMode,
            unresolvedRemainingCount: info.unresolvedRemainingCount,
            remainingReportedTotal: info.remainingReportedTotal,
            locationBreakdown: info.breakdown,
            orderIds: Array.from(info.orderIds),
          });
        });
      });
    });

    return groupedItems;
  }, []);

  // Calculate total items and checked count
  const allItems = useMemo(() => {
    return supplierGroups.flatMap((sg) => buildLocationGroupedItems(sg));
  }, [supplierGroups, buildLocationGroupedItems]);

  const checkedCount = useMemo(() => {
    return allItems.filter((item) =>
      checkedOtherItems.has(item.key)
    ).length;
  }, [allItems, checkedOtherItems]);

  const allChecked = checkedCount === allItems.length && allItems.length > 0;

  const buildConfirmationItems = useCallback((supplierGroup: SupplierGroup) => {
    const items = buildLocationGroupedItems(supplierGroup).map((item) => {
      const qty = getDisplayQuantity(item.key, item.totalQuantity);
      if (qty <= 0) return null;
      const unitLabel = item.unitType === 'pack'
        ? item.inventoryItem.pack_unit
        : item.inventoryItem.base_unit;
      return {
        id: item.key,
        name: item.inventoryItem.name,
        category: item.inventoryItem.category,
        locationGroup: item.locationGroup,
        quantity: qty,
        unitLabel,
        inputMode: item.hasRemainingMode ? 'remaining' : 'quantity',
        remainingReported: item.hasRemainingMode ? item.remainingReportedTotal : null,
        managerDecided: item.hasRemainingMode,
        details: item.locationBreakdown.map((loc) => ({
          locationName: loc.locationName,
          orderedBy: loc.orderedBy.length > 0 ? loc.orderedBy.join(', ') : 'Unknown',
          quantity: loc.quantity,
          remainingReported: loc.remainingReported,
          shortCode: loc.shortCode,
        })),
      };
    }).filter(Boolean) as Array<{
      id: string;
      name: string;
      category: ItemCategory;
      locationGroup: LocationGroup;
      quantity: number;
      unitLabel: string;
      inputMode: 'quantity' | 'remaining';
      remainingReported: number | null;
      managerDecided: boolean;
      details: Array<{
        locationName: string;
        orderedBy: string;
        quantity: number;
        remainingReported: number;
        shortCode: string;
      }>;
    }>;

    return items;
  }, [buildLocationGroupedItems, getDisplayQuantity]);

  const handleSend = useCallback((supplierGroup: SupplierGroup) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    const groupedItems = buildLocationGroupedItems(supplierGroup);
    const pendingDecisions = groupedItems.filter((item) => isDecisionPending(item));
    if (pendingDecisions.length > 0) {
      Alert.alert(
        'Decision Required',
        `Set order quantity for ${pendingDecisions.length} remaining item${pendingDecisions.length === 1 ? '' : 's'} before sending.`
      );
      return;
    }

    const items = buildConfirmationItems(supplierGroup);
    if (items.length === 0) {
      Alert.alert('Nothing to Send', 'All quantities are set to zero.');
      return;
    }

    router.push({
      pathname: '/(manager)/fulfillment-confirmation',
      params: {
        supplier: supplierGroup.supplierCategory,
        items: encodeURIComponent(JSON.stringify(items)),
      },
    } as any);
  }, [buildConfirmationItems, buildLocationGroupedItems, isDecisionPending]);

  // Handle mark orders fulfilled
  const handleMarkFulfilled = useCallback(async () => {
    const checkedOrderIds = new Set<string>();
    allItems
      .filter((item) =>
        checkedOtherItems.has(item.key)
      )
      .forEach((item) => {
        item.orderIds.forEach((id) => checkedOrderIds.add(id));
      });

    const orderIdArray = Array.from(checkedOrderIds);
    const orderCount = orderIdArray.length;

    Alert.alert(
      'Mark Orders Fulfilled',
      `Mark ${orderCount} order${orderCount !== 1 ? 's' : ''} as fulfilled?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark Fulfilled',
          onPress: async () => {
            setIsFulfilling(true);
            try {
              for (const orderId of orderIdArray) {
                await updateOrderStatus(orderId, 'fulfilled', user?.id);
              }

              if (Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }

              clearOtherItems();
              setEditedQuantities({});
              setReviewedRemainingKeys(new Set());
              await fetchPendingOrders();

              Alert.alert('Success', `${orderCount} order${orderCount !== 1 ? 's' : ''} marked as fulfilled`);
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to fulfill orders');
            } finally {
              setIsFulfilling(false);
            }
          },
        },
      ]
    );
  }, [allItems, checkedOtherItems, updateOrderStatus, user, clearOtherItems]);

  // Render item row
  const renderItem = useCallback((item: LocationGroupedItem, showLocationBreakdown: boolean) => {
    const key = item.key;
    const isChecked = checkedOtherItems.has(key);
    const unitLabel = item.unitType === 'pack'
      ? item.inventoryItem.pack_unit
      : item.inventoryItem.base_unit;
    const displayQty = getDisplayQuantity(key, item.totalQuantity);
    const numericQty = Number.isFinite(displayQty) ? displayQty : 0;
    const decisionPending = isDecisionPending(item);

    return (
      <View key={key}>
        <TouchableOpacity
          className={`flex-row items-center py-3 px-4 border-b border-gray-100 ${
            isChecked ? 'bg-green-50' : 'bg-white'
          }`}
          onPress={() => handleToggleCheck(item)}
          activeOpacity={0.7}
        >
          {/* Checkbox */}
          <View
            className={`w-5 h-5 rounded border-2 items-center justify-center mr-3 ${
              isChecked ? 'bg-green-500 border-green-500' : 'border-gray-300'
            }`}
          >
            {isChecked && (
              <Ionicons name="checkmark" size={14} color="white" />
            )}
          </View>

          {/* Item Name */}
          <View className="flex-1 pr-2">
            <Text
              className={`font-medium ${
                isChecked ? 'text-gray-400 line-through' : 'text-gray-900'
              }`}
              numberOfLines={1}
            >
              {item.inventoryItem.name}
            </Text>
            {item.hasRemainingMode && (
              <View className="flex-row items-center mt-1">
                <View className="px-1.5 py-0.5 rounded-full bg-amber-100">
                  <Text className="text-[10px] font-semibold text-amber-700">Remaining</Text>
                </View>
                <Text className="ml-2 text-[11px] text-amber-700">
                  Reported: {item.remainingReportedTotal} {unitLabel}
                </Text>
              </View>
            )}
            {decisionPending && (
              <Text className="text-[11px] text-red-600 mt-1">Set final order quantity before send.</Text>
            )}
          </View>

          {/* Quantity Controls */}
          <View className="flex-row items-center">
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                handleQuantityChange(item, numericQty - 1);
              }}
              className="w-7 h-7 bg-gray-100 rounded items-center justify-center"
            >
              <Ionicons name="remove" size={14} color={colors.gray[600]} />
            </TouchableOpacity>

            <TextInput
              className="w-12 h-7 text-center text-sm font-bold text-gray-900"
              value={displayQty.toString()}
              onChangeText={(text) => {
                const sanitized = text.replace(/[^0-9.]/g, '');
                const num = parseFloat(sanitized);
                handleQuantityChange(item, Number.isFinite(num) ? num : 0);
              }}
              keyboardType="decimal-pad"
              selectTextOnFocus
            />

            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                handleQuantityChange(item, numericQty + 1);
              }}
              className="w-7 h-7 bg-gray-100 rounded items-center justify-center"
            >
              <Ionicons name="add" size={14} color={colors.gray[600]} />
            </TouchableOpacity>

            <Text className="text-xs text-gray-500 ml-1 w-10">{unitLabel}</Text>
          </View>
        </TouchableOpacity>

        {decisionPending && (
          <View className="px-12 pb-2 bg-white border-b border-gray-100">
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                handleQuantityChange(item, numericQty);
              }}
              className="self-start px-2 py-1 rounded-md bg-amber-100"
            >
              <Text className="text-[11px] font-semibold text-amber-800">Confirm current qty</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Location Breakdown (shown when expanded) */}
        {showLocationBreakdown && item.locationBreakdown.length > 1 && (
          <View className="bg-gray-50 px-12 py-2 border-b border-gray-100">
            {item.locationBreakdown.map((loc) => (
              <View key={loc.locationId} className="flex-row items-center py-1">
                <View className="w-6 h-6 bg-primary-100 rounded-full items-center justify-center mr-2">
                  <Text className="text-xs font-bold text-primary-700">{loc.shortCode}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-xs text-gray-600">{loc.locationName}</Text>
                  {item.hasRemainingMode && (loc.hasUndecidedRemaining || loc.remainingReported > 0) && (
                    <Text className="text-[11px] text-amber-700">Remaining {loc.remainingReported}</Text>
                  )}
                </View>
                <Text className="text-xs font-medium text-gray-700">{loc.quantity}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  }, [checkedOtherItems, getDisplayQuantity, isDecisionPending, handleToggleCheck, handleQuantityChange]);

  // Render supplier section
  const renderSupplierSection = useCallback((supplierGroup: SupplierGroup) => {
    const isExpanded = expandedSuppliers.has(supplierGroup.supplierCategory);
    const colorScheme = SUPPLIER_COLORS[supplierGroup.supplierCategory];
    const emoji = SUPPLIER_EMOJI[supplierGroup.supplierCategory];
    const label = SUPPLIER_CATEGORY_LABELS[supplierGroup.supplierCategory];
    const locationItems = buildLocationGroupedItems(supplierGroup);
    const supplierItemCount = locationItems.length;
    const sections = [
      { group: 'sushi', items: locationItems.filter((item) => item.locationGroup === 'sushi') },
      { group: 'poki', items: locationItems.filter((item) => item.locationGroup === 'poki') },
    ] as const;
    const visibleSections: Array<{ group: LocationGroup; items: LocationGroupedItem[] }> = sections
      .map((section) => ({ group: section.group, items: section.items }))
      .filter((section) => section.items.length > 0);

    return (
      <View key={supplierGroup.supplierCategory} className="mb-4">
        {/* Supplier Header */}
        <TouchableOpacity
          className={`flex-row items-center justify-between p-4 rounded-xl ${colorScheme.bg} border ${colorScheme.border}`}
          onPress={() => toggleSupplier(supplierGroup.supplierCategory)}
          activeOpacity={0.7}
        >
          <View className="flex-row items-center flex-1">
            <Text className="text-2xl mr-3">{emoji}</Text>
            <View>
              <Text className={`font-bold text-base ${colorScheme.text}`}>{label}</Text>
              <Text className="text-sm text-gray-500">
                {supplierItemCount} item{supplierItemCount !== 1 ? 's' : ''}
              </Text>
            </View>
          </View>

          <View className="flex-row items-center">
            {/* Send Button */}
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                handleSend(supplierGroup);
              }}
              className="mr-3 px-3 py-1.5 bg-white rounded-lg border border-gray-200"
            >
              <Text className="text-xs font-semibold text-gray-700">Send</Text>
            </TouchableOpacity>

            <Ionicons
              name={isExpanded ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={colors.gray[500]}
            />
          </View>
        </TouchableOpacity>

        {/* Expanded Content */}
        {isExpanded && (
          <View className="mt-3">
            {visibleSections.map((section) => {
              const locationLabel = LOCATION_GROUP_LABELS[section.group];
              const sectionInitial = locationLabel.charAt(0);
              const sortedItems = [...section.items].sort((a, b) =>
                a.inventoryItem.name.localeCompare(b.inventoryItem.name)
              );

              return (
                <View key={`${supplierGroup.supplierCategory}-${section.group}`} className="mb-3">
                  <View className="bg-white rounded-t-xl px-4 py-3 border border-gray-200 border-b-0">
                    <View className="flex-row items-center justify-between">
                      <View className="flex-row items-center">
                        <View className="bg-primary-500 w-9 h-9 rounded-full items-center justify-center mr-3">
                          <Text className="text-white font-bold">{sectionInitial}</Text>
                        </View>
                        <View>
                          <Text className="text-base font-semibold text-gray-900">
                            {locationLabel}
                          </Text>
                          <Text className="text-sm text-gray-500">
                            {sortedItems.length} item{sortedItems.length !== 1 ? 's' : ''}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>

                  <View className="bg-white px-4 border border-gray-200 border-t-0 rounded-b-xl overflow-hidden">
                    {sortedItems.map((item) => renderItem(item, true))}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>
    );
  }, [expandedSuppliers, toggleSupplier, handleSend, renderItem, buildLocationGroupedItems]);

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      {/* Header */}
      <View className="bg-white px-4 py-3 border-b border-gray-100 flex-row items-center">
        <BrandLogo variant="header" size={24} style={{ marginRight: 8 }} />
        <Text className="text-xl font-bold text-gray-900">Fulfillment</Text>
      </View>

      {/* Content */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          padding: 16,
          paddingBottom: allItems.length > 0 ? 100 : 32
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F97316" />
        }
      >
        {supplierGroups.length === 0 ? (
          <View className="items-center py-12">
            <Text className="text-4xl mb-4">📋</Text>
            <Text className="text-gray-500 text-center text-lg font-medium">
              No pending orders
            </Text>
            <Text className="text-gray-400 text-center text-sm mt-2">
              Orders will appear here when employees submit them
            </Text>
          </View>
        ) : (
          <>
            {/* Supplier Groups */}
            {supplierGroups.map((group) => renderSupplierSection(group))}
          </>
        )}
      </ScrollView>

      {/* Bottom Action Bar */}
      {allItems.length > 0 && (
        <View className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3">
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-gray-600 font-medium">
                {checkedCount}/{allItems.length} items checked
              </Text>
              {!allChecked && (
                <Text className="text-xs text-gray-400">
                  Check all items to mark fulfilled
                </Text>
              )}
            </View>
            <TouchableOpacity
              className={`rounded-xl px-5 py-3 flex-row items-center ${
                allChecked ? 'bg-green-500' : 'bg-gray-300'
              }`}
              onPress={handleMarkFulfilled}
              disabled={!allChecked || isFulfilling}
              activeOpacity={0.8}
            >
              {isFulfilling ? (
                <SpinningFish size="small" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={18} color="white" />
                  <Text className="text-white font-semibold ml-2">
                    Mark Fulfilled
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
