import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useShallow } from 'zustand/react/shallow';
import { LoadingIndicator } from '@/components';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  triggerConfirmationHaptic,
  triggerImpactHaptic,
  ImpactFeedbackStyle,
} from '@/lib/haptics';
import { useAuthStore } from '@/store';
import { useOrderingCartActions } from '@/hooks/useOrderingCartActions';
import {
  colors,
  glassColors,
  glassRadii,
  glassSpacing,
  grayScale,
} from '@/theme/design';
import type { Location } from '@/types';
import { StockCheckHeader } from './components/StockCheckHeader';
import { StockCheckProgressBar } from './components/StockCheckProgressBar';
import { StorageAreaFilterBar } from './components/StorageAreaFilterBar';
import { StockCheckItemCard } from './components/StockCheckItemCard';
import { StationPickerBottomSheet } from './components/StationPickerBottomSheet';
import {
  SetStockBottomSheet,
  type SetStockBottomSheetRef,
} from './components/SetStockBottomSheet';
import {
  computeAreaProgress,
  useStockCheckStore,
} from './useStockCheckStore';
import type { StockCheckItem } from './types';

// Reanimated's `createAnimatedComponent` returns a wrapper that drops
// FlatList's generic over ItemT. We re-type the wrapper with a typed
// FlatList instantiation so `data`, `renderItem`, and `keyExtractor` all
// stay `StockCheckItem`-correct at the call site.
const AnimatedFlatList = Animated.createAnimatedComponent(
  FlatList<StockCheckItem>,
);

/** Pixel slack to count "scrolled to bottom" — matches FlatList onEndReached idiom. */
const SCROLL_TO_BOTTOM_SLACK = 24;

/** CTA color animation timing — same curve as the chevron + dropdown. */
const CTA_TIMING = { duration: 220, easing: Easing.bezier(0.2, 0, 0.2, 1) };

