import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Platform,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { SUPPLIER_CATEGORY_LABELS, colors } from '@/constants';
import { useSettingsStore } from '@/store';

interface ConfirmationDetail {
  locationName: string;
  orderedBy: string;
  quantity: number;
  shortCode?: string;
}

type LocationGroup = 'sushi' | 'poki';

const LOCATION_GROUP_LABELS: Record<LocationGroup, string> = {
  sushi: 'Sushi',
  poki: 'Poki',
};

interface ConfirmationItem {
  id: string;
  name: string;
  category: string;
  locationGroup: LocationGroup;
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

  const { exportFormat } = useSettingsStore();

  const formattedItems = useMemo(() => {
    if (items.length === 0) {
      return 'No items to order.';
    }

    const groupOrder: LocationGroup[] = ['sushi', 'poki'];
    const grouped = items.reduce<Record<LocationGroup, ConfirmationItem[]>>((acc, item) => {
      const group = item.locationGroup || 'sushi';
      if (!acc[group]) {
        acc[group] = [];
      }
      acc[group].push(item);
      return acc;
    }, { sushi: [], poki: [] });

    return groupOrder
      .map((group) => {
        const groupItems = grouped[group];
        if (!groupItems || groupItems.length === 0) return null;
        const label = LOCATION_GROUP_LABELS[group].toUpperCase();
        const lines = groupItems
          .map((item) => `- ${item.name}: ${item.quantity} ${item.unitLabel}`)
          .join('\n');
        return `--- ${label} ---\n${lines}`;
      })
      .filter(Boolean)
      .join('\n\n');
  }, [items]);

  const messageText = useMemo(() => {
    const today = new Date().toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    const variables: Record<string, string> = {
      supplier: supplierLabel,
      date: today,
      items: formattedItems,
    };

    const filled = Object.entries(variables).reduce((text, [key, value]) => {
      const pattern = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      return text.replace(pattern, value);
    }, exportFormat.template);
    return filled.replace(/\\n/g, '\n');
  }, [exportFormat.template, formattedItems, supplierLabel]);

  const groupedItems = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        const group = item.locationGroup || 'sushi';
        acc[group].push(item);
        return acc;
      },
      { sushi: [] as ConfirmationItem[], poki: [] as ConfirmationItem[] }
    );
  }, [items]);

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

  const handleCopyToClipboard = useCallback(async () => {
    await Clipboard.setStringAsync(messageText);
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    Alert.alert('Copied!', 'Order message copied to clipboard');
  }, [messageText]);

  const handleShare = useCallback(async () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    try {
      const result = await Share.share({
        message: messageText,
        title: `${supplierLabel} Order`,
      });

      if (result.action === Share.sharedAction) {
        Alert.alert('Shared!', 'Order has been shared');
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to share');
    }
  }, [messageText, supplierLabel]);

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right', 'bottom']}>
      {/* Header */}
      <View className="bg-white px-4 py-3 border-b border-gray-100 flex-row items-center justify-between">
        <View className="flex-row items-center flex-1">
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
        <TouchableOpacity
          onPress={() => router.push('/(manager)/settings/export-format')}
          className="p-2"
        >
          <Ionicons name="create-outline" size={18} color={colors.gray[600]} />
        </TouchableOpacity>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
      >
        {/* Message Preview */}
        <View className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Message Preview
            </Text>
            <TouchableOpacity
              onPress={() => router.push('/(manager)/settings/export-format')}
              className="flex-row items-center"
            >
              <Ionicons name="create-outline" size={14} color={colors.primary[500]} />
              <Text className="text-xs text-primary-600 font-semibold ml-1">Edit Format</Text>
            </TouchableOpacity>
          </View>
          <View className="bg-gray-50 rounded-xl p-3">
            <Text className="text-sm text-gray-800 leading-5">{messageText}</Text>
          </View>
        </View>

        {items.length === 0 ? (
          <View className="items-center justify-center py-12">
            <Ionicons name="list-outline" size={48} color={colors.gray[300]} />
            <Text className="text-gray-500 text-base mt-3">No items to send</Text>
            <Text className="text-gray-400 text-sm mt-1">Return to fulfillment to select items</Text>
          </View>
        ) : (
          <>
            <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Order Items ({items.length})
            </Text>
            {(['sushi', 'poki'] as LocationGroup[]).map((group) => {
              const groupItems = groupedItems[group];
              if (!groupItems || groupItems.length === 0) return null;
              const label = LOCATION_GROUP_LABELS[group].toUpperCase();

              return (
                <View key={group} className="mb-6">
                  <View className="flex-row items-center mb-3">
                    <View className="flex-1 h-px bg-gray-200" />
                    <Text className="text-xs font-semibold text-gray-500 uppercase tracking-widest mx-3">
                      {label}
                    </Text>
                    <View className="flex-1 h-px bg-gray-200" />
                  </View>

                  {groupItems.map((item) => {
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
                  })}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>

      <View className="bg-white border-t border-gray-200 px-4 py-4">
        <View className="flex-row">
          <TouchableOpacity
            onPress={handleCopyToClipboard}
            disabled={items.length === 0}
            className={`flex-1 rounded-xl py-3 items-center flex-row justify-center mr-3 ${
              items.length === 0 ? 'bg-gray-200' : 'bg-gray-100'
            }`}
          >
            <Ionicons
              name="copy-outline"
              size={18}
              color={items.length === 0 ? colors.gray[400] : colors.gray[700]}
            />
            <Text
              className={`font-semibold ml-2 ${items.length === 0 ? 'text-gray-400' : 'text-gray-700'}`}
            >
              Copy to Clipboard
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleShare}
            disabled={items.length === 0}
            className={`flex-1 rounded-xl py-3 items-center flex-row justify-center ${
              items.length === 0 ? 'bg-gray-200' : 'bg-primary-500'
            }`}
          >
            <Ionicons
              name="share-social-outline"
              size={18}
              color={items.length === 0 ? colors.gray[400] : 'white'}
            />
            <Text
              className={`font-semibold ml-2 ${items.length === 0 ? 'text-gray-400' : 'text-white'}`}
            >
              Share
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}
