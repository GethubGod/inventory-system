import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Platform,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { LoadingIndicator } from '@/components';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  ImpactFeedbackStyle,
  triggerImpactHaptic,
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
import {
  buildStationCardModel,
  StationCard,
  type StationCardModel,
  StationSeparator,
} from './components/StationCard';
import {
  computeAreaProgress,
  computeOverallProgress,
  useStockCheckStore,
} from './useStockCheckStore';

function StockHomeScreenImpl() {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();

  const location = useAuthStore((state) => state.location);
  const allLocations = useAuthStore((state) => state.locations);
  const setAuthLocation = useAuthStore((state) => state.setLocation);

  const loadLocation = useStockCheckStore((s) => s.loadLocation);
  const {
    areas,
    itemsById,
    isLoading,
    loadError,
  } = useStockCheckStore(
    useShallow((s) => ({
      areas: s.areas,
      itemsById: s.itemsById,
      isLoading: s.isLoading,
      loadError: s.loadError,
    })),
  );

  const [refreshing, setRefreshing] = useState(false);
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);

  useEffect(() => {
    if (location?.id) {
      void loadLocation(location.id);
    }
  }, [loadLocation, location?.id]);

  const overallProgress = useMemo(
    () => computeOverallProgress(areas, itemsById),
    [areas, itemsById],
  );

  const stationCards = useMemo(
    () =>
      areas
        .map((area) =>
          buildStationCardModel(
            area,
            computeAreaProgress(area, itemsById),
          ),
        )
        .filter((model) => model.statusLabel !== 'DONE'),
    [areas, itemsById],
  );

  const handleRefresh = useCallback(async () => {
    if (!location?.id) return;
    setRefreshing(true);
    try {
      await loadLocation(location.id);
    } finally {
      setRefreshing(false);
    }
  }, [loadLocation, location?.id]);

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
      void triggerImpactHaptic(ImpactFeedbackStyle.Light);
    },
    [location?.id, setAuthLocation],
  );

  const handleOpenStation = useCallback((stationId: string) => {
    void triggerImpactHaptic(ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/(tabs)/stock-check-list',
      params: { stationId },
    } as never);
  }, []);

  const handleOpenPastChecks = useCallback(() => {
    void triggerImpactHaptic(ImpactFeedbackStyle.Light);
    router.push('/(tabs)/past-checks' as never);
  }, []);

  const renderStation = useCallback(
    ({ item }: { item: StationCardModel }) => (
      <StationCard model={item} onPress={handleOpenStation} />
    ),
    [handleOpenStation],
  );

  const keyExtractor = useCallback(
    (item: StationCardModel) => item.area.id,
    [],
  );

  const tabBarBottomInset = Math.max(
    insets.bottom,
    glassSpacing.tabBarBottom,
  );
  const actualTabBarHeight = 60 + tabBarBottomInset;

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
              fontWeight: '700',
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
            onPress={() => void loadLocation(location.id)}
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

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: glassColors.background }}
      edges={['top', 'left', 'right']}
    >
      <FlatList
        data={stationCards}
        keyExtractor={keyExtractor}
        renderItem={renderStation}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={glassColors.accent}
          />
        }
        contentContainerStyle={{
          paddingHorizontal: glassSpacing.screen,
          paddingTop: ds.spacing(4),
          paddingBottom: actualTabBarHeight + ds.spacing(24),
        }}
        ListHeaderComponent={
          <View style={{ zIndex: 10 }}>
            <StockCheckHeader
              locationLabel={location.name}
              locations={allLocations}
              selectedLocationId={location.id}
              isDropdownOpen={locationDropdownOpen}
              onToggleDropdown={handleToggleLocationDropdown}
              onSelectLocation={handleSelectLocation}
              onCloseDropdown={handleCloseLocationDropdown}
              onPressMore={handleOpenPastChecks}
              moreAccessibilityLabel="View past checks"
              moreIconName="time-outline"
            />
            <StockCheckProgressBar
              totalItems={overallProgress.totalItems}
              checkedItems={overallProgress.checkedItems}
              itemsToOrder={overallProgress.itemsToOrder}
              labelMode="uncheckedRemaining"
            />
          </View>
        }
        ItemSeparatorComponent={StationSeparator}
        removeClippedSubviews={Platform.OS === 'android'}
        initialNumToRender={8}
        maxToRenderPerBatch={6}
        windowSize={7}
      />
    </SafeAreaView>
  );
}

export const StockHomeScreen = memo(StockHomeScreenImpl);
