import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { colors, CATEGORY_LABELS } from '@/constants';
import { useAuthStore, useStockStore } from '@/store';
import { useStockNetworkStatus } from '@/hooks';
import { AreaItemWithDetails } from '@/types';
import { supabase } from '@/lib/supabase';

function formatCompletedAt(value?: string | string[]) {
  if (!value) return '';
  const date = new Date(Array.isArray(value) ? value[0] : value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function groupStockItems(items: AreaItemWithDetails[]) {
  const critical = items.filter((item) => item.current_quantity < item.min_quantity);
  const low = items.filter(
    (item) =>
      item.current_quantity >= item.min_quantity &&
      item.current_quantity < item.min_quantity * 1.5
  );
  const ok = items.filter((item) => item.current_quantity >= item.min_quantity * 1.5);
  return { critical, low, ok };
}

async function sendStockAlert(areaName: string, count: number) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `🔴 ${count} items need reordering`,
        body: `${areaName} requires attention.`,
        data: { type: 'stock-alert', areaName },
      },
      trigger: null,
    });
  } catch (_) {
    // Ignore notification errors
  }
}

async function storeStockAlert(areaId: string, message: string) {
  try {
    await supabase.from('notifications').insert({
      type: 'stock_alert',
      area_id: areaId,
      message,
      created_at: new Date().toISOString(),
    });
  } catch (_) {
    // If the table doesn't exist, ignore for now.
  }
}

export default function StockCompletionScreen() {
  const params = useLocalSearchParams();
  const areaId = Array.isArray(params.areaId) ? params.areaId[0] : params.areaId;
  const checked = Number(Array.isArray(params.checked) ? params.checked[0] : params.checked);
  const skipped = Number(Array.isArray(params.skipped) ? params.skipped[0] : params.skipped);
  const completedAt = formatCompletedAt(params.completedAt);

  const { user } = useAuthStore();
  const { storageAreas, currentAreaItems, fetchAreaItems, isOnline, isLoading } = useStockStore();
  const [showOkItems, setShowOkItems] = useState(false);
  const [alertSent, setAlertSent] = useState(false);

  useStockNetworkStatus();

  const area = useMemo(
    () => storageAreas.find((entry) => entry.id === areaId) ?? null,
    [storageAreas, areaId]
  );

  useEffect(() => {
    if (areaId) {
      fetchAreaItems(areaId);
    }
  }, [areaId, fetchAreaItems]);

  const { critical, low, ok } = useMemo(() => groupStockItems(currentAreaItems), [currentAreaItems]);

  useEffect(() => {
    if (!area || alertSent || critical.length === 0) return;

    const message = `🔴 ${critical.length} items need reordering at ${area.name}`;
    sendStockAlert(area.name, critical.length);
    storeStockAlert(area.id, message);
    setAlertSent(true);
  }, [area, critical.length, alertSent]);

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        {!isOnline && (
          <View className="mx-4 mt-4 rounded-2xl bg-amber-100 px-4 py-3">
            <Text className="text-sm font-semibold text-amber-800">
              Offline mode - updates will sync when connected.
            </Text>
          </View>
        )}

        <View className="px-4 mt-6 items-center">
          <View className="h-20 w-20 rounded-full bg-green-100 items-center justify-center">
            <Ionicons name="checkmark" size={36} color={colors.success} />
          </View>
          <Text className="mt-4 text-2xl font-bold text-gray-900">
            {area?.name ?? 'Station'} Updated!
          </Text>
          <Text className="mt-2 text-sm text-gray-500">
            {isNaN(checked) ? 0 : checked} items checked • {isNaN(skipped) ? 0 : skipped} skipped
          </Text>
          {completedAt ? (
            <Text className="mt-1 text-xs text-gray-400">{completedAt}</Text>
          ) : null}
        </View>

        {isLoading && currentAreaItems.length === 0 ? (
          <View className="mt-6 px-4">
            <Text className="text-gray-500">Loading stock summary...</Text>
          </View>
        ) : (
          <View className="px-4 mt-6">
            {critical.length === 0 && low.length === 0 && (
              <View className="rounded-2xl bg-green-50 px-4 py-4 border border-green-100 mb-4">
                <Text className="text-sm font-semibold text-green-700">
                  ✅ All items at healthy levels!
                </Text>
              </View>
            )}
            {critical.length > 0 && (
              <View className="rounded-2xl bg-white px-4 py-4 border border-red-100 mb-4">
                <Text className="text-sm font-bold text-red-600">
                  🔴 {critical.length} ITEMS NEED REORDERING
                </Text>
                {critical.map((item) => (
                  <View key={item.id} className="mt-3">
                    <Text className="text-sm font-semibold text-gray-900">
                      {item.inventory_item.name}
                    </Text>
                    <Text className="text-xs text-gray-500">
                      Current: {item.current_quantity} {item.unit_type} | Min: {item.min_quantity} {item.unit_type}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {low.length > 0 && (
              <View className="rounded-2xl bg-white px-4 py-4 border border-amber-100 mb-4">
                <Text className="text-sm font-bold text-amber-600">
                  🟡 {low.length} ITEMS RUNNING LOW
                </Text>
                {low.map((item) => (
                  <View key={item.id} className="mt-3">
                    <Text className="text-sm font-semibold text-gray-900">
                      {item.inventory_item.name}
                    </Text>
                    <Text className="text-xs text-gray-500">
                      {item.current_quantity} {item.unit_type} (min {item.min_quantity})
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <View className="rounded-2xl bg-white px-4 py-4 border border-green-100 mb-4">
              <TouchableOpacity
                className="flex-row items-center justify-between"
                onPress={() => setShowOkItems((prev) => !prev)}
              >
                <Text className="text-sm font-semibold text-green-700">
                  ✅ {ok.length} items at healthy levels
                </Text>
                <Ionicons
                  name={showOkItems ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={colors.gray[500]}
                />
              </TouchableOpacity>
              {showOkItems && (
                <View className="mt-3">
                  {ok.map((item) => (
                    <View key={item.id} className="mb-2">
                      <Text className="text-sm text-gray-900">
                        {item.inventory_item.name}
                      </Text>
                      <Text className="text-xs text-gray-500">
                        {item.current_quantity} {item.unit_type} • {CATEGORY_LABELS[item.inventory_item.category]}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View className="rounded-2xl bg-blue-50 px-4 py-4">
              <Text className="text-sm text-blue-700">
                {user?.role === 'manager'
                  ? 'These items have been added to reorder suggestions.'
                  : 'Managers will be notified about low stock items.'}
              </Text>
            </View>
          </View>
        )}

        <View className="px-4 mt-6">
          <TouchableOpacity
            className="rounded-full bg-orange-500 py-4 items-center"
            onPress={() => router.replace('/(tabs)/stock')}
          >
            <Text className="text-base font-semibold text-white">Done</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="mt-3 rounded-full border border-gray-200 py-4 items-center"
            onPress={() => router.replace('/(tabs)/stock')}
          >
            <Text className="text-base font-semibold text-gray-700">Check Another Station</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
