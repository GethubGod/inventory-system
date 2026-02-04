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

// Aggregated item type
interface AggregatedItem {
  aggregateKey: string;
  inventoryItem: InventoryItem;
  totalQuantity: number;
  unitType: 'base' | 'pack';
  locationBreakdown: Array<{
    locationId: string;
    locationName: string;
    shortCode: string;
    quantity: number;
    orderedBy: string[];
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
          existing.totalQuantity += orderItem.quantity;
          if (!existing.orderIds.includes(order.id)) {
            existing.orderIds.push(order.id);
          }

          const locationEntry = existing.locationBreakdown.find(
            (lb) => lb.locationId === order.location_id
          );
          if (locationEntry) {
            locationEntry.quantity += orderItem.quantity;
            const orderedByName = order.user?.name || 'Unknown';
            if (!locationEntry.orderedBy.includes(orderedByName)) {
              locationEntry.orderedBy.push(orderedByName);
            }
          } else {
            existing.locationBreakdown.push({
              locationId: order.location_id,
              locationName: order.location?.name || 'Unknown',
              shortCode: order.location?.short_code || '??',
              quantity: orderItem.quantity,
              orderedBy: [order.user?.name || 'Unknown'],
            });
          }
        } else {
          itemMap.set(aggregateKey, {
            aggregateKey,
            inventoryItem: item,
            totalQuantity: orderItem.quantity,
            unitType: orderItem.unit_type,
            locationBreakdown: [
              {
                locationId: order.location_id,
                locationName: order.location?.name || 'Unknown',
                shortCode: order.location?.short_code || '??',
                quantity: orderItem.quantity,
                orderedBy: [order.user?.name || 'Unknown'],
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

  // Calculate total items and checked count
  const allItems = useMemo(() => {
    return supplierGroups.flatMap((sg) =>
      sg.categoryGroups.flatMap((cg) => cg.items)
    );
  }, [supplierGroups]);

  const checkedCount = useMemo(() => {
    return allItems.filter((item) =>
      checkedOtherItems.has(item.aggregateKey)
    ).length;
  }, [allItems, checkedOtherItems]);

  const allChecked = checkedCount === allItems.length && allItems.length > 0;

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
  const handleToggleCheck = useCallback((item: AggregatedItem) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    toggleOtherItem(item.aggregateKey);
  }, [toggleOtherItem]);

  // Handle quantity change
  const handleQuantityChange = useCallback((itemKey: string, newQuantity: number) => {
    setEditedQuantities((prev) => ({
      ...prev,
      [itemKey]: Math.max(0, newQuantity),
    }));
  }, []);

  // Get displayed quantity (edited or original)
  const getDisplayQuantity = useCallback((item: AggregatedItem) => {
    return editedQuantities[item.aggregateKey] ?? item.totalQuantity;
  }, [editedQuantities]);

  const buildConfirmationItems = useCallback((supplierGroup: SupplierGroup) => {
    const items = supplierGroup.categoryGroups.flatMap((categoryGroup) => {
      return categoryGroup.items.map((item) => {
        const qty = getDisplayQuantity(item);
        if (qty <= 0) return null;
        const unitLabel = item.unitType === 'pack'
          ? item.inventoryItem.pack_unit
          : item.inventoryItem.base_unit;
        return {
          id: item.aggregateKey,
          name: item.inventoryItem.name,
          quantity: qty,
          unitLabel,
          details: item.locationBreakdown.map((loc) => ({
            locationName: loc.locationName,
            orderedBy: loc.orderedBy.length > 0 ? loc.orderedBy.join(', ') : 'Unknown',
            quantity: loc.quantity,
            shortCode: loc.shortCode,
          })),
        };
      }).filter(Boolean);
    }).filter(Boolean) as Array<{
      id: string;
      name: string;
      quantity: number;
      unitLabel: string;
      details: Array<{ locationName: string; orderedBy: string; quantity: number; shortCode: string }>;
    }>;

    return items;
  }, [getDisplayQuantity]);

  const handleSend = useCallback((supplierGroup: SupplierGroup) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
  }, [buildConfirmationItems]);

  // Handle mark orders fulfilled
  const handleMarkFulfilled = useCallback(async () => {
    const checkedOrderIds = new Set<string>();
    allItems
      .filter((item) =>
        checkedOtherItems.has(item.aggregateKey)
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
  const renderItem = useCallback((item: AggregatedItem, showLocationBreakdown: boolean) => {
    const key = item.aggregateKey;
    const isChecked = checkedOtherItems.has(key);
    const unitLabel = item.unitType === 'pack'
      ? item.inventoryItem.pack_unit
      : item.inventoryItem.base_unit;
    const displayQty = getDisplayQuantity(item);

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
          <Text
            className={`flex-1 font-medium ${
              isChecked ? 'text-gray-400 line-through' : 'text-gray-900'
            }`}
            numberOfLines={1}
          >
            {item.inventoryItem.name}
          </Text>

          {/* Quantity Controls */}
          <View className="flex-row items-center">
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                handleQuantityChange(item.aggregateKey, displayQty - 1);
              }}
              className="w-7 h-7 bg-gray-100 rounded items-center justify-center"
            >
              <Ionicons name="remove" size={14} color={colors.gray[600]} />
            </TouchableOpacity>

            <TextInput
              className="w-12 h-7 text-center text-sm font-bold text-gray-900"
              value={displayQty.toString()}
              onChangeText={(text) => {
                const num = parseFloat(text) || 0;
                handleQuantityChange(item.aggregateKey, num);
              }}
              keyboardType="decimal-pad"
              selectTextOnFocus
            />

            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                handleQuantityChange(item.aggregateKey, displayQty + 1);
              }}
              className="w-7 h-7 bg-gray-100 rounded items-center justify-center"
            >
              <Ionicons name="add" size={14} color={colors.gray[600]} />
            </TouchableOpacity>

            <Text className="text-xs text-gray-500 ml-1 w-10">{unitLabel}</Text>
          </View>
        </TouchableOpacity>

        {/* Location Breakdown (shown when expanded) */}
        {showLocationBreakdown && item.locationBreakdown.length > 1 && (
          <View className="bg-gray-50 px-12 py-2 border-b border-gray-100">
            {item.locationBreakdown.map((loc) => (
              <View key={loc.locationId} className="flex-row items-center py-1">
                <View className="w-6 h-6 bg-primary-100 rounded-full items-center justify-center mr-2">
                  <Text className="text-xs font-bold text-primary-700">{loc.shortCode}</Text>
                </View>
                <Text className="text-xs text-gray-600 flex-1">{loc.locationName}</Text>
                <Text className="text-xs font-medium text-gray-700">{loc.quantity}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  }, [checkedOtherItems, getDisplayQuantity, handleToggleCheck, handleQuantityChange]);

  // Render category section
  const renderCategorySection = useCallback((
    supplierCategory: SupplierCategory,
    categoryGroup: CategoryGroup
  ) => {
    const key = `${supplierCategory}-${categoryGroup.category}`;
    const label = CATEGORY_LABELS[categoryGroup.category] || categoryGroup.category;

    return (
      <View key={key} className="mb-2">
        <View className="flex-row items-center justify-between py-2 px-2 bg-gray-50 rounded-t-lg">
          <Text className="text-xs font-bold text-gray-500 uppercase tracking-wide">
            {label} ({categoryGroup.items.length})
          </Text>
        </View>

        <View className="bg-white rounded-b-lg border border-gray-200 border-t-0 overflow-hidden">
          {categoryGroup.items.map((item) => renderItem(item, true))}
        </View>
      </View>
    );
  }, [renderItem]);

  // Render supplier section
  const renderSupplierSection = useCallback((supplierGroup: SupplierGroup) => {
    const isExpanded = expandedSuppliers.has(supplierGroup.supplierCategory);
    const colorScheme = SUPPLIER_COLORS[supplierGroup.supplierCategory];
    const emoji = SUPPLIER_EMOJI[supplierGroup.supplierCategory];
    const label = SUPPLIER_CATEGORY_LABELS[supplierGroup.supplierCategory];

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
                {supplierGroup.totalItems} item{supplierGroup.totalItems !== 1 ? 's' : ''}
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
          <View className="mt-2 pl-2">
            {supplierGroup.categoryGroups.map((cg) =>
              renderCategorySection(supplierGroup.supplierCategory, cg)
            )}
          </View>
        )}
      </View>
    );
  }, [expandedSuppliers, toggleSupplier, handleSend, renderCategorySection]);

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      {/* Header */}
      <View className="bg-white px-4 py-3 border-b border-gray-100">
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
