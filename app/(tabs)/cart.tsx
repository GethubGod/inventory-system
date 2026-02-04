import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useOrderStore, useInventoryStore, useAuthStore } from '@/store';
import { colors } from '@/constants';
import { Location, InventoryItem, UnitType } from '@/types';
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
    addToCart,
    updateCartItem,
    removeFromCart,
    moveCartItem,
    moveLocationCartItems,
    clearLocationCart,
    clearAllCarts,
    createAndSubmitOrder,
  } = useOrderStore();
  const { items } = useInventoryStore();
  const { user, locations } = useAuthStore();

  // Track expanded items
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // Cart location change modal state
  const [showCartLocationModal, setShowCartLocationModal] = useState(false);
  const [cartLocationToMove, setCartLocationToMove] = useState<Location | null>(null);

  // Item menu state
  const [showItemMenu, setShowItemMenu] = useState(false);
  const [showItemLocationModal, setShowItemLocationModal] = useState(false);
  const [itemLocationAction, setItemLocationAction] = useState<'add' | 'move' | null>(null);
  const [menuItem, setMenuItem] = useState<{
    locationId: string;
    item: CartItemWithDetails;
  } | null>(null);

  const cartLocationIds = getCartLocationIds();
  const totalCartCount = getTotalCartCount();

  // Get locations with cart items
  const locationsWithCart = useMemo(() => {
    return locations.filter(loc => cartLocationIds.includes(loc.id));
  }, [locations, cartLocationIds]);

  const hasOtherLocations = useMemo(() => {
    if (!menuItem) return false;
    return locations.some((loc) => loc.id !== menuItem.locationId);
  }, [locations, menuItem]);

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

  const handleOpenCartLocationModal = useCallback((location: Location) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setCartLocationToMove(location);
    setShowCartLocationModal(true);
  }, []);

  const handleMoveCartLocation = useCallback((toLocationId: string, toLocationName: string) => {
    if (!cartLocationToMove) return;
    if (cartLocationToMove.id === toLocationId) {
      setShowCartLocationModal(false);
      return;
    }

    Alert.alert(
      'Change Cart Location',
      `Move all items from ${cartLocationToMove.name} to ${toLocationName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Move',
          onPress: () => {
            if (Platform.OS !== 'web') {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
            moveLocationCartItems(cartLocationToMove.id, toLocationId);
            setShowCartLocationModal(false);
            setCartLocationToMove(null);
          },
        },
      ]
    );
  }, [cartLocationToMove, moveLocationCartItems]);

  const handleOpenItemMenu = useCallback((locationId: string, item: CartItemWithDetails) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setMenuItem({ locationId, item });
    setShowItemMenu(true);
  }, []);

  const handleDuplicateItem = useCallback(() => {
    if (!menuItem) return;
    const { locationId, item } = menuItem;
    if (!item.inventoryItem) return;
    updateCartItem(locationId, item.inventoryItemId, item.quantity + item.quantity, item.unitType);
    setShowItemMenu(false);
    setMenuItem(null);
  }, [menuItem, updateCartItem]);

  const handleOpenItemLocationModal = useCallback((action: 'add' | 'move') => {
    setItemLocationAction(action);
    setShowItemMenu(false);
    setShowItemLocationModal(true);
  }, []);

  const handleApplyItemLocation = useCallback((toLocationId: string, toLocationName: string) => {
    if (!menuItem || !itemLocationAction) return;
    if (menuItem.locationId === toLocationId) {
      setShowItemLocationModal(false);
      return;
    }

    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    if (itemLocationAction === 'add') {
      addToCart(toLocationId, menuItem.item.inventoryItemId, menuItem.item.quantity, menuItem.item.unitType);
    } else {
      moveCartItem(
        menuItem.locationId,
        toLocationId,
        menuItem.item.inventoryItemId,
        menuItem.item.unitType
      );
    }

    setShowItemLocationModal(false);
    setItemLocationAction(null);
    setMenuItem(null);
  }, [menuItem, itemLocationAction, addToCart, moveCartItem]);

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

              {/* Action Buttons */}
              <View className="flex-row items-center">
                <TouchableOpacity
                  onPress={() => handleOpenItemMenu(locationId, item)}
                  className="p-2 mr-1"
                >
                  <Ionicons name="ellipsis-horizontal" size={18} color={colors.gray[500]} />
                </TouchableOpacity>

                {/* Remove Button */}
                <TouchableOpacity
                  onPress={() => handleRemoveItem(locationId, inventoryItem.id, inventoryItem.name)}
                  className="p-2"
                >
                  <Ionicons name="trash-outline" size={18} color={colors.error} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Pack info */}
            <Text className="text-xs text-gray-400 mt-2">
              {inventoryItem.pack_size} {inventoryItem.base_unit} per {inventoryItem.pack_unit}
            </Text>
          </View>
        )}
      </View>
    );
  }, [expandedItems, toggleExpand, handleQuantityChange, handleOpenItemMenu, handleRemoveItem]);

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
          <TouchableOpacity
            onPress={() => handleOpenCartLocationModal(location)}
            className="flex-row items-center justify-between py-3 border-b border-gray-100"
          >
            <View className="flex-row items-center">
              <Ionicons name="location-outline" size={16} color={colors.gray[500]} />
              <Text className="text-sm text-gray-600 ml-2">Order Location</Text>
            </View>
            <View className="flex-row items-center">
              <Text className="text-sm font-semibold text-gray-900 mr-1">
                {location.name}
              </Text>
              <Ionicons name="chevron-down" size={16} color={colors.gray[500]} />
            </View>
          </TouchableOpacity>

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
              <SpinningFish size="small" />
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
  }, [getCartWithDetails, renderCartItem, handleClearLocationCart, handleSubmitOrder, submittingLocation, handleOpenCartLocationModal]);

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      {/* Header */}
      <View className="bg-white px-5 py-4 border-b border-gray-100">
        <Text className="text-2xl font-bold text-gray-900">Cart</Text>
      </View>

      {totalCartCount > 0 ? (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        >
          {/* Summary Bar */}
          <View className="flex-row justify-between items-center px-4 py-3 bg-white border border-gray-200 rounded-xl mb-4">
            <Text className="text-gray-600">
              {totalCartCount} item{totalCartCount !== 1 ? 's' : ''} across {locationsWithCart.length} location{locationsWithCart.length !== 1 ? 's' : ''}
            </Text>
            <TouchableOpacity onPress={handleClearAll}>
              <Text className="text-red-500 font-medium">Clear All</Text>
            </TouchableOpacity>
          </View>

          {/* Cart Sections */}
          {locationsWithCart.map(renderLocationSection)}
        </ScrollView>
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

      {/* Cart Location Modal */}
      <Modal
        visible={showCartLocationModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setShowCartLocationModal(false);
          setCartLocationToMove(null);
        }}
      >
        <Pressable
          className="flex-1 bg-black/50 justify-end"
          onPress={() => {
            setShowCartLocationModal(false);
            setCartLocationToMove(null);
          }}
        >
          <Pressable
            className="bg-white rounded-t-3xl"
            onPress={(e) => e.stopPropagation()}
          >
            <View className="items-center pt-3 pb-2">
              <View className="w-10 h-1 bg-gray-300 rounded-full" />
            </View>

            <View className="px-6 pb-8">
              <Text className="text-xl font-bold text-gray-900 mb-2">
                Change Cart Location
              </Text>
              <Text className="text-gray-500 mb-4">
                Move all items from {cartLocationToMove?.name || 'this cart'}
              </Text>

              {locations.map((loc) => {
                const isSelected = cartLocationToMove?.id === loc.id;
                return (
                  <TouchableOpacity
                    key={loc.id}
                    className={`flex-row items-center p-4 rounded-xl mb-3 border-2 ${
                      isSelected ? 'border-primary-500 bg-primary-50' : 'border-gray-200 bg-white'
                    }`}
                    onPress={() => handleMoveCartLocation(loc.id, loc.name)}
                    activeOpacity={0.7}
                  >
                    <View className={`w-11 h-11 rounded-full items-center justify-center ${
                      isSelected ? 'bg-primary-500' : 'bg-gray-100'
                    }`}>
                      <Text className={`font-bold text-sm ${isSelected ? 'text-white' : 'text-gray-600'}`}>
                        {loc.short_code}
                      </Text>
                    </View>
                    <View className="flex-1 ml-4">
                      <Text className="font-semibold text-base text-gray-900">
                        {loc.name}
                      </Text>
                      {isSelected && (
                        <Text className="text-sm text-primary-600">Current location</Text>
                      )}
                    </View>
                    {isSelected && (
                      <Ionicons name="checkmark-circle" size={20} color={colors.primary[500]} />
                    )}
                  </TouchableOpacity>
                );
              })}

              <TouchableOpacity
                onPress={() => {
                  setShowCartLocationModal(false);
                  setCartLocationToMove(null);
                }}
                className="py-4 mt-2"
              >
                <Text className="text-gray-500 font-medium text-center">Cancel</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Item Actions Menu */}
      <Modal
        visible={showItemMenu}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowItemMenu(false);
          setMenuItem(null);
        }}
      >
        <Pressable
          className="flex-1 bg-black/40 justify-end"
          onPress={() => {
            setShowItemMenu(false);
            setMenuItem(null);
          }}
        >
          <Pressable
            className="bg-white rounded-t-3xl px-6 pt-4 pb-6"
            onPress={(e) => e.stopPropagation()}
          >
            <View className="items-center pb-3">
              <View className="w-10 h-1 bg-gray-300 rounded-full" />
            </View>
            <Text className="text-lg font-bold text-gray-900 mb-1">Item Actions</Text>
            <Text className="text-sm text-gray-500 mb-4">
              {menuItem?.item.inventoryItem?.name || 'Item'}
            </Text>

            <TouchableOpacity
              onPress={handleDuplicateItem}
              className="flex-row items-center py-3"
            >
              <Ionicons name="copy-outline" size={20} color={colors.gray[600]} />
              <Text className="text-base text-gray-800 ml-3">Duplicate item</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => handleOpenItemLocationModal('add')}
              className={`flex-row items-center py-3 ${hasOtherLocations ? '' : 'opacity-50'}`}
              disabled={!hasOtherLocations}
            >
              <Ionicons name="add-circle-outline" size={20} color={colors.gray[600]} />
              <Text className="text-base text-gray-800 ml-3">Add to other cart</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => handleOpenItemLocationModal('move')}
              className={`flex-row items-center py-3 ${hasOtherLocations ? '' : 'opacity-50'}`}
              disabled={!hasOtherLocations}
            >
              <Ionicons name="swap-horizontal" size={20} color={colors.gray[600]} />
              <Text className="text-base text-gray-800 ml-3">Move to other cart</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setShowItemMenu(false);
                setMenuItem(null);
              }}
              className="py-4"
            >
              <Text className="text-gray-500 font-medium text-center">Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Item Location Picker */}
      <Modal
        visible={showItemLocationModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setShowItemLocationModal(false);
          setItemLocationAction(null);
        }}
      >
        <Pressable
          className="flex-1 bg-black/50 justify-end"
          onPress={() => {
            setShowItemLocationModal(false);
            setItemLocationAction(null);
          }}
        >
          <Pressable
            className="bg-white rounded-t-3xl"
            onPress={(e) => e.stopPropagation()}
          >
            <View className="items-center pt-3 pb-2">
              <View className="w-10 h-1 bg-gray-300 rounded-full" />
            </View>

            <View className="px-6 pb-8">
              <Text className="text-xl font-bold text-gray-900 mb-2">
                {itemLocationAction === 'add' ? 'Add to Cart' : 'Move to Cart'}
              </Text>
              <Text className="text-gray-500 mb-4">
                {menuItem?.item.inventoryItem?.name || 'Item'}
              </Text>

              {locations
                .filter((loc) => loc.id !== menuItem?.locationId)
                .map((loc) => {
                  const cartCount = getCartItems(loc.id).length;
                  return (
                    <TouchableOpacity
                      key={loc.id}
                      className="flex-row items-center p-4 rounded-xl mb-3 border-2 border-gray-200 bg-white"
                      onPress={() => handleApplyItemLocation(loc.id, loc.name)}
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
                onPress={() => {
                  setShowItemLocationModal(false);
                  setItemLocationAction(null);
                }}
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
