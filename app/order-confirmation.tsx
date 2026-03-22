import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { GlassSurface } from '@/components';
import { BROWSE_INVENTORY_ROUTE } from '@/features/browse/config';
import {
  formatOrderConfirmationDisplayId,
  formatOrderConfirmationSummary,
  getOrderConfirmationParam,
} from '@/features/cart/orderConfirmation';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
} from '@/theme/design';
import { useAuthStore, useDisplayStore, useOrderStore } from '@/store';

function parseItemCount(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatSubmittedTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Unavailable';
  }

  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const AUTO_DISMISS_MS = 2200;

export default function OrderConfirmationScreen() {
  const ds = useScaledStyles();
  const reduceMotion = useDisplayStore((state) => state.reduceMotion);
  const currentOrder = useOrderStore((state) => state.currentOrder);
  const { user, profile } = useAuthStore();
  const params = useLocalSearchParams<{
    orderId?: string | string[];
    orderNumber?: string | string[];
    locationName?: string | string[];
    itemCount?: string | string[];
    summary?: string | string[];
    submittedBy?: string | string[];
    submittedAt?: string | string[];
    browseRoute?: string | string[];
  }>();
  const backdropOpacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const cardOpacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const cardScale = useRef(new Animated.Value(reduceMotion ? 1 : 0.96)).current;
  const cardTranslateY = useRef(new Animated.Value(reduceMotion ? 0 : 14)).current;
  const dismissingRef = useRef(false);
  const autoDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const routeOrderId = getOrderConfirmationParam(params.orderId);
  const routeOrderNumber = getOrderConfirmationParam(params.orderNumber);
  const routeLocationName = getOrderConfirmationParam(params.locationName);
  const routeItemCount = getOrderConfirmationParam(params.itemCount);
  const routeSummary = getOrderConfirmationParam(params.summary);
  const routeSubmittedBy = getOrderConfirmationParam(params.submittedBy);
  const routeSubmittedAt = getOrderConfirmationParam(params.submittedAt);
  const routeBrowsePath = getOrderConfirmationParam(params.browseRoute);

  const orderDisplayId = formatOrderConfirmationDisplayId({
    orderId: routeOrderId ?? currentOrder?.id ?? null,
    orderNumber:
      routeOrderNumber ??
      (typeof currentOrder?.order_number === 'number' ||
      typeof currentOrder?.order_number === 'string'
        ? String(currentOrder.order_number)
        : null),
  });
  const locationName =
    routeLocationName ??
    currentOrder?.location?.name ??
    'Location';
  const itemCount = parseItemCount(
    routeItemCount,
    currentOrder?.order_items?.length ?? 0,
  );
  const summaryText =
    routeSummary ??
    formatOrderConfirmationSummary(itemCount, locationName);
  const submittedBy =
    routeSubmittedBy ??
    profile?.full_name?.trim() ??
    user?.name?.trim() ??
    user?.email?.trim() ??
    'Staff';
  const submittedAtValue =
    routeSubmittedAt ??
    currentOrder?.created_at ??
    new Date().toISOString();
  const submittedTime = useMemo(
    () => formatSubmittedTime(submittedAtValue),
    [submittedAtValue],
  );
  const browseRoute = routeBrowsePath ?? BROWSE_INVENTORY_ROUTE;

  const dismissConfirmation = useCallback(() => {
    if (dismissingRef.current) {
      return;
    }

    dismissingRef.current = true;
    if (autoDismissRef.current) {
      clearTimeout(autoDismissRef.current);
      autoDismissRef.current = null;
    }

    const completeDismiss = () => {
      router.replace(browseRoute as never);
    };

    if (reduceMotion) {
      completeDismiss();
      return;
    }

    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.timing(cardScale, {
        toValue: 0.98,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.timing(cardTranslateY, {
        toValue: 8,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        completeDismiss();
      } else {
        dismissingRef.current = false;
      }
    });
  }, [backdropOpacity, browseRoute, cardOpacity, cardScale, cardTranslateY, reduceMotion]);

  useEffect(() => {
    if (reduceMotion) {
      backdropOpacity.setValue(1);
      cardOpacity.setValue(1);
      cardScale.setValue(1);
      cardTranslateY.setValue(0);
    } else {
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(cardOpacity, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.spring(cardScale, {
          toValue: 1,
          damping: 18,
          stiffness: 220,
          mass: 0.9,
          useNativeDriver: true,
        }),
        Animated.timing(cardTranslateY, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();
    }

    autoDismissRef.current = setTimeout(() => {
      dismissConfirmation();
    }, AUTO_DISMISS_MS);

    return () => {
      if (autoDismissRef.current) {
        clearTimeout(autoDismissRef.current);
        autoDismissRef.current = null;
      }
    };
  }, [backdropOpacity, cardOpacity, cardScale, cardTranslateY, dismissConfirmation, reduceMotion]);

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerShown: false,
          contentStyle: { backgroundColor: 'transparent' },
          gestureEnabled: false,
          presentation: 'transparentModal',
          animation: reduceMotion ? 'none' : 'fade',
        }}
      />

      <Animated.View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: ds.spacing(20),
          backgroundColor: 'rgba(15, 23, 42, 0.2)',
          opacity: backdropOpacity,
        }}
      >
        <Animated.View
          style={{
            width: '100%',
            maxWidth: ds.spacing(344),
            opacity: cardOpacity,
            transform: [{ scale: cardScale }, { translateY: cardTranslateY }],
          }}
        >
          <GlassSurface
            intensity="strong"
            style={{
              borderRadius: glassRadii.surface,
              overflow: 'hidden',
              borderWidth: glassHairlineWidth,
              borderColor: glassColors.cardBorder,
            }}
          >
            <View
              style={{
                height: 8,
                backgroundColor: glassColors.successText,
              }}
            />
            <View
              style={{
                paddingHorizontal: ds.spacing(18),
                paddingTop: ds.spacing(16),
                paddingBottom: ds.spacing(18),
              }}
            >
              <View className="flex-row items-start justify-between">
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: ds.spacing(12) }}>
                  <View
                    style={{
                      width: ds.icon(42),
                      height: ds.icon(42),
                      borderRadius: glassRadii.round,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: glassColors.successSoft,
                      marginRight: ds.spacing(12),
                    }}
                  >
                    <Ionicons
                      name="checkmark"
                      size={ds.icon(20)}
                      color={glassColors.successText}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontSize: ds.fontSize(20),
                        fontWeight: '700',
                        color: glassColors.textPrimary,
                      }}
                    >
                      Order submitted
                    </Text>
                    <Text
                      style={{
                        marginTop: ds.spacing(4),
                        fontSize: ds.fontSize(13),
                        color: glassColors.textSecondary,
                        lineHeight: ds.fontSize(19),
                      }}
                    >
                      {summaryText}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss order confirmation"
                  onPress={dismissConfirmation}
                  activeOpacity={0.85}
                  style={{
                    width: ds.icon(34),
                    height: ds.icon(34),
                    borderRadius: glassRadii.round,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: glassColors.mediumFill,
                  }}
                >
                  <Ionicons
                    name="close"
                    size={ds.icon(18)}
                    color={glassColors.textSecondary}
                  />
                </TouchableOpacity>
              </View>

              <View
                style={{
                  marginTop: ds.spacing(16),
                  gap: ds.spacing(10),
                }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Text
                    style={{
                      fontSize: ds.fontSize(12),
                      color: glassColors.textSecondary,
                    }}
                  >
                    Order ID
                  </Text>
                  <Text
                    style={{
                      fontSize: ds.fontSize(13),
                      fontWeight: '700',
                      color: glassColors.textPrimary,
                    }}
                  >
                    {orderDisplayId}
                  </Text>
                </View>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Text
                    style={{
                      fontSize: ds.fontSize(12),
                      color: glassColors.textSecondary,
                    }}
                  >
                    Location
                  </Text>
                  <Text
                    style={{
                      flexShrink: 1,
                      marginLeft: ds.spacing(12),
                      fontSize: ds.fontSize(13),
                      fontWeight: '600',
                      color: glassColors.textPrimary,
                      textAlign: 'right',
                    }}
                    numberOfLines={1}
                  >
                    {locationName}
                  </Text>
                </View>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Text
                    style={{
                      fontSize: ds.fontSize(12),
                      color: glassColors.textSecondary,
                    }}
                  >
                    Submitted
                  </Text>
                  <Text
                    style={{
                      flexShrink: 1,
                      marginLeft: ds.spacing(12),
                      fontSize: ds.fontSize(13),
                      fontWeight: '600',
                      color: glassColors.textPrimary,
                      textAlign: 'right',
                    }}
                    numberOfLines={1}
                  >
                    {submittedTime}
                  </Text>
                </View>
              </View>

              <Ionicons
                name="time-outline"
                size={ds.icon(14)}
                color={glassColors.successText}
                style={{
                  marginTop: ds.spacing(14),
                }}
              />
              <Text
                style={{
                  marginTop: ds.spacing(8),
                  fontSize: ds.fontSize(12),
                  color: glassColors.textSecondary,
                }}
              >
                Submitted by {submittedBy}
              </Text>
            </View>
          </GlassSurface>
        </Animated.View>
      </Animated.View>
    </View>
  );
}
