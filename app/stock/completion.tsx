import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { colors } from '@/constants';
import { useStockNetworkStatus } from '@/hooks';
import { useStockStore } from '@/store';
import type { AreaItemWithDetails } from '@/types';
import type { SessionItemUpdate } from '@/store/stock.store';

type QuantityBand = 'critical' | 'low' | 'healthy';

type CompletionRow = {
  id: string;
  itemName: string;
  areaName: string;
  unitType: string;
  oldQuantity: number;
  newQuantity: number;
  status: SessionItemUpdate['status'];
  minQuantity: number;
};

function normalizeQuantity(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) return 0;
  return parsed;
}

function getQuantityBand(quantity: number, minQuantity: number): QuantityBand {
  if (quantity < minQuantity) return 'critical';
  if (quantity < minQuantity * 1.5) return 'low';
  return 'healthy';
}

function getStatusStyles(status: SessionItemUpdate['status']) {
  if (status === 'counted') {
    return {
      container: 'bg-green-100',
      text: 'text-green-700',
      label: 'Counted',
    };
  }

  return {
    container: 'bg-gray-200',
    text: 'text-gray-600',
    label: 'Skipped',
  };
}

function toMap(items: AreaItemWithDetails[]): Map<string, AreaItemWithDetails> {
  const map = new Map<string, AreaItemWithDetails>();
  items.forEach((item) => map.set(item.id, item));
  return map;
}

