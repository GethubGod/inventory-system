import { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
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
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store';
import { Order, OrderStatus, Location } from '@/types';
import { statusColors, ORDER_STATUS_LABELS } from '@/constants';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';

type FilterStatus = OrderStatus | 'all';

const filterStatuses: { key: FilterStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'submitted', label: 'Pending' },
  { key: 'processing', label: 'Processing' },
  { key: 'fulfilled', label: 'Fulfilled' },
];

export default function ManagerOrdersScreen() {
  const { locations, fetchLocations } = useAuthStore();
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<FilterStatus>('submitted');
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});

  const fetchOrders = async () => {
    try {
      let query = supabase
        .from('orders')
        .select(`
          *,
          location:locations(*),
          user:users!orders_user_id_fkey(*),
          order_items(count)
        `)
        .neq('status', 'draft')
        .order('created_at', { ascending: false })
        .limit(100);

      if (selectedStatus !== 'all') {
        query = query.eq('status', selectedStatus);
      }

      if (selectedLocation) {
        query = query.eq('location_id', selectedLocation.id);
      }

      const { data, error } = await query;

      if (error) throw error;
      setOrders(data || []);
    } catch (error) {
      console.error('Error fetching orders:', error);
    }
  };

  const fetchStatusCounts = async () => {
    let query = supabase.from('orders').select('status').neq('status', 'draft');

    if (selectedLocation) {
      query = query.eq('location_id', selectedLocation.id);
    }

    const { data } = await query;

    if (data) {
      const counts: Record<string, number> = { all: data.length };
      (data as { status: string }[]).forEach((order) => {
        counts[order.status] = (counts[order.status] || 0) + 1;
      });
      setStatusCounts(counts);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchLocations();
      fetchOrders();
      fetchStatusCounts();
    }, [selectedStatus, selectedLocation])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchOrders(), fetchStatusCounts()]);
    setRefreshing(false);
  };

  const handleSelectLocation = (loc: Location | null) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setSelectedLocation(loc);
    setShowLocationPicker(false);
  };

  const handleSelectStatus = (status: FilterStatus) => {
    if (Platform.OS !== 'web') {
      Haptics.selectionAsync();
    }
    setSelectedStatus(status);
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

  const getItemCount = (order: any) => {
    if (order.order_items && Array.isArray(order.order_items)) {
      return order.order_items.length > 0 ? order.order_items[0].count : 0;
    }
    return 0;
  };

  const renderOrder = ({ item: order }: { item: Order }) => {
    const colors = statusColors[order.status];
    const orderUser = (order as any).user;
    const orderLocation = (order as any).location;
    const itemCount = getItemCount(order);

    return (
      <TouchableOpacity
        className="bg-white rounded-2xl p-4 mb-3 border border-gray-100"
        style={{
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.05,
          shadowRadius: 4,
          elevation: 2,
        }}
        onPress={() => router.push(`/orders/${order.id}`)}
        activeOpacity={0.7}
      >
        <View className="flex-row justify-between items-start mb-3">
          <Text className="text-lg font-bold text-gray-900">
            Order #{order.order_number}
          </Text>
          <View
            className="px-3 py-1 rounded-full"
            style={{ backgroundColor: colors.bg }}
          >
            <Text
              className="text-sm font-semibold"
              style={{ color: colors.text }}
            >
              {ORDER_STATUS_LABELS[order.status]}
            </Text>
          </View>
        </View>

        <View className="space-y-2">
          <View className="flex-row items-center">
            <Ionicons name="person-outline" size={16} color="#6B7280" />
            <Text className="text-gray-700 ml-2 font-medium">
              {orderUser?.name || 'Unknown User'}
            </Text>
          </View>

          <View className="flex-row items-center mt-1">
            <Ionicons name="location-outline" size={16} color="#6B7280" />
            <Text className="text-gray-600 ml-2">
              {orderLocation?.name || 'Unknown Location'}
            </Text>
          </View>

          <View className="flex-row items-center mt-1">
            <Ionicons name="time-outline" size={16} color="#6B7280" />
            <Text className="text-gray-500 ml-2">
              {formatDate(order.created_at)} • {itemCount} item{itemCount !== 1 ? 's' : ''}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      <ManagerScaleContainer>
      {/* Header */}
      <View className="bg-white px-4 py-3 flex-row items-center justify-between border-b border-gray-100">
        <View className="flex-row items-center">
          <TouchableOpacity
            className="w-10 h-10 items-center justify-center -ml-2"
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={24} color="#374151" />
          </TouchableOpacity>
          <Text className="text-xl font-bold text-gray-900 ml-2">Orders</Text>
        </View>

        {/* Location Selector */}
        <TouchableOpacity
          className="bg-gray-100 rounded-full px-3 py-2 flex-row items-center"
          onPress={() => setShowLocationPicker(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="location" size={14} color="#F97316" />
          <Text className="text-gray-700 font-medium ml-1.5 text-sm">
            {selectedLocation?.short_code || 'All'}
          </Text>
          <Ionicons name="chevron-down" size={14} color="#6B7280" style={{ marginLeft: 4 }} />
        </TouchableOpacity>
      </View>

      {/* Status Filter Tabs */}
      <View className="bg-white border-b border-gray-200">
        <FlatList
          horizontal
          data={filterStatuses}
          keyExtractor={(item) => item.key}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 12 }}
          renderItem={({ item: filter }) => {
            const isSelected = selectedStatus === filter.key;
            const count = statusCounts[filter.key] || 0;
            const filterColor = filter.key !== 'all' ? statusColors[filter.key] : null;

            return (
              <TouchableOpacity
                className="px-4 py-2 rounded-full mr-2 flex-row items-center"
                style={{
                  backgroundColor: isSelected
                    ? filterColor?.text || '#F97316'
                    : filterColor?.bg || '#F3F4F6',
                }}
                onPress={() => handleSelectStatus(filter.key)}
              >
                <Text
                  className="font-semibold"
                  style={{
                    color: isSelected
                      ? '#FFFFFF'
                      : filterColor?.text || '#374151',
                  }}
                >
                  {filter.label}
                </Text>
                {count > 0 && (
                  <View
                    className="ml-1.5 px-1.5 py-0.5 rounded-full"
                    style={{
                      backgroundColor: isSelected
                        ? 'rgba(255,255,255,0.3)'
                        : 'rgba(0,0,0,0.1)',
                    }}
                  >
                    <Text
                      className="text-xs font-bold"
                      style={{
                        color: isSelected
                          ? '#FFFFFF'
                          : filterColor?.text || '#374151',
                      }}
                    >
                      {count}
                    </Text>
                  </View>
                )}
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
              {selectedStatus !== 'all'
                ? `No ${ORDER_STATUS_LABELS[selectedStatus]?.toLowerCase() || selectedStatus} orders`
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
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
