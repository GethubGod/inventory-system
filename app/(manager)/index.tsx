import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store';
import { supabase } from '@/lib/supabase';
import { Order } from '@/types';
import { statusColors } from '@/constants';

interface DashboardStats {
  pendingOrders: number;
  todayOrders: number;
  fulfilledToday: number;
}

export default function ManagerDashboard() {
  const { user, locations } = useAuthStore();
  const [stats, setStats] = useState<DashboardStats>({
    pendingOrders: 0,
    todayOrders: 0,
    fulfilledToday: 0,
  });
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDashboardData = async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Fetch pending orders count
    const { count: pendingCount } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'submitted');

    // Fetch today's orders count
    const { count: todayCount } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', today.toISOString());

    // Fetch fulfilled today count
    const { count: fulfilledCount } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'fulfilled')
      .gte('fulfilled_at', today.toISOString());

    setStats({
      pendingOrders: pendingCount || 0,
      todayOrders: todayCount || 0,
      fulfilledToday: fulfilledCount || 0,
    });

    // Fetch recent orders
    const { data: orders } = await supabase
      .from('orders')
      .select('*, location:locations(*), created_by:users!orders_user_id_fkey(*)')
      .in('status', ['submitted', 'draft'])
      .order('created_at', { ascending: false })
      .limit(5);

    setRecentOrders(orders || []);
  };

  useFocusEffect(
    useCallback(() => {
      fetchDashboardData();
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchDashboardData();
    setRefreshing(false);
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const StatCard = ({
    title,
    value,
    icon,
    color,
    onPress,
  }: {
    title: string;
    value: number;
    icon: keyof typeof Ionicons.glyphMap;
    color: string;
    onPress?: () => void;
  }) => (
    <TouchableOpacity
      className="flex-1 bg-white rounded-2xl p-4 shadow-sm border border-gray-100"
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <View
        className="w-10 h-10 rounded-full items-center justify-center mb-2"
        style={{ backgroundColor: color + '20' }}
      >
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <Text className="text-2xl font-bold text-gray-900">{value}</Text>
      <Text className="text-gray-500 text-sm">{title}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['left', 'right']}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#F97316"
          />
        }
      >
        {/* Welcome Header */}
        <View className="mb-6">
          <Text className="text-gray-500">Welcome back,</Text>
          <Text className="text-2xl font-bold text-gray-900">
            {user?.name || 'Manager'}
          </Text>
        </View>

        {/* Stats Grid */}
        <View className="flex-row gap-3 mb-6">
          <StatCard
            title="Pending Orders"
            value={stats.pendingOrders}
            icon="time-outline"
            color="#F97316"
            onPress={() => router.push('/(manager)/orders')}
          />
          <StatCard
            title="Today's Orders"
            value={stats.todayOrders}
            icon="today-outline"
            color="#3B82F6"
          />
        </View>
        <View className="flex-row gap-3 mb-6">
          <StatCard
            title="Fulfilled Today"
            value={stats.fulfilledToday}
            icon="checkmark-circle-outline"
            color="#10B981"
          />
          <StatCard
            title="Locations"
            value={locations.length}
            icon="location-outline"
            color="#8B5CF6"
          />
        </View>

        {/* Quick Actions */}
        <View className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 mb-6">
          <Text className="font-bold text-gray-900 mb-3">Quick Actions</Text>
          <View className="flex-row gap-3">
            <TouchableOpacity
              className="flex-1 bg-primary-50 rounded-xl p-4 items-center"
              onPress={() => router.push('/(manager)/orders')}
            >
              <Ionicons name="checkmark-done" size={24} color="#F97316" />
              <Text className="text-primary-700 font-medium mt-2 text-sm">
                Fulfill Orders
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="flex-1 bg-blue-50 rounded-xl p-4 items-center"
              onPress={() => router.push('/(manager)/inventory')}
            >
              <Ionicons name="cube" size={24} color="#3B82F6" />
              <Text className="text-blue-700 font-medium mt-2 text-sm">
                View Inventory
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Recent Orders */}
        <View className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <View className="flex-row justify-between items-center mb-3">
            <Text className="font-bold text-gray-900">Recent Orders</Text>
            <TouchableOpacity onPress={() => router.push('/(manager)/orders')}>
              <Text className="text-primary-500 font-medium text-sm">
                View All
              </Text>
            </TouchableOpacity>
          </View>

          {recentOrders.length === 0 ? (
            <View className="py-8 items-center">
              <Ionicons name="receipt-outline" size={40} color="#D1D5DB" />
              <Text className="text-gray-400 mt-2">No pending orders</Text>
            </View>
          ) : (
            recentOrders.map((order, index) => {
              const colors = statusColors[order.status];
              return (
                <TouchableOpacity
                  key={order.id}
                  className={`flex-row justify-between items-center py-3 ${
                    index < recentOrders.length - 1
                      ? 'border-b border-gray-100'
                      : ''
                  }`}
                  onPress={() => router.push(`/orders/${order.id}`)}
                >
                  <View className="flex-1">
                    <Text className="font-semibold text-gray-900">
                      Order #{order.order_number}
                    </Text>
                    <Text className="text-gray-500 text-sm">
                      {(order as any).location?.name} • {formatTime(order.created_at)}
                    </Text>
                  </View>
                  <View
                    className="px-3 py-1 rounded-full"
                    style={{ backgroundColor: colors.bg }}
                  >
                    <Text
                      className="text-xs font-medium capitalize"
                      style={{ color: colors.text }}
                    >
                      {order.status}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
