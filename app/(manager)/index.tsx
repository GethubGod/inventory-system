import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  Platform,
  Alert,
  LayoutAnimation,
  UIManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuthStore, useOrderStore } from '@/store';
import { useDisplayStore } from '@/store';
import { supabase } from '@/lib/supabase';
import { Location } from '@/types';
import { sendReminderToEmployees } from '@/services/notificationService';
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

interface EmployeeOrderStatus {
  userId: string;
  userName: string;
  lastOrderTime?: Date;
  locationName: string;
  defaultLocationId: string | null;
  lastOrderLocationId?: string | null;
}

type ReminderStatus = 'green' | 'orange' | 'red';

const REMINDER_COLORS: Record<ReminderStatus, { dot: string; text: string; bg: string }> = {
  green: { dot: '#22C55E', text: 'text-green-700', bg: 'bg-green-50' },
  orange: { dot: '#F59E0B', text: 'text-amber-700', bg: 'bg-amber-50' },
  red: { dot: '#EF4444', text: 'text-red-700', bg: 'bg-red-50' },
};

// Enable LayoutAnimation on Android
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
  const [employeeActivity, setEmployeeActivity] = useState<EmployeeActivity[]>([]);
  const [employeeStatuses, setEmployeeStatuses] = useState<EmployeeOrderStatus[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [sendingEmployeeId, setSendingEmployeeId] = useState<string | null>(null);

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

      // Fetch employee order statuses
      await fetchEmployeeStatuses();
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    }
  };

  const fetchEmployeeStatuses = async () => {
    try {
      // Get all employees
      const { data: employeesData } = await supabase
        .from('users')
        .select('id, name, default_location_id')
        .eq('role', 'employee');

      // Type assertion to work around Supabase's generic types
      const employees = employeesData as Array<{ id: string; name: string; default_location_id: string | null }> | null;
      if (!employees) return;

      // Get orders to determine last order time per employee
      const { data: recentOrders } = await supabase
        .from('orders')
        .select('user_id, created_at, location_id, location:locations(name)')
        .neq('status', 'draft')
        .order('created_at', { ascending: false });

      const ordersByUser = new Map<
        string,
        { time: Date; locationName: string; locationId: string | null }
      >();

      recentOrders?.forEach((order: any) => {
        if (ordersByUser.has(order.user_id)) return;
        ordersByUser.set(order.user_id, {
          time: new Date(order.created_at),
          locationName: order.location?.name || 'Unknown',
          locationId: order.location_id || null,
        });
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
        const defaultLocationName = emp.default_location_id
          ? locationMap.get(emp.default_location_id)
          : undefined;
        return {
          userId: emp.id,
          userName: emp.name,
          lastOrderTime: orderInfo?.time,
          locationName: orderInfo?.locationName || defaultLocationName || 'Unknown',
          defaultLocationId: emp.default_location_id,
          lastOrderLocationId: orderInfo?.locationId,
        };
      });

      // Filter by selected location if applicable
      if (selectedLocation) {
        const filteredStatuses = statuses.filter((status) =>
          status.defaultLocationId === selectedLocation.id ||
          status.lastOrderLocationId === selectedLocation.id
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
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSelectedLocation(loc);
    setShowLocationPicker(false);
  };

  const handleSendReminderToEmployee = async (employee: EmployeeOrderStatus) => {
    Alert.alert(
      'Send Reminder',
      `Send a reminder to ${employee.userName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          onPress: async () => {
            setSendingEmployeeId(employee.userId);
            try {
              await sendReminderToEmployees([employee.userId]);

              if (hapticFeedback && Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }

              Alert.alert('Sent!', `Reminder sent to ${employee.userName}.`);
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to send reminder');
            } finally {
              setSendingEmployeeId(null);
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

  const getDaysSinceOrder = (date?: Date) => {
    if (!date) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const orderDate = new Date(date);
    orderDate.setHours(0, 0, 0, 0);
    return Math.floor((today.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24));
  };

  const getReminderStatus = (date?: Date): ReminderStatus => {
    const days = getDaysSinceOrder(date);
    if (days === null) return 'red';
    if (days <= 3) return 'green';
    if (days <= 6) return 'orange';
    return 'red';
  };

  const formatLastOrder = (date?: Date) => {
    const days = getDaysSinceOrder(date);
    if (days === null) return 'No orders yet';
    if (days === 0) return 'Ordered today';
    if (days === 1) return '1 day ago';
    return `${days} days ago`;
  };

  const reminderStats = useMemo(() => {
    return employeeStatuses.reduce(
      (acc, employee) => {
        const status = getReminderStatus(employee.lastOrderTime);
        acc[status] += 1;
        return acc;
      },
      { green: 0, orange: 0, red: 0 } as Record<ReminderStatus, number>
    );
  }, [employeeStatuses]);

  const sortedEmployeeStatuses = useMemo(() => {
    const severityRank: Record<ReminderStatus, number> = { red: 0, orange: 1, green: 2 };
    return [...employeeStatuses].sort((a, b) => {
      const aStatus = getReminderStatus(a.lastOrderTime);
      const bStatus = getReminderStatus(b.lastOrderTime);
      if (aStatus !== bStatus) {
        return severityRank[aStatus] - severityRank[bStatus];
      }
      const aDays = getDaysSinceOrder(a.lastOrderTime) ?? 999;
      const bDays = getDaysSinceOrder(b.lastOrderTime) ?? 999;
      return bDays - aDays;
    });
  }, [employeeStatuses]);

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
      {/* Header */}
      <View className="bg-white px-4 pt-3 pb-2 border-b border-gray-100">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center">
            <BrandLogo variant="header" size={28} />
            <View className="ml-2 rounded-full bg-purple-100 px-3 py-1">
              <Text className="text-purple-700 text-xs font-semibold">Manager</Text>
            </View>
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

        {/* Location Dropdown */}
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
              {!selectedLocation && (
                <Ionicons name="checkmark" size={18} color="#F97316" />
              )}
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
                  <View className={`w-9 h-9 rounded-full items-center justify-center mr-3 ${
                    isSelected ? 'bg-primary-500' : 'bg-gray-200'
                  }`}>
                    <Text className={`text-xs font-bold ${
                      isSelected ? 'text-white' : 'text-gray-600'
                    }`}>
                      {loc.short_code}
                    </Text>
                  </View>
                  <Text className="flex-1 text-gray-900 font-medium">{loc.name}</Text>
                  {isSelected && (
                    <Ionicons name="checkmark" size={18} color="#F97316" />
                  )}
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

        {/* Employee Reminder Command Center */}
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
            <View>
              <Text className="text-gray-900 font-bold text-lg">Employee Reminders</Text>
              <Text className="text-gray-500 text-sm mt-1">
                Review ordering activity by employee
              </Text>
            </View>
            <TouchableOpacity
              className="bg-primary-500 rounded-full px-4 py-2"
              onPress={() => setShowReminderModal(true)}
              activeOpacity={0.8}
            >
              <Text className="text-white font-semibold text-sm">View</Text>
            </TouchableOpacity>
          </View>

          <View className="flex-row gap-3 mt-4">
            <View className={`flex-1 rounded-xl px-3 py-3 ${REMINDER_COLORS.green.bg}`}>
              <Text className={`text-xs font-semibold ${REMINDER_COLORS.green.text}`}>Recent</Text>
              <Text className="text-2xl font-bold text-gray-900 mt-1">
                {reminderStats.green}
              </Text>
            </View>
            <View className={`flex-1 rounded-xl px-3 py-3 ${REMINDER_COLORS.orange.bg}`}>
              <Text className={`text-xs font-semibold ${REMINDER_COLORS.orange.text}`}>Warning</Text>
              <Text className="text-2xl font-bold text-gray-900 mt-1">
                {reminderStats.orange}
              </Text>
            </View>
            <View className={`flex-1 rounded-xl px-3 py-3 ${REMINDER_COLORS.red.bg}`}>
              <Text className={`text-xs font-semibold ${REMINDER_COLORS.red.text}`}>Critical</Text>
              <Text className="text-2xl font-bold text-gray-900 mt-1">
                {reminderStats.red}
              </Text>
            </View>
          </View>
        </View>

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
                      {activity.itemCount && activity.itemCount > 1 && ` +${activity.itemCount - 1} more`}
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

      {/* Employee Reminder Modal */}
      <View>
        <Modal
          visible={showReminderModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowReminderModal(false)}
        >
          <View className="flex-1 bg-black/40 justify-end">
            <View className="bg-white rounded-t-3xl" style={{ maxHeight: '80%' }}>
              <View className="px-6 pt-5 pb-3 border-b border-gray-100 flex-row items-center justify-between">
                <View>
                  <Text className="text-xl font-bold text-gray-900">Employee Reminders</Text>
                  <Text className="text-sm text-gray-500 mt-1">
                    Tap an employee to send a reminder
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setShowReminderModal(false)}
                  className="w-9 h-9 rounded-full bg-gray-100 items-center justify-center"
                >
                  <Ionicons name="close" size={18} color="#6B7280" />
                </TouchableOpacity>
              </View>

              <ScrollView contentContainerStyle={{ padding: 16 }}>
                {sortedEmployeeStatuses.length === 0 ? (
                  <View className="py-10 items-center">
                    <Ionicons name="people-outline" size={42} color="#D1D5DB" />
                    <Text className="text-gray-400 mt-3">No employees found</Text>
                  </View>
                ) : (
                  sortedEmployeeStatuses.map((employee) => {
                    const status = getReminderStatus(employee.lastOrderTime);
                    const statusStyle = REMINDER_COLORS[status];
                    return (
                      <TouchableOpacity
                        key={employee.userId}
                        className="flex-row items-center bg-gray-50 rounded-2xl px-4 py-3 mb-3"
                        onPress={() => handleSendReminderToEmployee(employee)}
                        activeOpacity={0.7}
                        disabled={sendingEmployeeId === employee.userId}
                      >
                        <View
                          className="w-3 h-3 rounded-full mr-3"
                          style={{ backgroundColor: statusStyle.dot }}
                        />
                        <View className="flex-1">
                          <Text className="text-gray-900 font-semibold">{employee.userName}</Text>
                          <Text className="text-xs text-gray-500 mt-1">
                            {employee.locationName} • {formatLastOrder(employee.lastOrderTime)}
                          </Text>
                        </View>
                        <View className={`px-3 py-1 rounded-full ${statusStyle.bg}`}>
                          <Text className={`text-xs font-semibold ${statusStyle.text}`}>
                            {status === 'green' ? 'Recent' : status === 'orange' ? 'Warning' : 'Critical'}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
