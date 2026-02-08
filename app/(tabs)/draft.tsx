import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuthStore, useDraftStore, useOrderStore, DraftItem } from '@/store';
import { colors } from '@/constants';
import { Location } from '@/types';
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

export default function DraftScreen() {
  const ds = useScaledStyles();
  const { locations } = useAuthStore();
  const {
    getItems,
    updateItem,
    removeItem,
    clearLocationDraft,
    clearAllDrafts,
    getTotalItemCount,
    getAllLocationIds,
  } = useDraftStore();
  const { addToCart } = useOrderStore();

  const totalItemCount = getTotalItemCount();
  const locationIdsWithItems = getAllLocationIds();

  // Get locations that have items
  const locationsWithItems = useMemo(() => {
    return locations.filter(loc => locationIdsWithItems.includes(loc.id));
  }, [locations, locationIdsWithItems]);

  // Handle quantity change
  const handleQuantityChange = useCallback((locationId: string, itemId: string, newQuantity: number, currentUnit: 'base' | 'pack') => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    updateItem(locationId, itemId, newQuantity, currentUnit);
  }, [updateItem]);

  // Handle remove item
  const handleRemoveItem = useCallback((locationId: string, itemId: string, itemName: string) => {
    Alert.alert(
      'Remove Item',
      `Remove ${itemName} from draft?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            if (Platform.OS !== 'web') {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            }
            removeItem(locationId, itemId);
          },
        },
      ]
    );
  }, [removeItem]);

  // Handle clear location
  const handleClearLocation = useCallback((locationId: string, locationName: string) => {
    Alert.alert(
      'Clear Draft',
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
            clearLocationDraft(locationId);
          },
        },
      ]
    );
  }, [clearLocationDraft]);

  // Handle clear all
  const handleClearAll = useCallback(() => {
    Alert.alert(
      'Clear All Drafts',
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
            clearAllDrafts();
          },
        },
      ]
    );
  }, [clearAllDrafts]);

  // Handle submit location to cart
  const handleSubmitLocationToCart = useCallback((locationId: string, locationName: string) => {
    Alert.alert(
      'Add to Cart',
      `Add all ${locationName} items to cart?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add to Cart',
          onPress: () => {
            if (Platform.OS !== 'web') {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }

            const items = getItems(locationId);
            items.forEach((item) => {
              addToCart(locationId, item.inventoryItem.id, item.quantity, item.unit);
            });
            clearLocationDraft(locationId);

            router.push('/cart' as any);
          },
        },
      ]
    );
  }, [getItems, addToCart, clearLocationDraft]);

  // Render a single draft item (compact version)
  const renderDraftItem = useCallback((locationId: string, item: DraftItem) => {
    const { inventoryItem, quantity, unit } = item;
    const emoji = CATEGORY_EMOJI[inventoryItem.category] || '📦';
    const unitLabel = unit === 'pack' ? inventoryItem.pack_unit : inventoryItem.base_unit;

    return (
      <View
        key={inventoryItem.id}
        className="flex-row items-center border-b border-gray-100"
        style={{ paddingVertical: ds.spacing(12), minHeight: ds.rowH }}
      >
        {/* Emoji & Name */}
        <Text style={{ fontSize: ds.fontSize(18), marginRight: ds.spacing(8) }}>{emoji}</Text>
        <View className="flex-1">
          <Text className="font-medium text-gray-900" numberOfLines={1} ellipsizeMode="tail" style={{ fontSize: ds.fontSize(14) }}>
            {inventoryItem.name}
          </Text>
        </View>

        {/* Quantity Controls - Compact */}
        <View className="flex-row items-center">
          <TouchableOpacity
            onPress={() => handleQuantityChange(locationId, inventoryItem.id, quantity - 1, unit)}
            className="bg-gray-100 rounded-md items-center justify-center"
            style={{ width: Math.max(44, ds.icon(28)), height: Math.max(44, ds.icon(28)) }}
          >
            <Ionicons name="remove" size={ds.icon(16)} color={colors.gray[600]} />
          </TouchableOpacity>

          <Text className="font-semibold text-gray-900 text-center" style={{ fontSize: ds.fontSize(13), minWidth: ds.spacing(50), marginHorizontal: ds.spacing(8) }}>
            {quantity} {unitLabel}
          </Text>

          <TouchableOpacity
            onPress={() => handleQuantityChange(locationId, inventoryItem.id, quantity + 1, unit)}
            className="bg-gray-100 rounded-md items-center justify-center"
            style={{ width: Math.max(44, ds.icon(28)), height: Math.max(44, ds.icon(28)) }}
          >
            <Ionicons name="add" size={ds.icon(16)} color={colors.gray[600]} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => handleRemoveItem(locationId, inventoryItem.id, inventoryItem.name)}
            style={{ marginLeft: ds.spacing(12), padding: ds.spacing(4), minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={ds.icon(18)} color={colors.gray[400]} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [handleQuantityChange, handleRemoveItem]);

  // Render location section
  const renderLocationSection = useCallback((location: Location) => {
    const items = getItems(location.id);
    const itemCount = items.length;

    return (
      <View key={location.id} className="mb-4">
        {/* Location Header */}
        <View className="bg-white rounded-t-xl border border-gray-200 border-b-0" style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12) }}>
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center">
              <View className="bg-primary-500 rounded-full items-center justify-center" style={{ width: ds.icon(40), height: ds.icon(40), marginRight: ds.spacing(12) }}>
                <Text className="text-white font-bold" style={{ fontSize: ds.fontSize(12) }}>{location.short_code}</Text>
              </View>
              <View>
                <Text className="font-semibold text-gray-900" style={{ fontSize: ds.fontSize(15) }}>{location.name}</Text>
                <Text className="text-gray-500" style={{ fontSize: ds.fontSize(13) }}>
                  {itemCount} item{itemCount !== 1 ? 's' : ''}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => handleClearLocation(location.id, location.name)}
              style={{ padding: ds.spacing(8), minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' }}
            >
              <Ionicons name="trash-outline" size={ds.icon(20)} color={colors.gray[400]} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Items List */}
        <View className="bg-white px-4 border-l border-r border-gray-200">
          {items.map((item) => renderDraftItem(location.id, item))}
        </View>

        {/* Add to Cart Button for this location */}
        <TouchableOpacity
          onPress={() => handleSubmitLocationToCart(location.id, location.name)}
          className="bg-primary-500 mx-0 rounded-b-xl items-center flex-row justify-center"
          style={{ height: ds.buttonH, borderRadius: ds.radius(12) }}
        >
          <Ionicons name="cart" size={ds.icon(18)} color="white" />
          <Text className="text-white font-semibold" style={{ fontSize: ds.buttonFont, marginLeft: ds.spacing(8) }}>
            Add {location.short_code} to Cart
          </Text>
        </TouchableOpacity>
      </View>
    );
  }, [getItems, renderDraftItem, handleClearLocation, handleSubmitLocationToCart]);

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      {/* Header */}
      <View className="bg-white flex-row items-center justify-between border-b border-gray-200" style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12) }}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ padding: ds.spacing(8), minWidth: 44, minHeight: 44, justifyContent: 'center' }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={ds.icon(24)} color={colors.gray[900]} />
        </TouchableOpacity>

        <Text className="font-semibold text-gray-900" style={{ fontSize: ds.fontSize(18) }}>Draft Orders</Text>

        {totalItemCount > 0 ? (
          <TouchableOpacity onPress={handleClearAll} style={{ padding: ds.spacing(8), minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
            <Text className="font-medium text-red-500" style={{ fontSize: ds.fontSize(14) }}>Clear All</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 60 }} />
        )}
      </View>

      {/* Content */}
      {totalItemCount > 0 ? (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        >
          {/* Summary */}
          <View className="bg-primary-50 rounded-xl p-4 mb-4 flex-row items-center">
            <Ionicons name="document-text" size={24} color={colors.primary[500]} />
            <View className="ml-3 flex-1">
              <Text className="text-base font-semibold text-primary-700">
                {totalItemCount} item{totalItemCount !== 1 ? 's' : ''} in draft
              </Text>
              <Text className="text-sm text-primary-600">
                Across {locationsWithItems.length} location{locationsWithItems.length !== 1 ? 's' : ''}
              </Text>
            </View>
          </View>

          {/* Location Sections */}
          {locationsWithItems.map(renderLocationSection)}
        </ScrollView>
      ) : (
        /* Empty State */
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="document-text-outline" size={64} color={colors.gray[300]} />
          <Text className="text-lg font-medium text-gray-500 mt-4 text-center">No items in draft</Text>
          <Text className="text-sm text-gray-400 mt-2 text-center">
            Use Quick Order to quickly add items to your draft
          </Text>
          <TouchableOpacity
            onPress={() => router.push('/quick-order' as any)}
            className="mt-6 bg-primary-500 px-6 py-3 rounded-xl flex-row items-center"
          >
            <Ionicons name="flash" size={20} color="white" />
            <Text className="text-white font-semibold ml-2">Start Quick Order</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Bottom safe area */}
      <SafeAreaView edges={['bottom']} />
    </SafeAreaView>
  );
}
