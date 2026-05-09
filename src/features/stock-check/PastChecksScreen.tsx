import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Platform,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
import {
  buildStationCardModel,
  StationCard,
  type StationCardModel,
  StationSeparator,
} from './components/StationCard';
import {
  computeAreaProgress,
  useStockCheckStore,
} from './useStockCheckStore';

function PastChecksScreenImpl() {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();

  const location = useAuthStore((state) => state.location);
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

  useEffect(() => {
    if (location?.id) {
      void loadLocation(location.id);
    }
  }, [loadLocation, location?.id]);

  const completedStationCards = useMemo(
    () =>
      areas
        .map((area) =>
          buildStationCardModel(
            area,
            computeAreaProgress(area, itemsById),
          ),
        )
        .filter((model) => model.statusLabel === 'DONE'),
    [areas, itemsById],
  );

  const handleBack = useCallback(() => {
    void triggerImpactHaptic(ImpactFeedbackStyle.Light);
    router.back();
  }, []);

  const handleRefresh = useCallback(async () => {
    if (!location?.id) return;
    setRefreshing(true);
    try {
      await loadLocation(location.id);
    } finally {
      setRefreshing(false);
    }
  }, [loadLocation, location?.id]);

  const handleOpenStation = useCallback((stationId: string) => {
    void triggerImpactHaptic(ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/(tabs)/stock-check-list',
      params: { stationId },
    } as never);
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

  const ListEmptyComponent = useMemo(
    () => (
      <View
        style={{
          paddingVertical: ds.spacing(44),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontSize: ds.fontSize(14),
            fontWeight: '700',
            color: glassColors.textSecondary,
            textAlign: 'center',
          }}
        >
          No completed checks yet.
        </Text>
      </View>
    ),
    [ds],
  );

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
            Choose a location to view completed checks.
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
          <LoadingIndicator showText text="Loading past checks..." />
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
            We could not load your completed checks.
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
        data={completedStationCards}
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
          <View style={{ paddingBottom: ds.spacing(16) }}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Back to stock check"
              onPress={handleBack}
              activeOpacity={0.75}
              hitSlop={8}
              style={{
                alignSelf: 'flex-start',
                flexDirection: 'row',
                alignItems: 'center',
                minHeight: 42,
                paddingRight: ds.spacing(12),
              }}
            >
              <Ionicons
                name="chevron-back"
                size={ds.icon(20)}
                color={glassColors.textPrimary}
              />
              <Text
                style={{
                  fontSize: ds.fontSize(14),
                  fontWeight: '800',
                  color: glassColors.textPrimary,
                }}
              >
                Back
              </Text>
            </TouchableOpacity>
            <Text
              style={{
                marginTop: ds.spacing(4),
                fontSize: ds.fontSize(34),
                fontWeight: '900',
                color: glassColors.textPrimary,
                letterSpacing: 0,
              }}
            >
              Past Checks
            </Text>
          </View>
        }
        ListEmptyComponent={ListEmptyComponent}
        ItemSeparatorComponent={StationSeparator}
        removeClippedSubviews={Platform.OS === 'android'}
        initialNumToRender={8}
        maxToRenderPerBatch={6}
        windowSize={7}
      />
    </SafeAreaView>
  );
}

export const PastChecksScreen = memo(PastChecksScreenImpl);