export default function StockCompletionScreen() {
  const params = useLocalSearchParams();
  const areaId = Array.isArray(params.areaId) ? params.areaId[0] : params.areaId;

  const {
    areaItemsById,
    currentAreaItems,
    currentAreaId,
    storageAreas,
    sessionItemUpdates,
    pendingUpdates,
    isOnline,
    isLoading,
    error,
    setSessionItemQuantity,
    completeSession,
  } = useStockStore();

  const [showHealthyItems, setShowHealthyItems] = useState(false);
  const [editingRow, setEditingRow] = useState<CompletionRow | null>(null);
  const [editQuantity, setEditQuantity] = useState('0');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useStockNetworkStatus();

  const areaItems = useMemo(() => {
    if (!areaId) return [];
    if (currentAreaId === areaId) return currentAreaItems;
    return areaItemsById[areaId] ?? [];
  }, [areaId, currentAreaId, currentAreaItems, areaItemsById]);

  const areaItemsMap = useMemo(() => toMap(areaItems), [areaItems]);

  const areaName = useMemo(() => {
    if (!areaId) return 'Station';
    return storageAreas.find((entry) => entry.id === areaId)?.name ?? 'Station';
  }, [storageAreas, areaId]);

  const rows = useMemo(() => {
    if (!areaId) return [];

    return Object.values(sessionItemUpdates)
      .filter((entry) => entry.areaId === areaId)
      .map((entry) => {
        const sourceItem = areaItemsMap.get(entry.areaItemId);

        return {
          id: entry.areaItemId,
          itemName: entry.itemName || sourceItem?.inventory_item.name || 'Item',
          areaName: entry.areaName || areaName,
          unitType: entry.unitType || sourceItem?.unit_type || 'units',
          oldQuantity: entry.previousQuantity,
          newQuantity: entry.status === 'counted' ? entry.newQuantity : entry.previousQuantity,
          status: entry.status,
          minQuantity: sourceItem?.min_quantity ?? 0,
        } satisfies CompletionRow;
      });
  }, [areaId, sessionItemUpdates, areaItemsMap, areaName]);

  const groupedRows = useMemo(() => {
    const groups: Record<QuantityBand, CompletionRow[]> = {
      critical: [],
      low: [],
      healthy: [],
    };

    rows.forEach((row) => {
      groups[getQuantityBand(row.newQuantity, row.minQuantity)].push(row);
    });

    return groups;
  }, [rows]);

  const countedItems = useMemo(
    () => rows.filter((row) => row.status === 'counted'),
    [rows]
  );

  const skippedItems = useMemo(
    () => rows.filter((row) => row.status === 'skipped'),
    [rows]
  );

  const totalQuantityChanged = useMemo(
    () =>
      countedItems.reduce(
        (sum, row) => sum + Math.abs(row.newQuantity - row.oldQuantity),
        0
      ),
    [countedItems]
  );

  const updatedItemsCount = useMemo(
    () => countedItems.filter((row) => row.newQuantity !== row.oldQuantity).length,
    [countedItems]
  );

  const openEditor = useCallback((row: CompletionRow) => {
    if (row.status !== 'counted') return;
    setEditingRow(row);
    setEditQuantity(String(row.newQuantity));
  }, []);

  const closeEditor = useCallback(() => {
    setEditingRow(null);
    setEditQuantity('0');
  }, []);

  const handleEditQuantityChange = useCallback((value: string) => {
    setEditQuantity(value.replace(/[^0-9]/g, ''));
  }, []);

  const handleEditAdjust = useCallback((delta: number) => {
    const current = normalizeQuantity(editQuantity);
    const next = Math.max(0, current + delta);
    setEditQuantity(String(next));
  }, [editQuantity]);

  const handleSaveEdit = useCallback(() => {
    if (!editingRow) return;
    setSessionItemQuantity(editingRow.id, normalizeQuantity(editQuantity));
    closeEditor();
  }, [editingRow, editQuantity, setSessionItemQuantity, closeEditor]);

  const handleCompleteSession = useCallback(async () => {
    if (!rows.length) {
      Alert.alert('No Updates', 'Count or skip at least one item before completing.');
      return;
    }

    setIsSubmitting(true);
    await completeSession();
    setIsSubmitting(false);

    const latest = useStockStore.getState();
    if (latest.currentSession) {
      Alert.alert('Unable to Complete', latest.error ?? 'Please try again.');
      return;
    }

    router.replace('/(tabs)/stock');
  }, [rows.length, completeSession]);

  if (!areaId) {
    return null;
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 28 }}>
        {!isOnline && (
          <View className="mx-4 mt-4 rounded-2xl bg-amber-100 px-4 py-3">
            <Text className="text-sm font-semibold text-amber-800">
              Offline mode. Final updates will sync when connected.
            </Text>
            <Text className="mt-1 text-xs text-amber-700">
              Pending sync updates: {pendingUpdates.length}
            </Text>
          </View>
        )}

        <View className="px-4 mt-5">
          <Text className="text-2xl font-bold text-gray-900">Confirm Quantities</Text>
          <Text className="mt-1 text-sm text-gray-500">{areaName}</Text>
        </View>

        <View className="mx-4 mt-4 rounded-3xl bg-white border border-gray-100 p-5">
          <Text className="text-xs font-semibold text-gray-500 tracking-wide">QUANTITY SUMMARY</Text>
          <View className="mt-4 flex-row items-center justify-between">
            <Text className="text-sm text-gray-500">Total items counted</Text>
            <Text className="text-lg font-bold text-gray-900">{countedItems.length}</Text>
          </View>
          <View className="mt-2 flex-row items-center justify-between">
            <Text className="text-sm text-gray-500">Total items skipped</Text>
            <Text className="text-lg font-bold text-gray-900">{skippedItems.length}</Text>
          </View>
          <View className="mt-2 flex-row items-center justify-between">
            <Text className="text-sm text-gray-500">Total quantity changed</Text>
            <Text className="text-lg font-bold text-gray-900">{totalQuantityChanged}</Text>
          </View>
          <View className="mt-2 flex-row items-center justify-between">
            <Text className="text-sm text-gray-500">Items updated</Text>
            <Text className="text-lg font-bold text-gray-900">{updatedItemsCount}</Text>
          </View>

          <View className="mt-4 flex-row">
            <View className="mr-2 rounded-full bg-red-100 px-3 py-1">
              <Text className="text-xs font-semibold text-red-700">Critical {groupedRows.critical.length}</Text>
            </View>
            <View className="mr-2 rounded-full bg-amber-100 px-3 py-1">
              <Text className="text-xs font-semibold text-amber-700">Low {groupedRows.low.length}</Text>
            </View>
            <View className="rounded-full bg-green-100 px-3 py-1">
              <Text className="text-xs font-semibold text-green-700">Healthy {groupedRows.healthy.length}</Text>
            </View>
          </View>
        </View>

        {error && (
          <View className="mx-4 mt-4 rounded-2xl bg-red-50 px-4 py-3">
            <Text className="text-xs text-red-700">{error}</Text>
          </View>
        )}

        <View className="px-4 mt-5">
          <Text className="text-xs font-semibold text-red-600 tracking-wide">CRITICAL</Text>
          <View className="mt-2">
            {groupedRows.critical.length === 0 ? (
              <Text className="text-xs text-gray-400">No critical items.</Text>
            ) : (
              groupedRows.critical.map((row) => {
                const statusStyle = getStatusStyles(row.status);
                return (
                  <View key={row.id} className="rounded-2xl bg-white border border-red-100 px-4 py-4 mb-3">
                    <View className="flex-row items-start justify-between">
                      <View className="flex-1 pr-3">
                        <Text className="text-sm font-semibold text-gray-900">{row.itemName}</Text>
                        <Text className="mt-1 text-xs text-gray-500">{row.areaName}</Text>
                        <Text className="mt-2 text-xs text-gray-700">
                          Old: {row.oldQuantity} {row.unitType} • New: {row.newQuantity} {row.unitType}
                        </Text>
                      </View>
                      <View className="items-end">
                        <View className={`rounded-full px-3 py-1 ${statusStyle.container}`}>
                          <Text className={`text-xs font-semibold ${statusStyle.text}`}>{statusStyle.label}</Text>
                        </View>
                        {row.status === 'counted' && (
                          <TouchableOpacity
                            className="mt-2 rounded-full border border-gray-200 px-3 py-1"
                            onPress={() => openEditor(row)}
                          >
                            <Text className="text-xs font-semibold text-gray-700">Edit</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </View>

        <View className="px-4 mt-2">
          <Text className="text-xs font-semibold text-amber-600 tracking-wide">LOW</Text>
          <View className="mt-2">
            {groupedRows.low.length === 0 ? (
              <Text className="text-xs text-gray-400">No low items.</Text>
            ) : (
              groupedRows.low.map((row) => {
                const statusStyle = getStatusStyles(row.status);
                return (
                  <View key={row.id} className="rounded-2xl bg-white border border-amber-100 px-4 py-4 mb-3">
                    <View className="flex-row items-start justify-between">
                      <View className="flex-1 pr-3">
                        <Text className="text-sm font-semibold text-gray-900">{row.itemName}</Text>
                        <Text className="mt-1 text-xs text-gray-500">{row.areaName}</Text>
                        <Text className="mt-2 text-xs text-gray-700">
                          Old: {row.oldQuantity} {row.unitType} • New: {row.newQuantity} {row.unitType}
                        </Text>
                      </View>
                      <View className="items-end">
                        <View className={`rounded-full px-3 py-1 ${statusStyle.container}`}>
                          <Text className={`text-xs font-semibold ${statusStyle.text}`}>{statusStyle.label}</Text>
                        </View>
                        {row.status === 'counted' && (
                          <TouchableOpacity
                            className="mt-2 rounded-full border border-gray-200 px-3 py-1"
                            onPress={() => openEditor(row)}
                          >
                            <Text className="text-xs font-semibold text-gray-700">Edit</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </View>

        <View className="px-4 mt-2">
          <View className="flex-row items-center justify-between">
            <Text className="text-xs font-semibold text-green-700 tracking-wide">HEALTHY</Text>
            <TouchableOpacity
              className="flex-row items-center"
              onPress={() => setShowHealthyItems((prev) => !prev)}
            >
              <Text className="text-xs font-semibold text-gray-500 mr-1">
                {showHealthyItems ? 'Hide' : 'Show'} ({groupedRows.healthy.length})
              </Text>
              <Ionicons
                name={showHealthyItems ? 'chevron-up' : 'chevron-down'}
                size={14}
                color={colors.gray[500]}
              />
            </TouchableOpacity>
          </View>

          {showHealthyItems && (
            <View className="mt-2">
              {groupedRows.healthy.length === 0 ? (
                <Text className="text-xs text-gray-400">No healthy items.</Text>
              ) : (
                groupedRows.healthy.map((row) => {
                  const statusStyle = getStatusStyles(row.status);
                  return (
                    <View key={row.id} className="rounded-2xl bg-white border border-green-100 px-4 py-4 mb-3">
                      <View className="flex-row items-start justify-between">
                        <View className="flex-1 pr-3">
                          <Text className="text-sm font-semibold text-gray-900">{row.itemName}</Text>
                          <Text className="mt-1 text-xs text-gray-500">{row.areaName}</Text>
                          <Text className="mt-2 text-xs text-gray-700">
                            Old: {row.oldQuantity} {row.unitType} • New: {row.newQuantity} {row.unitType}
                          </Text>
                        </View>
                        <View className="items-end">
                          <View className={`rounded-full px-3 py-1 ${statusStyle.container}`}>
                            <Text className={`text-xs font-semibold ${statusStyle.text}`}>{statusStyle.label}</Text>
                          </View>
                          {row.status === 'counted' && (
                            <TouchableOpacity
                              className="mt-2 rounded-full border border-gray-200 px-3 py-1"
                              onPress={() => openEditor(row)}
                            >
                              <Text className="text-xs font-semibold text-gray-700">Edit</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          )}
        </View>

        <View className="px-4 mt-4">
          <TouchableOpacity
            className="rounded-full bg-orange-500 py-4 items-center"
            onPress={handleCompleteSession}
            disabled={isSubmitting || isLoading}
          >
            <Text className="text-base font-semibold text-white">
              {isSubmitting || isLoading ? 'Completing...' : 'Complete Stock Session'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="mt-3 rounded-full border border-gray-200 py-4 items-center"
            onPress={() => router.back()}
          >
            <Text className="text-base font-semibold text-gray-700">Back to Counting</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal visible={Boolean(editingRow)} transparent animationType="fade" onRequestClose={closeEditor}>
        <View className="flex-1 bg-black/40 justify-center px-5">
          <View className="rounded-3xl bg-white p-5">
            <Text className="text-base font-semibold text-gray-900">Edit Quantity</Text>
            <Text className="mt-1 text-xs text-gray-500">{editingRow?.itemName}</Text>

            <View className="mt-5 flex-row items-center justify-center">
              <TouchableOpacity
                className="h-12 w-12 rounded-full bg-gray-100 items-center justify-center"
                onPress={() => handleEditAdjust(-1)}
              >
                <Ionicons name="remove" size={22} color={colors.gray[700]} />
              </TouchableOpacity>

              <TextInput
                value={editQuantity}
                onChangeText={handleEditQuantityChange}
                keyboardType="number-pad"
                className="mx-4 text-4xl font-bold text-gray-900 text-center min-w-[110px]"
              />

              <TouchableOpacity
                className="h-12 w-12 rounded-full bg-gray-100 items-center justify-center"
                onPress={() => handleEditAdjust(1)}
              >
                <Ionicons name="add" size={22} color={colors.gray[700]} />
              </TouchableOpacity>
            </View>

            <View className="mt-6 flex-row justify-end">
              <TouchableOpacity
                className="rounded-full border border-gray-200 px-4 py-2 mr-2"
                onPress={closeEditor}
              >
                <Text className="text-sm font-semibold text-gray-600">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity className="rounded-full bg-orange-500 px-4 py-2" onPress={handleSaveEdit}>
                <Text className="text-sm font-semibold text-white">Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
