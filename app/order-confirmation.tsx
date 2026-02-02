import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  Easing,
  Platform,
  Pressable,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useOrderStore } from '@/store';
import { colors } from '@/constants';

const AUTO_DISMISS_SECONDS = 5;

export default function OrderConfirmationScreen() {
  const { currentOrder } = useOrderStore();
  const params = useLocalSearchParams<{ orderNumber: string; locationName: string }>();
  const [countdown, setCountdown] = useState(AUTO_DISMISS_SECONDS);

  // Animation values
  const popupScale = useRef(new Animated.Value(0.8)).current;
  const popupOpacity = useRef(new Animated.Value(0)).current;
  const checkmarkScale = useRef(new Animated.Value(0)).current;
  const progressWidth = useRef(new Animated.Value(100)).current;

  const orderNumber = params.orderNumber || currentOrder?.order_number?.toString() || '---';
  const locationName = params.locationName || currentOrder?.location?.name || 'Location';
  const itemCount = currentOrder?.order_items?.length || 0;

  const handleClose = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.replace('/(tabs)');
  };

  useEffect(() => {
    // Play success haptic
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    // Animate popup in
    Animated.parallel([
      Animated.spring(popupScale, {
        toValue: 1,
        friction: 8,
        tension: 100,
        useNativeDriver: true,
      }),
      Animated.timing(popupOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    // Animate checkmark
    Animated.sequence([
      Animated.delay(100),
      Animated.spring(checkmarkScale, {
        toValue: 1,
        friction: 4,
        tension: 100,
        useNativeDriver: true,
      }),
    ]).start();

    // Animate progress bar
    Animated.timing(progressWidth, {
      toValue: 0,
      duration: AUTO_DISMISS_SECONDS * 1000,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();

    // Countdown timer
    const countdownInterval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownInterval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Auto dismiss after countdown
    const dismissTimeout = setTimeout(() => {
      handleClose();
    }, AUTO_DISMISS_SECONDS * 1000);

    return () => {
      clearInterval(countdownInterval);
      clearTimeout(dismissTimeout);
    };
  }, []);

  return (
    <View className="flex-1 bg-black/50 items-center justify-center px-6">
      <Pressable className="absolute inset-0" onPress={handleClose} />

      <Animated.View
        style={{
          transform: [{ scale: popupScale }],
          opacity: popupOpacity,
        }}
        className="bg-white rounded-3xl w-full max-w-sm overflow-hidden"
      >
        {/* Progress bar */}
        <View className="h-1 bg-gray-100">
          <Animated.View
            className="h-full bg-green-500"
            style={{
              width: progressWidth.interpolate({
                inputRange: [0, 100],
                outputRange: ['0%', '100%'],
              }),
            }}
          />
        </View>

        {/* Close button */}
        <TouchableOpacity
          onPress={handleClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 bg-gray-100 rounded-full items-center justify-center"
        >
          <Ionicons name="close" size={18} color="#6B7280" />
        </TouchableOpacity>

        <View className="p-6 items-center">
          {/* Success checkmark */}
          <Animated.View
            style={{ transform: [{ scale: checkmarkScale }] }}
            className="w-16 h-16 bg-green-500 rounded-full items-center justify-center mb-4"
          >
            <Ionicons name="checkmark" size={36} color="white" />
          </Animated.View>

          {/* Order info */}
          <Text className="text-2xl font-bold text-gray-900 text-center">
            Order #{orderNumber}
          </Text>
          <Text className="text-lg text-green-600 font-semibold mt-1">
            Submitted!
          </Text>

          <View className="flex-row items-center mt-3 mb-4">
            <Ionicons name="location" size={16} color={colors.primary[500]} />
            <Text className="text-gray-600 ml-1">{locationName}</Text>
            {itemCount > 0 && (
              <>
                <Text className="text-gray-400 mx-2">•</Text>
                <Text className="text-gray-500">{itemCount} items</Text>
              </>
            )}
          </View>

          {/* Countdown text */}
          <Text className="text-gray-400 text-sm">
            Closing in {countdown}s
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}
