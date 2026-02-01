import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useOrderStore, useInventoryStore, useAuthStore } from '@/store';
import { colors } from '@/constants';
import { Location, InventoryItem, UnitType } from '@/types';
import { ActivityIndicator } from 'react-native';

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

interface CartItemWithDetails {
  inventoryItemId: string;
  quantity: number;
  unitType: UnitType;
  inventoryItem?: InventoryItem;
}

export default function CartScreen() {
  const {
    getCartItems,
    getCartLocationIds,
    getTotalCartCount,
    updateCartItem,
    removeFromCart,
    clearLocationCart,
    clearAllCarts,
    createAndSubmitOrder,
  } = useOrderStore();
  const { items } = useInventoryStore();
  const { user, locations } = useAuthStore();

  // Track expanded items
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const cartLocationIds = getCartLocationIds();
  const totalCartCount = getTotalCartCount();

  // Get locations with cart items
  const locationsWithCart = useMemo(() => {
    return locations.filter(loc => cartLocationIds.includes(loc.id));
  }, [locations, cartLocationIds]);

  // Get cart items with inventory details for a location
  const getCartWithDetails = useCallback((locationId: string): CartItemWithDetails[] => {
    const cartItems = getCartItems(locationId);
    return cartItems.map((cartItem) => ({
      ...cartItem,
      inventoryItem: items.find((item) => item.id === cartItem.inventoryItemId),
    }));
  }, [getCartItems, items]);

  // Toggle item expansion
  const toggleExpand = useCallback((locationId: string, itemId: string) => {
    const key = `${locationId}-${itemId}`;
    setExpandedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  }, []);

  // Handle quantity change
  const handleQuantityChange = useCallback((locationId: string, itemId: string, newQuantity: number, unitType: 'base' | 'pack') => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    updateCartItem(locationId, itemId, newQuantity, unitType);
  }, [updateCartItem]);

  // Handle remove item
  const handleRemoveItem = useCallback((locationId: string, itemId: string, itemName: string) => {
    Alert.alert(
      'Remove Item',
      `Remove ${itemName} from cart?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            if (Platform.OS !== 'web') {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            }
            removeFromCart(locationId, itemId);
          },
        },
      ]
    );
  }, [removeFromCart]);

  // Handle clear location cart
  const handleClearLocationCart = useCallback((locationId: string, locationName: string) => {
    Alert.alert(
      'Clear Cart',
      `Remove all items for ${locationName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            if (Platform.OS !== 'web') {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            }
            clearLocationCart(locationId);
          },
        },
      ]
    );
  }, [clearLocationCart]);

  // Handle clear all carts
  const handleClearAll = useCallback(() => {
    Alert.alert(
      'Clear All Carts',
      'Remove all items from all locations?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: () => {
            if (Platform.OS !== 'web') {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            }
            clearAllCarts();
          },
        },
      ]
    );
  }, [clearAllCarts]);

  // Track which location is currently submitting
  const [submittingLocation, setSubmittingLocation] = useState<string | null>(null);

  // Handle submit order for location
  const handleSubmitOrder = useCallback(async (locationId: string, locationName: string) => {
    if (!user) {
      Alert.alert('Error', 'Please log in first');
      return;
    }

    const cartItems = getCartItems(locationId);
    if (cartItems.length === 0) {
      Alert.alert('Error', 'Cart is empty for this location');
      return;
    }

    setSubmittingLocation(locationId);
    try {
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      const order = await createAndSubmitOrder(locationId, user.id);
      router.push({
        pathname: '/order-confirmation',
        params: {
          orderNumber: order.order_number.toString(),
          locationName: locationName,
        },
      } as any);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to submit order');
    } finally {
      setSubmittingLocation(null);
    }
  }, [user, getCartItems, createAndSubmitOrder]);

  // Render a compact cart item
  const renderCartItem = useCallback((locationId: string, item: CartItemWithDetails) => {
    if (!item.inventoryItem) return null;

    const { inventoryItem, quantity, unitType } = item;
    const emoji = CATEGORY_EMOJI[inventoryItem.category] || '📦';
    const unitLabel = unitType === 'pack' ? inventoryItem.pack_unit : inventoryItem.base_unit;
    const key = `${locationId}-${inventoryItem.id}`;
    const isExpanded = expandedItems.has(key);

    return (
      <View key={inventoryItem.id} className="border-b border-gray-100">
        {/* Compact Row */}
        <TouchableOpacity
          onPress={() => toggleExpand(locationId, inventoryItem.id)}
          className="flex-row items-center py-3"
          activeOpacity={0.7}
        >
          <Text className="text-lg mr-2">{emoji}</Text>
          <View className="flex-1">
            <Text className="text-sm font-medium text-gray-900" numberOfLines={1}>
              {inventoryItem.name}
            </Text>
          </View>
          <Text className="text-sm font-semibold text-gray-700 mr-2">
            {quantity} {unitLabel}
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
            <View className="flex-row items-center justify-between">
              {/* Quantity Controls */}
              <View className="flex-row items-center">
                <TouchableOpacity
                  onPress={() => handleQuantityChange(locationId, inventoryItem.id, quantity - 1, unitType)}
                  className="w-8 h-8 bg-gray-100 rounded-lg items-center justify-center"
                >
                  <Ionicons name="remove" size={18} color={colors.gray[600]} />
                </TouchableOpacity>

                <Text className="mx-3 text-base font-semibold text-gray-900 min-w-[60px] text-center">
                  {quantity}
                </Text>

                <TouchableOpacity
                  onPress={() => handleQuantityChange(locationId, inventoryItem.id, quantity + 1, unitType)}
                  className="w-8 h-8 bg-gray-100 rounded-lg items-center justify-center"
                >
                  <Ionicons name="add" size={18} color={colors.gray[600]} />
                </TouchableOpacity>
              </View>

              {/* Unit Toggle */}
              <View className="flex-row mx-3">
                <TouchableOpacity
                  onPress={() => handleQuantityChange(locationId, inventoryItem.id, quantity, 'pack')}
                  className={`px-3 py-1 rounded-l-lg ${
                    unitType === 'pack' ? 'bg-primary-500' : 'bg-gray-100'
                  }`}
                >
                  <Text className={`text-xs font-medium ${
                    unitType === 'pack' ? 'text-white' : 'text-gray-600'
                  }`}>
                    {inventoryItem.pack_unit}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleQuantityChange(locationId, inventoryItem.id, quantity, 'base')}
                  className={`px-3 py-1 rounded-r-lg ${
                    unitType === 'base' ? 'bg-primary-500' : 'bg-gray-100'
                  }`}
                >
                  <Text className={`text-xs font-medium ${
                    unitType === 'base' ? 'text-white' : 'text-gray-600'
                  }`}>
                    {inventoryItem.base_unit}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Remove Button */}
              <TouchableOpacity
                onPress={() => handleRemoveItem(locationId, inventoryItem.id, inventoryItem.name)}
                className="p-2"
              >
                <Ionicons name="trash-outline" size={18} color={colors.error} />
              </TouchableOpacity>
            </View>

            {/* Pack info */}
            <Text className="text-xs text-gray-400 mt-2">
              {inventoryItem.pack_size} {inventoryItem.base_unit} per {inventoryItem.pack_unit}
            </Text>
          </View>
        )}
      </View>
    );
  }, [expandedItems, toggleExpand, handleQuantityChange, handleRemoveItem]);

  // Render location section
  const renderLocationSection = useCallback((location: Location) => {
    const cartWithDetails = getCartWithDetails(location.id);
    const itemCount = cartWithDetails.length;

    return (
      <View key={location.id} className="mb-4">
        {/* Location Header */}
        <View className="bg-white rounded-t-xl px-4 py-3 border border-gray-200 border-b-0">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center">
              <View className="bg-primary-500 w-10 h-10 rounded-full items-center justify-center mr-3">
                <Text className="text-white font-bold">{location.short_code}</Text>
              </View>
              <View>
                <Text className="text-base font-semibold text-gray-900">{location.name}</Text>
                <Text className="text-sm text-gray-500">
                  {itemCount} item{itemCount !== 1 ? 's' : ''} in cart
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => handleClearLocationCart(location.id, location.name)}
              className="p-2"
            >
              <Ionicons name="trash-outline" size={20} color={colors.gray[400]} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Items List */}
        <View className="bg-white px-4 border-l border-r border-gray-200">
          {cartWithDetails.map((item) => renderCartItem(location.id, item))}
        </View>

        {/* Submit Order Button */}
        <TouchableOpacity
          onPress={() => handleSubmitOrder(location.id, location.name)}
          disabled={submittingLocation === location.id}
          className={`bg-primary-500 py-3 rounded-b-xl items-center flex-row justify-center ${
            submittingLocation === location.id ? 'opacity-70' : ''
          }`}
        >
          {submittingLocation === location.id ? (
            <>
              <ActivityIndicator size="small" color="white" />
              <Text className="text-white font-semibold ml-2">Submitting...</Text>
            </>
          ) : (
            <>
              <Ionicons name="send" size={18} color="white" />
              <Text className="text-white font-semibold ml-2">Submit Order</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    );
  }, [getCartWithDetails, renderCartItem, handleClearLocationCart, handleSubmitOrder, submittingLocation]);

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      {/* Header */}
      <View className="bg-white px-5 py-4 border-b border-gray-100">
        <Text className="text-2xl font-bold text-gray-900">Cart</Text>
      </View>

      {totalCartCount > 0 ? (
        <>
          {/* Summary Bar */}
          <View className="flex-row justify-between items-center px-4 py-3 bg-white border-b border-gray-200">
            <Text className="text-gray-600">
              {totalCartCount} item{totalCartCount !== 1 ? 's' : ''} across {locationsWithCart.length} location{locationsWithCart.length !== 1 ? 's' : ''}
            </Text>
            <TouchableOpacity onPress={handleClearAll}>
              <Text className="text-red-500 font-medium">Clear All</Text>
            </TouchableOpacity>
          </View>

          {/* Cart Sections */}
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          >
            {locationsWithCart.map(renderLocationSection)}
          </ScrollView>
        </>
      ) : (
        <View className="flex-1 items-center justify-center p-8">
          <Ionicons name="cart-outline" size={64} color={colors.gray[300]} />
          <Text className="text-gray-500 text-lg mt-4 text-center">
            Your cart is empty
          </Text>
          <Text className="text-gray-400 text-center mt-2">
            Add items from Quick Order or browse inventory
          </Text>
          <View className="flex-row mt-6">
            <TouchableOpacity
              className="bg-primary-500 rounded-xl px-5 py-3 mr-3 flex-row items-center"
              onPress={() => router.push('/quick-order' as any)}
            >
              <Ionicons name="flash" size={18} color="white" />
              <Text className="text-white font-semibold ml-2">Quick Order</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="bg-gray-200 rounded-xl px-5 py-3"
              onPress={() => router.push('/(tabs)' as any)}
            >
              <Text className="text-gray-700 font-semibold">Browse</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
