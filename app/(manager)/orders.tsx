import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store';
import { Order, OrderStatus } from '@/types';
import { statusColors, ORDER_STATUS_LABELS } from '@/constants';

const statuses: (OrderStatus | null)[] = [
  null,
  'submitted',
  'draft',
  'fulfilled',
  'cancelled',
];

export default function ManagerOrdersScreen() {
  const { user, locations } = useAuthStore();
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<OrderStatus | null>(
    'submitted'
  );
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchOrders = async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('orders')
        .select('*, location:locations(*), created_by:users!orders_user_id_fkey(*)')
        .order('created_at', { ascending: false })
        .limit(100);

      if (selectedStatus) {
        query = query.eq('status', selectedStatus);
      }

      if (selectedLocationId) {
        query = query.eq('location_id', selectedLocationId);
      }

      const { data, error } = await query;

      if (error) throw error;
      setOrders(data || []);
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchOrders();
    }, [selectedStatus, selectedLocationId])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchOrders();
    setRefreshing(false);
  };

  const handleFulfillOrder = async (order: Order) => {
    Alert.alert(
      'Fulfill Order',
      `Mark Order #${order.order_number} as fulfilled?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Fulfill',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('orders')
                .update({
                  status: 'fulfilled',
                  fulfilled_at: new Date().toISOString(),
                  fulfilled_by: user?.id,
                })
                .eq('id', order.id);

              if (error) throw error;
              fetchOrders();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to fulfill order');
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
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const renderOrder = ({ item: order }: { item: Order }) => {
    const colors = statusColors[order.status];
    const canFulfill = order.status === 'submitted';

    return (
      <TouchableOpacity
        className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 mb-3"
        onPress={() => router.push(`/orders/${order.id}`)}
        activeOpacity={0.7}
      >
        <View className="flex-row justify-between items-start mb-3">
          <View>
            <Text className="text-lg font-bold text-gray-900">
              Order #{order.order_number}
            </Text>
            <Text className="text-gray-500 text-sm mt-0.5">
              {formatDate(order.created_at)}
            </Text>
          </View>
          <View
            className="px-3 py-1 rounded-full"
            style={{ backgroundColor: colors.bg }}
          >
            <Text
              className="text-sm font-medium"
              style={{ color: colors.text }}
            >
              {ORDER_STATUS_LABELS[order.status]}
            </Text>
          </View>
        </View>

        <View className="flex-row items-center mb-3">
          <Ionicons name="location-outline" size={16} color="#6B7280" />
          <Text className="text-gray-600 ml-1.5">
            {(order as any).location?.name || 'Unknown Location'}
          </Text>
        </View>

        <View className="flex-row items-center mb-3">
          <Ionicons name="person-outline" size={16} color="#6B7280" />
          <Text className="text-gray-600 ml-1.5">
            {(order as any).user?.name || 'Unknown User'}
          </Text>
        </View>

        {canFulfill && (
          <TouchableOpacity
            className="bg-green-500 rounded-xl py-3 items-center mt-1"
            onPress={() => handleFulfillOrder(order)}
          >
            <View className="flex-row items-center">
              <Ionicons name="checkmark-circle" size={20} color="white" />
              <Text className="text-white font-bold ml-2">Mark as Fulfilled</Text>
            </View>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['left', 'right']}>
      {/* Status Filter */}
      <View className="bg-white border-b border-gray-200">
        <FlatList
          horizontal
          data={statuses}
          keyExtractor={(item) => item || 'all'}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 12 }}
          renderItem={({ item: status }) => {
            const isSelected = selectedStatus === status;
            const colors = status ? statusColors[status] : null;

            return (
              <TouchableOpacity
                className="px-4 py-2 rounded-full mr-2"
                style={{
                  backgroundColor: isSelected
                    ? status
                      ? colors?.text
                      : '#F97316'
                    : status
                    ? colors?.bg
                    : '#F3F4F6',
                }}
                onPress={() => setSelectedStatus(status)}
              >
                <Text
                  className="font-medium"
                  style={{
                    color: isSelected
                      ? '#FFFFFF'
                      : status
                      ? colors?.text
                      : '#374151',
                  }}
                >
                  {status ? ORDER_STATUS_LABELS[status] : 'All'}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {/* Location Filter */}
      <View className="bg-white border-b border-gray-200">
        <FlatList
          horizontal
          data={[null, ...locations]}
          keyExtractor={(item) => item?.id || 'all'}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 12 }}
          renderItem={({ item: location }) => {
            const isSelected = selectedLocationId === (location?.id || null);

            return (
              <TouchableOpacity
                className={`px-4 py-2 rounded-full mr-2 ${
                  isSelected ? 'bg-gray-800' : 'bg-gray-100'
                }`}
                onPress={() => setSelectedLocationId(location?.id || null)}
              >
                <Text
                  className={`font-medium ${
                    isSelected ? 'text-white' : 'text-gray-700'
                  }`}
                >
                  {location?.short_code || 'All Locations'}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {/* Orders List */}
      <FlatList
        data={orders}
        renderItem={renderOrder}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={() => (
          <View className="flex-1 items-center justify-center py-16">
            <Ionicons name="receipt-outline" size={48} color="#D1D5DB" />
            <Text className="text-gray-400 mt-4 text-center">
              {selectedStatus
                ? `No ${ORDER_STATUS_LABELS[selectedStatus].toLowerCase()} orders`
                : 'No orders found'}
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
