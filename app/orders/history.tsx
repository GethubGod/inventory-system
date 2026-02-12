import { useState, useCallback, useEffect, useRef } from 'react';
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
import { RealtimeChannel } from '@supabase/supabase-js';
import { useOrderStore, useAuthStore } from '@/store';
import { supabase } from '@/lib/supabase';
import { OrderWithDetails, OrderStatus } from '@/types';
import { statusColors, ORDER_STATUS_LABELS, colors } from '@/constants';
import { useScaledStyles } from '@/hooks/useScaledStyles';

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
  const ds = useScaledStyles();
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
      className="bg-white"
      style={{
        borderRadius: ds.radius(16),
        paddingHorizontal: ds.spacing(16),
        paddingVertical: ds.spacing(14),
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 2,
      }}
      activeOpacity={0.7}
    >
      {/* Header Row */}
      <View className="flex-row items-start justify-between" style={{ marginBottom: ds.spacing(8) }}>
        <Text className="text-gray-900 font-bold" style={{ fontSize: ds.fontSize(22), flexShrink: 1 }}>
          Order #{order.order_number}
        </Text>
        <View
          className="flex-row items-center rounded-full"
          style={{
            backgroundColor: statusStyle.bg,
            paddingHorizontal: ds.spacing(10),
            paddingVertical: ds.spacing(4),
            marginLeft: ds.spacing(8),
          }}
        >
          <Text className="mr-1">{statusEmoji}</Text>
          <Text
            className="font-medium"
            style={{ color: statusStyle.text, fontSize: ds.fontSize(13) }}
          >
            {statusLabel}
          </Text>
        </View>
      </View>

      {/* Date Row */}
      <Text className="text-gray-500" style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8) }}>
        {formatDate(order.created_at)}
      </Text>

      {/* Location & Items Row */}
      <View className="flex-row items-center">
        <Ionicons name="location" size={ds.icon(14)} color={colors.gray[400]} />
        <Text className="text-gray-600 ml-1" style={{ fontSize: ds.fontSize(14), flexShrink: 1 }}>{locationName}</Text>
        <Text className="text-gray-400 mx-2">•</Text>
        <Text className="text-gray-600" style={{ fontSize: ds.fontSize(14) }}>{itemCount} item{itemCount !== 1 ? 's' : ''}</Text>
        {noteCount > 0 && (
          <>
            <Text className="text-gray-400 mx-2">•</Text>
            <Text className="text-blue-700" style={{ fontSize: ds.fontSize(14) }}>{noteCount} note{noteCount !== 1 ? 's' : ''}</Text>
          </>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function OrdersScreen() {
  const ds = useScaledStyles();
  const { user } = useAuthStore();
  const { orders, fetchUserOrders } = useOrderStore();
  const [selectedStatus, setSelectedStatus] = useState<OrderStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (user) {
        fetchUserOrders(user.id);
      }
    }, [fetchUserOrders, user])
  );

  useEffect(() => {
    if (!user?.id) return;

    if (realtimeChannelRef.current) {
      supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }

    const scheduleRefresh = () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      refreshTimeoutRef.current = setTimeout(() => {
        void fetchUserOrders(user.id);
      }, 250);
    };

    const channel = supabase
      .channel(`employee-orders-sync-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `user_id=eq.${user.id}`,
        },
        scheduleRefresh
      )
      .subscribe();

    realtimeChannelRef.current = channel;

    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
    };
  }, [fetchUserOrders, user?.id]);

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
      <View
        className="bg-white border-b border-gray-100 flex-row items-center"
        style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(10) }}
      >
        <View className="flex-row items-center flex-1">
          <TouchableOpacity
            onPress={() => router.back()}
            style={{
              minWidth: 44,
              minHeight: 44,
              marginRight: ds.spacing(8),
              alignItems: 'center',
              justifyContent: 'center',
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={ds.icon(20)} color={colors.gray[700]} />
          </TouchableOpacity>
          <Text className="font-bold text-gray-900" style={{ fontSize: ds.fontSize(22) }}>My Orders</Text>
        </View>
      </View>

      {/* Status Filter */}
      <View className="bg-white border-b border-gray-100">
        <FlatList
          horizontal
          data={statuses}
          keyExtractor={(item) => item || 'all'}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: ds.spacing(12), paddingVertical: ds.spacing(12) }}
          renderItem={({ item: status }) => {
            const isSelected = selectedStatus === status;
            const label = status ? ORDER_STATUS_LABELS[status] : 'All';

            return (
              <TouchableOpacity
                onPress={() => setSelectedStatus(status)}
                className={`rounded-full ${
                  isSelected ? 'bg-primary-500' : 'bg-gray-100'
                }`}
                style={{
                  marginRight: ds.spacing(8),
                  paddingHorizontal: ds.spacing(16),
                  paddingVertical: ds.spacing(8),
                }}
              >
                <Text
                  className={`font-medium ${
                    isSelected ? 'text-white' : 'text-gray-600'
                  }`}
                  style={{ fontSize: ds.fontSize(14) }}
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
        contentContainerStyle={{ padding: ds.spacing(16), flexGrow: 1 }}
        ItemSeparatorComponent={() => <View style={{ height: ds.spacing(12) }} />}
        ListEmptyComponent={() => (
          <View className="flex-1 items-center justify-center py-16">
            <View
              className="bg-gray-100 rounded-full items-center justify-center"
              style={{ width: ds.icon(80), height: ds.icon(80), marginBottom: ds.spacing(16) }}
            >
              <Ionicons name="receipt-outline" size={ds.icon(40)} color={colors.gray[400]} />
            </View>
            <Text className="text-gray-900 font-semibold" style={{ fontSize: ds.fontSize(18), marginBottom: ds.spacing(4) }}>
              No orders yet
            </Text>
            <Text className="text-gray-500 text-center" style={{ paddingHorizontal: ds.spacing(32), fontSize: ds.fontSize(14) }}>
              Your submitted orders will appear here
            </Text>
            <TouchableOpacity
              onPress={() => router.push('/quick-order')}
              className="mt-6 bg-primary-500 rounded-xl"
              style={{ paddingHorizontal: ds.spacing(24), paddingVertical: ds.spacing(12) }}
            >
              <Text className="text-white font-semibold" style={{ fontSize: ds.fontSize(15) }}>Start Ordering</Text>
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
