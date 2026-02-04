import { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useOrderStore, useAuthStore } from '@/store';
import { OrderItemWithInventory } from '@/types';
import { statusColors, ORDER_STATUS_LABELS, CATEGORY_LABELS, categoryColors } from '@/constants';
import { supabase } from '@/lib/supabase';
import { SpinningFish } from '@/components';

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuthStore();
  const {
    currentOrder,
    fetchOrder,
    submitOrder,
    updateOrderStatus,
    cancelOrder,
    isLoading,
  } = useOrderStore();
  const [isUpdating, setIsUpdating] = useState(false);
  const [fulfilledByUser, setFulfilledByUser] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      fetchOrder(id);
    }
  }, [id]);

  // Fetch the user who fulfilled the order
  useEffect(() => {
    const fetchFulfilledBy = async () => {
      if (currentOrder?.fulfilled_by) {
        const { data } = await supabase
          .from('users')
          .select('name')
          .eq('id', currentOrder.fulfilled_by)
          .single();
        if (data) {
          setFulfilledByUser((data as { name: string }).name);
        }
      }
    };
    fetchFulfilledBy();
  }, [currentOrder?.fulfilled_by]);

  const handleSubmit = () => {
    if (!currentOrder) return;

    Alert.alert(
      'Submit Order',
      'Submit this order? It will be sent for fulfillment.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit',
          onPress: async () => {
            try {
              setIsUpdating(true);
              await submitOrder(currentOrder.id);
              if (Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
              fetchOrder(currentOrder.id);
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to submit order');
            } finally {
              setIsUpdating(false);
            }
          },
        },
      ]
    );
  };

  const handleMarkProcessing = () => {
    if (!currentOrder || !user) return;

    Alert.alert(
      'Start Processing',
      'Mark this order as processing? This indicates you have started working on it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start Processing',
          onPress: async () => {
            try {
              setIsUpdating(true);
              await updateOrderStatus(currentOrder.id, 'processing');
              if (Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
              fetchOrder(currentOrder.id);
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to update order');
            } finally {
              setIsUpdating(false);
            }
          },
        },
      ]
    );
  };

  const handleMarkFulfilled = () => {
    if (!currentOrder || !user) return;

    Alert.alert(
      'Fulfill Order',
      'Mark this order as fulfilled? This indicates the order is complete.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark Fulfilled',
          onPress: async () => {
            try {
              setIsUpdating(true);
              await updateOrderStatus(currentOrder.id, 'fulfilled', user.id);
              if (Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
              fetchOrder(currentOrder.id);
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to fulfill order');
            } finally {
              setIsUpdating(false);
            }
          },
        },
      ]
    );
  };

  const handleCancel = () => {
    if (!currentOrder) return;

    Alert.alert(
      'Cancel Order',
      'Are you sure you want to cancel this order?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsUpdating(true);
              await cancelOrder(currentOrder.id);
              if (Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              }
              fetchOrder(currentOrder.id);
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to cancel order');
            } finally {
              setIsUpdating(false);
            }
          },
        },
      ]
    );
  };

  const handleRequestCancellation = () => {
    if (!currentOrder) return;

    Alert.alert(
      'Request Cancellation',
      'Send a cancellation request for this order?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Request',
          onPress: async () => {
            try {
              setIsUpdating(true);
              await updateOrderStatus(currentOrder.id, 'cancel_requested');
              if (Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              }
              fetchOrder(currentOrder.id);
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to request cancellation');
            } finally {
              setIsUpdating(false);
            }
          },
        },
      ]
    );
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  if (isLoading || !currentOrder) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 items-center justify-center">
        <SpinningFish size="large" showText text="Loading order..." />
      </SafeAreaView>
    );
  }

  const colors = statusColors[currentOrder.status];
  const isManager = user?.role === 'manager';
  const canMarkProcessing = currentOrder.status === 'submitted' && isManager;
  const canMarkFulfilled = currentOrder.status === 'processing' && isManager;
  const canCancel = (currentOrder.status === 'submitted' || currentOrder.status === 'processing') && isManager;
  const isFulfilled = currentOrder.status === 'fulfilled';
  const isCancelled = currentOrder.status === 'cancelled';
  const isCancelRequested = currentOrder.status === 'cancel_requested';

  const minutesSinceCreated = Math.floor(
    (Date.now() - new Date(currentOrder.created_at).getTime()) / (1000 * 60)
  );
  const withinGracePeriod = minutesSinceCreated <= 5;
  const canRequestCancellation = minutesSinceCreated > 5;
  const isCancellableStatus =
    currentOrder.status === 'submitted' || currentOrder.status === 'processing';
  const showEmployeeCancellation =
    isCancellableStatus && !isFulfilled && !isCancelled && !isCancelRequested;

  const renderOrderItem = ({ item }: { item: OrderItemWithInventory }) => {
    const categoryColor = categoryColors[item.inventory_item.category] || '#6B7280';
    const unitLabel =
      item.unit_type === 'base'
        ? item.inventory_item.base_unit
        : item.inventory_item.pack_unit;

    return (
      <View
        className="bg-white rounded-2xl p-4 mb-3 border border-gray-100"
        style={{
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.05,
          shadowRadius: 4,
          elevation: 2,
        }}
      >
        <View className="flex-row justify-between items-start">
          <View className="flex-1 mr-3">
            <Text className="text-gray-900 font-semibold text-base">
              {item.inventory_item.name}
            </Text>
            <View
              style={{ backgroundColor: categoryColor + '20' }}
              className="px-2.5 py-1 rounded-lg self-start mt-2"
            >
              <Text style={{ color: categoryColor }} className="text-xs font-medium">
                {CATEGORY_LABELS[item.inventory_item.category]}
              </Text>
            </View>
          </View>
          <View className="items-end">
            <Text className="text-gray-900 font-bold text-xl">
              {item.quantity}
            </Text>
            <Text className="text-gray-500 text-sm">{unitLabel}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: `Order #${currentOrder.order_number}`,
          headerBackTitle: 'Back',
          headerTintColor: '#F97316',
          headerStyle: { backgroundColor: '#FFFFFF' },
          headerTitleStyle: { color: '#111827', fontWeight: '600' },
        }}
      />
      <SafeAreaView className="flex-1 bg-gray-50" edges={['left', 'right', 'bottom']}>
        {/* Order Info Card */}
        <View
          className="mx-4 mt-4 bg-white rounded-2xl p-4 border border-gray-100"
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.05,
            shadowRadius: 4,
            elevation: 2,
          }}
        >
          {/* Status Row */}
          <View className="flex-row justify-between items-center mb-4">
            <View>
              <Text className="text-gray-500 text-xs uppercase tracking-wide mb-1">Status</Text>
              <View
                className="px-3 py-1.5 rounded-full"
                style={{ backgroundColor: colors.bg }}
              >
                <Text
                  className="font-bold text-sm"
                  style={{ color: colors.text }}
                >
                  {ORDER_STATUS_LABELS[currentOrder.status]}
                </Text>
              </View>
            </View>
            <View className="items-end">
              <Text className="text-gray-500 text-xs uppercase tracking-wide mb-1">Created</Text>
              <Text className="text-gray-900 font-medium">
                {formatDate(currentOrder.created_at)}
              </Text>
            </View>
          </View>

          {/* Submitted By */}
          <View className="flex-row items-center py-2 border-t border-gray-100">
            <Ionicons name="person-outline" size={18} color="#6B7280" />
            <View className="ml-3">
              <Text className="text-gray-500 text-xs">Submitted by</Text>
              <Text className="text-gray-900 font-medium">
                {currentOrder.user?.name || 'Unknown'}
              </Text>
            </View>
          </View>

          {/* Location */}
          <View className="flex-row items-center py-2 border-t border-gray-100">
            <Ionicons name="location-outline" size={18} color="#6B7280" />
            <View className="ml-3">
              <Text className="text-gray-500 text-xs">Location</Text>
              <Text className="text-gray-900 font-medium">
                {currentOrder.location?.name || 'Unknown Location'}
              </Text>
            </View>
          </View>

          {/* Fulfilled Info */}
          {isFulfilled && currentOrder.fulfilled_at && (
            <View className="flex-row items-center py-2 border-t border-gray-100">
              <Ionicons name="checkmark-circle" size={18} color="#10B981" />
              <View className="ml-3">
                <Text className="text-gray-500 text-xs">Fulfilled</Text>
                <Text className="text-green-700 font-medium">
                  {formatDate(currentOrder.fulfilled_at)}
                  {fulfilledByUser && ` by ${fulfilledByUser}`}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* Items Header */}
        <View className="px-4 py-3 mt-2">
          <Text className="text-gray-500 font-semibold text-xs uppercase tracking-wide">
            Order Items ({currentOrder.order_items?.length || 0})
          </Text>
        </View>

        {/* Order Items List */}
        <FlatList
          data={currentOrder.order_items || []}
          renderItem={renderOrderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
          ListEmptyComponent={() => (
            <View className="items-center py-8">
              <Ionicons name="cube-outline" size={40} color="#D1D5DB" />
              <Text className="text-gray-400 mt-2">No items in this order</Text>
            </View>
          )}
        />

        {/* Action Buttons */}
        {(canMarkProcessing || canMarkFulfilled || currentOrder.status === 'draft' || showEmployeeCancellation) && (
          <View className="p-4 bg-white border-t border-gray-200">
            {/* Draft Status - Employee can submit */}
            {currentOrder.status === 'draft' && (
              <View className="flex-row">
                <TouchableOpacity
                  className="flex-1 bg-gray-200 rounded-xl py-4 items-center mr-2"
                  onPress={handleCancel}
                  disabled={isUpdating}
                >
                  <Text className="text-gray-700 font-semibold">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="flex-1 bg-primary-500 rounded-xl py-4 items-center ml-2 flex-row justify-center"
                  onPress={handleSubmit}
                  disabled={isUpdating}
                >
                  {isUpdating ? (
                    <SpinningFish size="small" />
                  ) : (
                    <>
                      <Ionicons name="send" size={18} color="white" />
                      <Text className="text-white font-semibold ml-2">Submit Order</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* Pending Status - Manager can mark as processing */}
            {canMarkProcessing && (
              <View className="flex-row">
                {canCancel && (
                  <TouchableOpacity
                    className="flex-1 bg-gray-200 rounded-xl py-4 items-center mr-2"
                    onPress={handleCancel}
                    disabled={isUpdating}
                  >
                    <Text className="text-gray-700 font-semibold">Cancel</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  className={`flex-1 bg-blue-500 rounded-xl py-4 items-center ${canCancel ? 'ml-2' : ''} flex-row justify-center`}
                  onPress={handleMarkProcessing}
                  disabled={isUpdating}
                >
                  {isUpdating ? (
                    <SpinningFish size="small" />
                  ) : (
                    <>
                      <Ionicons name="play-circle" size={18} color="white" />
                      <Text className="text-white font-semibold ml-2">Mark as Processing</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* Processing Status - Manager can mark as fulfilled */}
            {canMarkFulfilled && (
              <View className="flex-row">
                {canCancel && (
                  <TouchableOpacity
                    className="flex-1 bg-gray-200 rounded-xl py-4 items-center mr-2"
                    onPress={handleCancel}
                    disabled={isUpdating}
                  >
                    <Text className="text-gray-700 font-semibold">Cancel</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  className={`flex-1 bg-green-500 rounded-xl py-4 items-center ${canCancel ? 'ml-2' : ''} flex-row justify-center`}
                  onPress={handleMarkFulfilled}
                  disabled={isUpdating}
                >
                  {isUpdating ? (
                    <SpinningFish size="small" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle" size={18} color="white" />
                      <Text className="text-white font-semibold ml-2">Mark as Fulfilled</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* Cancellation - Time Based */}
            {!isManager && showEmployeeCancellation && (
              <View className="flex-row mt-3">
                {withinGracePeriod ? (
                  <TouchableOpacity
                    className="flex-1 bg-red-500 rounded-xl py-4 items-center flex-row justify-center"
                    onPress={handleCancel}
                    disabled={isUpdating}
                  >
                    {isUpdating ? (
                      <SpinningFish size="small" />
                    ) : (
                      <>
                        <Ionicons name="close-circle" size={18} color="white" />
                        <Text className="text-white font-semibold ml-2">Cancel Order</Text>
                      </>
                    )}
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    className="flex-1 bg-amber-500 rounded-xl py-4 items-center flex-row justify-center"
                    onPress={handleRequestCancellation}
                    disabled={isUpdating}
                  >
                    {isUpdating ? (
                      <SpinningFish size="small" />
                    ) : (
                      <>
                        <Ionicons name="alert-circle" size={18} color="white" />
                        <Text className="text-white font-semibold ml-2">Request Cancellation</Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        )}

        {/* Fulfilled Status Message */}
        {isFulfilled && (
          <View className="p-4 bg-green-50 border-t border-green-100">
            <View className="flex-row items-center justify-center">
              <Ionicons name="checkmark-circle" size={20} color="#10B981" />
              <Text className="text-green-700 font-semibold ml-2">
                Order Complete
              </Text>
            </View>
          </View>
        )}

        {/* Cancelled Status Message */}
        {currentOrder.status === 'cancelled' && (
          <View className="p-4 bg-red-50 border-t border-red-100">
            <View className="flex-row items-center justify-center">
              <Ionicons name="close-circle" size={20} color="#EF4444" />
              <Text className="text-red-700 font-semibold ml-2">
                Order Cancelled
              </Text>
            </View>
          </View>
        )}
      </SafeAreaView>
    </>
  );
}
