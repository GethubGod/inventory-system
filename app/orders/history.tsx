import { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useOrderStore, useAuthStore } from '@/store';
import { OrderWithDetails, OrderStatus } from '@/types';
import { statusColors, ORDER_STATUS_LABELS, colors } from '@/constants';
import { BrandLogo } from '@/components';

const statuses: (OrderStatus | null)[] = [null, 'submitted', 'fulfilled', 'cancelled'];

// Status emoji mapping
const STATUS_EMOJI: Record<string, string> = {
  draft: '📝',
  submitted: '🟠',
  processing: '🔵',
  fulfilled: '🟢',
  cancelled: '🔴',
};

function OrderListCard({ order }: { order: OrderWithDetails }) {
  const statusStyle = statusColors[order.status] || statusColors.draft;
  const statusLabel = ORDER_STATUS_LABELS[order.status] || order.status;
  const statusEmoji = STATUS_EMOJI[order.status] || '⚪';

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

  const itemCount = order.order_items?.length || 0;
  const noteCount = order.order_items?.filter(
    (line) => typeof line.note === 'string' && line.note.trim().length > 0
  ).length || 0;
  const locationName = order.location?.name || 'Unknown Location';

  return (
    <TouchableOpacity
      onPress={() => router.push(`/orders/${order.id}`)}
      className="bg-white rounded-xl p-4"
      style={{
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 2,
      }}
      activeOpacity={0.7}
    >
      {/* Header Row */}
      <View className="flex-row items-start justify-between mb-2">
        <Text className="text-gray-900 font-bold text-lg">
          Order #{order.order_number}
        </Text>
        <View
          className="flex-row items-center px-2.5 py-1 rounded-full"
          style={{ backgroundColor: statusStyle.bg }}
        >
          <Text className="mr-1">{statusEmoji}</Text>
          <Text
            className="font-medium text-sm"
            style={{ color: statusStyle.text }}
          >
            {statusLabel}
          </Text>
        </View>
      </View>

      {/* Date Row */}
      <Text className="text-gray-500 text-sm mb-2">
        {formatDate(order.created_at)}
      </Text>

      {/* Location & Items Row */}
      <View className="flex-row items-center">
        <Ionicons name="location" size={14} color={colors.gray[400]} />
        <Text className="text-gray-600 text-sm ml-1">{locationName}</Text>
        <Text className="text-gray-400 mx-2">•</Text>
        <Text className="text-gray-600 text-sm">{itemCount} item{itemCount !== 1 ? 's' : ''}</Text>
        {noteCount > 0 && (
          <>
            <Text className="text-gray-400 mx-2">•</Text>
            <Text className="text-blue-700 text-sm">{noteCount} note{noteCount !== 1 ? 's' : ''}</Text>
          </>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function OrdersScreen() {
  const { user } = useAuthStore();
  const { orders, fetchUserOrders } = useOrderStore();
  const [selectedStatus, setSelectedStatus] = useState<OrderStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (user) {
        fetchUserOrders(user.id);
      }
    }, [user])
  );

  const onRefresh = async () => {
    if (user) {
      setRefreshing(true);
      await fetchUserOrders(user.id);
      setRefreshing(false);
    }
  };

  const filteredOrders = selectedStatus
    ? orders.filter((order) => order.status === selectedStatus)
    : orders;

  const renderItem = ({ item }: { item: OrderWithDetails }) => (
    <OrderListCard order={item} />
  );

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      {/* Header */}
      <View className="bg-white px-5 py-3 border-b border-gray-100 flex-row items-center">
        <View className="flex-row items-center flex-1">
          <TouchableOpacity
            onPress={() => router.back()}
            className="p-2 mr-2"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={20} color={colors.gray[700]} />
          </TouchableOpacity>
          <BrandLogo variant="header" size={24} style={{ marginRight: 8 }} />
          <Text className="text-2xl font-bold text-gray-900">My Orders</Text>
        </View>
      </View>

      {/* Status Filter */}
      <View className="bg-white border-b border-gray-100">
        <FlatList
          horizontal
          data={statuses}
          keyExtractor={(item) => item || 'all'}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 12 }}
          renderItem={({ item: status }) => {
            const isSelected = selectedStatus === status;
            const label = status ? ORDER_STATUS_LABELS[status] : 'All';

            return (
              <TouchableOpacity
                onPress={() => setSelectedStatus(status)}
                className={`px-4 py-2 rounded-full mr-2 ${
                  isSelected ? 'bg-primary-500' : 'bg-gray-100'
                }`}
              >
                <Text
                  className={`font-medium ${
                    isSelected ? 'text-white' : 'text-gray-600'
                  }`}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {/* Orders List */}
      <FlatList
        data={filteredOrders as OrderWithDetails[]}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, flexGrow: 1 }}
        ItemSeparatorComponent={() => <View className="h-3" />}
        ListEmptyComponent={() => (
          <View className="flex-1 items-center justify-center py-16">
            <View className="w-20 h-20 bg-gray-100 rounded-full items-center justify-center mb-4">
              <Ionicons name="receipt-outline" size={40} color={colors.gray[400]} />
            </View>
            <Text className="text-gray-900 font-semibold text-lg mb-1">
              No orders yet
            </Text>
            <Text className="text-gray-500 text-center px-8">
              Your submitted orders will appear here
            </Text>
            <TouchableOpacity
              onPress={() => router.push('/quick-order')}
              className="mt-6 bg-primary-500 px-6 py-3 rounded-xl"
            >
              <Text className="text-white font-semibold">Start Ordering</Text>
            </TouchableOpacity>
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
