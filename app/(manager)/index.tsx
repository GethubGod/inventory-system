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
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuthStore, useSettingsStore } from '@/store';
import { supabase } from '@/lib/supabase';
import { Location } from '@/types';
import { statusColors, ORDER_STATUS_LABELS, colors } from '@/constants';
import { sendReminderToEmployees } from '@/services/notificationService';

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
}

interface EmployeeOrderStatus {
  userId: string;
  userName: string;
  hasOrderedToday: boolean;
  lastOrderTime?: Date;
  locationName: string;
}

export default function ManagerDashboard() {
  const { locations, signOut, fetchLocations, setViewMode } = useAuthStore();
  const { hapticFeedback } = useSettingsStore();
  const [stats, setStats] = useState<DashboardStats>({
    pendingOrders: 0,
    todayOrders: 0,
    weekOrders: 0,
  });
  const [employeeActivity, setEmployeeActivity] = useState<EmployeeActivity[]>([]);
  const [employeeStatuses, setEmployeeStatuses] = useState<EmployeeOrderStatus[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [isSendingReminder, setIsSendingReminder] = useState(false);

  const fetchDashboardData = async () => {
    try {
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

      // Fetch recent orders with details for activity feed
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

      // Transform recent orders into activity feed
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

      // Fetch employee order statuses for today
      await fetchEmployeeStatuses(today);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    }
  };

  const fetchEmployeeStatuses = async (today: Date) => {
    try {
      // Get all employees
      const { data: employeesData } = await supabase
        .from('users')
        .select('id, name, default_location_id')
        .eq('role', 'employee');

      // Type assertion to work around Supabase's generic types
      const employees = employeesData as Array<{ id: string; name: string; default_location_id: string | null }> | null;
      if (!employees) return;

      // Get today's orders
      const { data: todayOrders } = await supabase
        .from('orders')
        .select('user_id, created_at, location:locations(name)')
        .gte('created_at', today.toISOString())
        .neq('status', 'draft');

      const ordersByUser = new Map<string, { time: Date; locationName: string }>();
      todayOrders?.forEach((order: any) => {
        const existing = ordersByUser.get(order.user_id);
        const orderTime = new Date(order.created_at);
        if (!existing || orderTime > existing.time) {
          ordersByUser.set(order.user_id, {
            time: orderTime,
            locationName: order.location?.name || 'Unknown',
          });
        }
      });

      // Get location names for employees
      const locationIds = [...new Set(employees.map(e => e.default_location_id).filter(Boolean))] as string[];
      const { data: locationDataRaw } = await supabase
        .from('locations')
        .select('id, name')
        .in('id', locationIds);

      const locationData = locationDataRaw as Array<{ id: string; name: string }> | null;
      const locationMap = new Map(locationData?.map(l => [l.id, l.name]) || []);

      const statuses: EmployeeOrderStatus[] = employees.map((emp) => {
        const orderInfo = ordersByUser.get(emp.id);
        return {
          userId: emp.id,
          userName: emp.name,
          hasOrderedToday: !!orderInfo,
          lastOrderTime: orderInfo?.time,
          locationName: orderInfo?.locationName || (emp.default_location_id ? locationMap.get(emp.default_location_id) : undefined) || 'Unknown',
        };
      });

      // Filter by selected location if applicable
      if (selectedLocation) {
        const filteredStatuses = statuses.filter(
          s => s.locationName === selectedLocation.name
        );
        setEmployeeStatuses(filteredStatuses);
      } else {
        setEmployeeStatuses(statuses);
      }
    } catch (error) {
      console.error('Error fetching employee statuses:', error);
    }
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
    if (hapticFeedback && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setSelectedLocation(loc);
    setShowLocationPicker(false);
  };

  const handleSignOut = async () => {
    if (hapticFeedback && Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
    await signOut();
    router.replace('/(auth)/login');
  };

  const handleSwitchToEmployee = () => {
    if (hapticFeedback && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    setViewMode('employee');
    router.replace('/(tabs)');
  };

  const handleSendReminder = async () => {
    const employeesWhoHaventOrdered = employeeStatuses.filter(e => !e.hasOrderedToday);

    if (employeesWhoHaventOrdered.length === 0) {
      Alert.alert('All Caught Up!', 'All employees have placed their orders today.');
      return;
    }

    Alert.alert(
      'Send Reminder',
      `Send a reminder to ${employeesWhoHaventOrdered.length} employee${employeesWhoHaventOrdered.length !== 1 ? 's' : ''} who haven't ordered yet?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: async () => {
            setIsSendingReminder(true);
            try {
              await sendReminderToEmployees(
                employeesWhoHaventOrdered.map(e => e.userId)
              );

              if (hapticFeedback && Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }

              Alert.alert('Sent!', 'Reminder notifications have been sent.');
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to send reminders');
            } finally {
              setIsSendingReminder(false);
            }
          },
        },
      ]
    );
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

  const employeesWhoHaventOrdered = employeeStatuses.filter(e => !e.hasOrderedToday);

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

        {/* Send Reminder Section */}
        {employeesWhoHaventOrdered.length > 0 && (
          <TouchableOpacity
            className="bg-amber-50 rounded-2xl p-4 mb-6 border border-amber-200"
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.05,
              shadowRadius: 4,
              elevation: 2,
            }}
            onPress={handleSendReminder}
            activeOpacity={0.7}
            disabled={isSendingReminder}
          >
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center flex-1">
                <View className="w-12 h-12 rounded-xl bg-amber-100 items-center justify-center">
                  <Ionicons name="notifications" size={24} color="#F59E0B" />
                </View>
                <View className="ml-4 flex-1">
                  <Text className="text-gray-900 font-bold text-base">
                    {employeesWhoHaventOrdered.length} haven't ordered
                  </Text>
                  <Text className="text-amber-700 text-sm mt-0.5">
                    Tap to send reminder
                  </Text>
                </View>
              </View>
              <View className="bg-amber-500 rounded-full px-4 py-2">
                <Text className="text-white font-semibold text-sm">
                  {isSendingReminder ? 'Sending...' : 'Remind'}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        )}

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
            badge={stats.pendingOrders}
            onPress={() => router.push('/(manager)/fulfillment')}
          />
        </View>

        {/* Switch to Employee View */}
        <TouchableOpacity
          className="bg-purple-50 rounded-2xl p-4 mb-6 flex-row items-center border border-purple-100"
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.05,
            shadowRadius: 4,
            elevation: 2,
          }}
          onPress={handleSwitchToEmployee}
          activeOpacity={0.7}
        >
          <View className="w-12 h-12 rounded-xl bg-purple-100 items-center justify-center">
            <Ionicons name="swap-horizontal" size={24} color="#7C3AED" />
          </View>
          <View className="flex-1 ml-4">
            <Text className="text-gray-900 font-bold text-base">Switch to Employee View</Text>
            <Text className="text-gray-600 text-sm mt-0.5">Place your own orders</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#7C3AED" />
        </TouchableOpacity>

        {/* Employee Activity Feed */}
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
            <TouchableOpacity
              className="flex-row items-center"
              onPress={() => router.push('/(manager)/orders')}
            >
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
                  {/* Avatar */}
                  <View className="w-10 h-10 bg-primary-100 rounded-full items-center justify-center mr-3">
                    <Text className="text-primary-700 font-bold">
                      {activity.employeeName.charAt(0).toUpperCase()}
                    </Text>
                  </View>

                  <View className="flex-1">
                    {/* Name and action */}
                    <View className="flex-row items-center flex-wrap">
                      <Text className="font-semibold text-gray-900">
                        {activity.employeeName}
                      </Text>
                      <Text className="text-gray-500 ml-1">
                        ordered
                      </Text>
                      {activity.itemName && (
                        <Text className="font-medium text-primary-600 ml-1">
                          {activity.itemName}
                          {(activity as any).itemCount > 1 && ` +${(activity as any).itemCount - 1} more`}
                        </Text>
                      )}
                    </View>

                    {/* Details */}
                    <View className="flex-row items-center mt-1">
                      <Ionicons name="location-outline" size={12} color="#9CA3AF" />
                      <Text className="text-gray-400 text-xs ml-1">
                        {activity.locationName}
                      </Text>
                      <Text className="text-gray-300 mx-2">•</Text>
                      <Ionicons name="time-outline" size={12} color="#9CA3AF" />
                      <Text className="text-gray-400 text-xs ml-1">
                        {formatTimeAgo(activity.timestamp)}
                      </Text>
                    </View>
                  </View>

                  {/* Order number badge */}
                  {activity.orderNumber && (
                    <View className="bg-gray-100 px-2 py-1 rounded">
                      <Text className="text-gray-500 text-xs font-medium">
                        #{activity.orderNumber}
                      </Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            ))
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
