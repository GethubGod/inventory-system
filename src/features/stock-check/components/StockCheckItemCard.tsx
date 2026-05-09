import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  interpolateColor,
  LinearTransition,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  ImpactFeedbackStyle,
  triggerImpactHaptic,
  triggerNotificationHaptic,
  NotificationFeedbackType,
} from '@/lib/haptics';
import {
  colors,
  glassColors,
  glassHairlineWidth,
  glassRadii,
  grayScale,
} from '@/theme/design';
import type { StockCheckItem } from '../types';
import { formatStockDisplay, getStockUnitLabel } from '../utils/stockMath';

/** Vibrant success green for the "checked / done" state on the card chevron. */
const SUCCESS_GREEN = '#22C55E';

interface StockCheckItemCardProps {
  item: StockCheckItem;
  /**
   * `true` when this row is the currently-active item in the screen-level
   * Set-Stock bottom sheet. Drives the red outline accent.
   */
  isActive: boolean;
  /**
   * Single tap target for the row + the chevron button. Always opens the
   * Set-Stock bottom sheet for this item; the parent owns the active-id
   * state and renders exactly one sheet.
   */
  onPressEdit: (itemId: string) => void;
  /** Swipe-right shortcut → mark stock at par. */
  onMarkFull: (itemId: string) => void;
  /** Swipe-left shortcut → mark stock fully out. */
  onMarkEmpty: (itemId: string) => void;
}

/** Pixel offset that must be reached before a swipe action is committed. */
const SWIPE_COMMIT_THRESHOLD = 96;
/** Maximum visible drag distance before the card stops translating further. */
const SWIPE_MAX_TRANSLATION = 140;
/** Velocity (px/sec) that on its own commits a swipe even if below distance threshold. */
const SWIPE_VELOCITY_COMMIT = 850;

const REVEAL_GREEN_BG = 'rgba(34, 197, 94, 0.95)';
const REVEAL_RED_BG = 'rgba(232, 80, 58, 0.95)';

/* ──────────────────────────────────────────────────────────────────────────
 * EditChevron — circular action button on the right edge of every row.
 *
 * Phase-6 success state:
 *   • Idle (item unchecked): grey background + chevron-forward icon.
 *   • Done (item checked):   vibrant green background + checkmark icon,
 *     reached via a smooth Reanimated transition (color interpolation +
 *     1.0 → 1.12 → 1.0 scale pop). The transition fires on the false →
 *     true edge of `isChecked`; toggling back the other way reverses
 *     smoothly without the pop (we only celebrate completion).
 *
 * Implementation notes:
 *   • `progress` is a 0..1 shared value driven by `withTiming` (220ms
 *     bezier, same easing as the rest of the screen's motion language).
 *   • `popScale` is its own shared value so the bounce can play once
 *     without coupling to the steady-state color phase.
 *   • Icon swap uses two absolutely-positioned icons cross-faded via
 *     opacity; cheaper and crisper than re-keying the icon component.
 * ──────────────────────────────────────────────────────────────────── */

interface EditChevronProps {
  onPress: () => void;
  accessibilityLabel: string;
  /** When true, paints the success state (green + checkmark). */
  isChecked: boolean;
}

const CHEVRON_TRANSITION_MS = 220;
const CHEVRON_EASING = Easing.bezier(0.2, 0, 0.2, 1);

