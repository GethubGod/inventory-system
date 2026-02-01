import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuthStore, useOrderStore, useFulfillmentStore } from '@/store';
import { colors, CATEGORY_LABELS } from '@/constants';
import { OrderWithDetails, InventoryItem } from '@/types';
import { supabase } from '@/lib/supabase';
import { SpinningFish } from '@/components';

// Category emoji mapping
const CATEGORY_EMOJI: Record<string, string> = {
  fish: '🐟',
  protein: '🥩',
  produce: '🥬',
  dry: '🍚',
  dairy_cold: '🧊',
  frozen: '❄️',
  sauces: '🍶',
  packaging: '📦',
};

// Sample fish data for testing (will be merged with real orders)
const SAMPLE_FISH_ORDERS = [
  {
    id: 'sample-salmon',
    name: 'Salmon (Sushi Grade)',
    category: 'fish' as const,
    base_unit: 'lb',
    pack_unit: 'case',
    pack_size: 10,
    quantity: 8,
    unitType: 'pack' as const,
    locations: [
      { name: 'Babytuna Sushi', shortCode: 'BTS', quantity: 5 },
      { name: 'Babytuna Poki & Pho', shortCode: 'BTP', quantity: 3 },
    ],
    orderNumbers: [127, 126, 125],
  },
  {
    id: 'sample-tuna',
    name: 'Tuna (Sushi Grade)',
    category: 'fish' as const,
    base_unit: 'lb',
    pack_unit: 'case',
    pack_size: 10,
    quantity: 5,
    unitType: 'pack' as const,
    locations: [
      { name: 'Babytuna Sushi', shortCode: 'BTS', quantity: 3 },
      { name: 'Babytuna Poki & Pho', shortCode: 'BTP', quantity: 2 },
    ],
    orderNumbers: [127, 126],
  },
  {
    id: 'sample-shrimp',
    name: 'Shrimp (Ebi)',
    category: 'fish' as const,
    base_unit: 'lb',
    pack_unit: 'lb',
    pack_size: 1,
    quantity: 12,
    unitType: 'base' as const,
    locations: [
      { name: 'Babytuna Sushi', shortCode: 'BTS', quantity: 7 },
      { name: 'Babytuna Poki & Pho', shortCode: 'BTP', quantity: 5 },
    ],
    orderNumbers: [127, 125],
  },
  {
    id: 'sample-yellowtail',
    name: 'Yellowtail (Hamachi)',
    category: 'fish' as const,
    base_unit: 'lb',
    pack_unit: 'case',
    pack_size: 8,
    quantity: 3,
    unitType: 'pack' as const,
    locations: [
      { name: 'Babytuna Sushi', shortCode: 'BTS', quantity: 3 },
    ],
    orderNumbers: [127],
  },
  {
    id: 'sample-octopus',
    name: 'Octopus (Tako)',
    category: 'fish' as const,
    base_unit: 'lb',
    pack_unit: 'lb',
    pack_size: 1,
    quantity: 6,
    unitType: 'base' as const,
    locations: [
      { name: 'Babytuna Poki & Pho', shortCode: 'BTP', quantity: 6 },
    ],
    orderNumbers: [126],
  },
];

// Aggregated item type
interface AggregatedItem {
  inventoryItem: InventoryItem;
  totalQuantity: number;
  unitType: 'base' | 'pack';
  locationBreakdown: Array<{
    locationId: string;
    locationName: string;
    shortCode: string;
    quantity: number;
  }>;
  orderNumbers: number[];
  orderIds: string[];
}

// Sample fish item type
interface SampleFishItem {
  id: string;
  name: string;
  category: 'fish';
  base_unit: string;
  pack_unit: string;
  pack_size: number;
  quantity: number;
  unitType: 'base' | 'pack';
  locations: Array<{ name: string; shortCode: string; quantity: number }>;
  orderNumbers: number[];
}

type TabType = 'fish' | 'other';

