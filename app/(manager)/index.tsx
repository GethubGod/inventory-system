import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Platform,
  LayoutAnimation,
  UIManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { RealtimeChannel } from '@supabase/supabase-js';
import * as Haptics from 'expo-haptics';
import { useAuthStore, useOrderStore, useDisplayStore } from '@/store';
import { supabase } from '@/lib/supabase';
import type { Location } from '@/types';
import { listEmployeesWithReminderStatus } from '@/services';
import { BrandLogo } from '@/components';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';

interface DashboardStats {
  pendingOrders: number;
  todayOrders: number;
  weekOrders: number;
}

interface EmployeeActivity {
  id: string;
  employeeName: string;
  employeeId: string;
  action: string;
  itemName?: string;
  quantity?: number;
  unit?: string;
  locationName: string;
  timestamp: Date;
  orderNumber?: number;
  orderId?: string;
  itemCount?: number;
}

interface ReminderStats {
  pendingReminders: number;
  overdueEmployees: number;
  notificationsOff: number;
}

const DEFAULT_REMINDER_STATS: ReminderStats = {
  pendingReminders: 0,
  overdueEmployees: 0,
  notificationsOff: 0,
};

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function ManagerDashboard() {
  const { locations, fetchLocations } = useAuthStore();
  const { hapticFeedback } = useDisplayStore();
  const { getTotalCartCount } = useOrderStore();
  const cartCount = getTotalCartCount();

  const [stats, setStats] = useState<DashboardStats>({
    pendingOrders: 0,
    todayOrders: 0,
    weekOrders: 0,
  });
  const [reminderStats, setReminderStats] = useState<ReminderStats>({
    ...DEFAULT_REMINDER_STATS,
  });
  const [employeeActivity, setEmployeeActivity] = useState<EmployeeActivity[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchDashboardData = useCallback(async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      weekAgo.setHours(0, 0, 0, 0);

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
        .select(`
          *,
          location:locations(*),
          user:users!orders_user_id_fkey(*),
          order_items(
            quantity,
            unit_type,
            inventory_item:inventory_items(name)
          )
        `)
        .neq('status', 'draft')
        .order('created_at', { ascending: false })
        .limit(10);

      if (selectedLocation?.id) {
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

      try {
        const reminderOverview = await listEmployeesWithReminderStatus({
          locationId: selectedLocation?.id ?? null,
        });
        setReminderStats({
          pendingReminders: reminderOverview.stats.pendingReminders,
          overdueEmployees: reminderOverview.stats.overdueEmployees,
          notificationsOff: reminderOverview.stats.notificationsOff,
        });
      } catch {
        // Reminders backend can be unavailable in local/dev until Edge Functions are deployed.
        // Keep dashboard usable with safe defaults instead of surfacing a runtime error overlay.
        setReminderStats(DEFAULT_REMINDER_STATS);
      }

      if (recentResult.data) {
        const activities: EmployeeActivity[] = recentResult.data.map((order: any) => {
          const firstItem = order.order_items?.[0];
          const itemCount = order.order_items?.length || 0;

          return {
            id: order.id,
            employeeName: order.user?.name || 'Unknown',
            employeeId: order.user_id,
            action: `placed order #${order.order_number}`,
            itemName: firstItem?.inventory_item?.name,
            quantity: firstItem?.quantity,
            unit: firstItem?.unit_type,
            locationName: order.location?.name || 'Unknown',
            timestamp: new Date(order.created_at),
            orderNumber: order.order_number,
            orderId: order.id,
            itemCount,
          };
        });
        setEmployeeActivity(activities);
      }
    } catch {
      setStats({
        pendingOrders: 0,
        todayOrders: 0,
        weekOrders: 0,
      });
      setReminderStats(DEFAULT_REMINDER_STATS);
    }
  }, [selectedLocation?.id]);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  useFocusEffect(
    useCallback(() => {
      fetchDashboardData();
    }, [fetchDashboardData])
  );

  useEffect(() => {
    if (realtimeChannelRef.current) {
      supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }

    const scheduleRefresh = () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      refreshTimeoutRef.current = setTimeout(() => {
        fetchDashboardData();
      }, 250);
    };

    const channel = supabase
      .channel(`manager-dashboard-sync-${selectedLocation?.id ?? 'all'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        scheduleRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reminders' },
        scheduleRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
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
  }, [fetchDashboardData, selectedLocation?.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchDashboardData();
    setRefreshing(false);
  };

  const handleSelectLocation = (loc: Location | null) => {
    if (hapticFeedback && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSelectedLocation(loc);
    setShowLocationPicker(false);
  };

  const formatTimeAgo = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
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

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      <ManagerScaleContainer>
        <View className="bg-white px-4 pt-3 pb-2 border-b border-gray-100">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center">
              <BrandLogo variant="header" size={28} />
            </View>

            <View className="flex-row items-center">
              <TouchableOpacity
                className="bg-gray-100 rounded-full px-3 py-2 flex-row items-center mr-2"
                onPress={() => {
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  setShowLocationPicker((prev) => !prev);
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="location" size={14} color="#F97316" />
                <Text className="text-gray-900 font-medium ml-2" numberOfLines={1}>
                  {selectedLocation?.name || 'All Locations'}
                </Text>
                <Ionicons
                  name={showLocationPicker ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color="#6B7280"
                  className="ml-1.5"
                />
              </TouchableOpacity>

              <TouchableOpacity
                className="w-10 h-10 bg-gray-100 rounded-full items-center justify-center"
                onPress={() => router.push('/(manager)/cart')}
              >
                <Ionicons name="cart-outline" size={20} color="#6B7280" />
                {cartCount > 0 && (
                  <View
                    className="absolute -top-1 -right-1 bg-primary-500 h-5 rounded-full items-center justify-center px-1"
                    style={{ minWidth: 20 }}
                  >
                    <Text className="text-white font-bold" style={{ fontSize: 10 }}>
                      {cartCount > 99 ? '99+' : cartCount}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {showLocationPicker && (
            <View className="mt-3 bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <TouchableOpacity
                className="flex-row items-center px-4 py-3"
                onPress={() => handleSelectLocation(null)}
                activeOpacity={0.7}
              >
                <View className="w-9 h-9 rounded-full bg-primary-100 items-center justify-center mr-3">
                  <Ionicons name="globe" size={18} color="#F97316" />
                </View>
                <Text className="flex-1 text-gray-900 font-medium">All Locations</Text>
                {!selectedLocation && <Ionicons name="checkmark" size={18} color="#F97316" />}
              </TouchableOpacity>

              {locations.map((loc) => {
                const isSelected = selectedLocation?.id === loc.id;
                return (
                  <TouchableOpacity
                    key={loc.id}
                    className="flex-row items-center px-4 py-3 border-t border-gray-100"
                    onPress={() => handleSelectLocation(loc)}
                    activeOpacity={0.7}
                  >
                    <View
                      className={`w-9 h-9 rounded-full items-center justify-center mr-3 ${
                        isSelected ? 'bg-primary-500' : 'bg-gray-200'
                      }`}
                    >
                      <BrandLogo variant="inline" size={18} colorMode={isSelected ? 'dark' : 'light'} />
                    </View>
                    <Text className="flex-1 text-gray-900 font-medium">{loc.name}</Text>
                    {isSelected && <Ionicons name="checkmark" size={18} color="#F97316" />}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F97316" />
          }
        >
          <View className="flex-row gap-3 mb-6">
            <StatCard
              title="Pending"
              value={stats.pendingOrders}
              icon="alert-circle"
              color="#F97316"
              onPress={() => router.push('/(manager)/orders')}
            />
            <StatCard title="Today" value={stats.todayOrders} icon="today" color="#3B82F6" />
            <StatCard title="This Week" value={stats.weekOrders} icon="checkmark-circle" color="#10B981" />
          </View>

          <View
            className="bg-white rounded-2xl p-4 mb-6 border border-gray-100"
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.05,
              shadowRadius: 4,
              elevation: 2,
            }}
          >
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-3">
                <Text className="text-gray-900 font-bold text-lg">Employee Reminders</Text>
                <Text className="text-gray-500 text-sm mt-1">
                  Send and track reminders by employee
                </Text>
              </View>
              <TouchableOpacity
                className="bg-primary-500 rounded-full px-4 py-2"
                onPress={() => router.push('/(manager)/employee-reminders')}
                activeOpacity={0.8}
              >
                <Text className="text-white font-semibold text-sm">Manage</Text>
              </TouchableOpacity>
            </View>

            <View className="flex-row gap-3 mt-4">
              <View className="flex-1 rounded-xl px-3 py-3 bg-orange-50">
                <Text className="text-xs font-semibold text-orange-700">Pending</Text>
                <Text className="text-2xl font-bold text-gray-900 mt-1">{reminderStats.pendingReminders}</Text>
              </View>
              <View className="flex-1 rounded-xl px-3 py-3 bg-red-50">
                <Text className="text-xs font-semibold text-red-700">Overdue</Text>
                <Text className="text-2xl font-bold text-gray-900 mt-1">{reminderStats.overdueEmployees}</Text>
              </View>
              <View className="flex-1 rounded-xl px-3 py-3 bg-slate-100">
                <Text className="text-xs font-semibold text-slate-700">Notifications Off</Text>
                <Text className="text-2xl font-bold text-gray-900 mt-1">{reminderStats.notificationsOff}</Text>
              </View>
            </View>
          </View>

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
              <Text className="font-bold text-gray-900 text-lg">Employee Activity</Text>
              <TouchableOpacity className="flex-row items-center" onPress={() => router.push('/(manager)/orders')}>
                <Text className="text-primary-500 font-medium text-sm mr-1">See All</Text>
                <Ionicons name="arrow-forward" size={14} color="#F97316" />
              </TouchableOpacity>
            </View>

            {employeeActivity.length === 0 ? (
              <View className="py-8 items-center">
                <Ionicons name="people-outline" size={40} color="#D1D5DB" />
                <Text className="text-gray-400 mt-2">No recent activity</Text>
              </View>
            ) : (
              employeeActivity.slice(0, 5).map((activity, index) => (
                <TouchableOpacity
                  key={activity.id}
                  className={`py-3 ${
                    index < Math.min(employeeActivity.length, 5) - 1 ? 'border-b border-gray-100' : ''
                  }`}
                  onPress={() => activity.orderId && router.push(`/orders/${activity.orderId}`)}
                  activeOpacity={0.7}
                >
                  <View className="flex-row items-start">
                    <View className="w-10 h-10 bg-primary-100 rounded-full items-center justify-center mr-3">
                      <Text className="text-primary-700 font-bold">
                        {activity.employeeName.charAt(0).toUpperCase()}
                      </Text>
                    </View>

                    <View className="flex-1">
                      <View className="flex-row items-center flex-wrap">
                        <Text className="font-semibold text-gray-900">{activity.employeeName}</Text>
                        <Text className="text-gray-500 ml-1">ordered</Text>
                        {activity.itemName && (
                          <Text className="font-medium text-primary-600 ml-1">
                            {activity.itemName}
                            {activity.itemCount && activity.itemCount > 1 && ` +${activity.itemCount - 1} more`}
                          </Text>
                        )}
                      </View>

                      <View className="flex-row items-center mt-1">
                        <Ionicons name="location-outline" size={12} color="#9CA3AF" />
                        <Text className="text-gray-400 text-xs ml-1">{activity.locationName}</Text>
                        <Text className="text-gray-300 mx-2">•</Text>
                        <Ionicons name="time-outline" size={12} color="#9CA3AF" />
                        <Text className="text-gray-400 text-xs ml-1">{formatTimeAgo(activity.timestamp)}</Text>
                      </View>
                    </View>

                    {activity.orderNumber && (
                      <View className="bg-gray-100 px-2 py-1 rounded">
                        <Text className="text-gray-500 text-xs font-medium">#{activity.orderNumber}</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
        </ScrollView>
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