const EditChevron = memo(function EditChevron({
  onPress,
  accessibilityLabel,
  isChecked,
}: EditChevronProps) {
  const ds = useScaledStyles();

  /* Steady-state progress: 0 = idle (grey + chevron), 1 = done (green +
   * check). Drives the background color interpolation and the icon cross-
   * fade. */
  const progress = useSharedValue(isChecked ? 1 : 0);
  /* Independent scale spring — the celebratory "pop" plays only on the
   * false → true edge of `isChecked` so toggling back doesn't bounce. */
  const popScale = useSharedValue(1);
  /* Tracks the most recent value seen by the effect so we can detect the
   * specific transition direction without re-running the pop on the
   * initial mount of an already-checked row. */
  const prevCheckedRef = useRef(isChecked);

  useEffect(() => {
    const wasChecked = prevCheckedRef.current;
    prevCheckedRef.current = isChecked;
    progress.value = withTiming(isChecked ? 1 : 0, {
      duration: CHEVRON_TRANSITION_MS,
      easing: CHEVRON_EASING,
    });
    if (isChecked && !wasChecked) {
      // Pop sequence — quick scale up to 1.12, then a damped spring back
      // to 1. Stiffer spring (220) keeps the bounce crisp instead of
      // wobbly. Total time matches the color transition so the two
      // animations land together.
      popScale.value = withSequence(
        withTiming(1.12, {
          duration: 110,
          easing: Easing.out(Easing.cubic),
        }),
        withSpring(1, {
          damping: 12,
          stiffness: 220,
          mass: 0.6,
        }),
      );
    }
  }, [isChecked, popScale, progress]);

  const containerStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [grayScale[100], SUCCESS_GREEN],
    ),
    transform: [{ scale: popScale.value }],
  }));

  const chevronIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [1, 0], Extrapolation.CLAMP),
  }));
  const checkIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1], Extrapolation.CLAMP),
  }));

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: isChecked }}
      onPress={onPress}
      activeOpacity={0.75}
      hitSlop={6}
    >
      <Animated.View
        style={[
          {
            width: 36,
            height: 36,
            borderRadius: glassRadii.round,
            alignItems: 'center',
            justifyContent: 'center',
          },
          containerStyle,
        ]}
      >
        <Animated.View style={[{ position: 'absolute' }, chevronIconStyle]}>
          <Ionicons
            name="chevron-forward"
            size={ds.icon(18)}
            color={glassColors.textPrimary}
          />
        </Animated.View>
        <Animated.View style={[{ position: 'absolute' }, checkIconStyle]}>
          <Ionicons name="checkmark" size={ds.icon(20)} color={colors.white} />
        </Animated.View>
      </Animated.View>
    </TouchableOpacity>
  );
});

/* ──────────────────────────────────────────────────────────────────────────
 * StockCheckItemCard
 * ──────────────────────────────────────────────────────────────────────── */

