import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
  Modal,
  Pressable,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useOrderStore, useInventoryStore, useAuthStore } from '@/store';
import type { CartItem } from '@/store';
import { colors } from '@/constants';
import { Location, InventoryItem, UnitType } from '@/types';
import { SpinningFish } from '@/components';
import { getInventoryWithStock } from '@/lib/api/stock';

// Category emoji mapping
const CATEGORY_EMOJI: Record<string, string> = {
  fish: '🐟',
  protein: '🥩',
  produce: '🥬',
  dry: '🍚',
  dairy_cold: '🧊',
  frozen: '❄️',
  sauces: '🍶',
  alcohol: '🍺',
  packaging: '📦',
};

interface CartItemWithDetails extends CartItem {
  inventoryItem?: InventoryItem;
}

export default function ManagerCartScreen() {
  const {
    getCartItems,
    getCartLocationIds,
    getTotalCartCount,
    getUndecidedRemainingItems,
    setCartItemDecision,
    updateCartItem,
    removeFromCart,
    moveCartItem,
    clearLocationCart,
    clearAllCarts,
    createAndSubmitOrder,
  } = useOrderStore();
  const { items } = useInventoryStore();
  const { user, locations } = useAuthStore();

  // Track expanded items
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // Move item modal state
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [itemToMove, setItemToMove] = useState<{
    locationId: string;
    cartItemId: string;
    inventoryItemId: string;
    itemName: string;
    unitType: UnitType;
  } | null>(null);

  const cartLocationIds = getCartLocationIds();
  const totalCartCount = getTotalCartCount();
  const [stockTargetsByKey, setStockTargetsByKey] = useState<
    Record<string, { min: number; max: number }>
  >({});

  // Get locations with cart items
  const locationsWithCart = useMemo(() => {
    return locations.filter(loc => cartLocationIds.includes(loc.id));
  }, [locations, cartLocationIds]);

  const remainingSignature = useMemo(() => {
    return cartLocationIds
      .map((locationId) => {
        const remainingKeys = getCartItems(locationId)
          .filter((entry) => entry.inputMode === 'remaining')
          .map((entry) => entry.inventoryItemId)
          .sort()
          .join(',');
        return `${locationId}:${remainingKeys}`;
      })
      .join('|');
  }, [cartLocationIds, getCartItems]);

  useEffect(() => {
    let isMounted = true;

    const loadTargets = async () => {
      const locationIds = cartLocationIds.filter((locationId) =>
        getCartItems(locationId).some((entry) => entry.inputMode === 'remaining')
      );

      if (locationIds.length === 0) {
        if (isMounted) {
          setStockTargetsByKey({});
        }
        return;
      }

      const nextMap: Record<string, { min: number; max: number }> = {};

      await Promise.all(
        locationIds.map(async (locationId) => {
          try {
            const stockRows = await getInventoryWithStock(locationId);
            stockRows.forEach((row) => {
              nextMap[`${locationId}:${row.inventory_item.id}`] = {
                min: Number(row.min_quantity ?? 0),
                max: Number(row.max_quantity ?? 0),
              };
            });
          } catch {
            // Ignore transient failures; manager can still decide manually.
          }
        })
      );

      if (isMounted) {
        setStockTargetsByKey(nextMap);
      }
    };

    loadTargets();

    return () => {
      isMounted = false;
    };
  }, [cartLocationIds, getCartItems, remainingSignature]);

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

  const handleItemValueChange = useCallback(
    (locationId: string, item: CartItemWithDetails, nextValue: number, unitType: UnitType) => {
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }

      if (item.inputMode === 'quantity') {
        updateCartItem(locationId, item.inventoryItemId, nextValue, unitType, {
          cartItemId: item.id,
          inputMode: 'quantity',
          quantityRequested: nextValue,
        });
        return;
      }

      updateCartItem(locationId, item.inventoryItemId, Math.max(0, nextValue), unitType, {
        cartItemId: item.id,
        inputMode: 'remaining',
        remainingReported: Math.max(0, nextValue),
      });
    },
    [updateCartItem]
  );

  // Handle remove item
  const handleRemoveItem = useCallback((locationId: string, itemId: string, itemName: string, cartItemId: string) => {
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
            removeFromCart(locationId, itemId, cartItemId);
          },
        },
      ]
    );
  }, [removeFromCart]);

  // Handle opening move modal
  const handleOpenMoveModal = useCallback((
    locationId: string,
    cartItemId: string,
    inventoryItemId: string,
    itemName: string,
    unitType: UnitType
  ) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setItemToMove({ locationId, cartItemId, inventoryItemId, itemName, unitType });
    setShowMoveModal(true);
  }, []);

  // Handle moving item to another location
  const handleMoveItem = useCallback((toLocationId: string) => {
    if (!itemToMove) return;

    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    moveCartItem(
      itemToMove.locationId,
      toLocationId,
      itemToMove.inventoryItemId,
      itemToMove.unitType,
      itemToMove.cartItemId
    );
    setShowMoveModal(false);
    setItemToMove(null);
  }, [itemToMove, moveCartItem]);

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

    const undecided = getUndecidedRemainingItems(locationId);
    if (undecided.length > 0) {
      Alert.alert(
        'Decision Required',
        `${undecided.length} remaining item${undecided.length === 1 ? '' : 's'} still need an order quantity before submit.`
      );
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
  }, [user, getCartItems, getUndecidedRemainingItems, createAndSubmitOrder]);

  // Render a compact cart item
  const renderCartItem = useCallback((locationId: string, item: CartItemWithDetails) => {
    if (!item.inventoryItem) return null;

    const { inventoryItem, unitType } = item;
    const isRemainingMode = item.inputMode === 'remaining';
    const remainingValue = item.remainingReported ?? 0;
    const quantityValue = item.quantityRequested ?? item.quantity;
    const undecided = isRemainingMode && (item.decidedQuantity === null || item.decidedQuantity < 0);
    const emoji = CATEGORY_EMOJI[inventoryItem.category] || '📦';
    const unitLabel = unitType === 'pack' ? inventoryItem.pack_unit : inventoryItem.base_unit;
    const key = `${locationId}-${item.id}`;
    const isExpanded = expandedItems.has(key);
    const targetMeta = stockTargetsByKey[`${locationId}:${inventoryItem.id}`];
    const target = targetMeta?.max && targetMeta.max > 0 ? targetMeta.max : targetMeta?.min ?? 0;
    const suggestedQuantity = Math.max(0, target - remainingValue);

    return (
      <View key={item.id} className="border-b border-gray-100">
        {/* Compact Row */}
        <TouchableOpacity
          onPress={() => toggleExpand(locationId, item.id)}
          className="flex-row items-center py-3"
          activeOpacity={0.7}
        >
          <Text className="text-lg mr-2">{emoji}</Text>
          <View className="flex-1">
            <Text className="text-sm font-medium text-gray-900" numberOfLines={1}>
              {inventoryItem.name}
            </Text>
            {isRemainingMode && (
              <View className={`self-start mt-1 px-2 py-0.5 rounded-full ${undecided ? 'bg-red-100' : 'bg-amber-100'}`}>
                <Text className={`text-[10px] font-semibold ${undecided ? 'text-red-700' : 'text-amber-700'}`}>
                  Remaining
                </Text>
              </View>
            )}
          </View>
          <Text className="text-sm font-semibold text-gray-700 mr-2">
            {isRemainingMode
              ? undecided
                ? `Remaining: ${remainingValue}`
                : `Order: ${item.decidedQuantity}`
              : `Order: ${quantityValue}`}{' '}
            {unitLabel}
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
              {/* Value Controls */}
              <View className="flex-row items-center">
                <TouchableOpacity
                  onPress={() =>
                    handleItemValueChange(
                      locationId,
                      item,
                      (isRemainingMode ? remainingValue : quantityValue) - 1,
                      unitType
                    )
                  }
                  className="w-8 h-8 bg-gray-100 rounded-lg items-center justify-center"
                >
                  <Ionicons name="remove" size={18} color={colors.gray[600]} />
                </TouchableOpacity>

                <Text className="mx-3 text-base font-semibold text-gray-900 min-w-[60px] text-center">
                  {isRemainingMode ? remainingValue : quantityValue}
                </Text>

                <TouchableOpacity
                  onPress={() =>
                    handleItemValueChange(
                      locationId,
                      item,
                      (isRemainingMode ? remainingValue : quantityValue) + 1,
                      unitType
                    )
                  }
                  className="w-8 h-8 bg-gray-100 rounded-lg items-center justify-center"
                >
                  <Ionicons name="add" size={18} color={colors.gray[600]} />
                </TouchableOpacity>
              </View>

              {/* Unit Toggle */}
              <View className="flex-row mx-3">
                <TouchableOpacity
                  onPress={() =>
                    handleItemValueChange(
                      locationId,
                      item,
                      isRemainingMode ? remainingValue : quantityValue,
                      'pack'
                    )
                  }
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
                  onPress={() =>
                    handleItemValueChange(
                      locationId,
                      item,
                      isRemainingMode ? remainingValue : quantityValue,
                      'base'
                    )
                  }
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

              {/* Action Buttons */}
              <View className="flex-row items-center">
                {/* Move to Another Location Button */}
                {locations.length > 1 && (
                  <TouchableOpacity
                    onPress={() => handleOpenMoveModal(locationId, item.id, inventoryItem.id, inventoryItem.name, unitType)}
                    className="p-2 mr-1"
                  >
                    <Ionicons name="swap-horizontal" size={18} color={colors.primary[500]} />
                  </TouchableOpacity>
                )}

                {/* Remove Button */}
                <TouchableOpacity
                  onPress={() => handleRemoveItem(locationId, inventoryItem.id, inventoryItem.name, item.id)}
                  className="p-2"
                >
                  <Ionicons name="trash-outline" size={18} color={colors.error} />
                </TouchableOpacity>
              </View>
            </View>

            {isRemainingMode ? (
              <View className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <Text className="text-xs font-medium text-amber-800">
                  Remaining reported: {remainingValue} {unitLabel}
                </Text>
                {targetMeta && (
                  <Text className="text-xs text-amber-700 mt-1">
                    Min {targetMeta.min} • Max {targetMeta.max}
                  </Text>
                )}
                <View className="mt-2 flex-row items-center justify-between">
                  <Text className="text-xs text-amber-700">
                    Suggested order: {suggestedQuantity} {unitLabel}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      if (!user?.id) return;
                      setCartItemDecision(locationId, item.id, suggestedQuantity, user.id);
                    }}
                    className="px-2 py-1 rounded-md bg-amber-200"
                  >
                    <Text className="text-[11px] font-semibold text-amber-800">Set Suggested</Text>
                  </TouchableOpacity>
                </View>

                {targetMeta && targetMeta.max > 0 && remainingValue > targetMeta.max && (
                  <Text className="text-[11px] text-red-600 mt-2">
                    Reported remaining is above max target. Review before submit.
                  </Text>
                )}

                <View className="mt-3">
                  <Text className="text-xs font-semibold text-gray-700 mb-2">Manager order quantity</Text>
                  <View className="flex-row items-center">
                    <TouchableOpacity
                      onPress={() => {
                        if (!user?.id) return;
                        const base = item.decidedQuantity ?? suggestedQuantity;
                        setCartItemDecision(locationId, item.id, Math.max(0, base - 1), user.id);
                      }}
                      className="w-8 h-8 rounded-md bg-white border border-gray-200 items-center justify-center"
                    >
                      <Ionicons name="remove" size={16} color={colors.gray[700]} />
                    </TouchableOpacity>
                    <TextInput
                      value={item.decidedQuantity == null ? '' : String(item.decidedQuantity)}
                      onChangeText={(text) => {
                        if (!user?.id) return;
                        const sanitized = text.replace(/[^0-9.]/g, '');
                        if (!sanitized) return;
                        const parsed = Number(sanitized);
                        if (!Number.isFinite(parsed) || parsed < 0) return;
                        setCartItemDecision(locationId, item.id, parsed, user.id);
                      }}
                      keyboardType="decimal-pad"
                      placeholder="Set qty"
                      placeholderTextColor={colors.gray[400]}
                      className="mx-2 h-8 min-w-[72px] rounded-md border border-gray-200 bg-white px-2 text-center text-sm font-semibold text-gray-900"
                    />
                    <TouchableOpacity
                      onPress={() => {
                        if (!user?.id) return;
                        const base = item.decidedQuantity ?? suggestedQuantity;
                        setCartItemDecision(locationId, item.id, base + 1, user.id);
                      }}
                      className="w-8 h-8 rounded-md bg-white border border-gray-200 items-center justify-center"
                    >
                      <Ionicons name="add" size={16} color={colors.gray[700]} />
                    </TouchableOpacity>
                    {undecided && (
                      <Text className="ml-2 text-[11px] font-medium text-red-600">Required</Text>
                    )}
                  </View>
                </View>
              </View>
            ) : (
              <Text className="text-xs text-gray-400 mt-2">
                {inventoryItem.pack_size} {inventoryItem.base_unit} per {inventoryItem.pack_unit}
              </Text>
            )}
          </View>
        )}
      </View>
    );
  }, [expandedItems, toggleExpand, stockTargetsByKey, user?.id, setCartItemDecision, handleItemValueChange, handleOpenMoveModal, handleRemoveItem, locations.length]);

  // Render location section
  const renderLocationSection = useCallback((location: Location) => {
    const cartWithDetails = getCartWithDetails(location.id);
    const itemCount = cartWithDetails.length;
    const undecidedRemaining = getUndecidedRemainingItems(location.id);
    const hasUndecided = undecidedRemaining.length > 0;

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
          {hasUndecided && (
            <TouchableOpacity
              onPress={() => {
                if (!user?.id) return;
                cartWithDetails
                  .filter((entry) => entry.inputMode === 'remaining')
                  .forEach((entry) => {
                    const targetMeta = stockTargetsByKey[`${location.id}:${entry.inventoryItemId}`];
                    const target =
                      targetMeta?.max && targetMeta.max > 0 ? targetMeta.max : targetMeta?.min ?? 0;
                    const remaining = entry.remainingReported ?? 0;
                    const suggested = Math.max(0, target - remaining);
                    setCartItemDecision(location.id, entry.id, suggested, user.id);
                  });
              }}
              className="self-start mt-3 mb-1 px-3 py-1.5 rounded-lg bg-amber-100"
            >
              <Text className="text-xs font-semibold text-amber-800">Set all suggested</Text>
            </TouchableOpacity>
          )}
          {cartWithDetails.map((item) => renderCartItem(location.id, item))}
        </View>

        {hasUndecided && (
          <View className="px-4 py-2 border-l border-r border-gray-200 bg-red-50">
            <Text className="text-xs text-red-700 font-medium">
              {undecidedRemaining.length} remaining item{undecidedRemaining.length === 1 ? '' : 's'} still require manager order quantity.
            </Text>
          </View>
        )}

        {/* Submit Order Button */}
        <TouchableOpacity
          onPress={() => handleSubmitOrder(location.id, location.name)}
          disabled={submittingLocation === location.id || hasUndecided}
          className={`py-3 rounded-b-xl items-center flex-row justify-center ${
            submittingLocation === location.id || hasUndecided ? 'bg-primary-300' : 'bg-primary-500'
          }`}
        >
          {submittingLocation === location.id ? (
            <>
              <SpinningFish size="small" />
              <Text className="text-white font-semibold ml-2">Submitting...</Text>
            </>
          ) : hasUndecided ? (
            <>
              <Ionicons name="alert-circle-outline" size={18} color="white" />
              <Text className="text-white font-semibold ml-2">Decision Required</Text>
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
  }, [getCartWithDetails, getUndecidedRemainingItems, renderCartItem, handleClearLocationCart, handleSubmitOrder, submittingLocation, stockTargetsByKey, setCartItemDecision, user?.id]);

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
              onPress={() => router.push('/(manager)/quick-order')}
            >
              <Ionicons name="flash" size={18} color="white" />
              <Text className="text-white font-semibold ml-2">Quick Order</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="bg-gray-200 rounded-xl px-5 py-3"
              onPress={() => router.push('/(manager)')}
            >
              <Text className="text-gray-700 font-semibold">Dashboard</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Move Item Modal */}
      <Modal
        visible={showMoveModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowMoveModal(false)}
      >
        <Pressable
          className="flex-1 bg-black/50 justify-end"
          onPress={() => setShowMoveModal(false)}
        >
          <Pressable
            className="bg-white rounded-t-3xl"
            onPress={(e) => e.stopPropagation()}
          >
            {/* Handle bar */}
            <View className="items-center pt-3 pb-2">
              <View className="w-10 h-1 bg-gray-300 rounded-full" />
            </View>

            <View className="px-6 pb-8">
              <Text className="text-xl font-bold text-gray-900 mb-2">
                Move Item
              </Text>
              <Text className="text-gray-500 mb-4">
                Move "{itemToMove?.itemName}" to another location
              </Text>

              {locations
                .filter((loc) => loc.id !== itemToMove?.locationId)
                .map((loc) => {
                  const cartCount = getCartItems(loc.id).length;
                  return (
                    <TouchableOpacity
                      key={loc.id}
                      className="flex-row items-center p-4 rounded-xl mb-3 border-2 border-gray-200 bg-white"
                      onPress={() => handleMoveItem(loc.id)}
                      activeOpacity={0.7}
                    >
                      <View className="w-11 h-11 bg-primary-100 rounded-full items-center justify-center">
                        <Text className="text-primary-600 font-bold text-sm">
                          {loc.short_code}
                        </Text>
                      </View>
                      <View className="flex-1 ml-4">
                        <Text className="font-semibold text-base text-gray-900">
                          {loc.name}
                        </Text>
                        {cartCount > 0 && (
                          <Text className="text-sm text-gray-500">
                            {cartCount} item{cartCount !== 1 ? 's' : ''} in cart
                          </Text>
                        )}
                      </View>
                      <Ionicons name="arrow-forward" size={20} color={colors.primary[500]} />
                    </TouchableOpacity>
                  );
                })}

              <TouchableOpacity
                onPress={() => setShowMoveModal(false)}
                className="py-4 mt-2"
              >
                <Text className="text-gray-500 font-medium text-center">Cancel</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
