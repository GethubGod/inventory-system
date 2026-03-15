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
import { GlassSurface } from '@/components';
import { colors } from '@/theme/design';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassSpacing,
  glassTypography,
} from '@/design/tokens';

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
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: colors.overlay, paddingHorizontal: glassSpacing.screen }}
      >
        <Pressable className="absolute inset-0" onPress={onClose} />

        <Animated.View
          style={{
            width: '100%',
            maxWidth: 360,
            transform: [{ scale: popupScale }],
            opacity: popupOpacity,
          }}
        >
          <GlassSurface intensity="strong" style={{ borderRadius: glassRadii.surface }}>
            <View
              style={{
                height: 3,
                backgroundColor: glassColors.mediumFill,
              }}
            >
              <Animated.View
                style={{
                  height: '100%',
                  backgroundColor: glassColors.accent,
                  width: progressWidth.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0%', '100%'],
                  }),
                }}
              />
            </View>

            <TouchableOpacity
              onPress={onClose}
              style={{
                position: 'absolute',
                top: 12,
                right: 12,
                zIndex: 10,
                width: 32,
                height: 32,
                borderRadius: glassRadii.round,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: glassColors.mediumFill,
              }}
            >
              <Ionicons name="close" size={18} color={glassColors.textSecondary} />
            </TouchableOpacity>

            <View style={{ padding: 24, alignItems: 'center' }}>
              <Animated.View
                style={{
                  transform: [{ scale: checkmarkScale }],
                  width: 56,
                  height: 56,
                  borderRadius: glassRadii.round,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 16,
                  backgroundColor: glassColors.successSoft,
                }}
              >
                <Ionicons name="checkmark" size={28} color={glassColors.successText} />
              </Animated.View>

              <Text
                style={{
                  fontSize: glassTypography.screenTitle,
                  fontWeight: '600',
                  color: glassColors.textPrimary,
                }}
              >
                Order submitted
              </Text>
              <Text
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  color: glassColors.textSecondary,
                }}
              >
                {itemCount} item{itemCount === 1 ? '' : 's'} for {locationName}
              </Text>

              <GlassSurface
                intensity="subtle"
                blurred={false}
                style={{
                  width: '100%',
                  marginTop: 20,
                  paddingHorizontal: glassSpacing.card,
                  paddingVertical: glassSpacing.card,
                  borderRadius: glassRadii.surface,
                }}
              >
                {[
                  ['Order ID', `#${orderNumber}`],
                  ['Location', locationName],
                ].map(([label, value], index) => (
                  <View
                    key={label}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      paddingVertical: 8,
                      borderTopWidth: index > 0 ? glassHairlineWidth : 0,
                      borderTopColor: glassColors.divider,
                    }}
                  >
                    <Text style={{ fontSize: 11, color: glassColors.textSecondary }}>
                      {label}
                    </Text>
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: '500',
                        color: glassColors.textPrimary,
                      }}
                    >
                      {value}
                    </Text>
                  </View>
                ))}
              </GlassSurface>

              <Text
                style={{
                  marginTop: 12,
                  fontSize: 11,
                  color: glassColors.textSecondary,
                }}
              >
                Closing in {countdown}s
              </Text>
            </View>
          </GlassSurface>
        </Animated.View>
      </View>
    </Modal>
  );
}
