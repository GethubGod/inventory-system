import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Text,
  View,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { triggerSelectionHaptic } from '@/lib/haptics';
import { glassColors } from '@/theme/design';

/**
 * A single column of a wheel picker. Renders a snapping FlatList styled to
 * look like an iOS-style cylinder picker (3D fade + scale falloff away
 * from the center selection band).
 *
 * Performance contract:
 *   • All visual interpolation runs on the UI thread via Reanimated.
 *   • Haptic ticks are driven by `useAnimatedReaction` watching the
 *     rounded scroll index — that means exactly one haptic per row crossed,
 *     fired from a worklet via `runOnJS`. No JS-thread scroll handler, so
 *     rapid flings can't crash the app or queue thousands of haptics.
 *   • `getItemLayout` lets the FlatList jump directly to large indexes
 *     (e.g., the 0..99 PIECES wheel) without materialising every row.
 *   • The component is `memo`-wrapped and only re-renders when its props
 *     change — important because three of these are mounted side-by-side
 *     and would otherwise all re-render whenever any column changes.
 */
export interface WheelPickerOption<T = string> {
  /** Stable key used by FlatList. */
  key: string;
  /** Visible label rendered in the row. */
  label: string;
  /** Opaque value the parent maps back to its domain (unit key, integer, etc). */
  value: T;
}

export interface WheelPickerProps<T = string> {
  options: WheelPickerOption<T>[];
  /** Currently-selected index. Drives both scroll position and haptic baseline. */
  selectedIndex: number;
  /**
   * Fired when the active row changes. Always called with a clamped, valid
   * index (0..options.length-1).
   */
  onIndexChange: (nextIndex: number) => void;
  /** Pixel height of one row. Defaults to 44. */
  itemHeight?: number;
  /** Number of visible rows above + below the selection band. Default: 2. */
  visibleRange?: number;
  /** Optional accessibility label for the column. */
  accessibilityLabel?: string;
}

const DEFAULT_ITEM_HEIGHT = 44;
const DEFAULT_VISIBLE_RANGE = 2;

/* ──────────────────────────────────────────────────────────────────────────
 * WheelRow — independently memoized so a 100-row wheel doesn't re-render
 * every cell when the active index moves. The 3D effect lives in its own
 * animated style hook driven by the column's shared `scrollY` and the
 * row's own static index.
 * ──────────────────────────────────────────────────────────────────────── */

interface WheelRowProps {
  label: string;
  index: number;
  itemHeight: number;
  scrollY: SharedValue<number>;
}

