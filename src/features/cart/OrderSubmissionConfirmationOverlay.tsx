import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { View as RNView } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { GlassSurface } from '@/components';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { useDisplayStore } from '@/store';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
} from '@/theme/design';
import {
  formatOrderConfirmationDisplayId,
  formatOrderConfirmationSubmittedTime,
  formatOrderConfirmationSummary,
  type OrderConfirmationPayload,
} from './orderConfirmation';

const AUTO_DISMISS_MS = 3200;
const EXIT_DURATION_MS = 160;

interface OrderSubmissionConfirmationOverlayProps {
  confirmation: OrderConfirmationPayload | null;
  blurTargetRef: React.RefObject<RNView | null>;
  onDismissed: () => void;
}

export function OrderSubmissionConfirmationOverlay({
  confirmation,
  blurTargetRef,
  onDismissed,
}: OrderSubmissionConfirmationOverlayProps) {
  const ds = useScaledStyles();
  const reduceMotion = useDisplayStore((state) => state.reduceMotion);
  const [activeConfirmation, setActiveConfirmation] = useState<OrderConfirmationPayload | null>(null);
  const activeConfirmationRef = useRef<OrderConfirmationPayload | null>(null);
  const dismissingRef = useRef(false);
  const autoDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.96)).current;
  const cardTranslateY = useRef(new Animated.Value(18)).current;
  const badgeOpacity = useRef(new Animated.Value(0)).current;
  const badgeScale = useRef(new Animated.Value(0.78)).current;
  const checkOpacity = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0.54)).current;
  const pulseOpacity = useRef(new Animated.Value(0)).current;
  const pulseScale = useRef(new Animated.Value(0.92)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const contentTranslateY = useRef(new Animated.Value(8)).current;
  const progressValue = useRef(new Animated.Value(0)).current;

  const stopAnimations = useCallback(() => {
    overlayOpacity.stopAnimation();
    cardOpacity.stopAnimation();
    cardScale.stopAnimation();
    cardTranslateY.stopAnimation();
    badgeOpacity.stopAnimation();
    badgeScale.stopAnimation();
    checkOpacity.stopAnimation();
    checkScale.stopAnimation();
    pulseOpacity.stopAnimation();
    pulseScale.stopAnimation();
    contentOpacity.stopAnimation();
    contentTranslateY.stopAnimation();
    progressValue.stopAnimation();
  }, [
    badgeOpacity,
    badgeScale,
    cardOpacity,
    cardScale,
    cardTranslateY,
    checkOpacity,
    checkScale,
    contentOpacity,
    contentTranslateY,
    overlayOpacity,
    progressValue,
    pulseOpacity,
    pulseScale,
  ]);

  const resetAnimatedValues = useCallback(() => {
    overlayOpacity.setValue(0);
    cardOpacity.setValue(0);
    cardScale.setValue(0.96);
    cardTranslateY.setValue(18);
    badgeOpacity.setValue(0);
    badgeScale.setValue(0.78);
    checkOpacity.setValue(0);
    checkScale.setValue(0.54);
    pulseOpacity.setValue(0);
    pulseScale.setValue(0.92);
    contentOpacity.setValue(0);
    contentTranslateY.setValue(8);
    progressValue.setValue(0);
  }, [
    badgeOpacity,
    badgeScale,
    cardOpacity,
    cardScale,
    cardTranslateY,
    checkOpacity,
    checkScale,
    contentOpacity,
    contentTranslateY,
    overlayOpacity,
    progressValue,
    pulseOpacity,
    pulseScale,
  ]);

  const clearAutoDismiss = useCallback(() => {
    if (autoDismissRef.current) {
      clearTimeout(autoDismissRef.current);
      autoDismissRef.current = null;
    }
  }, []);

  const finishDismissal = useCallback(() => {
    dismissingRef.current = false;
    activeConfirmationRef.current = null;
    setActiveConfirmation(null);
    onDismissed();
  }, [onDismissed]);

  const dismissConfirmation = useCallback(() => {
    if (dismissingRef.current || !activeConfirmationRef.current) {
      return;
    }

    dismissingRef.current = true;
    clearAutoDismiss();
    stopAnimations();

    if (reduceMotion) {
      finishDismissal();
      return;
    }

    Animated.parallel([
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: EXIT_DURATION_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        toValue: 0,
        duration: EXIT_DURATION_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(cardScale, {
        toValue: 0.98,
        duration: EXIT_DURATION_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(cardTranslateY, {
        toValue: 10,
        duration: EXIT_DURATION_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        finishDismissal();
        return;
      }

      dismissingRef.current = false;
    });
  }, [
    cardOpacity,
    cardScale,
    cardTranslateY,
    clearAutoDismiss,
    finishDismissal,
    overlayOpacity,
    reduceMotion,
    stopAnimations,
  ]);

  useEffect(() => {
    if (!confirmation) {
      return;
    }

    clearAutoDismiss();
    dismissingRef.current = false;
    stopAnimations();
    activeConfirmationRef.current = confirmation;
    setActiveConfirmation(confirmation);
    resetAnimatedValues();

    if (reduceMotion) {
      overlayOpacity.setValue(1);
      cardOpacity.setValue(1);
      cardScale.setValue(1);
      cardTranslateY.setValue(0);
      contentOpacity.setValue(1);
      contentTranslateY.setValue(0);
      badgeOpacity.setValue(1);
      badgeScale.setValue(1);
      checkOpacity.setValue(1);
      checkScale.setValue(1);
      progressValue.setValue(1);
    } else {
      Animated.parallel([
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: 130,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(cardOpacity, {
          toValue: 1,
          duration: 160,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(cardScale, {
          toValue: 1,
          damping: 18,
          stiffness: 220,
          mass: 0.95,
          useNativeDriver: true,
        }),
        Animated.timing(cardTranslateY, {
          toValue: 0,
          duration: 160,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(contentOpacity, {
          toValue: 1,
          duration: 120,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(contentTranslateY, {
          toValue: 0,
          duration: 140,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();

      Animated.parallel([
        Animated.parallel([
          Animated.timing(badgeOpacity, {
            toValue: 1,
            duration: 110,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.spring(badgeScale, {
            toValue: 1,
            damping: 10,
            stiffness: 260,
            mass: 0.68,
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.delay(50),
            Animated.parallel([
              Animated.timing(checkOpacity, {
                toValue: 1,
                duration: 90,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
              }),
              Animated.spring(checkScale, {
                toValue: 1,
                damping: 9,
                stiffness: 320,
                mass: 0.55,
                useNativeDriver: true,
              }),
            ]),
          ]),
          Animated.sequence([
            Animated.delay(20),
            Animated.parallel([
              Animated.timing(pulseOpacity, {
                toValue: 0.14,
                duration: 100,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
              }),
              Animated.timing(pulseScale, {
                toValue: 1.12,
                duration: 150,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
              }),
            ]),
            Animated.parallel([
              Animated.timing(pulseOpacity, {
                toValue: 0,
                duration: 180,
                easing: Easing.out(Easing.quad),
                useNativeDriver: true,
              }),
              Animated.timing(pulseScale, {
                toValue: 1.24,
                duration: 180,
                easing: Easing.out(Easing.quad),
                useNativeDriver: true,
              }),
            ]),
          ]),
        ]),
      ]).start();

      Animated.timing(progressValue, {
        toValue: 1,
        duration: AUTO_DISMISS_MS - 140,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start();
    }

    autoDismissRef.current = setTimeout(() => {
      dismissConfirmation();
    }, AUTO_DISMISS_MS);

    return () => {
      clearAutoDismiss();
      stopAnimations();
    };
  }, [
    badgeOpacity,
    badgeScale,
    cardOpacity,
    cardScale,
    cardTranslateY,
    checkOpacity,
    checkScale,
    clearAutoDismiss,
    confirmation,
    contentOpacity,
    contentTranslateY,
    dismissConfirmation,
    overlayOpacity,
    progressValue,
    pulseOpacity,
    pulseScale,
    reduceMotion,
    resetAnimatedValues,
    stopAnimations,
  ]);

  useEffect(() => {
    activeConfirmationRef.current = activeConfirmation;
  }, [activeConfirmation]);

  useEffect(() => () => {
    clearAutoDismiss();
    stopAnimations();
  }, [clearAutoDismiss, stopAnimations]);

  const summaryText = activeConfirmation?.summary
    ?? formatOrderConfirmationSummary(
      activeConfirmation?.itemCount ?? 0,
      activeConfirmation?.locationName ?? 'Location',
    );
  const orderDisplayId = useMemo(
    () =>
      formatOrderConfirmationDisplayId({
        orderId: activeConfirmation?.orderId ?? null,
        orderNumber: activeConfirmation?.orderNumber ?? null,
      }),
    [activeConfirmation?.orderId, activeConfirmation?.orderNumber],
  );
  const submittedTime = useMemo(
    () =>
      formatOrderConfirmationSubmittedTime(
        activeConfirmation?.submittedAt ?? new Date().toISOString(),
      ),
    [activeConfirmation?.submittedAt],
  );
  const progressWidth = progressValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  if (!activeConfirmation) {
    return null;
  }

  return (
    <Animated.View
      style={[styles.overlay, { opacity: overlayOpacity }]}
    >
      <View style={styles.backdrop} pointerEvents="none">
        <View
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: 'rgba(247, 245, 242, 0.18)' },
          ]}
        />
        <BlurView
          blurMethod={Platform.OS === 'android' ? 'dimezisBlurViewSdk31Plus' : undefined}
          blurReductionFactor={Platform.OS === 'android' ? 8 : undefined}
          blurTarget={blurTargetRef}
          intensity={10}
          tint={Platform.OS === 'ios' ? 'systemUltraThinMaterialLight' : 'light'}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: 'rgba(248, 246, 243, 0.34)' },
          ]}
        />
      </View>

      <Animated.View
        style={[
          styles.cardWrap,
          {
            opacity: cardOpacity,
            transform: [{ scale: cardScale }, { translateY: cardTranslateY }],
            paddingHorizontal: ds.spacing(24),
          },
        ]}
      >
        <GlassSurface
          intensity="strong"
          style={{
            width: '100%',
            maxWidth: ds.spacing(360),
            borderRadius: ds.radius(24),
            overflow: 'hidden',
            borderWidth: glassHairlineWidth,
            borderColor: glassColors.cardBorder,
          }}
        >
          <View
            style={{
              height: 7,
              backgroundColor: glassColors.successSoft,
            }}
          >
            <Animated.View
              style={{
                height: '100%',
                width: progressWidth,
                backgroundColor: glassColors.successText,
              }}
            />
          </View>

          <View
            style={{
              paddingHorizontal: ds.spacing(20),
              paddingTop: ds.spacing(18),
              paddingBottom: ds.spacing(20),
            }}
          >
            <Animated.View
              style={{
                position: 'absolute',
                top: ds.spacing(14),
                right: ds.spacing(14),
                opacity: contentOpacity,
                transform: [{ translateY: contentTranslateY }],
              }}
            >
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
            </Animated.View>

            <View style={{ alignItems: 'center', paddingTop: ds.spacing(4) }}>
              <Animated.View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: ds.spacing(2),
                  width: ds.icon(76),
                  height: ds.icon(76),
                  borderRadius: glassRadii.round,
                  backgroundColor: glassColors.successSoft,
                  opacity: pulseOpacity,
                  transform: [{ scale: pulseScale }],
                }}
              />

              <Animated.View
                style={{
                  width: ds.icon(58),
                  height: ds.icon(58),
                  borderRadius: glassRadii.round,
                  backgroundColor: glassColors.successSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: badgeOpacity,
                  transform: [{ scale: badgeScale }],
                }}
              >
                <Animated.View
                  style={{
                    opacity: checkOpacity,
                    transform: [{ scale: checkScale }],
                  }}
                >
                  <Ionicons
                    name="checkmark"
                    size={ds.icon(28)}
                    color={glassColors.successText}
                  />
                </Animated.View>
              </Animated.View>

              <Animated.View
                style={{
                  width: '100%',
                  opacity: contentOpacity,
                  transform: [{ translateY: contentTranslateY }],
                }}
              >
                <Text
                  style={{
                    marginTop: ds.spacing(18),
                    fontSize: ds.fontSize(22),
                    fontWeight: '800',
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
                    lineHeight: ds.fontSize(20),
                    textAlign: 'center',
                  }}
                >
                  {summaryText}
                </Text>

                <View
                  style={{
                    marginTop: ds.spacing(20),
                    borderRadius: ds.radius(18),
                    borderWidth: glassHairlineWidth,
                    borderColor: glassColors.cardBorder,
                    backgroundColor: glassColors.background,
                    paddingHorizontal: ds.spacing(14),
                    paddingVertical: ds.spacing(12),
                    gap: ds.spacing(12),
                  }}
                >
                  <View style={styles.detailRow}>
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
                        marginLeft: ds.spacing(14),
                        fontSize: ds.fontSize(13),
                        fontWeight: '700',
                        color: glassColors.textPrimary,
                        textAlign: 'right',
                      }}
                      numberOfLines={1}
                    >
                      {orderDisplayId}
                    </Text>
                  </View>

                  <View style={styles.detailRow}>
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
                        marginLeft: ds.spacing(14),
                        fontSize: ds.fontSize(13),
                        fontWeight: '600',
                        color: glassColors.textPrimary,
                        textAlign: 'right',
                      }}
                      numberOfLines={1}
                    >
                      {activeConfirmation.locationName}
                    </Text>
                  </View>

                  <View style={styles.detailRow}>
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
                        marginLeft: ds.spacing(14),
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

                <View
                  style={{
                    marginTop: ds.spacing(14),
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons
                    name="time-outline"
                    size={ds.icon(14)}
                    color={glassColors.successText}
                  />
                  <Text
                    style={{
                      marginLeft: ds.spacing(6),
                      fontSize: ds.fontSize(12),
                      color: glassColors.textSecondary,
                    }}
                  >
                    Submitted by {activeConfirmation.submittedBy}
                  </Text>
                </View>
              </Animated.View>
            </View>
          </View>
        </GlassSurface>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  cardWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