function StockCheckItemCardImpl({
  item,
  isActive,
  onPressEdit,
  onMarkFull,
  onMarkEmpty,
}: StockCheckItemCardProps) {
  const ds = useScaledStyles();
  const { width: screenWidth } = useWindowDimensions();

  /* Shared values for the swipe gesture. */
  const translateX = useSharedValue(0);
  const isPressed = useSharedValue(0);
  /**
   * Tracks which swipe-direction haptic has already fired during this gesture
   * so we trigger exactly once per cross of the threshold. Reset on release.
   */
  const hapticFiredFor = useSharedValue<0 | 1 | -1>(0);

  const handleEdit = useCallback(
    () => onPressEdit(item.id),
    [item.id, onPressEdit],
  );

  /**
   * JS-thread callbacks bridged from the gesture worklet via `runOnJS`.
   * Each performs:
   *  1. Tactile feedback (medium impact + success notification)
   *  2. Store mutation (markFull / markEmpty)
   * They are stable across renders because they only depend on `item.id` and
   * the upstream callbacks (which the parent already memoizes).
   */
  const commitFull = useCallback(() => {
    void triggerImpactHaptic(ImpactFeedbackStyle.Medium);
    void triggerNotificationHaptic(NotificationFeedbackType.Success);
    onMarkFull(item.id);
  }, [item.id, onMarkFull]);

  const commitEmpty = useCallback(() => {
    void triggerImpactHaptic(ImpactFeedbackStyle.Medium);
    void triggerNotificationHaptic(NotificationFeedbackType.Warning);
    onMarkEmpty(item.id);
  }, [item.id, onMarkEmpty]);

  const fireThresholdHaptic = useCallback(() => {
    void triggerImpactHaptic(ImpactFeedbackStyle.Light);
  }, []);

  /**
   * Pan gesture configuration:
   *  - `activeOffsetX([-12, 12])` lets the FlatList own vertical scrolling
   *    until the user clearly intends a horizontal swipe. Without this, fast
   *    flings fight the parent ScrollView.
   *  - `failOffsetY([-12, 12])` gives up the gesture if the user moves too
   *    far vertically — vertical scroll wins.
   *  - The gesture is disabled while this card is the active sheet target so
   *    swipes can't fight a sheet that's already animating open.
   *  - We clamp `translationX` against `SWIPE_MAX_TRANSLATION` so the rubber-
   *    banding stops feeling laggy on very long swipes.
   */
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-12, 12])
        .failOffsetY([-12, 12])
        .enabled(!isActive)
        .onStart(() => {
          'worklet';
          isPressed.value = 1;
          hapticFiredFor.value = 0;
        })
        .onUpdate((evt) => {
          'worklet';
          const clamped = Math.max(
            -SWIPE_MAX_TRANSLATION,
            Math.min(SWIPE_MAX_TRANSLATION, evt.translationX),
          );
          translateX.value = clamped;

          if (clamped >= SWIPE_COMMIT_THRESHOLD && hapticFiredFor.value !== 1) {
            hapticFiredFor.value = 1;
            runOnJS(fireThresholdHaptic)();
          } else if (
            clamped <= -SWIPE_COMMIT_THRESHOLD &&
            hapticFiredFor.value !== -1
          ) {
            hapticFiredFor.value = -1;
            runOnJS(fireThresholdHaptic)();
          }
        })
        .onEnd((evt) => {
          'worklet';
          isPressed.value = 0;
          const distance = translateX.value;
          const velocity = evt.velocityX;
          const shouldCommitRight =
            distance >= SWIPE_COMMIT_THRESHOLD ||
            velocity >= SWIPE_VELOCITY_COMMIT;
          const shouldCommitLeft =
            distance <= -SWIPE_COMMIT_THRESHOLD ||
            velocity <= -SWIPE_VELOCITY_COMMIT;

          if (shouldCommitRight) {
            translateX.value = withSpring(screenWidth * 0.6, {
              damping: 18,
              stiffness: 180,
              mass: 0.7,
            });
            translateX.value = withTiming(0, { duration: 220 });
            runOnJS(commitFull)();
          } else if (shouldCommitLeft) {
            translateX.value = withSpring(-screenWidth * 0.6, {
              damping: 18,
              stiffness: 180,
              mass: 0.7,
            });
            translateX.value = withTiming(0, { duration: 220 });
            runOnJS(commitEmpty)();
          } else {
            translateX.value = withSpring(0, {
              damping: 16,
              stiffness: 220,
              mass: 0.6,
            });
          }
          hapticFiredFor.value = 0;
        })
        .onFinalize(() => {
          'worklet';
          isPressed.value = 0;
        }),
    [
      commitEmpty,
      commitFull,
      fireThresholdHaptic,
      hapticFiredFor,
      isActive,
      isPressed,
      screenWidth,
      translateX,
    ],
  );

  /* The card itself moves; reveal layers stay anchored. */
  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const rightRevealStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      translateX.value,
      [0, SWIPE_COMMIT_THRESHOLD * 0.4, SWIPE_COMMIT_THRESHOLD],
      [0, 0.6, 1],
      Extrapolation.CLAMP,
    );
    return { opacity };
  });

  const leftRevealStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      translateX.value,
      [-SWIPE_COMMIT_THRESHOLD, -SWIPE_COMMIT_THRESHOLD * 0.4, 0],
      [1, 0.6, 0],
      Extrapolation.CLAMP,
    );
    return { opacity };
  });

  const stockDisplay = useMemo(() => formatStockDisplay(item), [item]);
  const isUnchecked = item.status === 'unchecked';

  // Accessibility label for the chevron — read with the row's stock state so
  // VoiceOver announces "Open Brown Sugar, current stock 4 lb 2 pcs".
  const editAccessibilityLabel = useMemo(() => {
    if (isUnchecked) {
      return `Set stock for ${item.name}`;
    }
    const unitLabel = getStockUnitLabel(item);
    const head = `${item.stockAmount} ${unitLabel}`;
    const tail = item.stockPieces > 0 ? `, ${item.stockPieces} pieces` : '';
    return `Edit stock for ${item.name}, current stock ${head}${tail}`;
  }, [isUnchecked, item]);

  return (
    <Animated.View
      // Smooth, non-bouncy `LinearTransition` keeps neighbouring rows from
      // jumping when the active outline width toggles between 1px hairline
      // and 2px accent. Same easing as the rest of the screen's motion
      // language.
      layout={LinearTransition.duration(220).easing(
        Easing.bezier(0.2, 0, 0.2, 1).factory(),
      )}
      style={{
        position: 'relative',
        borderRadius: glassRadii.surface,
        overflow: 'hidden',
      }}
    >
      {/* Reveal layer — shown beneath the card, fades in as the card swipes. */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            borderRadius: glassRadii.surface,
            backgroundColor: REVEAL_GREEN_BG,
            paddingHorizontal: ds.spacing(20),
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-start',
          },
          rightRevealStyle,
        ]}
      >
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: glassRadii.round,
            backgroundColor: 'rgba(255,255,255,0.25)',
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: ds.spacing(12),
          }}
        >
          <Ionicons
            name="checkmark"
            size={ds.icon(20)}
            color={colors.white}
          />
        </View>
        <Text
          style={{
            color: colors.white,
            fontSize: ds.fontSize(15),
            fontWeight: '800',
            letterSpacing: 0.4,
          }}
        >
          Full
        </Text>
      </Animated.View>

      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            borderRadius: glassRadii.surface,
            backgroundColor: REVEAL_RED_BG,
            paddingHorizontal: ds.spacing(20),
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-end',
          },
          leftRevealStyle,
        ]}
      >
        <Text
          style={{
            color: colors.white,
            fontSize: ds.fontSize(15),
            fontWeight: '800',
            letterSpacing: 0.4,
            marginRight: ds.spacing(12),
          }}
        >
          All out
        </Text>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: glassRadii.round,
            backgroundColor: 'rgba(255,255,255,0.25)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons
            name="alert"
            size={ds.icon(20)}
            color={colors.white}
          />
        </View>
      </Animated.View>

      {/* Foreground — the actual card. */}
      <GestureDetector gesture={panGesture}>
        <Animated.View
          style={[
            {
              backgroundColor: colors.white,
              borderRadius: glassRadii.surface,
              borderWidth: isActive ? 2 : glassHairlineWidth,
              borderColor: isActive ? glassColors.accent : glassColors.cardBorder,
            },
            cardAnimatedStyle,
          ]}
        >
          {/*
            The whole row is a single tap target — tapping anywhere opens
            the sheet, matching the design where the chevron and the card
            body both feel "tappable". `activeOpacity={1}` because the
            chevron itself provides the press affordance; flashing the
            entire surface when the user taps the chevron looks busy.
          */}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={editAccessibilityLabel}
            onPress={handleEdit}
            activeOpacity={0.96}
            style={{
              paddingHorizontal: ds.spacing(16),
              paddingVertical: ds.spacing(13),
              minHeight: ds.spacing(64),
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              <View
                style={{
                  flex: 1,
                  paddingRight: ds.spacing(10),
                  justifyContent: 'center',
                }}
              >
                <Text
                  style={{
                    fontSize: ds.fontSize(16),
                    fontWeight: '700',
                    color: isUnchecked
                      ? glassColors.textSecondary
                      : glassColors.textPrimary,
                  }}
                  numberOfLines={1}
                >
                  {item.name}
                </Text>
              </View>

              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: ds.spacing(10),
                }}
              >
                <Text
                  style={{
                    fontSize: ds.fontSize(18),
                    fontWeight: '900',
                    color: isUnchecked
                      ? glassColors.textMuted
                      : glassColors.textPrimary,
                  }}
                  numberOfLines={1}
                >
                  {stockDisplay}
                </Text>
                <EditChevron
                  onPress={handleEdit}
                  accessibilityLabel={editAccessibilityLabel}
                  isChecked={item.checked}
                />
              </View>
            </View>

            {item.hasNote ? (
              <View
                style={{
                  marginTop: ds.spacing(10),
                  paddingTop: ds.spacing(10),
                  borderTopWidth: glassHairlineWidth,
                  borderTopColor: glassColors.divider,
                }}
              >
                <Text
                  style={{
                    fontSize: ds.fontSize(13),
                    color: glassColors.textSecondary,
                    fontStyle: 'italic',
                  }}
                  numberOfLines={3}
                >
                  “{item.noteText}”
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

/**
 * Memoized with a custom equality so taps on *other* cards (which only flip
 * the screen-level `activeItemId`) don't force this card to re-render. The
 * vast majority of rows are never the active item, so this prevents a
 * cascade of work when the sheet opens/closes.
 */
export const StockCheckItemCard = memo(
  StockCheckItemCardImpl,
  (prev, next) =>
    prev.item === next.item &&
    prev.isActive === next.isActive &&
    prev.onPressEdit === next.onPressEdit &&
    prev.onMarkFull === next.onMarkFull &&
    prev.onMarkEmpty === next.onMarkEmpty,
);
