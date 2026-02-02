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
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuthStore, useOrderStore, useFulfillmentStore } from '@/store';
import { colors, CATEGORY_LABELS } from '@/constants';
import { OrderWithDetails, InventoryItem, Location } from '@/types';
import { supabase } from '@/lib/supabase';
import { SpinningFish } from '@/components';

// Fish item with order details
interface FishOrderItem {
  inventoryItem: InventoryItem;
  quantity: number;
  unitType: 'base' | 'pack';
  orderedBy: string;
  orderNumber: number;
  orderId: string;
}

// Fish order grouped by location
interface LocationFishOrder {
  location: Location;
  items: FishOrderItem[];
}

// Aggregated item type for other orders
interface AggregatedItem {
  inventoryItem: InventoryItem;
  totalQuantity: number;
  unitType: 'base' | 'pack';
  locationBreakdown: Array<{
    locationId: string;
    locationName: string;
    shortCode: string;
    quantity: number;
    orderedBy: string;
  }>;
  orderNumbers: number[];
  orderIds: string[];
}

type TabType = 'fish' | 'other';

export default function FulfillmentScreen() {
  const { user } = useAuthStore();
  const { orders, updateOrderStatus } = useOrderStore();
  const {
    checkedOtherItems,
    toggleOtherItem,
    clearOtherItems,
  } = useFulfillmentStore();

  const [activeTab, setActiveTab] = useState<TabType>('fish');
  const [refreshing, setRefreshing] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['produce', 'dry', 'protein', 'dairy_cold', 'frozen', 'sauces', 'packaging']));
  const [expandedFishItems, setExpandedFishItems] = useState<Set<string>>(new Set());
  const [isFulfilling, setIsFulfilling] = useState(false);

  // Editable quantities for fish items (locationId-itemId -> quantity)
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

  // Group fish orders by location
  const fishOrdersByLocation = useMemo(() => {
    const locationMap = new Map<string, LocationFishOrder>();

    pendingOrders.forEach((order) => {
      order.order_items?.forEach((orderItem) => {
        const item = orderItem.inventory_item;
        if (!item || item.category !== 'fish') return;

        const locationId = order.location_id;
        let locationOrder = locationMap.get(locationId);

        if (!locationOrder) {
          locationOrder = {
            location: order.location as Location,
            items: [],
          };
          locationMap.set(locationId, locationOrder);
        }

        // Check if this item already exists for this location
        const existingItem = locationOrder.items.find(
          (i) => i.inventoryItem.id === item.id && i.unitType === orderItem.unit_type
        );

        if (existingItem) {
          existingItem.quantity += orderItem.quantity;
        } else {
          locationOrder.items.push({
            inventoryItem: item,
            quantity: orderItem.quantity,
            unitType: orderItem.unit_type,
            orderedBy: order.user?.name || 'Unknown',
            orderNumber: order.order_number,
            orderId: order.id,
          });
        }
      });
    });

    return Array.from(locationMap.values());
  }, [pendingOrders]);

  // Aggregate other (non-fish) items
  const otherItems = useMemo(() => {
    const itemMap = new Map<string, AggregatedItem>();

    pendingOrders.forEach((order) => {
      order.order_items?.forEach((orderItem) => {
        const item = orderItem.inventory_item;
        if (!item || item.category === 'fish') return;

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
              orderedBy: order.user?.name || 'Unknown',
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
                orderedBy: order.user?.name || 'Unknown',
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

  // Toggle fish item expansion
  const toggleFishItemExpand = useCallback((key: string) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setExpandedFishItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  }, []);

  // Handle quantity change for fish item
  const handleQuantityChange = useCallback((locationId: string, itemId: string, newQuantity: number) => {
    const key = `${locationId}-${itemId}`;
    setEditedQuantities((prev) => ({
      ...prev,
      [key]: Math.max(0, newQuantity),
    }));
  }, []);

  // Get displayed quantity (edited or original)
  const getDisplayQuantity = useCallback((locationId: string, itemId: string, originalQuantity: number) => {
    const key = `${locationId}-${itemId}`;
    return editedQuantities[key] ?? originalQuantity;
  }, [editedQuantities]);

  // Handle toggle check for other items
  const handleToggleOtherCheck = useCallback((item: AggregatedItem) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    const key = `${item.inventoryItem.id}-${item.unitType}`;
    toggleOtherItem(key);
  }, [toggleOtherItem]);

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

  // Render fish item in location cart
  const renderFishItem = useCallback((locationId: string, item: FishOrderItem, index: number, totalItems: number) => {
    const key = `${locationId}-${item.inventoryItem.id}`;
    const isExpanded = expandedFishItems.has(key);
    const unitLabel = item.unitType === 'pack' ? item.inventoryItem.pack_unit : item.inventoryItem.base_unit;
    const displayQty = getDisplayQuantity(locationId, item.inventoryItem.id, item.quantity);

    return (
      <View key={key} className={index < totalItems - 1 ? 'border-b border-gray-100' : ''}>
        <TouchableOpacity
          onPress={() => toggleFishItemExpand(key)}
          className="flex-row items-center py-3"
          activeOpacity={0.7}
        >
          <Text className="text-lg mr-2">🐟</Text>
          <View className="flex-1">
            <Text className="text-sm font-medium text-gray-900" numberOfLines={1}>
              {item.inventoryItem.name}
            </Text>
          </View>
          <Text className="text-sm font-semibold text-gray-700 mr-2">
            {displayQty} {unitLabel}
          </Text>
          <Ionicons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.gray[400]}
          />
        </TouchableOpacity>

        {/* Expanded Controls */}
        {isExpanded && (
          <View className="pb-3 pl-8">
            {/* Ordered by info */}
            <View className="flex-row items-center mb-3 bg-blue-50 rounded-lg px-3 py-2">
              <Ionicons name="person" size={14} color="#3B82F6" />
              <Text className="text-sm text-blue-700 ml-2">
                Ordered by: {item.orderedBy}
              </Text>
              <Text className="text-sm text-blue-500 ml-2">
                (Order #{item.orderNumber})
              </Text>
            </View>

            {/* Quantity Controls */}
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center">
                <TouchableOpacity
                  onPress={() => handleQuantityChange(locationId, item.inventoryItem.id, displayQty - 1)}
                  className="w-9 h-9 bg-gray-100 rounded-lg items-center justify-center"
                >
                  <Ionicons name="remove" size={18} color={colors.gray[600]} />
                </TouchableOpacity>

                <TextInput
                  className="w-16 h-9 bg-gray-50 border border-gray-200 rounded-lg mx-2 text-center text-gray-900 font-semibold"
                  value={displayQty.toString()}
                  onChangeText={(text) => {
                    const num = parseFloat(text) || 0;
                    handleQuantityChange(locationId, item.inventoryItem.id, num);
                  }}
                  keyboardType="decimal-pad"
                />

                <TouchableOpacity
                  onPress={() => handleQuantityChange(locationId, item.inventoryItem.id, displayQty + 1)}
                  className="w-9 h-9 bg-gray-100 rounded-lg items-center justify-center"
                >
                  <Ionicons name="add" size={18} color={colors.gray[600]} />
                </TouchableOpacity>

                <Text className="ml-2 text-sm text-gray-500">{unitLabel}</Text>
              </View>
            </View>

            {/* Pack info */}
            <Text className="text-xs text-gray-400 mt-2">
              {item.inventoryItem.pack_size} {item.inventoryItem.base_unit} per {item.inventoryItem.pack_unit}
            </Text>
          </View>
        )}
      </View>
    );
  }, [expandedFishItems, toggleFishItemExpand, getDisplayQuantity, handleQuantityChange]);

  // Handle navigation to export fish order page
  const handleOrderFromSupplier = useCallback((locationOrder: LocationFishOrder) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    // Prepare fish items data with any edited quantities
    const fishItemsData = locationOrder.items.map((item) => {
      const displayQty = getDisplayQuantity(locationOrder.location.id, item.inventoryItem.id, item.quantity);
      const unitLabel = item.unitType === 'pack' ? item.inventoryItem.pack_unit : item.inventoryItem.base_unit;
      return {
        itemId: item.inventoryItem.id,
        itemName: item.inventoryItem.name,
        quantity: displayQty,
        unit: unitLabel,
      };
    });

    router.push({
      pathname: '/(manager)/export-fish-order',
      params: {
        locationName: locationOrder.location.name,
        locationShortCode: locationOrder.location.short_code,
        fishItems: JSON.stringify(fishItemsData),
      },
    });
  }, [getDisplayQuantity]);

  // Render location fish cart
  const renderLocationFishCart = useCallback((locationOrder: LocationFishOrder) => {
    const itemCount = locationOrder.items.length;

    return (
      <View key={locationOrder.location.id} className="mb-4">
        {/* Location Header */}
        <View className="bg-white rounded-t-xl px-4 py-3 border border-gray-200 border-b-0">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center">
              <View className="bg-primary-500 w-10 h-10 rounded-full items-center justify-center mr-3">
                <Text className="text-white font-bold">{locationOrder.location.short_code}</Text>
              </View>
              <View>
                <Text className="text-base font-semibold text-gray-900">{locationOrder.location.name}</Text>
                <Text className="text-sm text-gray-500">
                  {itemCount} fish item{itemCount !== 1 ? 's' : ''}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Items List */}
        <View className="bg-white px-4 border-l border-r border-gray-200">
          {locationOrder.items.map((item, index) => renderFishItem(locationOrder.location.id, item, index, itemCount))}
        </View>

        {/* Order from Supplier Button */}
        <TouchableOpacity
          className="bg-primary-500 py-3 rounded-b-xl items-center flex-row justify-center"
          onPress={() => handleOrderFromSupplier(locationOrder)}
          activeOpacity={0.8}
        >
          <Ionicons name="call-outline" size={18} color="white" />
          <Text className="text-white font-semibold ml-2">Order from Supplier</Text>
        </TouchableOpacity>
      </View>
    );
  }, [renderFishItem, handleOrderFromSupplier]);

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

  // Count total fish items
  const totalFishItems = fishOrdersByLocation.reduce((sum, loc) => sum + loc.items.length, 0);

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      {/* Header */}
      <View className="bg-white px-5 py-4 border-b border-gray-100">
        <Text className="text-2xl font-bold text-gray-900">Fulfillment</Text>
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
          {totalFishItems > 0 && (
            <View className="absolute top-1 right-8 bg-primary-500 rounded-full w-5 h-5 items-center justify-center">
              <Text className="text-white text-xs font-bold">{totalFishItems}</Text>
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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F97316" />
        }
      >
        {activeTab === 'fish' ? (
          <>
            {fishOrdersByLocation.length === 0 ? (
              <View className="items-center py-12">
                <Text className="text-4xl mb-4">🐟</Text>
                <Text className="text-gray-500 text-center">
                  No fish orders pending
                </Text>
              </View>
            ) : (
              <>
                <Text className="text-sm text-gray-500 mb-4">
                  Fish orders grouped by location. Tap items to edit quantities.
                </Text>
                {fishOrdersByLocation.map((locationOrder) => renderLocationFishCart(locationOrder))}
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
