import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, Share, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { colors } from '@/constants';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';
import { useAuthStore, useOrderStore } from '@/store';
import { supabase } from '@/lib/supabase';

function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? `${value}` : `${value}`.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}

export default function FulfillmentHistoryDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const { user, locations } = useAuthStore();
  const { fetchPastOrderById, fetchPendingFulfillmentOrders } = useOrderStore();
  const [isLoading, setIsLoading] = useState(true);
  const [isReordering, setIsReordering] = useState(false);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof fetchPastOrderById>>>(null);

  const targetId = Array.isArray(params.id) ? params.id[0] : params.id;

  const refreshDetail = useCallback(async () => {
    if (!targetId) {
      setDetail(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const result = await fetchPastOrderById(targetId, user?.id ?? null);
      setDetail(result);
    } finally {
      setIsLoading(false);
    }
  }, [fetchPastOrderById, targetId, user?.id]);

  useFocusEffect(
    useCallback(() => {
      void refreshDetail();
    }, [refreshDetail])
  );

  const pastOrder = detail?.order ?? null;
  const items = detail?.items ?? [];
  const supplierLabel = useMemo(() => {
    if (!pastOrder) return 'Past Order';
    if (pastOrder.supplierName && pastOrder.supplierName.trim().length > 0) return pastOrder.supplierName;
    if (pastOrder.supplierId && pastOrder.supplierId.trim().length > 0) {
      return `Unknown Supplier (${pastOrder.supplierId.slice(0, 8)})`;
    }
    return 'Unknown Supplier';
  }, [pastOrder]);

  const handleReorder = useCallback(async () => {
    if (!pastOrder || !user?.id || items.length === 0) return;

    setIsReordering(true);
    try {
      // Verify inventory items still exist
      const itemIds = items
        .map((item) => item.itemId)
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

      if (itemIds.length === 0) {
        Alert.alert('Cannot Reorder', 'No valid inventory items found in this past order.');
        return;
      }

      const { data: inventoryItems, error: inventoryError } = await (supabase as any)
        .from('inventory_items')
        .select('id,name,active')
        .in('id', itemIds);

      if (inventoryError) {
        throw inventoryError;
      }

      const activeItemIds = new Set(
        (Array.isArray(inventoryItems) ? inventoryItems : [])
          .filter((row: any) => row.active !== false)
          .map((row: any) => row.id as string)
      );

      const validItems = items.filter((item) => activeItemIds.has(item.itemId));
      if (validItems.length === 0) {
        Alert.alert('Cannot Reorder', 'All items from this order are no longer active in inventory.');
        return;
      }

      // Use the first available location as the order location
      const locationId = locations[0]?.id;
      if (!locationId) {
        Alert.alert('Cannot Reorder', 'No location available. Please ensure your account has an assigned location.');
        return;
      }

      // Create a new submitted order with the reorder items
      const { data: orderData, error: orderError } = await (supabase as any)
        .from('orders')
        .insert({
          user_id: user.id,
          location_id: locationId,
          status: 'submitted',
        })
        .select('*')
        .single();

      if (orderError) throw orderError;

      const orderId = orderData?.id;
      if (!orderId) throw new Error('Failed to create reorder — no order ID returned.');

      // Build order items from past order items
      const orderItemRows = validItems.map((item) => ({
        order_id: orderId,
        inventory_item_id: item.itemId,
        quantity: item.quantity,
        unit_type: item.unitType || 'pack',
        input_mode: 'quantity',
        quantity_requested: item.quantity,
        status: 'pending',
      }));

      const { error: itemsError } = await (supabase as any)
        .from('order_items')
        .insert(orderItemRows);

      if (itemsError) throw itemsError;

      // Refresh fulfillment data
      await fetchPendingFulfillmentOrders();

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      const skipped = items.length - validItems.length;
      const message = skipped > 0
        ? `${validItems.length} item${validItems.length === 1 ? '' : 's'} added to fulfillment. ${skipped} inactive item${skipped === 1 ? '' : 's'} skipped.`
        : `${validItems.length} item${validItems.length === 1 ? '' : 's'} added to fulfillment.`;

      Alert.alert('Reorder Created', message, [
        {
          text: 'Go to Fulfillment',
          onPress: () => router.replace('/(manager)/fulfillment'),
        },
        { text: 'Stay Here', style: 'cancel' },
      ]);
    } catch (error: any) {
      Alert.alert('Reorder Failed', error?.message || 'Unable to create reorder. Please try again.');
    } finally {
      setIsReordering(false);
    }
  }, [fetchPendingFulfillmentOrders, items, locations, pastOrder, user?.id]);

  const shareMessage = useCallback(async () => {
    if (!pastOrder) return;
    try {
      await Share.share({
        title: `${supplierLabel} Order`,
        message: pastOrder.messageText,
      });
    } catch (error: any) {
      Alert.alert('Share Failed', error?.message || 'Unable to open share sheet.');
    }
  }, [pastOrder, supplierLabel]);

  const copyMessage = useCallback(async () => {
    if (!pastOrder) return;
    await Clipboard.setStringAsync(pastOrder.messageText);
    Alert.alert('Copied', 'Message copied to clipboard.');
  }, [pastOrder]);

  if (!isLoading && !pastOrder) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
        <ManagerScaleContainer>
          <View className="bg-white px-4 py-3 border-b border-gray-100 flex-row items-center">
            <TouchableOpacity
              onPress={() => router.back()}
              className="p-2 mr-2"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="arrow-back" size={20} color={colors.gray[700]} />
            </TouchableOpacity>
            <Text className="text-lg font-bold text-gray-900">Past Order</Text>
          </View>
          <View className="flex-1 items-center justify-center px-8">
            <Text className="text-gray-500 text-base">Order not found.</Text>
          </View>
        </ManagerScaleContainer>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right', 'bottom']}>
      <ManagerScaleContainer>
        <View className="bg-white px-4 py-3 border-b border-gray-100 flex-row items-center">
          <TouchableOpacity
            onPress={() => router.back()}
            className="p-2 mr-2"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={20} color={colors.gray[700]} />
          </TouchableOpacity>
          <View className="flex-1">
            <View className="flex-row items-center">
              <Text className="text-lg font-bold text-gray-900">{supplierLabel}</Text>
              {pastOrder?.syncStatus === 'pending_sync' && (
                <View className="ml-2 rounded-full border border-orange-300 bg-orange-100 px-2 py-0.5">
                  <Text className="text-[10px] font-semibold text-orange-800">Pending sync</Text>
                </View>
              )}
            </View>
            <Text className="text-xs text-gray-500">
              {pastOrder ? new Date(pastOrder.createdAt).toLocaleString() : 'Loading...'}
            </Text>
          </View>
        </View>

        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
          <View className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
            <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Summary</Text>
            <Text className="text-sm text-gray-700">
              {(pastOrder?.itemCount ?? items.length)} line
              {(pastOrder?.itemCount ?? items.length) === 1 ? '' : 's'} •{' '}
              {(pastOrder?.remainingCount ?? 0)} remaining • Sent via{' '}
              {pastOrder?.shareMethod === 'copy' ? 'copy' : 'share'}
            </Text>
            {pastOrder?.syncError && (
              <Text className="text-xs text-orange-700 mt-2">{pastOrder.syncError}</Text>
            )}
          </View>

          <View className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
            <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Items</Text>
            {items.length === 0 ? (
              <Text className="text-sm text-gray-500">No item snapshot available.</Text>
            ) : (
              items.map((item, index) => {
                const locationLabel = item.locationName || item.locationGroup || '';
                return (
                  <View
                    key={item.id}
                    className={`py-2.5 ${index < items.length - 1 ? 'border-b border-gray-100' : ''}`}
                  >
                    <View className="flex-row items-center justify-between">
                      <Text className="text-sm font-medium text-gray-900 flex-1 pr-3">{item.itemName}</Text>
                      <Text className="text-sm font-semibold text-gray-700">
                        {formatQuantity(item.quantity)} {item.unit}
                      </Text>
                    </View>
                    {locationLabel.length > 0 && (
                      <Text className="text-xs text-gray-500 mt-1">{locationLabel}</Text>
                    )}
                    {item.note && (
                      <Text className="text-xs text-blue-700 mt-1">Note: {item.note}</Text>
                    )}
                  </View>
                );
              })
            )}
          </View>

          <View className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
            <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Message</Text>
            <View className="bg-gray-50 rounded-xl p-3">
              <Text className="text-sm text-gray-800 leading-5">
                {pastOrder?.messageText || 'No message available.'}
              </Text>
            </View>
          </View>
        </ScrollView>

        <View className="bg-white border-t border-gray-200 px-4 py-4">
          {items.length > 0 && (
            <TouchableOpacity
              onPress={handleReorder}
              disabled={isReordering || !pastOrder}
              className={`rounded-xl py-3 items-center justify-center flex-row mb-3 ${
                isReordering ? 'bg-gray-200' : 'bg-green-500'
              }`}
            >
              <Ionicons
                name="refresh-outline"
                size={17}
                color={isReordering ? colors.gray[400] : 'white'}
              />
              <Text className={`font-semibold ml-2 ${isReordering ? 'text-gray-400' : 'text-white'}`}>
                {isReordering ? 'Creating Reorder...' : 'Reorder'}
              </Text>
            </TouchableOpacity>
          )}
          <View className="flex-row">
            <TouchableOpacity
              onPress={copyMessage}
              className="flex-1 rounded-xl py-3 items-center justify-center bg-gray-100 mr-3 flex-row"
              disabled={!pastOrder}
            >
              <Ionicons name="copy-outline" size={17} color={colors.gray[700]} />
              <Text className="text-gray-700 font-semibold ml-2">Copy</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={shareMessage}
              className="flex-1 rounded-xl py-3 items-center justify-center bg-primary-500 flex-row"
              disabled={!pastOrder}
            >
              <Ionicons name="share-social-outline" size={17} color="white" />
              <Text className="text-white font-semibold ml-2">Share Again</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
