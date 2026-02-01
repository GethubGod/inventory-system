import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  Pressable,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuthStore } from '@/store';
import { supabase } from '@/lib/supabase';
import { Order, Location } from '@/types';
import { statusColors, ORDER_STATUS_LABELS } from '@/constants';

interface DashboardStats {
  pendingOrders: number;
  todayOrders: number;
  weekOrders: number;
}

export default function ManagerDashboard() {
  const { locations, signOut, fetchLocations } = useAuthStore();
  const [stats, setStats] = useState<DashboardStats>({
    pendingOrders: 0,
    todayOrders: 0,
    weekOrders: 0,
  });
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);

  const fetchDashboardData = async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    weekAgo.setHours(0, 0, 0, 0);

    // Build queries with optional location filter
    let pendingQuery = supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .in('status', ['submitted', 'processing']);

    let todayQuery = supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', today.toISOString())
      .neq('status', 'draft');

    let weekQuery = supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', weekAgo.toISOString())
      .eq('status', 'fulfilled');

    let recentQuery = supabase
      .from('orders')
      .select('*, location:locations(*), user:users!orders_user_id_fkey(*)')
      .neq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(5);

    // Apply location filter if selected
    if (selectedLocation) {
      pendingQuery = pendingQuery.eq('location_id', selectedLocation.id);
      todayQuery = todayQuery.eq('location_id', selectedLocation.id);
      weekQuery = weekQuery.eq('location_id', selectedLocation.id);
      recentQuery = recentQuery.eq('location_id', selectedLocation.id);
    }

    const [pendingResult, todayResult, weekResult, recentResult] = await Promise.all([
      pendingQuery,
      todayQuery,
      weekQuery,
      recentQuery,
    ]);

    setStats({
      pendingOrders: pendingResult.count || 0,
      todayOrders: todayResult.count || 0,
      weekOrders: weekResult.count || 0,
    });

    setRecentOrders(recentResult.data || []);
  };

  useEffect(() => {
    fetchLocations();
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchDashboardData();
    }, [selectedLocation])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchDashboardData();
    setRefreshing(false);
  };

  const handleSelectLocation = (loc: Location | null) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setSelectedLocation(loc);
    setShowLocationPicker(false);
  };

  const handleSignOut = async () => {
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
    await signOut();
    router.replace('/(auth)/login');
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
      className="flex-1 bg-white rounded-2xl p-4 border border-gray-100"
      style={{
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 2,
      }}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      disabled={!onPress}
    >
      <Text className="text-3xl font-bold text-gray-900 mb-1">{value}</Text>
      <Text className="text-gray-500 text-sm">{title}</Text>
      <View
        className="w-8 h-8 rounded-full items-center justify-center mt-2"
        style={{ backgroundColor: color + '20' }}
      >
        <Ionicons name={icon} size={16} color={color} />
      </View>
    </TouchableOpacity>
  );

  const ActionCard = ({
    title,
    subtitle,
    icon,
    color,
    bgColor,
    badge,
    onPress,
  }: {
    title: string;
    subtitle: string;
    icon: keyof typeof Ionicons.glyphMap;
    color: string;
    bgColor: string;
    badge?: number;
    onPress: () => void;
  }) => (
    <TouchableOpacity
      className="flex-1 rounded-2xl p-4 border border-gray-100"
      style={{
        backgroundColor: bgColor,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 2,
      }}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View className="flex-row items-start justify-between">
        <View className="w-12 h-12 rounded-xl bg-white/50 items-center justify-center">
          <Ionicons name={icon} size={24} color={color} />
        </View>
        {badge !== undefined && badge > 0 && (
          <View className="bg-primary-500 px-2.5 py-1 rounded-full">
            <Text className="text-white text-xs font-bold">{badge}</Text>
          </View>
        )}
      </View>
      <Text className="text-gray-900 font-bold text-base mt-3">{title}</Text>
      <Text className="text-gray-600 text-sm mt-1">{subtitle}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      {/* Header */}
      <View className="bg-white px-4 py-3 flex-row items-center justify-between border-b border-gray-100">
        <View className="flex-row items-center">
          <View className="w-10 h-10 bg-primary-500 rounded-xl items-center justify-center">
            <Text className="text-white font-bold text-lg">B</Text>
          </View>
          <View className="ml-3">
            <Text className="text-gray-900 font-bold text-lg">Babytuna</Text>
            <Text className="text-primary-500 text-xs font-medium">Manager</Text>
          </View>
        </View>
        <TouchableOpacity
          className="w-10 h-10 bg-gray-100 rounded-full items-center justify-center"
          onPress={handleSignOut}
        >
          <Ionicons name="log-out-outline" size={20} color="#6B7280" />
        </TouchableOpacity>
      </View>

      {/* Location Selector */}
      <TouchableOpacity
        className="mx-4 mt-4 bg-white rounded-full px-4 py-2.5 flex-row items-center self-start border border-gray-200"
        style={{
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.05,
          shadowRadius: 2,
          elevation: 1,
        }}
        onPress={() => setShowLocationPicker(true)}
        activeOpacity={0.7}
      >
        <Ionicons name="location" size={16} color="#F97316" />
        <Text className="text-gray-900 font-medium ml-2">
          {selectedLocation?.name || 'All Locations'}
        </Text>
        <Ionicons name="chevron-down" size={16} color="#6B7280" className="ml-1.5" />
      </TouchableOpacity>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#F97316"
          />
        }
      >
        {/* Stats Row */}
        <View className="flex-row gap-3 mb-6">
          <StatCard
            title="Pending"
            value={stats.pendingOrders}
            icon="alert-circle"
            color="#F97316"
            onPress={() => router.push('/(manager)/orders')}
          />
          <StatCard
            title="Today"
            value={stats.todayOrders}
            icon="today"
            color="#3B82F6"
          />
          <StatCard
            title="This Week"
            value={stats.weekOrders}
            icon="checkmark-circle"
            color="#10B981"
          />
        </View>

        {/* Action Cards */}
        <View className="flex-row gap-3 mb-6">
          <ActionCard
            title="View Orders"
            subtitle="See all incoming orders"
            icon="list"
            color="#3B82F6"
            bgColor="#EFF6FF"
            badge={stats.pendingOrders}
            onPress={() => router.push('/(manager)/orders')}
          />
          <ActionCard
            title="Fulfillment"
            subtitle="Grouped items to fulfill"
            icon="clipboard"
            color="#F97316"
            bgColor="#FFF7ED"
            onPress={() => router.push('/(manager)/orders')}
          />
        </View>

        {/* Recent Orders */}
        <View
          className="bg-white rounded-2xl p-4 border border-gray-100"
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.05,
            shadowRadius: 4,
            elevation: 2,
          }}
        >
          <View className="flex-row justify-between items-center mb-4">
            <Text className="font-bold text-gray-900 text-lg">Recent Orders</Text>
            <TouchableOpacity
              className="flex-row items-center"
              onPress={() => router.push('/(manager)/orders')}
            >
              <Text className="text-primary-500 font-medium text-sm mr-1">See All</Text>
              <Ionicons name="arrow-forward" size={14} color="#F97316" />
            </TouchableOpacity>
          </View>

          {recentOrders.length === 0 ? (
            <View className="py-8 items-center">
              <Ionicons name="receipt-outline" size={40} color="#D1D5DB" />
              <Text className="text-gray-400 mt-2">No recent orders</Text>
            </View>
          ) : (
            recentOrders.map((order, index) => {
              const statusColor = statusColors[order.status];
              const orderUser = (order as any).user;
              const orderLocation = (order as any).location;
              return (
                <TouchableOpacity
                  key={order.id}
                  className={`py-3 ${
                    index < recentOrders.length - 1 ? 'border-b border-gray-100' : ''
                  }`}
                  onPress={() => router.push(`/orders/${order.id}`)}
                  activeOpacity={0.7}
                >
                  <View className="flex-row justify-between items-start mb-2">
                    <Text className="font-bold text-gray-900">
                      Order #{order.order_number}
                    </Text>
                    <View
                      className="px-2.5 py-1 rounded-full"
                      style={{ backgroundColor: statusColor.bg }}
                    >
                      <Text
                        className="text-xs font-semibold"
                        style={{ color: statusColor.text }}
                      >
                        {ORDER_STATUS_LABELS[order.status]}
                      </Text>
                    </View>
                  </View>
                  <View className="flex-row items-center mb-1">
                    <Ionicons name="person-outline" size={14} color="#6B7280" />
                    <Text className="text-gray-600 text-sm ml-1.5">
                      {orderUser?.name || 'Unknown'}
                    </Text>
                  </View>
                  <View className="flex-row items-center">
                    <Ionicons name="location-outline" size={14} color="#6B7280" />
                    <Text className="text-gray-500 text-sm ml-1.5">
                      {orderLocation?.name || 'Unknown'} • {formatDate(order.created_at)}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* Location Picker Modal */}
      <Modal
        visible={showLocationPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowLocationPicker(false)}
      >
        <Pressable
          className="flex-1 bg-black/50 justify-end"
          onPress={() => setShowLocationPicker(false)}
        >
          <Pressable
            className="bg-white rounded-t-3xl"
            onPress={(e) => e.stopPropagation()}
          >
            {/* Handle bar */}
            <View className="items-center pt-3 pb-2">
              <View className="w-10 h-1 bg-gray-300 rounded-full" />
            </View>

            <View className="px-6 pb-8">
              <Text className="text-2xl font-bold text-gray-900 mb-2">
                Filter by Location
              </Text>
              <Text className="text-gray-500 mb-6">
                View orders for a specific location
              </Text>

              {/* All Locations Option */}
              <TouchableOpacity
                className={`flex-row items-center p-4 rounded-2xl mb-3 border-2 ${
                  !selectedLocation
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-gray-200 bg-white'
                }`}
                onPress={() => handleSelectLocation(null)}
                activeOpacity={0.7}
              >
                <View
                  className={`w-12 h-12 rounded-full items-center justify-center ${
                    !selectedLocation ? 'bg-primary-500' : 'bg-gray-100'
                  }`}
                >
                  <Ionicons
                    name="globe"
                    size={24}
                    color={!selectedLocation ? 'white' : '#6B7280'}
                  />
                </View>
                <View className="flex-1 ml-4">
                  <Text
                    className={`font-bold text-lg ${
                      !selectedLocation ? 'text-primary-700' : 'text-gray-900'
                    }`}
                  >
                    All Locations
                  </Text>
                  <Text
                    className={`text-sm ${
                      !selectedLocation ? 'text-primary-600' : 'text-gray-500'
                    }`}
                  >
                    View orders from all restaurants
                  </Text>
                </View>
                {!selectedLocation && (
                  <Ionicons name="checkmark-circle" size={24} color="#F97316" />
                )}
              </TouchableOpacity>

              {locations.map((loc) => {
                const isSelected = selectedLocation?.id === loc.id;
                return (
                  <TouchableOpacity
                    key={loc.id}
                    className={`flex-row items-center p-4 rounded-2xl mb-3 border-2 ${
                      isSelected
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-gray-200 bg-white'
                    }`}
                    onPress={() => handleSelectLocation(loc)}
                    activeOpacity={0.7}
                  >
                    <View
                      className={`w-12 h-12 rounded-full items-center justify-center ${
                        isSelected ? 'bg-primary-500' : 'bg-gray-100'
                      }`}
                    >
                      <Ionicons
                        name="restaurant"
                        size={24}
                        color={isSelected ? 'white' : '#6B7280'}
                      />
                    </View>
                    <View className="flex-1 ml-4">
                      <Text
                        className={`font-bold text-lg ${
                          isSelected ? 'text-primary-700' : 'text-gray-900'
                        }`}
                      >
                        {loc.name}
                      </Text>
                      <Text
                        className={`text-sm ${
                          isSelected ? 'text-primary-600' : 'text-gray-500'
                        }`}
                      >
                        {loc.short_code}
                      </Text>
                    </View>
                    {isSelected && (
                      <Ionicons name="checkmark-circle" size={24} color="#F97316" />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