export function StockCheckScreenView() {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();

  const location = useAuthStore((state) => state.location);
  const allLocations = useAuthStore((state) => state.locations);
  const setAuthLocation = useAuthStore((state) => state.setLocation);

  const markFull = useStockCheckStore((s) => s.markFull);
  const markEmpty = useStockCheckStore((s) => s.markEmpty);
  const setItemNote = useStockCheckStore((s) => s.setItemNote);
  const clearItemNote = useStockCheckStore((s) => s.clearItemNote);
  const commitStockEntry = useStockCheckStore((s) => s.commitStockEntry);
  const selectArea = useStockCheckStore((s) => s.selectArea);
  const loadLocation = useStockCheckStore((s) => s.loadLocation);

  const {
    areas,
    itemsById,
    selectedAreaId,
    isLoading,
    loadError,
  } = useStockCheckStore(
    useShallow((s) => ({
      areas: s.areas,
      itemsById: s.itemsById,
      selectedAreaId: s.selectedAreaId,
      isLoading: s.isLoading,
      loadError: s.loadError,
    })),
  );

  const { addLineItem } = useOrderingCartActions('employee');

  const [refreshing, setRefreshing] = useState(false);
  const [stationPickerVisible, setStationPickerVisible] = useState(false);
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);
  // Tracks whether the user has physically scrolled to the bottom of the
  // CURRENT station's list. Reset whenever the station changes or the data
  // shape changes substantially. Used as one of two CTA-enable conditions.
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);

  // Active item id for the screen-level Set-Stock bottom sheet. Exactly ONE
  // sheet is mounted; this id is what the sheet reads from `itemsById`. We
  // intentionally do NOT mount a sheet inside each card — at 100+ items that
  // would explode memory and tank scroll perf. See QA notes at the bottom.
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const sheetRef = useRef<SetStockBottomSheetRef | null>(null);

  const listRef = useRef<FlatList<StockCheckItem> | null>(null);

  useEffect(() => {
    if (location?.id) {
      void loadLocation(location.id);
    }
  }, [loadLocation, location?.id]);

  // Reset scroll-to-bottom state on station change — entering a new station
  // means the user hasn't yet seen its tail.
  useEffect(() => {
    setHasScrolledToBottom(false);
  }, [selectedAreaId]);

  /* ────────────── Derived selectors ─────────────────────────────────── */

  const filterOptions = useMemo(
    () =>
      areas.map((area) => {
        const progress = computeAreaProgress(area, itemsById);
        return {
          id: area.id,
          label: area.name,
          badgeCount: Math.max(
            0,
            progress.totalItems - progress.checkedItems,
          ),
        };
      }),
    [areas, itemsById],
  );

  const selectedArea = useMemo(
    () => areas.find((a) => a.id === selectedAreaId) ?? null,
    [areas, selectedAreaId],
  );

  // Phase 2a: progress bar is now SCOPED to the currently selected station.
  // It reads `computeAreaProgress` for `selectedArea` only — when no station
  // is selected, all counts collapse to zero so the bar reads "0 of 0".
  const sectionProgress = useMemo(() => {
    if (!selectedArea) {
      return { totalItems: 0, checkedItems: 0, itemsToOrder: 0 };
    }
    const p = computeAreaProgress(selectedArea, itemsById);
    return {
      totalItems: p.totalItems,
      checkedItems: p.checkedItems,
      itemsToOrder: p.itemsToOrder,
    };
  }, [itemsById, selectedArea]);

  // The list renders in the storage area's natural item order — items never
  // re-sort when interacted with. The previous "checked → bottom" auto-sort
  // was reverted by request; the `checked` flag still flows through to the
  // CTA-enable predicate below, just without the visual reordering.
  const areaItems = useMemo<StockCheckItem[]>(() => {
    if (!selectedArea) return [];
    return selectedArea.itemIds
      .map((id) => itemsById[id])
      .filter((item): item is StockCheckItem => Boolean(item));
  }, [itemsById, selectedArea]);

  const allItemsCheckedInStation = useMemo(() => {
    if (areaItems.length === 0) return false;
    for (const it of areaItems) {
      if (!it.checked) return false;
    }
    return true;
  }, [areaItems]);

  /* ────────────── Action handlers ───────────────────────────────────── */

  const handleRefresh = useCallback(async () => {
    if (!location?.id) return;
    setRefreshing(true);
    try {
      await loadLocation(location.id);
    } finally {
      setRefreshing(false);
    }
  }, [loadLocation, location?.id]);

  const handleSelectArea = useCallback(
    (id: string) => {
      selectArea(id);
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    },
    [selectArea],
  );

  const handleOpenStationPicker = useCallback(() => {
    setStationPickerVisible(true);
  }, []);

  const handleCloseStationPicker = useCallback(() => {
    setStationPickerVisible(false);
  }, []);

  const handleToggleLocationDropdown = useCallback(() => {
    setLocationDropdownOpen((prev) => !prev);
  }, []);

  const handleCloseLocationDropdown = useCallback(() => {
    setLocationDropdownOpen(false);
  }, []);

  const handleSelectLocation = useCallback(
    (next: Location) => {
      if (next.id === location?.id) return;
      setAuthLocation(next);
      // The store's loadLocation will run via the effect below as `location.id`
      // changes. Reset transient view state immediately.
      setHasScrolledToBottom(false);
      void triggerImpactHaptic(ImpactFeedbackStyle.Light);
    },
    [location?.id, setAuthLocation],
  );

  const handleMarkFull = useCallback(
    (itemId: string) => {
      markFull(itemId);
    },
    [markFull],
  );

  const handleMarkEmpty = useCallback(
    (itemId: string) => {
      markEmpty(itemId);
    },
    [markEmpty],
  );

  /* ── Bottom-sheet wiring ─────────────────────────────────────────────
   * All three callbacks below are stable across renders (only depend on
   * the store's stable action references), so the memoized cards never
   * re-render purely due to handler identity flips.
   * ─────────────────────────────────────────────────────────────────── */

  const handlePressEdit = useCallback(
    (itemId: string) => {
      void triggerImpactHaptic(ImpactFeedbackStyle.Light);
      setActiveItemId(itemId);
      // Imperative present — using a ref instead of a `visible` prop keeps
      // open/close fully under the sheet's animation control and avoids
      // a re-render of every card just to toggle open state.
      sheetRef.current?.present();
    },
    [],
  );

  const handleDismissSheet = useCallback(() => {
    // Fired by both the user-driven dismiss (drag/scrim/cancel) and the
    // post-commit auto-dismiss. Clears the active outline once the sheet
    // animation has finished so the row's red outline doesn't snap off
    // mid-animation.
    setActiveItemId(null);
  }, []);

  const handleCommitStock = useCallback(
    (
      itemId: string,
      entry: { stockUnit: 'pack' | 'base'; stockAmount: number; stockPieces: number },
      noteText: string,
    ) => {
      const trimmedNote = noteText.trim();
      if (trimmedNote.length > 0) {
        setItemNote(itemId, trimmedNote);
      } else {
        clearItemNote(itemId);
      }
      commitStockEntry(itemId, entry);
      void triggerConfirmationHaptic();
      sheetRef.current?.dismiss();
    },
    [clearItemNote, commitStockEntry, setItemNote],
  );

  const reviewableItems = useMemo(
    () =>
      Object.values(itemsById).filter(
        (item) =>
          item.status === 'needs_order' ||
          (item.status === 'low' && item.orderQuantity > 0),
      ),
    [itemsById],
  );

  const handleConfirmStock = useCallback(() => {
    if (reviewableItems.length === 0) {
      void triggerConfirmationHaptic();
      router.push('/(tabs)/cart' as any);
      return;
    }
    let added = 0;
    for (const item of reviewableItems) {
      const qty =
        item.orderQuantity > 0 ? item.orderQuantity : item.parLevel;
      if (qty <= 0) continue;
      // The cart's `addLineItem` takes the structured 'pack' | 'base' the
      // user selected via the unit segmented control on each card. We pass
      // it through verbatim — no string-label sniffing needed.
      const ok = addLineItem(item.id, qty, item.unitType, {
        inputMode: 'quantity',
        quantityRequested: qty,
        note: item.hasNote ? item.noteText : undefined,
      });
      if (ok) added += 1;
    }
    if (added > 0) {
      void triggerConfirmationHaptic();
      router.push('/(tabs)/cart' as any);
    }
  }, [addLineItem, reviewableItems]);

  /* ────────────── Scroll tracking ───────────────────────────────────── */

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
      // Avoid flapping: once the user has reached the bottom in this station
      // we *latch* `hasScrolledToBottom` to true. Scrolling back up to inspect
      // a row before pressing Confirm shouldn't disable the CTA.
      if (hasScrolledToBottom) return;
      const reachedBottom =
        contentOffset.y + layoutMeasurement.height >=
        contentSize.height - SCROLL_TO_BOTTOM_SLACK;
      if (reachedBottom) {
        setHasScrolledToBottom(true);
      }
    },
    [hasScrolledToBottom],
  );

  const handleScrollBeginDrag = useCallback(() => {
    // Dismiss the location dropdown the instant the user begins scrolling the
    // list — feels natural and avoids leaving a stale floating menu over
    // content the user is now interacting with.
    if (locationDropdownOpen) {
      setLocationDropdownOpen(false);
    }
  }, [locationDropdownOpen]);

  const handleEndReached = useCallback(() => {
    // Belt-and-braces: short lists may reach the bottom without firing scroll.
    if (areaItems.length === 0) return;
    if (!hasScrolledToBottom) setHasScrolledToBottom(true);
  }, [hasScrolledToBottom, areaItems.length]);

  /* ────────────── CTA enable + animated background ──────────────────── */

  const ctaEnabled =
    areaItems.length > 0 &&
    allItemsCheckedInStation &&
    hasScrolledToBottom;

  const ctaProgress = useSharedValue(0);
  useEffect(() => {
    ctaProgress.value = withTiming(ctaEnabled ? 1 : 0, CTA_TIMING);
  }, [ctaEnabled, ctaProgress]);

  // The CTA paints a grey base layer + an animated red layer on top. Driving
  // the red layer's opacity from 0 → 1 produces a clean "grey → red"
  // crossfade with no muddied intermediate colors. Cheap (worklet-only,
  // single mutation) and color-token-driven.
  const ctaBackgroundStyle = useAnimatedStyle(() => ({
    backgroundColor: glassColors.accent,
    opacity: ctaProgress.value,
  }));

  /* ────────────── Render row ────────────────────────────────────────── */

  const renderItem = useCallback(
    ({ item }: { item: StockCheckItem }) => (
      <StockCheckItemCard
        item={item}
        isActive={activeItemId === item.id}
        onPressEdit={handlePressEdit}
        onMarkFull={handleMarkFull}
        onMarkEmpty={handleMarkEmpty}
      />
    ),
    [activeItemId, handleMarkEmpty, handleMarkFull, handlePressEdit],
  );

  const activeItem = activeItemId ? itemsById[activeItemId] : null;

  const keyExtractor = useCallback((item: StockCheckItem) => item.id, []);

  const ListEmptyComponent = useMemo(
    () => (
      <View
        style={{
          paddingVertical: ds.spacing(40),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontSize: ds.fontSize(14),
            color: glassColors.textSecondary,
          }}
        >
          {selectedArea
            ? 'No items configured for this area yet.'
            : 'Select a storage area to begin.'}
        </Text>
      </View>
    ),
    [ds, selectedArea],
  );

  /* ────────────── Layout offsets ────────────────────────────────────── */

  // The Stock Check route doesn't render through the standard tab safe-area
  // wrapper, so the FAB-like CTA needs to clear the tab bar manually. The
  // tab bar's true height is `60 + max(insets.bottom, glassSpacing.tabBarBottom)`
  // (see `getTabBarBottomInset` / `getTabBarScreenOptions`). Computing it
  // exactly avoids the double-spacing bug from the previous pass where we
  // added both `glassTabBarHeight` AND the bottom inset, leaving a ~40px gap.
  const tabBarBottomInset = Math.max(
    insets.bottom,
    glassSpacing.tabBarBottom,
  );
  const actualTabBarHeight = 60 + tabBarBottomInset;

  const ctaHeight = Math.max(56, ds.buttonH + 8);
  // 16px breathing room above the tab bar — Apple-HIG-friendly density.
  const ctaBottomGap = ds.spacing(16);
  const ctaBottomOffset = actualTabBarHeight + ctaBottomGap;
  // List padding-bottom: clear the CTA, the gap, and the tab bar so the last
  // row is fully visible (and the user can actually *reach* the bottom of
  // the list, which the CTA enable logic depends on).
  const listPaddingBottom =
    ctaHeight + ctaBottomGap + actualTabBarHeight + ds.spacing(12);

  /* ───────── Loading & error states ─────────────────────────────────── */

  if (!location?.id) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: glassColors.background }}
        edges={['top', 'left', 'right']}
      >
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: glassSpacing.screen,
          }}
        >
          <Text
            style={{
              fontSize: ds.fontSize(15),
              color: glassColors.textSecondary,
              textAlign: 'center',
            }}
          >
            Choose a location to start a stock check.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isLoading && areas.length === 0) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: glassColors.background }}
        edges={['top', 'left', 'right']}
      >
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <LoadingIndicator showText text="Loading stock check..." />
        </View>
      </SafeAreaView>
    );
  }

  if (loadError && areas.length === 0) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: glassColors.background }}
        edges={['top', 'left', 'right']}
      >
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: glassSpacing.screen,
          }}
        >
          <Text
            style={{
              fontSize: ds.fontSize(15),
              fontWeight: '600',
              color: glassColors.textPrimary,
              textAlign: 'center',
            }}
          >
            We couldn’t load your storage areas.
          </Text>
          <Text
            style={{
              marginTop: ds.spacing(6),
              fontSize: ds.fontSize(13),
              color: glassColors.textSecondary,
              textAlign: 'center',
            }}
          >
            {loadError}
          </Text>
          <TouchableOpacity
            onPress={() => location?.id && void loadLocation(location.id)}
            activeOpacity={0.85}
            style={{
              marginTop: ds.spacing(16),
              paddingHorizontal: ds.spacing(18),
              paddingVertical: ds.spacing(10),
              borderRadius: glassRadii.pill,
              backgroundColor: glassColors.accent,
            }}
          >
            <Text
              style={{
                fontSize: ds.fontSize(14),
                fontWeight: '700',
                color: glassColors.textOnPrimary,
              }}
            >
              Try again
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  /* ────────────── Main render ───────────────────────────────────────── */

  return (
    <BottomSheetModalProvider>
    <SafeAreaView
      style={{ flex: 1, backgroundColor: glassColors.background }}
      edges={['top', 'left', 'right']}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {/*
          Phase 1: STICKY HEADER. Rendered as a sibling above the FlatList so
          it stays pinned at the top while items scroll beneath. The
          location-dropdown overlay paints inside this container's stacking
          context (zIndex: 10) so it lands over the progress bar / station
          rail when open.
        */}
        <View
          style={{
            paddingHorizontal: glassSpacing.screen,
            paddingTop: ds.spacing(4),
            backgroundColor: glassColors.background,
            zIndex: 10,
          }}
        >
          <StockCheckHeader
            locationLabel={location?.name ?? ''}
            locations={allLocations}
            selectedLocationId={location?.id ?? null}
            isDropdownOpen={locationDropdownOpen}
            onToggleDropdown={handleToggleLocationDropdown}
            onSelectLocation={handleSelectLocation}
            onCloseDropdown={handleCloseLocationDropdown}
          />
          <StockCheckProgressBar
            totalItems={sectionProgress.totalItems}
            checkedItems={sectionProgress.checkedItems}
            itemsToOrder={sectionProgress.itemsToOrder}
          />
          <StorageAreaFilterBar
            options={filterOptions}
            selectedId={selectedAreaId}
            onSelect={handleSelectArea}
            onPressMore={handleOpenStationPicker}
          />
        </View>

        <AnimatedFlatList
          ref={listRef}
          data={areaItems}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={{
            paddingHorizontal: glassSpacing.screen,
            paddingTop: ds.spacing(8),
            paddingBottom: listPaddingBottom,
          }}
          ItemSeparatorComponent={ItemSeparator}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={ListEmptyComponent}
          // Optimization: explicit window sizing keeps memory flat during
          // long scrolls. `removeClippedSubviews` is fine on iOS for our row
          // heights (cards stay above 100px) and prevents Reanimated layout
          // animations from being trampled by ghost views on Android.
          removeClippedSubviews={Platform.OS === 'android'}
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          windowSize={9}
          onScroll={handleScroll}
          onScrollBeginDrag={handleScrollBeginDrag}
          scrollEventThrottle={16}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.05}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={glassColors.accent}
            />
          }
          extraData={activeItemId}
        />

        {/*
          Phase 4: CTA — docked just above the tab bar. Background color
          animates between disabled-grey and brand-red via Reanimated. The
          button is non-interactive in the disabled state (pointerEvents:
          'none' on the disabled overlay isn't needed because we just gate
          onPress + activeOpacity).
        */}
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: ctaBottomOffset,
          }}
        >
          <View
            style={{
              marginHorizontal: ds.spacing(16),
              borderRadius: glassRadii.submitButton,
              overflow: 'hidden',
              shadowColor: 'rgba(15, 23, 42, 0.35)',
              shadowOpacity: 0.18,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 8 },
              elevation: 4,
            }}
          >
            {/* Disabled-state base layer — shows through when ctaProgress is 0.
                grayScale[500] keeps the white icon + label legible while still
                reading clearly as "inert / disabled". */}
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: grayScale[500],
              }}
            />
            <Animated.View
              pointerEvents="none"
              style={[
                {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                },
                ctaBackgroundStyle,
              ]}
            />
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={
                ctaEnabled
                  ? 'Confirm stock'
                  : areaItems.length === 0
                    ? 'Confirm stock — no items in this station'
                    : !allItemsCheckedInStation
                      ? 'Confirm stock — check every item to enable'
                      : 'Confirm stock — scroll to the bottom of the list to enable'
              }
              accessibilityState={{ disabled: !ctaEnabled }}
              disabled={!ctaEnabled}
              onPress={handleConfirmStock}
              activeOpacity={0.9}
              style={{
                height: ctaHeight,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
              }}
            >
              <Ionicons
                name="checkmark-circle"
                size={ds.icon(20)}
                color={colors.white}
                style={{ opacity: ctaEnabled ? 1 : 0.85 }}
              />
              <Text
                style={{
                  fontSize: ds.fontSize(17),
                  color: colors.white,
                  fontWeight: '700',
                  marginLeft: ds.spacing(8),
                  opacity: ctaEnabled ? 1 : 0.92,
                }}
              >
                Confirm stock
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      <StationPickerBottomSheet
        visible={stationPickerVisible}
        options={filterOptions}
        selectedId={selectedAreaId}
        onSelect={handleSelectArea}
        onClose={handleCloseStationPicker}
      />

      {/*
        Single screen-level Set-Stock sheet. We pass the *entire* active item
        so re-mounts don't happen on every wheel tick. The sheet keeps its
        own transient state internally and only writes back via
        `onCommit`/`onDismiss`. When `activeItem` is null (no row is being
        edited) the sheet still exists in the tree but is dismissed — the
        ref-based imperative API keeps the component lifecycle stable
        regardless of `activeItemId`.
      */}
      <SetStockBottomSheet
        ref={sheetRef}
        item={activeItem}
        onCommit={handleCommitStock}
        onDismiss={handleDismissSheet}
      />
    </SafeAreaView>
    </BottomSheetModalProvider>
  );
}

const ItemSeparator = memo(function ItemSeparator() {
  return <View style={{ height: 10, backgroundColor: 'transparent' }} />;
});