const WheelRow = memo(function WheelRow({
  label,
  index,
  itemHeight,
  scrollY,
}: WheelRowProps) {
  const animatedStyle = useAnimatedStyle(() => {
    const distance = Math.abs(scrollY.value - index * itemHeight) / itemHeight;
    const scale = interpolate(
      distance,
      [0, 1, 2, 3],
      [1, 0.86, 0.72, 0.6],
      Extrapolation.CLAMP,
    );
    const opacity = interpolate(
      distance,
      [0, 1, 2, 3],
      [1, 0.5, 0.25, 0.1],
      Extrapolation.CLAMP,
    );
    return {
      opacity,
      transform: [{ scale }],
    };
  });

  return (
    <Animated.View
      style={[
        {
          height: itemHeight,
          alignItems: 'center',
          justifyContent: 'center',
        },
        animatedStyle,
      ]}
    >
      <Text
        style={{
          fontSize: 22,
          fontWeight: '700',
          color: glassColors.textPrimary,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Animated.View>
  );
});

/* ──────────────────────────────────────────────────────────────────────────
 * WheelPicker (single column).
 * ──────────────────────────────────────────────────────────────────────── */

function WheelPickerImpl<T>({
  options,
  selectedIndex,
  onIndexChange,
  itemHeight = DEFAULT_ITEM_HEIGHT,
  visibleRange = DEFAULT_VISIBLE_RANGE,
  accessibilityLabel,
}: WheelPickerProps<T>) {
  const listRef = useRef<Animated.FlatList<WheelPickerOption<T>>>(null);

  const optionCount = options.length;

  // Defensive: when the parent passes an out-of-range index, clamp it for
  // every internal calculation but leave the prop untouched.
  const safeIndex = useMemo(() => {
    if (optionCount === 0) return 0;
    const i = Math.max(0, Math.min(optionCount - 1, selectedIndex));
    return Number.isFinite(i) ? i : 0;
  }, [optionCount, selectedIndex]);

  const scrollY = useSharedValue(safeIndex * itemHeight);
  /**
   * UI-thread mirror of the rounded "active index" the wheel last reported.
   * Lives on the worklet thread, updated by `useAnimatedReaction`. We
   * compare the freshly-rounded index against this and only `runOnJS` a
   * haptic + commit when they differ — exactly one haptic per row crossed.
   */
  const liveIndex = useSharedValue(safeIndex);
  /** Tracks whether the most recent scroll was user-driven vs prop-driven. */
  const isUserScrolling = useRef(false);
  /**
   * Failsafe timer that force-clears `isUserScrolling` if the FlatList
   * never delivers a settle event (`onMomentumScrollEnd` /
   * `onScrollEndDrag`). This happens, for example, when the bottom sheet
   * is dragged down to dismiss while a wheel fling is mid-flight — the
   * wheel's gesture is cancelled by the sheet's pan and our settle
   * callbacks never fire. Without this, the next sheet open for a new
   * item would have its prop-driven seed ignored.
   */
  const settleFailsafeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The last index the JS thread committed via `onIndexChange`. Used by the
   * `useEffect` below to suppress prop-driven scroll bounces from
   * re-firing the JS callback.
   */
  const lastCommittedIndex = useRef(safeIndex);

  // Always cancel the failsafe on unmount so the timer can't fire after
  // tear-down (which would mutate a ref on a dead instance — harmless,
  // but worth being tidy about).
  useEffect(() => {
    return () => {
      if (settleFailsafeRef.current) {
        clearTimeout(settleFailsafeRef.current);
        settleFailsafeRef.current = null;
      }
    };
  }, []);

  /* When the parent updates `selectedIndex` (e.g., a Cancel that resets the
   * wheel to the previously-saved value), jump the list. Skipping during
   * active user scroll prevents fighting the user's gesture. */
  useEffect(() => {
    if (isUserScrolling.current) return;
    if (safeIndex === lastCommittedIndex.current) return;
    lastCommittedIndex.current = safeIndex;
    liveIndex.value = safeIndex;
    scrollY.value = safeIndex * itemHeight;
    listRef.current?.scrollToOffset({
      offset: safeIndex * itemHeight,
      animated: false,
    });
  }, [safeIndex, itemHeight, scrollY, liveIndex]);

  /* Animated scroll handler — UI-thread only, just keeps `scrollY` mirrored. */
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  /**
   * Phase-6 perf rework: this is now the WORKLET-ONLY haptic path. We do
   * NOT call `onIndexChange` from here — that fires only on settle (see
   * `handleScrollSettled` below). During a scroll/fling we just:
   *   1. Update `liveIndex` (UI-thread mirror, used by future consumers
   *      that want a SharedValue read).
   *   2. Fire a selection haptic via `runOnJS` once per row crossed.
   *
   * Pushing `onIndexChange` out of this hot path eliminates the per-row
   * setState that was tanking smoothness on long flings — the parent
   * sheet now re-renders at most once per gesture instead of dozens of
   * times per second. The user-visible "STOCK / NEED TO ORDER" summary
   * therefore updates on settle (snappy, not laggy).
   */
  useAnimatedReaction(
    () => {
      const idx = Math.round(scrollY.value / itemHeight);
      // Clamp inside the worklet so the haptic always corresponds to a
      // visible row.
      if (optionCount === 0) return 0;
      if (idx < 0) return 0;
      if (idx >= optionCount) return optionCount - 1;
      return idx;
    },
    (next, prev) => {
      if (next === prev) return;
      if (next === liveIndex.value) return;
      liveIndex.value = next;
      // Pure side effect — `triggerSelectionHaptic` doesn't touch React
      // state, so this is safe to call ~60 times per second during a
      // fast fling without any reconciliation cost.
      runOnJS(triggerSelectionHaptic)();
    },
    [itemHeight, optionCount],
  );

  const handleScrollBeginDrag = useCallback(() => {
    isUserScrolling.current = true;
    // Schedule a failsafe — see `settleFailsafeRef` comment above. 1.5s is
    // generous: a typical iOS fling settles in <800ms, so we won't race
    // with legitimate momentum.
    if (settleFailsafeRef.current) {
      clearTimeout(settleFailsafeRef.current);
    }
    settleFailsafeRef.current = setTimeout(() => {
      isUserScrolling.current = false;
      settleFailsafeRef.current = null;
    }, 1500);
  }, []);

  /**
   * Fires after a flick has fully settled. We don't recompute the index here
   * (the worklet reaction already did) — we just clear the user-scrolling
   * flag so prop-driven jumps can resume controlling the position. We also
   * snap-correct any sub-pixel drift that the FlatList's snap engine might
   * have left behind: if the contentOffset isn't an exact multiple of
   * `itemHeight`, programmatically nudge to the rounded position. This
   * prevents the "wheel sits half-way between two rows" bug that can occur
   * on Android after fast flings.
   */
  /**
   * Settle handler — runs once per gesture (fired by both
   * `onMomentumScrollEnd` and `onScrollEndDrag`). This is now the SOLE
   * call-site for `onIndexChange`, completing the Phase-6 contract that
   * parent state mutates exactly once per wheel interaction.
   */
  const handleScrollSettled = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      isUserScrolling.current = false;
      if (settleFailsafeRef.current) {
        clearTimeout(settleFailsafeRef.current);
        settleFailsafeRef.current = null;
      }
      const offset = e.nativeEvent.contentOffset.y;
      const rounded = Math.round(offset / itemHeight);
      const clamped = Math.max(0, Math.min(optionCount - 1, rounded));
      const correctedOffset = clamped * itemHeight;

      // Snap-correct any sub-pixel drift left over from a fast Android
      // fling. Only nudge if we're more than a half-pixel off — within
      // that tolerance the visible result is identical and animating
      // would feel twitchy.
      if (Math.abs(offset - correctedOffset) > 0.5) {
        listRef.current?.scrollToOffset({
          offset: correctedOffset,
          animated: true,
        });
      }

      // Commit the final index to JS state IF it differs from what the
      // parent already has. Worklet round-trips during the gesture
      // already kept `lastCommittedIndex.current` in sync via the
      // prop-seeding effect — so this guard correctly fires only when
      // the user genuinely landed on a different row.
      if (clamped !== lastCommittedIndex.current) {
        lastCommittedIndex.current = clamped;
        onIndexChange(clamped);
      }
    },
    [itemHeight, onIndexChange, optionCount],
  );

  /* Memoize the renderer + key extractor so the FlatList doesn't churn. */
  const keyExtractor = useCallback(
    (item: WheelPickerOption<T>) => item.key,
    [],
  );

  const renderItem: ListRenderItem<WheelPickerOption<T>> = useCallback(
    ({ item, index }) => (
      <WheelRow
        label={item.label}
        index={index}
        itemHeight={itemHeight}
        scrollY={scrollY}
      />
    ),
    [itemHeight, scrollY],
  );

  const listPadding = visibleRange * itemHeight;
  const listHeight = (visibleRange * 2 + 1) * itemHeight;

  const getItemLayout = useCallback(
    (_data: ArrayLike<WheelPickerOption<T>> | null | undefined, index: number) => ({
      length: itemHeight,
      offset: itemHeight * index,
      index,
    }),
    [itemHeight],
  );

  /* Static degenerate case — single option, no scroll. */
  if (optionCount <= 1) {
    return (
      <View
        accessibilityLabel={accessibilityLabel}
        style={{
          height: listHeight,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontSize: 22,
            fontWeight: '700',
            color: glassColors.textPrimary,
          }}
          numberOfLines={1}
        >
          {options[0]?.label ?? ''}
        </Text>
      </View>
    );
  }

  return (
    <Animated.FlatList
      ref={listRef}
      data={options}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      getItemLayout={getItemLayout}
      // Snap to each row so releases always land on a discrete index.
      snapToInterval={itemHeight}
      snapToAlignment="center"
      decelerationRate="fast"
      showsVerticalScrollIndicator={false}
      bounces={false}
      overScrollMode="never"
      // Tight render windows + clipped subviews keep memory flat even with
      // 100-row wheels.
      initialNumToRender={visibleRange * 2 + 3}
      maxToRenderPerBatch={visibleRange * 2 + 3}
      windowSize={3}
      removeClippedSubviews
      scrollEventThrottle={16}
      contentContainerStyle={{
        paddingTop: listPadding,
        paddingBottom: listPadding,
      }}
      style={{
        height: listHeight,
        flex: 1,
      }}
      onScroll={onScroll}
      onScrollBeginDrag={handleScrollBeginDrag}
      onScrollEndDrag={handleScrollSettled}
      onMomentumScrollEnd={handleScrollSettled}
      accessibilityLabel={accessibilityLabel}
      initialScrollIndex={safeIndex}
    />
  );
}

export const WheelPicker = memo(WheelPickerImpl) as <T>(
  props: WheelPickerProps<T>,
) => React.ReactElement;
