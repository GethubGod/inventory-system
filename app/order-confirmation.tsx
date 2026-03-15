import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { GlassSurface } from '@/components';
import { useAuthStore, useOrderStore } from '@/store';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassSpacing,
  glassTypography,
} from '@/design/tokens';
import { colors } from '@/theme/design';
import { useScaledStyles } from '@/hooks/useScaledStyles';

const AUTO_DISMISS_SECONDS = 3;

export default function OrderConfirmationScreen() {
  const ds = useScaledStyles();
  const { currentOrder } = useOrderStore();
  const { user, profile } = useAuthStore();
  const params = useLocalSearchParams<{
    orderNumber?: string | string[];
    locationName?: string | string[];
  }>();
  const [countdown, setCountdown] = useState(AUTO_DISMISS_SECONDS);

  const popupScale = useRef(new Animated.Value(0.8)).current;
  const popupOpacity = useRef(new Animated.Value(0)).current;
  const checkmarkScale = useRef(new Animated.Value(0)).current;
  const progressWidth = useRef(new Animated.Value(100)).current;

  const routeOrderNumber = Array.isArray(params.orderNumber)
    ? params.orderNumber[0]
    : params.orderNumber;
  const routeLocationName = Array.isArray(params.locationName)
    ? params.locationName[0]
    : params.locationName;
  const orderNumber =
    routeOrderNumber || currentOrder?.order_number?.toString() || '---';
  const locationName =
    routeLocationName || currentOrder?.location?.name || 'Location';
  const itemCount = currentOrder?.order_items?.length || 0;
  const submittedBy = profile?.full_name || user?.name || user?.email || 'Staff';
  const submittedAt = currentOrder?.created_at
    ? new Date(currentOrder.created_at).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      })
    : new Date().toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      });

  const handleClose = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.back();
  }, []);

  useEffect(() => {
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
      handleClose();
    }, AUTO_DISMISS_SECONDS * 1000);

    return () => {
      clearInterval(countdownInterval);
      clearTimeout(dismissTimeout);
    };
  }, [checkmarkScale, handleClose, popupOpacity, popupScale, progressWidth]);

  return (
    <View
      className="flex-1 items-center justify-center"
      style={{
        backgroundColor: colors.overlay,
        paddingHorizontal: glassSpacing.screen,
      }}
    >
      <Pressable className="absolute inset-0" onPress={handleClose} />

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
            onPress={handleClose}
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

          <View style={{ padding: ds.spacing(32), alignItems: 'center' }}>
            <Animated.View
              style={{
                transform: [{ scale: checkmarkScale }],
                width: 80,
                height: 80,
                borderRadius: glassRadii.round,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: ds.spacing(24),
                backgroundColor: 'rgba(52, 199, 89, 0.12)',
              }}
            >
              <Ionicons name="checkmark" size={40} color="#34C759" />
            </Animated.View>

            <Text
              style={{
                fontSize: glassTypography.screenTitle,
                fontWeight: '700',
                color: glassColors.textPrimary,
                textAlign: 'center',
              }}
            >
              Order submitted
            </Text>
            <Text
              style={{
                marginTop: ds.spacing(8),
                fontSize: ds.fontSize(14),
                color: glassColors.textSecondary,
                textAlign: 'center',
              }}
            >
              {itemCount} items ready to process
            </Text>

            <GlassSurface
              intensity="medium"
              blurred={false}
              style={{
                width: '100%',
                marginTop: 24,
                paddingHorizontal: glassSpacing.card + 4,
                paddingVertical: glassSpacing.card + 4,
                borderRadius: glassRadii.surface,
              }}
            >
              {[
                ['Order ID', `#${orderNumber}`],
                ['Location', locationName],
                ['Submitted by', submittedBy],
                ['Time', submittedAt],
              ].map(([label, value], index) => (
                <View
                  key={label}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    paddingVertical: 10,
                    borderTopWidth: index > 0 ? glassHairlineWidth : 0,
                    borderTopColor: glassColors.divider,
                  }}
                >
                  <Text style={{ fontSize: ds.fontSize(14), color: glassColors.textSecondary }}>
                    {label}
                  </Text>
                  <Text
                    style={{
                      fontSize: ds.fontSize(14),
                      fontWeight: '600',
                      color: glassColors.textPrimary,
                    }}
                  >
                    {value}
                  </Text>
                </View>
              ))}
            </GlassSurface>

            <TouchableOpacity
              onPress={handleClose}
              style={{
                marginTop: 18,
                width: '100%',
                minHeight: 48,
                borderRadius: glassRadii.surface,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: glassColors.mediumFill,
                borderWidth: glassHairlineWidth,
                borderColor: glassColors.controlBorder,
              }}
            >
              <Text
                style={{
                  fontSize: ds.fontSize(15),
                  fontWeight: '600',
                  color: glassColors.textPrimary,
                }}
              >
                Back to browse
              </Text>
            </TouchableOpacity>

            <Text
              style={{
                marginTop: ds.spacing(12),
                fontSize: ds.fontSize(12),
                color: glassColors.textSecondary,
              }}
            >
              Closing in {countdown}s
            </Text>
          </View>
        </GlassSurface>
      </Animated.View>
    </View>
  );
}