export default function FulfillmentScreen() {
  const { locations, user } = useAuthStore();
  const { orders, fetchManagerOrders, updateOrderStatus, isLoading } = useOrderStore();
  const {
    checkedFishItems,
    checkedOtherItems,
    toggleFishItem,
    toggleOtherItem,
    clearOtherItems,
  } = useFulfillmentStore();

  const [activeTab, setActiveTab] = useState<TabType>('fish');
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['produce', 'dry', 'protein', 'dairy_cold', 'frozen', 'sauces', 'packaging']));
  const [isFulfilling, setIsFulfilling] = useState(false);
  const [useSampleData, setUseSampleData] = useState(true); // Toggle for sample data

  // Fetch pending and processing orders
  useEffect(() => {
    fetchPendingOrders();
  }, [selectedLocationId]);

  const fetchPendingOrders = async () => {
    try {
      let query = supabase
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
        .in('status', ['submitted', 'processing'])
        .order('created_at', { ascending: false });

      if (selectedLocationId) {
        query = query.eq('location_id', selectedLocationId);
      }

      const { data, error } = await query;
      if (!error && data) {
        useOrderStore.setState({ orders: data });
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchPendingOrders();
    setRefreshing(false);
  }, [selectedLocationId]);

  // Get pending orders
  const pendingOrders = useMemo(() => {
    return (orders as OrderWithDetails[]).filter(
      (order) => order.status === 'submitted' || order.status === 'processing'
    );
  }, [orders]);

  // Aggregate items from all pending orders
  const aggregatedItems = useMemo(() => {
    const itemMap = new Map<string, AggregatedItem>();

    pendingOrders.forEach((order) => {
      order.order_items?.forEach((orderItem) => {
        const item = orderItem.inventory_item;
        if (!item) return;

        const key = `${item.id}-${orderItem.unit_type}`;
        const existing = itemMap.get(key);

        if (existing) {
          existing.totalQuantity += orderItem.quantity;
          if (!existing.orderNumbers.includes(order.order_number)) {
            existing.orderNumbers.push(order.order_number);
            existing.orderIds.push(order.id);
          }

          const locationEntry = existing.locationBreakdown.find(
            (lb) => lb.locationId === order.location_id
          );
          if (locationEntry) {
            locationEntry.quantity += orderItem.quantity;
          } else {
            existing.locationBreakdown.push({
              locationId: order.location_id,
              locationName: order.location?.name || 'Unknown',
              shortCode: order.location?.short_code || '??',
              quantity: orderItem.quantity,
            });
          }
        } else {
          itemMap.set(key, {
            inventoryItem: item,
            totalQuantity: orderItem.quantity,
            unitType: orderItem.unit_type,
            locationBreakdown: [
              {
                locationId: order.location_id,
                locationName: order.location?.name || 'Unknown',
                shortCode: order.location?.short_code || '??',
                quantity: orderItem.quantity,
              },
            ],
            orderNumbers: [order.order_number],
            orderIds: [order.id],
          });
        }
      });
    });

    return Array.from(itemMap.values());
  }, [pendingOrders]);

  // Split items by fish vs other
  const fishItems = useMemo(() => {
    return aggregatedItems.filter((item) => item.inventoryItem.category === 'fish');
  }, [aggregatedItems]);

  const otherItems = useMemo(() => {
    return aggregatedItems.filter((item) => item.inventoryItem.category !== 'fish');
  }, [aggregatedItems]);

  // Group other items by category
  const otherItemsByCategory = useMemo(() => {
    const categoryMap = new Map<string, AggregatedItem[]>();

    otherItems.forEach((item) => {
      const category = item.inventoryItem.category;
      const existing = categoryMap.get(category) || [];
      existing.push(item);
      categoryMap.set(category, existing);
    });

    return categoryMap;
  }, [otherItems]);

  // Calculate checked counts
  const otherCheckedCount = useMemo(() => {
    return otherItems.filter((item) =>
      checkedOtherItems.has(`${item.inventoryItem.id}-${item.unitType}`)
    ).length;
  }, [otherItems, checkedOtherItems]);

  const allOtherChecked = otherCheckedCount === otherItems.length && otherItems.length > 0;

  // Toggle category expansion
  const toggleCategory = useCallback((category: string) => {
    setExpandedCategories((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(category)) {
        newSet.delete(category);
      } else {
        newSet.add(category);
      }
      return newSet;
    });
  }, []);

  // Handle toggle check for other items
  const handleToggleOtherCheck = useCallback((item: AggregatedItem) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    const key = `${item.inventoryItem.id}-${item.unitType}`;
    toggleOtherItem(key);
  }, [toggleOtherItem]);

  // Handle order button for fish item
  const handleOrderFish = useCallback((fishItem: SampleFishItem) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    // Navigate to order confirmation with this fish item's data
    router.push({
      pathname: '/(manager)/export-fish-order',
      params: {
        fishItemId: fishItem.id,
        fishItemName: fishItem.name,
        fishItemQuantity: fishItem.quantity.toString(),
        fishItemUnit: fishItem.unitType === 'pack' ? fishItem.pack_unit : fishItem.base_unit,
        fishItemLocations: JSON.stringify(fishItem.locations),
      },
    } as any);
  }, []);

  // Handle mark orders fulfilled
  const handleMarkFulfilled = useCallback(async () => {
    const checkedOrderIds = new Set<string>();
    otherItems
      .filter((item) =>
        checkedOtherItems.has(`${item.inventoryItem.id}-${item.unitType}`)
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
  }, [otherItems, checkedOtherItems, updateOrderStatus, user, clearOtherItems]);

  // Render sample fish item with Order button
  const renderSampleFishItem = useCallback((item: SampleFishItem) => {
    const unitLabel = item.unitType === 'pack' ? item.pack_unit : item.base_unit;

    return (
      <View
        key={item.id}
        className="bg-white rounded-2xl p-4 mb-3 border border-gray-200"
        style={{
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.05,
          shadowRadius: 4,
          elevation: 2,
        }}
      >
        <View className="flex-row items-start justify-between">
          <View className="flex-1 mr-3">
            {/* Item Name */}
            <Text className="font-semibold text-base text-gray-900">
              {item.name}
            </Text>

            {/* Total Quantity */}
            <Text className="font-bold text-lg mt-1 text-primary-600">
              {item.quantity} {unitLabel} total
            </Text>

            {/* Location Breakdown */}
            {item.locations.length > 0 && (
              <View className="mt-3 space-y-1">
                {item.locations.map((loc, idx) => (
                  <View key={idx} className="flex-row items-center">
                    <Ionicons name="location" size={14} color={colors.primary[500]} />
                    <Text className="ml-1.5 text-sm text-gray-600">
                      {loc.name}: {loc.quantity}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Order Numbers */}
            <Text className="text-xs mt-2 text-gray-500">
              Orders: #{item.orderNumbers.join(', #')}
            </Text>
          </View>

          {/* Order Button */}
          <TouchableOpacity
            className="bg-primary-500 rounded-xl px-4 py-2.5 flex-row items-center"
            onPress={() => handleOrderFish(item)}
            activeOpacity={0.8}
          >
            <Ionicons name="cart-outline" size={18} color="white" />
            <Text className="text-white font-semibold ml-1.5">Order</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [handleOrderFish]);

  // Render other item (compact)
  const renderOtherItem = useCallback((item: AggregatedItem) => {
    const key = `${item.inventoryItem.id}-${item.unitType}`;
    const isChecked = checkedOtherItems.has(key);
    const unitLabel = item.unitType === 'pack'
      ? item.inventoryItem.pack_unit
      : item.inventoryItem.base_unit;

    return (
      <TouchableOpacity
        key={key}
        className={`flex-row items-center py-3 px-4 border-b border-gray-100 ${
          isChecked ? 'bg-green-50' : 'bg-white'
        }`}
        onPress={() => handleToggleOtherCheck(item)}
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

        {/* Quantity */}
        <Text
          className={`font-semibold ${
            isChecked ? 'text-gray-400' : 'text-gray-700'
          }`}
        >
          {item.totalQuantity} {unitLabel}
        </Text>
      </TouchableOpacity>
    );
  }, [checkedOtherItems, handleToggleOtherCheck]);

  // Render category section
  const renderCategorySection = useCallback((category: string, items: AggregatedItem[]) => {
    const isExpanded = expandedCategories.has(category);
    const label = CATEGORY_LABELS[category] || category;

    return (
      <View key={category} className="mb-4">
        {/* Category Header */}
        <TouchableOpacity
          className="flex-row items-center justify-between py-2 px-1"
          onPress={() => toggleCategory(category)}
          activeOpacity={0.7}
        >
          <View className="flex-row items-center">
            <Ionicons
              name={isExpanded ? 'chevron-down' : 'chevron-forward'}
              size={20}
              color={colors.gray[500]}
            />
            <Text className="text-sm font-bold text-gray-500 uppercase tracking-wide ml-1">
              {label} ({items.length} items)
            </Text>
          </View>
        </TouchableOpacity>

        {/* Category Items */}
        {isExpanded && (
          <View
            className="bg-white rounded-xl overflow-hidden border border-gray-200"
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.05,
              shadowRadius: 4,
              elevation: 2,
            }}
          >
            {items.map((item) => renderOtherItem(item))}
          </View>
        )}
      </View>
    );
  }, [expandedCategories, toggleCategory, renderOtherItem]);

  // Determine which fish items to display
  const displayFishItems = useSampleData ? SAMPLE_FISH_ORDERS : [];

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      {/* Header */}
      <View className="bg-white px-5 py-4 border-b border-gray-100">
        <View className="flex-row items-center justify-between">
          <Text className="text-2xl font-bold text-gray-900">Fulfillment</Text>
          {/* Sample Data Toggle */}
          <TouchableOpacity
            className={`px-3 py-1.5 rounded-full ${useSampleData ? 'bg-primary-100' : 'bg-gray-100'}`}
            onPress={() => setUseSampleData(!useSampleData)}
          >
            <Text className={`text-xs font-medium ${useSampleData ? 'text-primary-600' : 'text-gray-500'}`}>
              {useSampleData ? 'Sample Data' : 'Real Data'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Tab Bar */}
      <View className="flex-row bg-white border-b border-gray-200">
        <TouchableOpacity
          className={`flex-1 py-3 items-center border-b-2 ${
            activeTab === 'fish' ? 'border-primary-500' : 'border-transparent'
          }`}
          onPress={() => setActiveTab('fish')}
        >
          <Text
            className={`font-semibold ${
              activeTab === 'fish' ? 'text-primary-500' : 'text-gray-500'
            }`}
          >
            🐟 Fish Orders
          </Text>
          {displayFishItems.length > 0 && (
            <View className="absolute top-1 right-8 bg-primary-500 rounded-full w-5 h-5 items-center justify-center">
              <Text className="text-white text-xs font-bold">{displayFishItems.length}</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          className={`flex-1 py-3 items-center border-b-2 ${
            activeTab === 'other' ? 'border-primary-500' : 'border-transparent'
          }`}
          onPress={() => setActiveTab('other')}
        >
          <Text
            className={`font-semibold ${
              activeTab === 'other' ? 'text-primary-500' : 'text-gray-500'
            }`}
          >
            📦 Other Orders
          </Text>
          {otherItems.length > 0 && (
            <View className="absolute top-1 right-6 bg-primary-500 rounded-full w-5 h-5 items-center justify-center">
              <Text className="text-white text-xs font-bold">{otherItems.length}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Content */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: activeTab === 'other' && otherItems.length > 0 ? 100 : 32 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {activeTab === 'fish' ? (
          <>
            {displayFishItems.length === 0 ? (
              <View className="items-center py-12">
                <Text className="text-4xl mb-4">🐟</Text>
                <Text className="text-gray-500 text-center">
                  No fish orders pending
                </Text>
                <Text className="text-gray-400 text-sm text-center mt-2">
                  Toggle "Sample Data" to see test items
                </Text>
              </View>
            ) : (
              <>
                <Text className="text-sm text-gray-500 mb-4">
                  Tap "Order" to place an order with your fish supplier
                </Text>
                {displayFishItems.map((item) => renderSampleFishItem(item))}
              </>
            )}
          </>
        ) : (
          <>
            {otherItems.length === 0 ? (
              <View className="items-center py-12">
                <Text className="text-4xl mb-4">📦</Text>
                <Text className="text-gray-500 text-center">
                  No other orders pending
                </Text>
              </View>
            ) : (
              Array.from(otherItemsByCategory.entries()).map(([category, items]) =>
                renderCategorySection(category, items)
              )
            )}
          </>
        )}
      </ScrollView>

      {/* Bottom Action Bar for Other Orders */}
      {activeTab === 'other' && otherItems.length > 0 && (
        <View className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-gray-600">
              Checked: {otherCheckedCount}/{otherItems.length} items
            </Text>
            <TouchableOpacity
              className={`rounded-xl px-5 py-3 flex-row items-center ${
                allOtherChecked ? 'bg-green-500' : 'bg-gray-300'
              }`}
              onPress={handleMarkFulfilled}
              disabled={!allOtherChecked || isFulfilling}
              activeOpacity={0.8}
            >
              {isFulfilling ? (
                <SpinningFish size="small" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={18} color="white" />
                  <Text className="text-white font-semibold ml-2">
                    Mark Orders Fulfilled
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
