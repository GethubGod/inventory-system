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
  Platform,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
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
import {
  glassColors,
  glassRadii,
  glassSpacing,
} from '@/theme/design';
import type { Location } from '@/types';
import { StockCheckHeader } from './components/StockCheckHeader';
import { StockCheckProgressBar } from './components/StockCheckProgressBar';
import { StockCheckItemCard } from './components/StockCheckItemCard';
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

interface StockCheckScreenViewProps {
  stationId?: string | string[];
}

export function StockCheckScreenView({ stationId }: StockCheckScreenViewProps) {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();
  const routeStationId = Array.isArray(stationId) ? stationId[0] : stationId;

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

  const [refreshing, setRefreshing] = useState(false);
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);

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

  /* ────────────── Derived selectors ─────────────────────────────────── */

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

  useEffect(() => {
    if (!routeStationId) return;
    if (!areas.some((area) => area.id === routeStationId)) return;
    if (selectedAreaId === routeStationId) return;
    handleSelectArea(routeStationId);
  }, [areas, handleSelectArea, routeStationId, selectedAreaId]);

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
      void triggerImpactHaptic(ImpactFeedbackStyle.Light);
    },
    [location?.id, setAuthLocation],
  );

  const handleContinueLater = useCallback(() => {
    void triggerImpactHaptic(ImpactFeedbackStyle.Light);
    router.replace('/(tabs)/stock-check' as any);
  }, []);

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

  /* ────────────── Scroll tracking ───────────────────────────────────── */

  const handleScrollBeginDrag = useCallback(() => {
    // Dismiss the location dropdown the instant the user begins scrolling the
    // list — feels natural and avoids leaving a stale floating menu over
    // content the user is now interacting with.
    if (locationDropdownOpen) {
      setLocationDropdownOpen(false);
    }
  }, [locationDropdownOpen]);

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

  // The route renders inside a hidden tab screen, so list content needs to
  // clear the tab bar directly now that the sticky confirm CTA is gone.
  const tabBarBottomInset = Math.max(
    insets.bottom,
    glassSpacing.tabBarBottom,
  );
  const actualTabBarHeight = 60 + tabBarBottomInset;
  const listPaddingBottom = actualTabBarHeight + ds.spacing(18);

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
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingBottom: ds.spacing(12),
            }}
          >
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Continue stock check later"
              onPress={handleContinueLater}
              activeOpacity={0.75}
              hitSlop={8}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: ds.spacing(6),
                paddingRight: ds.spacing(10),
              }}
            >
              <Ionicons
                name="chevron-back"
                size={ds.icon(18)}
                color={glassColors.textPrimary}
              />
              <Text
                style={{
                  fontSize: ds.fontSize(14),
                  fontWeight: '800',
                  color: glassColors.textPrimary,
                }}
              >
                Continue later
              </Text>
            </TouchableOpacity>

            <Text
              style={{
                flex: 1,
                textAlign: 'right',
                fontSize: ds.fontSize(15),
                fontWeight: '900',
                color: glassColors.textPrimary,
              }}
              numberOfLines={1}
            >
              {selectedArea?.name ?? 'Select station'}
            </Text>
          </View>
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
          onScrollBeginDrag={handleScrollBeginDrag}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={glassColors.accent}
            />
          }
          extraData={activeItemId}
        />
      </KeyboardAvoidingView>

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
