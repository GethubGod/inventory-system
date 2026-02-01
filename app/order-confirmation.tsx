import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Animated,
  Easing,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useOrderStore } from '@/store';
import { colors } from '@/constants';

// Category emoji mapping
const CATEGORY_EMOJI: Record<string, string> = {
  fish: '🐟',
  protein: '🥩',
  produce: '🥬',
  dry: '🍚',
  dairy_cold: '🧊',
  frozen: '❄️',
  sauces: '🍶',
  packaging: '📦',
};

export default function OrderConfirmationScreen() {
  const { currentOrder } = useOrderStore();
  const params = useLocalSearchParams<{ orderNumber: string; locationName: string }>();

  // Animation values
  const checkmarkScale = useRef(new Animated.Value(0)).current;
  const checkmarkOpacity = useRef(new Animated.Value(0)).current;
  const contentTranslate = useRef(new Animated.Value(30)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Play success haptic
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    // Animate checkmark
    Animated.sequence([
      Animated.parallel([
        Animated.timing(checkmarkScale, {
          toValue: 1.2,
          duration: 300,
          easing: Easing.out(Easing.back(2)),
          useNativeDriver: true,
        }),
        Animated.timing(checkmarkOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(checkmarkScale, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();

    // Animate content
    Animated.parallel([
      Animated.timing(contentTranslate, {
        toValue: 0,
        duration: 400,
        delay: 200,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 400,
        delay: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const handleStartNewOrder = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.replace('/(tabs)');
  };

  const handleViewMyOrders = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.replace('/(tabs)/orders');
  };

  const orderNumber = params.orderNumber || currentOrder?.order_number?.toString() || '---';
  const locationName = params.locationName || currentOrder?.location?.name || 'Location';
  const orderItems = currentOrder?.order_items || [];
  const timestamp = currentOrder?.created_at ? formatDate(currentOrder.created_at) : formatDate(new Date().toISOString());

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1, padding: 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Success Animation */}
        <View className="items-center pt-8 pb-6">
          <Animated.View
            style={{
              transform: [{ scale: checkmarkScale }],
              opacity: checkmarkOpacity,
            }}
            className="w-24 h-24 bg-green-100 rounded-full items-center justify-center mb-6"
          >
            <View className="w-20 h-20 bg-green-500 rounded-full items-center justify-center">
              <Ionicons name="checkmark" size={48} color="white" />
            </View>
          </Animated.View>

          <Animated.View
            style={{
              transform: [{ translateY: contentTranslate }],
              opacity: contentOpacity,
            }}
            className="items-center"
          >
            <Text className="text-3xl font-bold text-gray-900 text-center">
              Order #{orderNumber} Submitted!
            </Text>

            <View className="flex-row items-center mt-3">
              <Ionicons name="location" size={16} color={colors.primary[500]} />
              <Text className="text-gray-600 ml-1">{locationName}</Text>
              <Text className="text-gray-400 mx-2">•</Text>
              <Text className="text-gray-500">{timestamp}</Text>
            </View>
          </Animated.View>
        </View>

        {/* Order Summary Card */}
        <Animated.View
          style={{
            transform: [{ translateY: contentTranslate }],
            opacity: contentOpacity,
          }}
          className="bg-gray-50 rounded-2xl p-5 mt-4"
        >
          <Text className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-4">
            Order Summary
          </Text>

          {orderItems.length > 0 ? (
            <>
              {orderItems.map((item, index) => {
                const inventoryItem = item.inventory_item;
                if (!inventoryItem) return null;

                const emoji = CATEGORY_EMOJI[inventoryItem.category] || '📦';
                const unitLabel = item.unit_type === 'pack'
                  ? inventoryItem.pack_unit
                  : inventoryItem.base_unit;

                return (
                  <View
                    key={item.id || index}
                    className={`flex-row items-center py-3 ${
                      index < orderItems.length - 1 ? 'border-b border-gray-200' : ''
                    }`}
                  >
                    <Text className="text-xl mr-3">{emoji}</Text>
                    <Text className="flex-1 text-gray-900" numberOfLines={1}>
                      {inventoryItem.name}
                    </Text>
                    <Text className="text-gray-600 font-medium">
                      {item.quantity} {unitLabel}
                    </Text>
                  </View>
                );
              })}

              <View className="border-t border-gray-300 mt-3 pt-3">
                <Text className="text-gray-600 text-center">
                  Total: {orderItems.length} item{orderItems.length !== 1 ? 's' : ''}
                </Text>
              </View>
            </>
          ) : (
            <Text className="text-gray-500 text-center py-4">
              Order submitted successfully
            </Text>
          )}
        </Animated.View>

        {/* Spacer */}
        <View className="flex-1 min-h-[40px]" />

        {/* Action Buttons */}
        <Animated.View
          style={{
            transform: [{ translateY: contentTranslate }],
            opacity: contentOpacity,
          }}
          className="pb-4"
        >
          <TouchableOpacity
            onPress={handleStartNewOrder}
            className="bg-primary-500 py-4 rounded-xl items-center mb-3"
            activeOpacity={0.8}
          >
            <Text className="text-white font-bold text-lg">Start New Order</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleViewMyOrders}
            className="bg-white border-2 border-gray-200 py-4 rounded-xl items-center"
            activeOpacity={0.8}
          >
            <Text className="text-gray-700 font-semibold text-lg">View My Orders</Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}
