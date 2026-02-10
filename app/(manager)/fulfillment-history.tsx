import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';
import { useAuthStore, useOrderStore } from '@/store';

type DateFilter = 'all' | 'today' | '7d' | '30d';

const DATE_FILTER_OPTIONS: Array<{ key: DateFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
];

function getPastOrderSummary(pastOrder: any) {
  const payload = (pastOrder?.payload || {}) as Record<string, unknown>;
  const regularItems = Array.isArray(payload.regularItems) ? payload.regularItems : [];
  const remainingItems = Array.isArray(payload.remainingItems) ? payload.remainingItems : [];
  const totalItemCountRaw =
    typeof payload.totalItemCount === 'number'
      ? payload.totalItemCount
      : typeof payload.total_item_count === 'number'
        ? payload.total_item_count
        : regularItems.length + remainingItems.length;
  const totalItemCount = Number.isFinite(totalItemCountRaw) ? totalItemCountRaw : 0;

  const locationsRaw = Array.isArray(payload.locations)
    ? payload.locations
    : Array.isArray(payload.location_groups)
      ? payload.location_groups
      : [];
  const locations = locationsRaw
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);

  return {
    totalItemCount,
    locations,
  };
}

function isInDateFilter(createdAt: string, filter: DateFilter) {
  if (filter === 'all') return true;
  const now = Date.now();
  const createdTime = new Date(createdAt).getTime();
  if (!Number.isFinite(createdTime)) return false;

  if (filter === 'today') {
    const created = new Date(createdAt);
    const current = new Date();
    return (
      created.getFullYear() === current.getFullYear() &&
      created.getMonth() === current.getMonth() &&
      created.getDate() === current.getDate()
    );
  }

  if (filter === '7d') {
    return createdTime >= now - 7 * 24 * 60 * 60 * 1000;
  }

  if (filter === '30d') {
    return createdTime >= now - 30 * 24 * 60 * 60 * 1000;
  }

  return true;
}

export default function FulfillmentHistoryScreen() {
  const { user } = useAuthStore();
  const { pastOrders, loadFulfillmentData } = useOrderStore();
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');

  const refreshData = useCallback(async () => {
    await loadFulfillmentData(user?.id ?? null);
  }, [loadFulfillmentData, user?.id]);

  useFocusEffect(
    useCallback(() => {
      void refreshData();
    }, [refreshData])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshData();
    setRefreshing(false);
  }, [refreshData]);

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredOrders = useMemo(() => {
    return pastOrders.filter((row) => {
      if (!isInDateFilter(row.createdAt, dateFilter)) return false;
      if (!normalizedSearch) return true;
      return row.supplierName.toLowerCase().includes(normalizedSearch);
    });
  }, [dateFilter, normalizedSearch, pastOrders]);

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      <ManagerScaleContainer>
        <View className="bg-white px-4 py-3 border-b border-gray-100 flex-row items-center">
          <TouchableOpacity
            onPress={() => router.back()}
            className="p-2 mr-2"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={20} color={colors.gray[700]} />
          </TouchableOpacity>
          <View className="flex-1">
            <Text className="text-lg font-bold text-gray-900">Past Orders</Text>
            <Text className="text-xs text-gray-500">
              {filteredOrders.length} order{filteredOrders.length === 1 ? '' : 's'}
            </Text>
          </View>
        </View>

        <View className="px-4 pt-4 pb-2 bg-gray-50">
          <View className="bg-white rounded-xl border border-gray-200 px-3 py-2.5 flex-row items-center">
            <Ionicons name="search-outline" size={16} color={colors.gray[400]} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search supplier"
              placeholderTextColor={colors.gray[400]}
              className="ml-2 flex-1 text-sm text-gray-900"
            />
          </View>
          <View className="flex-row mt-3">
            {DATE_FILTER_OPTIONS.map((option) => {
              const selected = option.key === dateFilter;
              return (
                <TouchableOpacity
                  key={option.key}
                  onPress={() => setDateFilter(option.key)}
                  className={`px-3 py-2 rounded-full mr-2 ${selected ? 'bg-primary-500' : 'bg-white border border-gray-200'}`}
                >
                  <Text className={`text-xs font-semibold ${selected ? 'text-white' : 'text-gray-600'}`}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <FlatList
          data={filteredOrders}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary[500]}
            />
          }
          ItemSeparatorComponent={() => <View className="h-3" />}
          renderItem={({ item }) => {
            const summary = getPastOrderSummary(item);
            const dateLabel = new Date(item.createdAt).toLocaleString();

            return (
              <TouchableOpacity
                onPress={() =>
                  router.push({
                    pathname: '/(manager)/fulfillment-history-detail',
                    params: { id: item.id },
                  } as any)
                }
                className="bg-white rounded-2xl border border-gray-100 px-4 py-3"
                activeOpacity={0.7}
              >
                <View className="flex-row items-start justify-between">
                  <View className="flex-1 pr-2">
                    <Text className="text-base font-semibold text-gray-900">{item.supplierName}</Text>
                    <Text className="text-xs text-gray-500 mt-1">{dateLabel}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.gray[400]} />
                </View>

                <View className="flex-row items-center mt-3">
                  <View className="px-2.5 py-1 rounded-full bg-gray-100 mr-2">
                    <Text className="text-[11px] font-semibold text-gray-700">
                      {summary.totalItemCount} item{summary.totalItemCount === 1 ? '' : 's'}
                    </Text>
                  </View>
                  {summary.locations.length > 0 && (
                    <Text className="text-xs text-gray-600">
                      {summary.locations.join(', ')}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View className="items-center justify-center py-16">
              <Ionicons name="time-outline" size={40} color={colors.gray[300]} />
              <Text className="text-gray-500 text-base mt-3">No past orders</Text>
              <Text className="text-gray-400 text-sm mt-1 text-center px-10">
                Finalized supplier orders will show up here.
              </Text>
            </View>
          }
        />
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
