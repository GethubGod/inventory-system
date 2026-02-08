import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors } from '@/constants';
import { useScaledStyles } from '@/hooks/useScaledStyles';

const AUTO_DISMISS_SECONDS = 3;

interface OrderConfirmationPopupProps {
  visible: boolean;
  orderNumber: string;
  locationName: string;
  itemCount: number;
  onClose: () => void;
}

export function OrderConfirmationPopup({
  visible,
  orderNumber,
  locationName,
  itemCount,
  onClose,
}: OrderConfirmationPopupProps) {
  const ds = useScaledStyles();
  const [countdown, setCountdown] = useState(AUTO_DISMISS_SECONDS);
  const popupScale = useRef(new Animated.Value(0.8)).current;
  const popupOpacity = useRef(new Animated.Value(0)).current;
  const checkmarkScale = useRef(new Animated.Value(0)).current;
  const progressWidth = useRef(new Animated.Value(100)).current;

  useEffect(() => {
    if (!visible) return;

    setCountdown(AUTO_DISMISS_SECONDS);
    popupScale.setValue(0.8);
    popupOpacity.setValue(0);
    checkmarkScale.setValue(0);
    progressWidth.setValue(100);

    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

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

    Animated.sequence([
      Animated.delay(100),
      Animated.spring(checkmarkScale, {
        toValue: 1,
        friction: 4,
        tension: 100,
        useNativeDriver: true,
      }),
    ]).start();

    Animated.timing(progressWidth, {
      toValue: 0,
      duration: AUTO_DISMISS_SECONDS * 1000,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();

    const countdownInterval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownInterval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    const dismissTimeout = setTimeout(() => {
      onClose();
    }, AUTO_DISMISS_SECONDS * 1000);

    return () => {
      clearInterval(countdownInterval);
      clearTimeout(dismissTimeout);
    };
  }, [visible, onClose, popupOpacity, popupScale, checkmarkScale, progressWidth]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View className="flex-1 bg-black/50 items-center justify-center" style={{ paddingHorizontal: ds.spacing(24) }}>
        <Pressable className="absolute inset-0" onPress={onClose} />

        <Animated.View
          style={{
            transform: [{ scale: popupScale }],
            opacity: popupOpacity,
            maxWidth: ds.spacing(420),
          }}
          className="bg-white rounded-3xl w-full overflow-hidden"
        >
          <View className="bg-gray-100" style={{ height: Math.max(3, ds.spacing(4)) }}>
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

          <TouchableOpacity
            onPress={onClose}
            className="absolute z-10 bg-gray-100 rounded-full items-center justify-center"
            style={{
              top: ds.spacing(12),
              right: ds.spacing(12),
              width: ds.icon(32),
              height: ds.icon(32),
            }}
          >
            <Ionicons name="close" size={ds.icon(18)} color="#6B7280" />
          </TouchableOpacity>

          <View className="items-center" style={{ paddingHorizontal: ds.spacing(24), paddingVertical: ds.spacing(22) }}>
            <Animated.View
              style={{ transform: [{ scale: checkmarkScale }], width: ds.icon(64), height: ds.icon(64), borderRadius: ds.icon(32) }}
              className="bg-green-500 items-center justify-center mb-4"
            >
              <Ionicons name="checkmark" size={ds.icon(36)} color="white" />
            </Animated.View>

            <Text className="font-bold text-gray-900 text-center" style={{ fontSize: ds.fontSize(32) }}>
              Order #{orderNumber}
            </Text>
            <Text className="text-green-600 font-semibold" style={{ marginTop: ds.spacing(4), fontSize: ds.fontSize(18) }}>
              Submitted!
            </Text>

            <View className="flex-row items-center flex-wrap justify-center" style={{ marginTop: ds.spacing(10), marginBottom: ds.spacing(10) }}>
              <Ionicons name="location" size={ds.icon(16)} color={colors.primary[500]} />
              <Text className="text-gray-600" style={{ marginLeft: ds.spacing(4), fontSize: ds.fontSize(14) }}>{locationName}</Text>
              {itemCount > 0 && (
                <>
                  <Text className="text-gray-400" style={{ marginHorizontal: ds.spacing(8), fontSize: ds.fontSize(14) }}>•</Text>
                  <Text className="text-gray-500" style={{ fontSize: ds.fontSize(14) }}>
                    {itemCount} item{itemCount === 1 ? '' : 's'}
                  </Text>
                </>
              )}
            </View>

            <Text className="text-gray-400" style={{ fontSize: ds.fontSize(13) }}>
              Closing in {countdown}s
            </Text>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
