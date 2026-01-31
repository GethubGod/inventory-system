import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useOrderStore, useAuthStore } from '@/store';
import { Order, OrderStatus } from '@/types';
import { OrderCard } from '@/components/OrderCard';
import { StatusFilter } from '@/components/StatusFilter';

const statuses: (OrderStatus | null)[] = [null, 'draft', 'submitted', 'fulfilled', 'cancelled'];

export default function OrdersScreen() {
  const { location } = useAuthStore();
  const { orders, fetchOrders, isLoading } = useOrderStore();
  const [selectedStatus, setSelectedStatus] = useState<OrderStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (location) {
        fetchOrders(location.id);
      }
    }, [location])
  );

  const onRefresh = async () => {
    if (location) {
      setRefreshing(true);
      await fetchOrders(location.id);
      setRefreshing(false);
    }
  };

  const filteredOrders = selectedStatus
    ? orders.filter((order) => order.status === selectedStatus)
    : orders;

  const renderItem = ({ item }: { item: Order }) => <OrderCard order={item} />;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['left', 'right']}>
      {/* Location Header */}
      {location && (
        <View className="bg-primary-500 px-4 py-3">
          <Text className="text-white text-sm">Orders for</Text>
          <Text className="text-white font-bold text-lg">{location.name}</Text>
        </View>
      )}

      {/* Status Filter */}
      <StatusFilter
        statuses={statuses}
        selectedStatus={selectedStatus}
        onSelectStatus={setSelectedStatus}
      />

      {/* Orders List */}
      <FlatList
        data={filteredOrders}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        ItemSeparatorComponent={() => <View className="h-3" />}
        ListEmptyComponent={() => (
          <View className="flex-1 items-center justify-center py-12">
            <Ionicons name="receipt-outline" size={48} color="#9CA3AF" />
            <Text className="text-gray-500 mt-4 text-center">
              {selectedStatus
                ? `No ${selectedStatus} orders found`
                : 'No orders yet'}
            </Text>
          </View>
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#F97316"
          />
        }
      />
    </SafeAreaView>
  );
}
