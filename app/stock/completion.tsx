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
import { useSettingsStore, useStockStore } from '@/store';
import type { AreaItemWithDetails } from '@/types';
import type { SessionItemUpdate } from '@/store/stock.store';
import {
  cancelStockCountPausedNotifications,
} from '@/services/notificationService';

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
  maxQuantity: number | null;
};

type FlaggedRow = CompletionRow & {
  flagReason: string;
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

function getFlagReason(row: CompletionRow): string | null {
  if (!Number.isFinite(row.newQuantity) || row.newQuantity < 0) {
    return 'Invalid quantity';
  }

  const maxQuantity = row.maxQuantity;
  const hasMax = typeof maxQuantity === 'number' && maxQuantity > 0;
  if (hasMax && row.newQuantity > maxQuantity * 1.25) {
    return `Above max (Max ${maxQuantity})`;
  }

  if (!hasMax && row.newQuantity >= row.oldQuantity * 3 && row.newQuantity >= 10) {
    return '3x increase';
  }

  return null;
}

function QuantityRow({
  row,
  flagReason,
  onEdit,
  compact = false,
}: {
  row: CompletionRow;
  flagReason?: string | null;
  onEdit: (row: CompletionRow) => void;
  compact?: boolean;
}) {
  const statusStyle = getStatusStyles(row.status);
  const canEdit = row.status === 'counted';
  const isCompact = compact && !flagReason;
  const quantityFontSize = isCompact ? 26 : 34;
  const quantityLineHeight = isCompact ? 30 : 38;

  return (
    <TouchableOpacity
      activeOpacity={canEdit ? 0.8 : 1}
      onPress={canEdit ? () => onEdit(row) : undefined}
      className={`rounded-3xl bg-white border ${
        flagReason ? 'border-red-100' : 'border-gray-100'
      } ${isCompact ? 'px-3 py-3 mb-2' : 'px-4 py-4 mb-3'}`}
    >
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          <Text className={`${isCompact ? 'text-[13px]' : 'text-sm'} font-semibold text-gray-900`}>
            {row.itemName}
          </Text>
          <Text className="mt-1 text-[11px] text-gray-500">
            {row.areaName} • {row.unitType}
          </Text>
        </View>
        <View className="items-end">
          <View className={`rounded-full px-3 py-1 ${statusStyle.container}`}>
            <Text className={`text-xs font-semibold ${statusStyle.text}`}>{statusStyle.label}</Text>
          </View>
          {canEdit && (
            <View className="mt-2 flex-row items-center">
              <Ionicons name="create-outline" size={13} color={colors.gray[500]} />
              <Text className="ml-1 text-xs font-semibold text-gray-500">Edit</Text>
            </View>
          )}
        </View>
      </View>

      <View className={`${isCompact ? 'mt-2 px-2 py-2' : 'mt-4 px-3 py-3'} rounded-2xl bg-gray-50 border border-gray-100`}>
        <View className="flex-row items-center justify-between">
          <View className="items-center flex-1">
            <Text className="text-[10px] font-semibold text-gray-500 tracking-[1px]">OLD</Text>
            <Text className="font-black text-gray-900" style={{ fontSize: quantityFontSize, lineHeight: quantityLineHeight }}>
              {row.oldQuantity}
            </Text>
          </View>

          <Ionicons name="arrow-forward" size={20} color={colors.gray[400]} />

          <View className="items-center flex-1">
            <Text className="text-[10px] font-semibold text-gray-500 tracking-[1px]">NEW</Text>
            <Text className="font-black text-orange-600" style={{ fontSize: quantityFontSize, lineHeight: quantityLineHeight }}>
              {row.newQuantity}
            </Text>
          </View>
        </View>
      </View>

      {flagReason ? (
        <View className="mt-3 flex-row items-center justify-between rounded-2xl border border-red-200 bg-red-50 px-3 py-2">
          <View>
            <View className="self-start rounded-full bg-red-500 px-2 py-0.5">
              <Text className="text-[10px] font-bold text-white">FLAGGED</Text>
            </View>
            <Text className="mt-1 text-xs font-semibold text-red-700">{flagReason}</Text>
          </View>
          {canEdit && (
            <Text className="text-xs font-semibold text-red-700">Review</Text>
          )}
        </View>
      ) : null}

      {!isCompact && <Text className="mt-3 text-[11px] text-gray-500">Unit: {row.unitType}</Text>}
    </TouchableOpacity>
  );
}

export default function StockCompletionScreen() {
  const params = useLocalSearchParams();
  const areaId = Array.isArray(params.areaId) ? params.areaId[0] : params.areaId;

  const { stockSettings } = useSettingsStore();

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
          maxQuantity: sourceItem?.max_quantity ?? null,
        } satisfies CompletionRow;
      });
  }, [areaId, sessionItemUpdates, areaItemsMap, areaName]);

  const countedItems = useMemo(
    () => rows.filter((row) => row.status === 'counted'),
    [rows]
  );

  const skippedItems = useMemo(
    () => rows.filter((row) => row.status === 'skipped'),
    [rows]
  );

  const flaggedRows = useMemo<FlaggedRow[]>(() => {
    if (!stockSettings.flagUnusualQuantities) return [];

    return countedItems
      .map((row) => {
        const flagReason = getFlagReason(row);
        if (!flagReason) return null;
        return { ...row, flagReason };
      })
      .filter((row): row is FlaggedRow => Boolean(row));
  }, [countedItems, stockSettings.flagUnusualQuantities]);

  const flaggedItemIds = useMemo(() => new Set(flaggedRows.map((row) => row.id)), [flaggedRows]);

  const allCheckedRows = useMemo(
    () => countedItems.filter((row) => !flaggedItemIds.has(row.id)),
    [countedItems, flaggedItemIds]
  );

  const quantityBands = useMemo(() => {
    const bands: Record<QuantityBand, number> = {
      critical: 0,
      low: 0,
      healthy: 0,
    };

    countedItems.forEach((row) => {
      bands[getQuantityBand(row.newQuantity, row.minQuantity)] += 1;
    });

    return bands;
  }, [countedItems]);

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

    await cancelStockCountPausedNotifications();
    router.replace('/(tabs)/stock');
  }, [rows.length, completeSession]);

  if (!areaId) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50 items-center justify-center px-6">
        <Ionicons name="alert-circle-outline" size={32} color="#DC2626" />
        <Text className="mt-3 text-base font-semibold text-gray-900 text-center">
          Missing stock session
        </Text>
        <Text className="mt-1 text-sm text-gray-500 text-center">
          We could not find the storage area for this completion screen.
        </Text>
        <TouchableOpacity
          className="mt-5 rounded-xl bg-primary-500 px-4 py-2"
          onPress={() => router.replace('/(tabs)/stock')}
        >
          <Text className="text-white font-semibold">Back to Stock</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
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

          <View className="mt-4 flex-row flex-wrap">
            <View className="mr-2 mb-2 rounded-full bg-red-100 px-3 py-1">
              <Text className="text-xs font-semibold text-red-700">Critical {quantityBands.critical}</Text>
            </View>
            <View className="mr-2 mb-2 rounded-full bg-amber-100 px-3 py-1">
              <Text className="text-xs font-semibold text-amber-700">Low {quantityBands.low}</Text>
            </View>
            <View className="mb-2 rounded-full bg-green-100 px-3 py-1">
              <Text className="text-xs font-semibold text-green-700">Healthy {quantityBands.healthy}</Text>
            </View>
          </View>
        </View>

        {error && (
          <View className="mx-4 mt-4 rounded-2xl bg-red-50 px-4 py-3">
            <Text className="text-xs text-red-700">{error}</Text>
          </View>
        )}

        <View className="px-4 mt-5">
          <Text className="text-xs font-semibold text-red-600 tracking-wide">
            FLAGGED ({flaggedRows.length})
          </Text>
          {!stockSettings.flagUnusualQuantities && (
            <Text className="mt-2 text-xs text-gray-400">
              Flagging is disabled in Settings.
            </Text>
          )}
          <View className="mt-2">
            {flaggedRows.length === 0 ? (
              <Text className="text-xs text-gray-400">No unusual quantities detected.</Text>
            ) : (
              flaggedRows.map((row) => (
                <QuantityRow
                  key={`flagged-${row.id}`}
                  row={row}
                  flagReason={row.flagReason}
                  onEdit={openEditor}
                />
              ))
            )}
          </View>
        </View>

        <View className="px-4 mt-2">
          <Text className="text-xs font-semibold text-gray-600 tracking-wide">ALL CHECKED ITEMS</Text>
          <View className="mt-2">
            {allCheckedRows.length === 0 ? (
              <Text className="text-xs text-gray-400">No additional checked items.</Text>
            ) : (
              allCheckedRows.map((row) => (
                <QuantityRow key={row.id} row={row} onEdit={openEditor} compact />
              ))
            )}
          </View>
        </View>

        <View className="px-4 mt-2">
          <Text className="text-xs font-semibold text-gray-500 tracking-wide">
            SKIPPED ({skippedItems.length})
          </Text>
          <View className="mt-2">
            {skippedItems.length === 0 ? (
              <Text className="text-xs text-gray-400">No skipped items.</Text>
            ) : (
              skippedItems.map((row) => (
                <QuantityRow key={`skipped-${row.id}`} row={row} onEdit={openEditor} compact />
              ))
            )}
          </View>
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
                maxLength={6}
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
