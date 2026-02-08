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
import { useScaledStyles } from '@/hooks/useScaledStyles';

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

export default function CartScreen() {
  const ds = useScaledStyles();

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
    setCartItemNote,
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
  const [showItemNoteModal, setShowItemNoteModal] = useState(false);
  const [itemLocationAction, setItemLocationAction] = useState<'add' | 'move' | null>(null);
  const [itemNoteDraft, setItemNoteDraft] = useState('');
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

    if (item.inputMode === 'remaining') {
      Alert.alert('Not available', 'Remaining-mode items cannot be duplicated.');
      setShowItemMenu(false);
      setMenuItem(null);
      return;
    }

    const baseQuantity = item.quantityRequested ?? item.quantity;
    updateCartItem(locationId, item.inventoryItemId, baseQuantity + baseQuantity, item.unitType, {
      cartItemId: item.id,
      inputMode: 'quantity',
      quantityRequested: baseQuantity + baseQuantity,
    });
    setShowItemMenu(false);
    setMenuItem(null);
  }, [menuItem, updateCartItem]);

  const handleToggleItemMode = useCallback(() => {
    if (!menuItem) return;

    const { locationId, item } = menuItem;
    const currentValue =
      item.inputMode === 'quantity'
        ? item.quantityRequested ?? item.quantity
        : item.remainingReported ?? 0;

    if (item.inputMode === 'quantity') {
      updateCartItem(locationId, item.inventoryItemId, Math.max(0, currentValue), item.unitType, {
        cartItemId: item.id,
        inputMode: 'remaining',
        remainingReported: Math.max(0, currentValue),
      });
    } else {
      const nextQuantity = Math.max(1, item.decidedQuantity ?? currentValue ?? 1);
      updateCartItem(locationId, item.inventoryItemId, nextQuantity, item.unitType, {
        cartItemId: item.id,
        inputMode: 'quantity',
        quantityRequested: nextQuantity,
        clearDecision: true,
      });
    }

    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setShowItemMenu(false);
    setMenuItem(null);
  }, [menuItem, updateCartItem]);

  const handleOpenItemNoteModal = useCallback(() => {
    if (!menuItem) return;
    setItemNoteDraft(menuItem.item.note ?? '');
    setShowItemMenu(false);
    setShowItemNoteModal(true);
  }, [menuItem]);

  const handleSaveItemNote = useCallback(() => {
    if (!menuItem) return;
    setCartItemNote(menuItem.locationId, menuItem.item.id, itemNoteDraft);
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setShowItemNoteModal(false);
    setItemNoteDraft('');
    setMenuItem(null);
  }, [menuItem, itemNoteDraft, setCartItemNote]);

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
      if (menuItem.item.inputMode === 'quantity') {
        const qty = menuItem.item.quantityRequested ?? menuItem.item.quantity;
        addToCart(toLocationId, menuItem.item.inventoryItemId, qty, menuItem.item.unitType, {
          inputMode: 'quantity',
          quantityRequested: qty,
          note: menuItem.item.note,
        });
      } else {
        const remaining = menuItem.item.remainingReported ?? 0;
        addToCart(toLocationId, menuItem.item.inventoryItemId, remaining, menuItem.item.unitType, {
          inputMode: 'remaining',
          remainingReported: remaining,
          decidedQuantity: menuItem.item.decidedQuantity,
          decidedBy: menuItem.item.decidedBy,
          decidedAt: menuItem.item.decidedAt,
          note: menuItem.item.note,
        });
      }
    } else {
      moveCartItem(
        menuItem.locationId,
        toLocationId,
        menuItem.item.inventoryItemId,
        menuItem.item.unitType,
        menuItem.item.id
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

    const { inventoryItem, unitType } = item;
    const isRemainingMode = item.inputMode === 'remaining';
    const value = isRemainingMode ? item.remainingReported ?? 0 : item.quantityRequested ?? item.quantity;
    const valueLabel = isRemainingMode ? 'Remaining' : 'Order';
    const emoji = CATEGORY_EMOJI[inventoryItem.category] || '📦';
    const unitLabel = unitType === 'pack' ? inventoryItem.pack_unit : inventoryItem.base_unit;
    const key = `${locationId}-${item.id}`;
    const isExpanded = expandedItems.has(key);
    const itemActionButtonSize = Math.max(52, ds.icon(44));

    return (
      <View key={item.id} className="border-b border-gray-100">
        {/* Compact Row */}
        <TouchableOpacity
          onPress={() => toggleExpand(locationId, item.id)}
          className="flex-row items-center"
          style={{
            minHeight: Math.max(ds.rowH, 60),
            paddingVertical: ds.spacing(8),
          }}
          activeOpacity={0.7}
        >
          <Text style={{ fontSize: ds.fontSize(18) }} className="mr-2">{emoji}</Text>
          <View className="flex-1 mr-2">
            <Text style={{ fontSize: ds.fontSize(15) }} className="font-medium text-gray-900" numberOfLines={1} ellipsizeMode="tail">
              {inventoryItem.name}
            </Text>
            <View className="flex-row items-center flex-wrap mt-1">
              <Text style={{ fontSize: ds.fontSize(13) }} className="font-semibold text-gray-700 mr-2">
                {valueLabel}: {value} {unitLabel}
              </Text>
              {isRemainingMode && (
                <View
                  className="self-start rounded-full bg-amber-100"
                  style={{ paddingHorizontal: ds.spacing(8), paddingVertical: ds.spacing(2), marginRight: ds.spacing(6) }}
                >
                  <Text style={{ fontSize: ds.fontSize(10) }} className="font-semibold text-amber-700">Remaining</Text>
                </View>
              )}
              {item.note && (
                <View
                  className="self-start rounded-full bg-blue-100"
                  style={{ paddingHorizontal: ds.spacing(8), paddingVertical: ds.spacing(2) }}
                >
                  <Text style={{ fontSize: ds.fontSize(10) }} className="font-semibold text-blue-700">Note</Text>
                </View>
              )}
            </View>
          </View>
          <View style={{ minWidth: Math.max(44, ds.icon(28)), alignItems: 'flex-end' }}>
            <Ionicons
              name={isExpanded ? 'chevron-up' : 'chevron-down'}
              size={ds.icon(16)}
              color={colors.gray[400]}
            />
          </View>
        </TouchableOpacity>

        {/* Expanded Controls */}
        {isExpanded && (
          <View className="pb-3 pl-8 pr-2">
            <View className="flex-row items-center justify-between">
              {/* Value Controls */}
              <View className="flex-row items-center">
                <TouchableOpacity
                  onPress={() => handleItemValueChange(locationId, item, value - 1, unitType)}
                  style={{ width: Math.max(44, ds.icon(32)), height: Math.max(44, ds.icon(32)), borderRadius: ds.radius(8) }}
                  className="bg-gray-100 items-center justify-center"
                >
                  <Ionicons name="remove" size={ds.fontSize(18)} color={colors.gray[600]} />
                </TouchableOpacity>

                <Text style={{ fontSize: ds.fontSize(16), minWidth: ds.spacing(56) }} className="mx-3 font-bold text-gray-900 text-center">
                  {value}
                </Text>

                <TouchableOpacity
                  onPress={() => handleItemValueChange(locationId, item, value + 1, unitType)}
                  style={{ width: Math.max(44, ds.icon(32)), height: Math.max(44, ds.icon(32)), borderRadius: ds.radius(8) }}
                  className="bg-gray-100 items-center justify-center"
                >
                  <Ionicons name="add" size={ds.fontSize(18)} color={colors.gray[600]} />
                </TouchableOpacity>
              </View>

              {/* Action Buttons */}
              <View className="flex-row items-center ml-2">
                <TouchableOpacity
                  onPress={() => handleOpenItemMenu(locationId, item)}
                  style={{
                    width: itemActionButtonSize,
                    height: itemActionButtonSize,
                    borderRadius: ds.radius(10),
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="ellipsis-horizontal" size={ds.icon(22)} color={colors.gray[500]} />
                </TouchableOpacity>

                {/* Remove Button */}
                <TouchableOpacity
                  onPress={() => handleRemoveItem(locationId, inventoryItem.id, inventoryItem.name, item.id)}
                  style={{
                    width: itemActionButtonSize,
                    height: itemActionButtonSize,
                    borderRadius: ds.radius(10),
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="trash-outline" size={ds.icon(24)} color={colors.error} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Unit Toggle */}
            <View className="mt-3 flex-row items-center">
              <View className="flex-row self-start">
                <TouchableOpacity
                  onPress={() => handleItemValueChange(locationId, item, value, 'pack')}
                  style={{ paddingHorizontal: ds.spacing(12), paddingVertical: ds.spacing(6), borderTopLeftRadius: ds.radius(8), borderBottomLeftRadius: ds.radius(8), minHeight: 44, justifyContent: 'center' }}
                  className={unitType === 'pack' ? 'bg-primary-500' : 'bg-gray-100'}
                >
                  <Text style={{ fontSize: ds.fontSize(12) }} className={`font-medium ${
                    unitType === 'pack' ? 'text-white' : 'text-gray-600'
                  }`}>
                    {inventoryItem.pack_unit}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleItemValueChange(locationId, item, value, 'base')}
                  style={{ paddingHorizontal: ds.spacing(12), paddingVertical: ds.spacing(6), borderTopRightRadius: ds.radius(8), borderBottomRightRadius: ds.radius(8), minHeight: 44, justifyContent: 'center' }}
                  className={unitType === 'base' ? 'bg-primary-500' : 'bg-gray-100'}
                >
                  <Text style={{ fontSize: ds.fontSize(12) }} className={`font-medium ${
                    unitType === 'base' ? 'text-white' : 'text-gray-600'
                  }`}>
                    {inventoryItem.base_unit}
                  </Text>
                </TouchableOpacity>
              </View>

              {!isRemainingMode && (
                <View style={{ marginLeft: ds.spacing(12), flex: 1, minHeight: 44, justifyContent: 'center' }}>
                  <Text
                    style={{ fontSize: ds.fontSize(12) }}
                    className="text-gray-400 text-left"
                    numberOfLines={2}
                  >
                    {inventoryItem.pack_size} {inventoryItem.base_unit} per {inventoryItem.pack_unit}
                  </Text>
                </View>
              )}
            </View>

            {isRemainingMode ? (
              <>
                {item.note && (
                  <Text style={{ fontSize: ds.fontSize(12) }} className="text-blue-700 mt-2">
                    Note: {item.note}
                  </Text>
                )}
                <Text style={{ fontSize: ds.fontSize(12) }} className="text-gray-500 mt-2">
                  Please confirm quantity before submitting
                </Text>
              </>
            ) : (
              <>
                {item.note && (
                  <Text style={{ fontSize: ds.fontSize(12) }} className="text-blue-700 mt-2">
                    Note: {item.note}
                  </Text>
                )}
              </>
            )}
          </View>
        )}
      </View>
    );
  }, [ds, expandedItems, toggleExpand, handleItemValueChange, handleOpenItemMenu, handleRemoveItem]);

  // Render location section
  const renderLocationSection = useCallback((location: Location) => {
    const cartWithDetails = getCartWithDetails(location.id);
    const itemCount = cartWithDetails.length;

    return (
      <View key={location.id} className="mb-4">
        {/* Location Header */}
        <View style={{ paddingHorizontal: ds.spacing(16), borderTopLeftRadius: ds.radius(12), borderTopRightRadius: ds.radius(12) }} className="bg-white py-3 border border-gray-200 border-b-0">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center flex-1 mr-2">
              <View style={{ width: ds.icon(40), height: ds.icon(40), borderRadius: ds.icon(20) }} className="bg-primary-500 items-center justify-center mr-3">
                <Text style={{ fontSize: ds.fontSize(13) }} className="text-white font-bold">{location.short_code}</Text>
              </View>
              <View className="flex-1">
                <Text style={{ fontSize: ds.fontSize(16) }} className="font-semibold text-gray-900" numberOfLines={1} ellipsizeMode="tail">
                  {location.name}
                </Text>
                <Text style={{ fontSize: ds.fontSize(13) }} className="text-gray-500">
                  {itemCount} item{itemCount !== 1 ? 's' : ''} in cart
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => handleClearLocationCart(location.id, location.name)}
              className="p-2"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="trash-outline" size={ds.icon(20)} color={colors.gray[400]} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Items List */}
        <View style={{ paddingHorizontal: ds.spacing(16) }} className="bg-white border-l border-r border-gray-200">
          <TouchableOpacity
            onPress={() => handleOpenCartLocationModal(location)}
            className="border-b border-gray-100"
            style={{
              minHeight: Math.max(ds.rowH, 60),
              justifyContent: 'center',
              paddingVertical: ds.spacing(8),
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <View className="flex-row items-center">
              <Ionicons name="location-outline" size={ds.icon(16)} color={colors.gray[500]} />
              <View style={{ marginLeft: ds.spacing(8), flex: 1, marginRight: ds.spacing(8) }}>
                <Text style={{ fontSize: ds.fontSize(12) }} className="text-gray-600">
                  Order Location
                </Text>
                <Text
                  style={{ fontSize: ds.fontSize(14) }}
                  className="font-semibold text-gray-900"
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {location.name}
                </Text>
              </View>
              <Ionicons name="chevron-down" size={ds.icon(16)} color={colors.gray[500]} />
            </View>
          </TouchableOpacity>

          {cartWithDetails.map((item) => renderCartItem(location.id, item))}
        </View>

        {/* Submit Order Button */}
        <TouchableOpacity
          onPress={() => handleSubmitOrder(location.id, location.name)}
          disabled={submittingLocation === location.id}
          style={{ height: ds.buttonH + 4, borderBottomLeftRadius: ds.radius(12), borderBottomRightRadius: ds.radius(12) }}
          className={`items-center flex-row justify-center ${
            submittingLocation === location.id
              ? 'bg-primary-300'
              : 'bg-primary-500'
          }`}
        >
          {submittingLocation === location.id ? (
            <>
              <SpinningFish size="small" />
              <Text style={{ fontSize: ds.buttonFont + 1 }} className="text-white font-semibold ml-2">Submitting...</Text>
            </>
          ) : (
            <>
              <Ionicons name="send" size={ds.icon(18)} color="white" />
              <Text style={{ fontSize: ds.buttonFont + 1 }} className="text-white font-semibold ml-2">Submit Order</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    );
  }, [ds, getCartWithDetails, renderCartItem, handleClearLocationCart, handleSubmitOrder, submittingLocation, handleOpenCartLocationModal]);

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={{ paddingHorizontal: ds.spacing(20) }} className="bg-white py-4 border-b border-gray-100">
        <Text style={{ fontSize: ds.fontSize(24) }} className="font-bold text-gray-900">Cart</Text>
      </View>

      {totalCartCount > 0 ? (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: ds.spacing(16), paddingBottom: ds.spacing(32) }}
        >
          {/* Summary Bar */}
          <View
            style={{ paddingHorizontal: ds.spacing(16), borderRadius: ds.radius(12), minHeight: Math.max(52, ds.rowH - ds.spacing(8)) }}
            className="flex-row items-center bg-white border border-gray-200 mb-4"
          >
            <Text style={{ fontSize: ds.fontSize(14) }} className="text-gray-600 flex-1" numberOfLines={2}>
              {totalCartCount} item{totalCartCount !== 1 ? 's' : ''} across {locationsWithCart.length} location{locationsWithCart.length !== 1 ? 's' : ''}
            </Text>
            <TouchableOpacity onPress={handleClearAll} style={{ marginLeft: ds.spacing(10), minHeight: 44, justifyContent: 'center', paddingVertical: ds.spacing(4) }}>
              <Text style={{ fontSize: ds.fontSize(14) }} className="text-red-500 font-medium">Clear All</Text>
            </TouchableOpacity>
          </View>

          {/* Cart Sections */}
          {locationsWithCart.map(renderLocationSection)}
        </ScrollView>
      ) : (
        <View style={{ padding: ds.spacing(32) }} className="flex-1 items-center justify-center">
          <Ionicons name="cart-outline" size={ds.icon(64)} color={colors.gray[300]} />
          <Text style={{ fontSize: ds.fontSize(18) }} className="text-gray-500 mt-4 text-center">
            Your cart is empty
          </Text>
          <Text style={{ fontSize: ds.fontSize(15) }} className="text-gray-400 text-center mt-2">
            Add items from Quick Order or browse inventory
          </Text>
          <View className="flex-row mt-6">
            <TouchableOpacity
              style={{ borderRadius: ds.radius(12), paddingHorizontal: ds.spacing(20), height: ds.buttonH }}
              className="bg-primary-500 mr-3 flex-row items-center justify-center"
              onPress={() => router.push('/quick-order' as any)}
            >
              <Ionicons name="flash" size={ds.icon(18)} color="white" />
              <Text style={{ fontSize: ds.buttonFont }} className="text-white font-semibold ml-2">Quick Order</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ borderRadius: ds.radius(12), paddingHorizontal: ds.spacing(20), height: ds.buttonH }}
              className="bg-gray-200 items-center justify-center"
              onPress={() => router.push('/(tabs)' as any)}
            >
              <Text style={{ fontSize: ds.buttonFont }} className="text-gray-700 font-semibold">Browse</Text>
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

            <View style={{ paddingHorizontal: ds.spacing(24) }} className="pb-8">
              <Text style={{ fontSize: ds.fontSize(20) }} className="font-bold text-gray-900 mb-2">
                Change Cart Location
              </Text>
              <Text style={{ fontSize: ds.fontSize(14) }} className="text-gray-500 mb-4">
                Move all items from {cartLocationToMove?.name || 'this cart'}
              </Text>

              <ScrollView
                style={{ maxHeight: ds.spacing(360) }}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: ds.spacing(8) }}
              >
                {locations.map((loc) => {
                  const isSelected = cartLocationToMove?.id === loc.id;
                  return (
                    <TouchableOpacity
                      key={loc.id}
                      style={{ padding: ds.spacing(16), borderRadius: ds.radius(12) }}
                      className={`flex-row items-center mb-3 border-2 ${
                        isSelected ? 'border-primary-500 bg-primary-50' : 'border-gray-200 bg-white'
                      }`}
                      onPress={() => handleMoveCartLocation(loc.id, loc.name)}
                      activeOpacity={0.7}
                    >
                      <View style={{ width: ds.icon(44), height: ds.icon(44), borderRadius: ds.icon(22) }} className={`items-center justify-center ${
                        isSelected ? 'bg-primary-500' : 'bg-gray-100'
                      }`}>
                        <Text style={{ fontSize: ds.fontSize(13) }} className={`font-bold ${isSelected ? 'text-white' : 'text-gray-600'}`}>
                          {loc.short_code}
                        </Text>
                      </View>
                      <View className="flex-1 ml-4">
                        <Text style={{ fontSize: ds.fontSize(16) }} className="font-semibold text-gray-900">
                          {loc.name}
                        </Text>
                        {isSelected && (
                          <Text style={{ fontSize: ds.fontSize(13) }} className="text-primary-600">Current location</Text>
                        )}
                      </View>
                      {isSelected && (
                        <Ionicons name="checkmark-circle" size={ds.icon(20)} color={colors.primary[500]} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <TouchableOpacity
                onPress={() => {
                  setShowCartLocationModal(false);
                  setCartLocationToMove(null);
                }}
                className="py-4 mt-2"
              >
                <Text style={{ fontSize: ds.fontSize(14) }} className="text-gray-500 font-medium text-center">Cancel</Text>
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
            style={{ paddingHorizontal: ds.spacing(24) }}
            className="bg-white rounded-t-3xl pt-4 pb-6"
            onPress={(e) => e.stopPropagation()}
          >
            <View className="items-center pb-3">
              <View className="w-10 h-1 bg-gray-300 rounded-full" />
            </View>
            <Text style={{ fontSize: ds.fontSize(18) }} className="font-bold text-gray-900 mb-1">Item Actions</Text>
            <Text style={{ fontSize: ds.fontSize(13) }} className="text-gray-500 mb-4">
              {menuItem?.item.inventoryItem?.name || 'Item'}
            </Text>

            <TouchableOpacity
              onPress={handleDuplicateItem}
              className={`flex-row items-center py-3 ${menuItem?.item.inputMode === 'remaining' ? 'opacity-50' : ''}`}
              disabled={menuItem?.item.inputMode === 'remaining'}
            >
              <Ionicons name="copy-outline" size={ds.icon(20)} color={colors.gray[600]} />
              <Text style={{ fontSize: ds.fontSize(16) }} className="text-gray-800 ml-3">Duplicate item</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleToggleItemMode}
              className="flex-row items-center py-3"
            >
              <Ionicons
                name={menuItem?.item.inputMode === 'remaining' ? 'list-outline' : 'albums-outline'}
                size={ds.icon(20)}
                color={colors.gray[600]}
              />
              <Text style={{ fontSize: ds.fontSize(16) }} className="text-gray-800 ml-3">
                {menuItem?.item.inputMode === 'remaining' ? 'Change to Order' : 'Change to Remaining'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleOpenItemNoteModal}
              className="flex-row items-center py-3"
            >
              <Ionicons name="create-outline" size={ds.icon(20)} color={colors.gray[600]} />
              <Text style={{ fontSize: ds.fontSize(16) }} className="text-gray-800 ml-3">
                {menuItem?.item.note ? 'Edit Note' : 'Add Note'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => handleOpenItemLocationModal('add')}
              className={`flex-row items-center py-3 ${hasOtherLocations ? '' : 'opacity-50'}`}
              disabled={!hasOtherLocations}
            >
              <Ionicons name="add-circle-outline" size={ds.icon(20)} color={colors.gray[600]} />
              <Text style={{ fontSize: ds.fontSize(16) }} className="text-gray-800 ml-3">Add to other cart</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => handleOpenItemLocationModal('move')}
              className={`flex-row items-center py-3 ${hasOtherLocations ? '' : 'opacity-50'}`}
              disabled={!hasOtherLocations}
            >
              <Ionicons name="swap-horizontal" size={ds.icon(20)} color={colors.gray[600]} />
              <Text style={{ fontSize: ds.fontSize(16) }} className="text-gray-800 ml-3">Move to other cart</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setShowItemMenu(false);
                setMenuItem(null);
              }}
              className="py-4"
            >
              <Text style={{ fontSize: ds.fontSize(14) }} className="text-gray-500 font-medium text-center">Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Item Note Modal */}
      <Modal
        visible={showItemNoteModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowItemNoteModal(false);
          setItemNoteDraft('');
          setMenuItem(null);
        }}
      >
        <Pressable
          className="flex-1 bg-black/40 justify-end"
          onPress={() => {
            setShowItemNoteModal(false);
            setItemNoteDraft('');
            setMenuItem(null);
          }}
        >
          <Pressable
            style={{ paddingHorizontal: ds.spacing(24) }}
            className="bg-white rounded-t-3xl pt-4 pb-6"
            onPress={(e) => e.stopPropagation()}
          >
            <View className="items-center pb-3">
              <View className="w-10 h-1 bg-gray-300 rounded-full" />
            </View>
            <Text style={{ fontSize: ds.fontSize(18) }} className="font-bold text-gray-900 mb-1">
              {menuItem?.item.note ? 'Edit Note' : 'Add Note'}
            </Text>
            <Text style={{ fontSize: ds.fontSize(13) }} className="text-gray-500 mb-4">
              {menuItem?.item.inventoryItem?.name || 'Item'}
            </Text>

            <TextInput
              value={itemNoteDraft}
              onChangeText={setItemNoteDraft}
              placeholder="Add special request for manager..."
              placeholderTextColor={colors.gray[400]}
              multiline
              maxLength={240}
              textAlignVertical="top"
              style={{ fontSize: ds.fontSize(14), borderRadius: ds.radius(12), paddingHorizontal: ds.spacing(16) }}
              className="min-h-[110px] border border-gray-200 py-3 text-gray-900 bg-gray-50"
            />
            <Text style={{ fontSize: ds.fontSize(12) }} className="text-gray-400 mt-2">
              {itemNoteDraft.length}/240
            </Text>

            <View className="flex-row mt-5">
              <TouchableOpacity
                onPress={() => {
                  setShowItemNoteModal(false);
                  setItemNoteDraft('');
                  setMenuItem(null);
                }}
                style={{ height: ds.buttonH, borderRadius: ds.radius(12) }}
                className="flex-1 bg-gray-100 mr-2 items-center justify-center"
              >
                <Text style={{ fontSize: ds.buttonFont }} className="text-gray-700 font-semibold">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSaveItemNote}
                style={{ height: ds.buttonH, borderRadius: ds.radius(12) }}
                className="flex-1 bg-primary-500 ml-2 items-center justify-center"
              >
                <Text style={{ fontSize: ds.buttonFont }} className="text-white font-semibold">Save Note</Text>
              </TouchableOpacity>
            </View>
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

            <View style={{ paddingHorizontal: ds.spacing(24) }} className="pb-8">
              <Text style={{ fontSize: ds.fontSize(20) }} className="font-bold text-gray-900 mb-2">
                {itemLocationAction === 'add' ? 'Add to Cart' : 'Move to Cart'}
              </Text>
              <Text style={{ fontSize: ds.fontSize(14) }} className="text-gray-500 mb-4">
                {menuItem?.item.inventoryItem?.name || 'Item'}
              </Text>

              <ScrollView
                style={{ maxHeight: ds.spacing(360) }}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: ds.spacing(8) }}
              >
                {locations
                  .filter((loc) => loc.id !== menuItem?.locationId)
                  .map((loc) => {
                    const cartCount = getCartItems(loc.id).length;
                    return (
                      <TouchableOpacity
                        key={loc.id}
                        style={{ padding: ds.spacing(16), borderRadius: ds.radius(12) }}
                        className="flex-row items-center mb-3 border-2 border-gray-200 bg-white"
                        onPress={() => handleApplyItemLocation(loc.id, loc.name)}
                        activeOpacity={0.7}
                      >
                        <View style={{ width: ds.icon(44), height: ds.icon(44), borderRadius: ds.icon(22) }} className="bg-primary-100 items-center justify-center">
                          <Text style={{ fontSize: ds.fontSize(13) }} className="text-primary-600 font-bold">
                            {loc.short_code}
                          </Text>
                        </View>
                        <View className="flex-1 ml-4">
                          <Text style={{ fontSize: ds.fontSize(16) }} className="font-semibold text-gray-900">
                            {loc.name}
                          </Text>
                          {cartCount > 0 && (
                            <Text style={{ fontSize: ds.fontSize(13) }} className="text-gray-500">
                              {cartCount} item{cartCount !== 1 ? 's' : ''} in cart
                            </Text>
                          )}
                        </View>
                        <Ionicons name="arrow-forward" size={ds.icon(20)} color={colors.primary[500]} />
                      </TouchableOpacity>
                    );
                  })}
              </ScrollView>

              <TouchableOpacity
                onPress={() => {
                  setShowItemLocationModal(false);
                  setItemLocationAction(null);
                }}
                className="py-4 mt-2"
              >
                <Text style={{ fontSize: ds.fontSize(14) }} className="text-gray-500 font-medium text-center">Cancel</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
