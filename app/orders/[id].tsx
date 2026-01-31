import { useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useOrderStore, useAuthStore } from '@/store';
import { OrderItemWithInventory } from '@/types';
import { statusColors, ORDER_STATUS_LABELS, CATEGORY_LABELS, categoryColors } from '@/constants';

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuthStore();
  const {
    currentOrder,
    fetchOrder,
    submitOrder,
    fulfillOrder,
    cancelOrder,
    isLoading,
  } = useOrderStore();

  useEffect(() => {
    if (id) {
      fetchOrder(id);
    }
  }, [id]);

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
              await submitOrder(currentOrder.id);
              fetchOrder(currentOrder.id);
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to submit order');
            }
          },
        },
      ]
    );
  };

  const handleFulfill = () => {
    if (!currentOrder || !user) return;

    Alert.alert(
      'Fulfill Order',
      'Mark this order as fulfilled?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Fulfill',
          onPress: async () => {
            try {
              await fulfillOrder(currentOrder.id, user.id);
              fetchOrder(currentOrder.id);
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to fulfill order');
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
              await cancelOrder(currentOrder.id);
              fetchOrder(currentOrder.id);
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to cancel order');
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
      <SafeAreaView className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="#F97316" />
      </SafeAreaView>
    );
  }

  const colors = statusColors[currentOrder.status];

  const renderOrderItem = ({ item }: { item: OrderItemWithInventory }) => {
    const categoryColor = categoryColors[item.inventory_item.category] || '#6B7280';
    const unitLabel =
      item.unit_type === 'base'
        ? item.inventory_item.base_unit
        : item.inventory_item.pack_unit;

    return (
      <View className="bg-white rounded-lg p-4 mb-2">
        <View className="flex-row justify-between items-start">
          <View className="flex-1 mr-3">
            <Text className="text-gray-900 font-medium">
              {item.inventory_item.name}
            </Text>
            <View
              style={{ backgroundColor: categoryColor + '20' }}
              className="px-2 py-1 rounded self-start mt-1"
            >
              <Text style={{ color: categoryColor }} className="text-xs font-medium">
                {CATEGORY_LABELS[item.inventory_item.category]}
              </Text>
            </View>
          </View>
          <View className="items-end">
            <Text className="text-gray-900 font-bold text-lg">
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
      <SafeAreaView className="flex-1 bg-background" edges={['left', 'right', 'bottom']}>
        {/* Order Info Header */}
        <View className="bg-white px-4 py-4 border-b border-gray-200">
          <View className="flex-row justify-between items-center mb-3">
            <View>
              <Text className="text-gray-500 text-sm">Status</Text>
              <View
                className="flex-row items-center px-3 py-1 rounded-full mt-1"
                style={{ backgroundColor: colors.bg }}
              >
                <Text
                  className="font-semibold"
                  style={{ color: colors.text }}
                >
                  {ORDER_STATUS_LABELS[currentOrder.status]}
                </Text>
              </View>
            </View>
            <View className="items-end">
              <Text className="text-gray-500 text-sm">Created</Text>
              <Text className="text-gray-900 font-medium">
                {formatDate(currentOrder.created_at)}
              </Text>
            </View>
          </View>

          <View className="flex-row items-center">
            <Ionicons name="location-outline" size={16} color="#6B7280" />
            <Text className="text-gray-600 ml-1">
              {currentOrder.location?.name || 'Unknown Location'}
            </Text>
          </View>

          {currentOrder.fulfilled_at && (
            <View className="flex-row items-center mt-2">
              <Ionicons name="checkmark-circle-outline" size={16} color="#10B981" />
              <Text className="text-green-600 ml-1">
                Fulfilled: {formatDate(currentOrder.fulfilled_at)}
              </Text>
            </View>
          )}
        </View>

        {/* Items Header */}
        <View className="px-4 py-3">
          <Text className="text-gray-500 font-medium">
            ORDER ITEMS ({currentOrder.order_items?.length || 0})
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
              <Text className="text-gray-500">No items in this order</Text>
            </View>
          )}
        />

        {/* Action Buttons */}
        {(currentOrder.status === 'draft' || currentOrder.status === 'submitted') && (
          <View className="p-4 bg-white border-t border-gray-200">
            {currentOrder.status === 'draft' && (
              <View className="flex-row">
                <TouchableOpacity
                  className="flex-1 bg-gray-200 rounded-lg py-4 items-center mr-2"
                  onPress={handleCancel}
                >
                  <Text className="text-gray-700 font-semibold">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="flex-1 bg-primary-500 rounded-lg py-4 items-center ml-2"
                  onPress={handleSubmit}
                >
                  <Text className="text-white font-semibold">Submit Order</Text>
                </TouchableOpacity>
              </View>
            )}

            {currentOrder.status === 'submitted' && user?.role === 'manager' && (
              <View className="flex-row">
                <TouchableOpacity
                  className="flex-1 bg-gray-200 rounded-lg py-4 items-center mr-2"
                  onPress={handleCancel}
                >
                  <Text className="text-gray-700 font-semibold">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="flex-1 bg-green-500 rounded-lg py-4 items-center ml-2"
                  onPress={handleFulfill}
                >
                  <Text className="text-white font-semibold">Mark Fulfilled</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </SafeAreaView>
    </>
  );
}
