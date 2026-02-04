import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { SUPPLIER_CATEGORY_LABELS, colors } from '@/constants';

interface ConfirmationDetail {
  locationName: string;
  orderedBy: string;
  quantity: number;
  shortCode?: string;
}

interface ConfirmationItem {
  id: string;
  name: string;
  quantity: number;
  unitLabel: string;
  details: ConfirmationDetail[];
}

export default function FulfillmentConfirmationScreen() {
  const params = useLocalSearchParams<{ items?: string; supplier?: string }>();

  const initialItems = useMemo(() => {
    const rawItems = Array.isArray(params.items) ? params.items[0] : params.items;
    if (!rawItems) return [] as ConfirmationItem[];
    try {
      const decoded = decodeURIComponent(rawItems);
      const parsed = JSON.parse(decoded) as ConfirmationItem[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [] as ConfirmationItem[];
    }
  }, [params.items]);

  const [items, setItems] = useState<ConfirmationItem[]>(initialItems);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const supplierParam = Array.isArray(params.supplier) ? params.supplier[0] : params.supplier;
  const supplierLabel = supplierParam
    ? SUPPLIER_CATEGORY_LABELS[supplierParam as keyof typeof SUPPLIER_CATEGORY_LABELS]
    : 'Supplier';

  const toggleExpand = useCallback((id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleQuantityChange = useCallback((id: string, newQuantity: number) => {
    const qty = Math.max(1, newQuantity);
    setItems((prev) => prev.map((item) => (
      item.id === id ? { ...item, quantity: qty } : item
    )));
  }, []);

  const handleDelete = useCallback((id: string, name: string) => {
    Alert.alert('Remove Item', `Remove ${name} from this order?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          if (Platform.OS !== 'web') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          }
          setItems((prev) => prev.filter((item) => item.id !== id));
        },
      },
    ]);
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      {/* Header */}
      <View className="bg-white px-4 py-3 border-b border-gray-100 flex-row items-center">
        <TouchableOpacity
          onPress={() => router.back()}
          className="p-2 mr-2"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={20} color={colors.gray[700]} />
        </TouchableOpacity>
        <View>
          <Text className="text-lg font-bold text-gray-900">Send Order</Text>
          <Text className="text-xs text-gray-500">{supplierLabel}</Text>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      >
        {items.length === 0 ? (
          <View className="items-center justify-center py-12">
            <Ionicons name="list-outline" size={48} color={colors.gray[300]} />
            <Text className="text-gray-500 text-base mt-3">No items to send</Text>
            <Text className="text-gray-400 text-sm mt-1">Return to fulfillment to select items</Text>
          </View>
        ) : (
          items.map((item) => {
            const isExpanded = expandedItems.has(item.id);
            return (
              <View key={item.id} className="bg-white rounded-2xl border border-gray-100 mb-4">
                <TouchableOpacity
                  onPress={() => toggleExpand(item.id)}
                  className="flex-row items-center px-4 py-3"
                  activeOpacity={0.7}
                >
                  <View className="flex-1">
                    <Text className="text-base font-semibold text-gray-900" numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text className="text-sm text-gray-500 mt-1">
                      {item.quantity} {item.unitLabel}
                    </Text>
                  </View>
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={colors.gray[400]}
                  />
                </TouchableOpacity>

                {isExpanded && (
                  <View className="px-4 pb-4">
                    {/* Quantity Controls */}
                    <View className="flex-row items-center justify-between mb-3">
                      <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Quantity
                      </Text>
                      <View className="flex-row items-center">
                        <TouchableOpacity
                          onPress={(e) => {
                            e.stopPropagation();
                            handleQuantityChange(item.id, item.quantity - 1);
                          }}
                          className="w-8 h-8 bg-gray-100 rounded-lg items-center justify-center"
                        >
                          <Ionicons name="remove" size={16} color={colors.gray[600]} />
                        </TouchableOpacity>

                        <TextInput
                          value={item.quantity.toString()}
                          onChangeText={(text) => {
                            const num = parseFloat(text) || 1;
                            handleQuantityChange(item.id, num);
                          }}
                          keyboardType="decimal-pad"
                          className="mx-3 text-center text-base font-semibold text-gray-900 min-w-[60px]"
                        />

                        <TouchableOpacity
                          onPress={(e) => {
                            e.stopPropagation();
                            handleQuantityChange(item.id, item.quantity + 1);
                          }}
                          className="w-8 h-8 bg-gray-100 rounded-lg items-center justify-center"
                        >
                          <Ionicons name="add" size={16} color={colors.gray[600]} />
                        </TouchableOpacity>
                      </View>
                    </View>

                    {/* Delete */}
                    <TouchableOpacity
                      onPress={(e) => {
                        e.stopPropagation();
                        handleDelete(item.id, item.name);
                      }}
                      className="flex-row items-center mb-3"
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.error} />
                      <Text className="text-sm text-red-500 font-medium ml-2">Remove Item</Text>
                    </TouchableOpacity>

                    {/* Details */}
                    <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      Details
                    </Text>
                    <View className="bg-gray-50 rounded-xl p-3">
                      {item.details.length === 0 ? (
                        <Text className="text-sm text-gray-400">No detail records</Text>
                      ) : (
                        item.details.map((detail, index) => (
                          <View
                            key={`${item.id}-${index}`}
                            className={`py-2 ${index < item.details.length - 1 ? 'border-b border-gray-200' : ''}`}
                          >
                            <View className="flex-row items-center justify-between">
                              <Text className="text-sm text-gray-700">{detail.locationName}</Text>
                              <Text className="text-sm font-medium text-gray-700">{detail.quantity}</Text>
                            </View>
                            <Text className="text-xs text-gray-500 mt-1">Ordered by {detail.orderedBy}</Text>
                          </View>
                        ))
                      )}
                    </View>
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
