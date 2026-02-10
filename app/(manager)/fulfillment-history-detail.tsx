import React, { useMemo } from 'react';
import { Alert, ScrollView, Share, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { colors } from '@/constants';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';
import { useOrderStore } from '@/store';

function asArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'));
}

function toText(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function FulfillmentHistoryDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const { pastOrders } = useOrderStore();

  const targetId = Array.isArray(params.id) ? params.id[0] : params.id;
  const pastOrder = useMemo(
    () => pastOrders.find((item) => item.id === targetId) ?? null,
    [pastOrders, targetId]
  );

  if (!pastOrder) {
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
            <Text className="text-lg font-bold text-gray-900">Past Order</Text>
          </View>
          <View className="flex-1 items-center justify-center px-8">
            <Text className="text-gray-500 text-base">Order not found.</Text>
          </View>
        </ManagerScaleContainer>
      </SafeAreaView>
    );
  }

  const payload = (pastOrder.payload || {}) as Record<string, unknown>;
  const regularItems = asArray(payload.regularItems);
  const remainingItems = asArray(payload.remainingItems);
  const allItems = [...regularItems, ...remainingItems];

  const shareMessage = async () => {
    try {
      await Share.share({
        title: `${pastOrder.supplierName} Order`,
        message: pastOrder.messageText,
      });
    } catch (error: any) {
      Alert.alert('Share Failed', error?.message || 'Unable to open share sheet.');
    }
  };

  const copyMessage = async () => {
    await Clipboard.setStringAsync(pastOrder.messageText);
    Alert.alert('Copied', 'Message copied to clipboard.');
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right', 'bottom']}>
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
            <Text className="text-lg font-bold text-gray-900">{pastOrder.supplierName}</Text>
            <Text className="text-xs text-gray-500">{new Date(pastOrder.createdAt).toLocaleString()}</Text>
          </View>
        </View>

        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
          <View className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
            <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Summary</Text>
            <Text className="text-sm text-gray-700">
              {allItems.length} line{allItems.length === 1 ? '' : 's'} • Sent via{' '}
              {pastOrder.shareMethod === 'copy' ? 'copy' : 'share'}
            </Text>
          </View>

          <View className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
            <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Items</Text>
            {allItems.length === 0 ? (
              <Text className="text-sm text-gray-500">No item snapshot available.</Text>
            ) : (
              allItems.map((item, index) => {
                const name = toText(item.name, 'Unnamed Item');
                const quantity = toNumber(item.quantity ?? item.decidedQuantity ?? item.decided_quantity, 0);
                const unit = toText(item.unitLabel ?? item.unit, 'unit');
                const location = toText(
                  item.locationName ?? item.location_name ?? item.locationGroup ?? item.location_group,
                  ''
                );
                const note = toText(item.note ?? item.notes, '');

                return (
                  <View
                    key={`${name}-${index}`}
                    className={`py-2.5 ${index < allItems.length - 1 ? 'border-b border-gray-100' : ''}`}
                  >
                    <View className="flex-row items-center justify-between">
                      <Text className="text-sm font-medium text-gray-900 flex-1 pr-3">{name}</Text>
                      <Text className="text-sm font-semibold text-gray-700">
                        {quantity} {unit}
                      </Text>
                    </View>
                    {location.length > 0 && (
                      <Text className="text-xs text-gray-500 mt-1">{location}</Text>
                    )}
                    {note.length > 0 && (
                      <Text className="text-xs text-blue-700 mt-1">Note: {note}</Text>
                    )}
                  </View>
                );
              })
            )}
          </View>

          <View className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
            <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Message</Text>
            <View className="bg-gray-50 rounded-xl p-3">
              <Text className="text-sm text-gray-800 leading-5">{pastOrder.messageText}</Text>
            </View>
          </View>
        </ScrollView>

        <View className="bg-white border-t border-gray-200 px-4 py-4">
          <View className="flex-row">
            <TouchableOpacity
              onPress={copyMessage}
              className="flex-1 rounded-xl py-3 items-center justify-center bg-gray-100 mr-3 flex-row"
            >
              <Ionicons name="copy-outline" size={17} color={colors.gray[700]} />
              <Text className="text-gray-700 font-semibold ml-2">Copy</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={shareMessage}
              className="flex-1 rounded-xl py-3 items-center justify-center bg-primary-500 flex-row"
            >
              <Ionicons name="share-social-outline" size={17} color="white" />
              <Text className="text-white font-semibold ml-2">Share Again</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
