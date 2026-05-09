import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  GestureResponderEvent,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useShallow } from 'zustand/react/shallow';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AddButton,
  GlassSurface,
  IdentityHeader,
  LoadingIndicator,
} from '@/components';
import { colors } from '@/constants';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
} from '@/theme/design';
import {
  CATEGORY_ORDER,
  getCategoryShortLabel,
  buildCategoryList,
} from '@/features/browse/config';
import { useManagedRefresh } from '@/hooks/useManagedRefresh';
import { useOrderingCartActions } from '@/hooks/useOrderingCartActions';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { useAuthStore, useInventoryStore, useOrderStore } from '@/store';
import type {
  InventoryItem,
  ItemCategory,
} from '@/types';
import {
  fetchLocationOrderInsights,
  formatOrderDayLabel,
  getItemSupplierLabel,
  summarizeOrderItems,
  type HistoricalOrderSummary,
  type PredictedOrderItem,
} from '@/features/ordering/orderInsights';
import {
  fetchActiveLocationReminder,
  type LocationReminderBanner,
} from '@/services/locationReminderService';
import {
  HomeModuleCard,
  HomeModuleState,
  HomeScreenScroll,
  HomeSearchCard,
} from './components/HomeScreenPrimitives';
import type { HomeScreenMode } from './modes';

const HOME_INSIGHTS_TIMEOUT_MS = 8000;
const HOME_REMINDER_TIMEOUT_MS = 6000;
const HOME_BACKGROUND_REFRESH_INTERVAL_MS = 60 * 1000;

// Stale-while-revalidate cache for Suggestions / Quick Actions / Reminders.
// Prevents the cards from flip-flopping between populated and empty states
// across component remounts (tab switches) and app restarts.
interface CachedHomeInsights {
  predictedItems: PredictedOrderItem[];
  reorderOrder: HistoricalOrderSummary | null;
  activeReminder: LocationReminderBanner | null;
  cachedAt: number;
}

const homeInsightsCache = new Map<string, CachedHomeInsights>();
const HOME_CACHE_STORAGE_KEY = 'home-insights-cache-v1';
const HOME_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function persistHomeInsightsCache(): void {
  const obj: Record<string, CachedHomeInsights> = {};
  homeInsightsCache.forEach((v, k) => {
    obj[k] = v;
  });
  void AsyncStorage.setItem(HOME_CACHE_STORAGE_KEY, JSON.stringify(obj)).catch(
    () => {},
  );
}

void (async () => {
  try {
    const raw = await AsyncStorage.getItem(HOME_CACHE_STORAGE_KEY);
    if (!raw) return;
    const entries = JSON.parse(raw) as Record<string, CachedHomeInsights>;
    const now = Date.now();
    for (const [id, entry] of Object.entries(entries)) {
      if (
        now - entry.cachedAt < HOME_CACHE_MAX_AGE_MS &&
        !homeInsightsCache.has(id)
      ) {
        homeInsightsCache.set(id, entry);
      }
    }
  } catch {
    // Ignore cache hydration errors
  }
})();

class HomeDataTimeoutError extends Error {
  label: string;

  constructor(label: string) {
    super(`${label} timed out`);
    this.name = 'HomeDataTimeoutError';
    this.label = label;
  }
}

interface HomeScreenViewProps {
  mode: HomeScreenMode;
}

interface LoadHomeDataOptions {
  background?: boolean;
}

interface SuggestedItemCardProps {
  item: PredictedOrderItem;
  onAdd: (item: PredictedOrderItem) => void;
}

const SuggestedItemCard = memo(function SuggestedItemCard({
  item,
  onAdd,
}: SuggestedItemCardProps) {
  const ds = useScaledStyles();

  return (
    <View
      style={{
        width: ds.spacing(168),
        minHeight: ds.spacing(148),
        borderRadius: glassRadii.surface,
        backgroundColor: colors.gray[100],
        borderWidth: glassHairlineWidth,
        borderColor: glassColors.cardBorder,
        overflow: 'hidden',
      }}
    >
      <View style={{ padding: ds.spacing(14), flex: 1, flexDirection: 'column' }}>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: ds.fontSize(15),
              fontWeight: '600',
              color: glassColors.textPrimary,
            }}
            numberOfLines={2}
          >
            {item.name}
          </Text>
          <Text
            style={{
              marginTop: ds.spacing(4),
              fontSize: ds.fontSize(12),
              color: glassColors.textSecondary,
            }}
            numberOfLines={1}
          >
            {item.quantity} {item.unitType === 'base' ? item.baseUnit : item.packUnit}
            {' · '}
            {getItemSupplierLabel(item)}
          </Text>
        </View>
        <AddButton
          onPress={() => onAdd(item)}
          style={{
            marginTop: 'auto',
            minHeight: Math.max(38, ds.buttonH - ds.spacing(8)),
            borderRadius: glassRadii.button,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: glassColors.accent,
          }}
          textStyle={{
            fontSize: ds.fontSize(13),
          }}
        />
      </View>
    </View>
  );
});

interface BrowsePreviewRowProps {
  item: InventoryItem;
  onAdd: (item: InventoryItem) => void;
}

const BrowsePreviewRow = memo(function BrowsePreviewRow({
  item,
  onAdd,
}: BrowsePreviewRowProps) {
  const ds = useScaledStyles();

  return (
    <View
      style={{
        backgroundColor: glassColors.background,
        borderWidth: glassHairlineWidth,
        borderColor: glassColors.cardBorder,
        borderRadius: glassRadii.button,
        paddingHorizontal: ds.spacing(12),
        paddingVertical: ds.spacing(10),
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <View style={{ flex: 1, paddingRight: ds.spacing(10) }}>
        <Text
          style={{
            fontSize: ds.fontSize(14),
            fontWeight: '600',
            color: glassColors.textPrimary,
          }}
          numberOfLines={1}
        >
          {item.name}
        </Text>
        <Text
          style={{
            marginTop: ds.spacing(2),
            fontSize: ds.fontSize(12),
            color: glassColors.textSecondary,
          }}
          numberOfLines={1}
        >
          {getCategoryShortLabel(item.category)} · per {item.pack_unit}
        </Text>
      </View>
      <AddButton
        onPress={() => onAdd(item)}
        style={{
          minHeight: Math.max(36, ds.buttonH - ds.spacing(10)),
          minWidth: ds.spacing(68),
          borderRadius: glassRadii.pill,
          backgroundColor: glassColors.accent,
          paddingHorizontal: ds.spacing(14),
          alignItems: 'center',
          justifyContent: 'center',
        }}
        textStyle={{
          fontSize: ds.fontSize(12),
        }}
      />
    </View>
  );
});

function getGreeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) {
    return 'Good morning';
  }
  if (hour < 18) {
    return 'Good afternoon';
  }
  return 'Good evening';
}

function formatHeaderDate(now: Date): string {
  return now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function formatReminderDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function createBrowseFocusRequestId(itemId: string): string {
  return `${itemId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new HomeDataTimeoutError(label));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function isHomeDataTimeoutError(error: unknown): error is HomeDataTimeoutError {
  return error instanceof HomeDataTimeoutError;
}

export function HomeScreenView({ mode }: HomeScreenViewProps) {
  const ds = useScaledStyles();
  const [browseCategory, setBrowseCategory] = useState<ItemCategory | null>(null);
  const [predictedItems, setPredictedItems] = useState<PredictedOrderItem[]>(
    () => {
      const locId = useAuthStore.getState().location?.id;
      return locId
        ? (homeInsightsCache.get(locId)?.predictedItems ?? [])
        : [];
    },
  );
  const [reorderOrder, setReorderOrder] =
    useState<HistoricalOrderSummary | null>(() => {
      const locId = useAuthStore.getState().location?.id;
      return locId
        ? (homeInsightsCache.get(locId)?.reorderOrder ?? null)
        : null;
    });
  const [activeReminder, setActiveReminder] =
    useState<LocationReminderBanner | null>(() => {
      const locId = useAuthStore.getState().location?.id;
      return locId
        ? (homeInsightsCache.get(locId)?.activeReminder ?? null)
        : null;
    });
  const hasLoadedHomeDataRef = useRef(
    (() => {
      const locId = useAuthStore.getState().location?.id;
      return !!(locId && homeInsightsCache.has(locId));
    })(),
  );
  const homeDataRefreshPromiseRef = useRef<Promise<void> | null>(null);
  const queuedHomeDataRefreshRef = useRef(false);
  const {
    location,
    locations,
    setLocation,
    fetchLocations,
  } = useAuthStore(
    useShallow((state) => ({
      location: state.location,
      locations: state.locations,
      setLocation: state.setLocation,
      fetchLocations: state.fetchLocations,
    })),
  );
  const {
    items,
    isLoading: itemsLoading,
    fetchItems,
  } = useInventoryStore(
    useShallow((state) => ({
      items: state.items,
      isLoading: state.isLoading,
      fetchItems: state.fetchItems,
    })),
  );
  const {
    totalCartCount,
  } = useOrderStore(
    useShallow((state) => ({
      totalCartCount: state.getTotalCartCount(mode.scope),
    })),
  );
  const {
    addPredictedItem,
    reorderHistoricalOrder,
  } = useOrderingCartActions(mode.scope);

  useEffect(() => {
    void fetchItems();
    void fetchLocations();
  }, [fetchItems, fetchLocations]);

  useEffect(() => {
    if (locations.length > 0 && !location) {
      setLocation(locations[0]);
    }
  }, [location, locations, setLocation]);

  useEffect(() => {
    queuedHomeDataRefreshRef.current = false;

    const cached = location?.id
      ? homeInsightsCache.get(location.id)
      : undefined;
    if (cached) {
      setPredictedItems(cached.predictedItems);
      setReorderOrder(cached.reorderOrder);
      setActiveReminder(cached.activeReminder);
      hasLoadedHomeDataRef.current = true;
    } else {
      hasLoadedHomeDataRef.current = false;
      setPredictedItems([]);
      setReorderOrder(null);
      setActiveReminder(null);
    }
  }, [location?.id]);

  const runHomeDataLoad = useCallback(async (background = false) => {
    const authState = useAuthStore.getState();
    const locationId = authState.location?.id ?? null;
    const userId = authState.session?.user?.id ?? null;
    if (!locationId) {
      hasLoadedHomeDataRef.current = false;
      setPredictedItems([]);
      setReorderOrder(null);
      setActiveReminder(null);
      return;
    }

    const shouldPreserveCurrentState =
      background || hasLoadedHomeDataRef.current;

    const [insightsResult, reminderResult] = await Promise.allSettled([
      withTimeout(
        fetchLocationOrderInsights(locationId, 12, userId),
        HOME_INSIGHTS_TIMEOUT_MS,
        'Home insights',
      ),
      withTimeout(
        fetchActiveLocationReminder(locationId),
        HOME_REMINDER_TIMEOUT_MS,
        'Home reminder',
      ),
    ]);

    if (useAuthStore.getState().location?.id !== locationId) {
      return;
    }

    if (insightsResult.status === 'fulfilled') {
      setPredictedItems(insightsResult.value.predictedItems);
      setReorderOrder(insightsResult.value.reorderOrder);
    } else if (isHomeDataTimeoutError(insightsResult.reason)) {
      // Keep the current empty or populated card state on transient timeouts.
    } else {
      console.error('Unable to load order insights', insightsResult.reason);
    }

    if (reminderResult.status === 'fulfilled') {
      setActiveReminder(reminderResult.value);
    } else if (isHomeDataTimeoutError(reminderResult.reason)) {
      // Keep the current banner state on transient timeouts.
    } else {
      console.error('Unable to load home reminder', reminderResult.reason);
      if (!shouldPreserveCurrentState) {
        setActiveReminder(null);
      }
    }

    hasLoadedHomeDataRef.current = true;

    if (
      insightsResult.status === 'fulfilled' ||
      reminderResult.status === 'fulfilled'
    ) {
      const prev = homeInsightsCache.get(locationId);
      homeInsightsCache.set(locationId, {
        predictedItems:
          insightsResult.status === 'fulfilled'
            ? insightsResult.value.predictedItems
            : (prev?.predictedItems ?? []),
        reorderOrder:
          insightsResult.status === 'fulfilled'
            ? insightsResult.value.reorderOrder
            : (prev?.reorderOrder ?? null),
        activeReminder:
          reminderResult.status === 'fulfilled'
            ? reminderResult.value
            : (prev?.activeReminder ?? null),
        cachedAt: Date.now(),
      });
      persistHomeInsightsCache();
    }
  }, []);

  const loadHomeData = useCallback(
    async ({ background = false }: LoadHomeDataOptions = {}) => {
      if (homeDataRefreshPromiseRef.current) {
        queuedHomeDataRefreshRef.current = true;
        await homeDataRefreshPromiseRef.current;
        return;
      }

      const refreshPromise = (async () => {
        await runHomeDataLoad(background);

        while (queuedHomeDataRefreshRef.current) {
          queuedHomeDataRefreshRef.current = false;
          await runHomeDataLoad(true);
        }
      })().finally(() => {
        homeDataRefreshPromiseRef.current = null;
      });

      homeDataRefreshPromiseRef.current = refreshPromise;
      await refreshPromise;
    },
    [runHomeDataLoad],
  );

  const { refreshing, onRefresh } = useManagedRefresh(
    useCallback(async () => {
      await Promise.allSettled([
        fetchItems({ force: true }),
        loadHomeData(),
      ]);
    }, [fetchItems, loadHomeData]),
  );

  useFocusEffect(
    useCallback(() => {
      void loadHomeData({
        background: hasLoadedHomeDataRef.current,
      });

      const intervalId = setInterval(() => {
        void loadHomeData({ background: true });
      }, HOME_BACKGROUND_REFRESH_INTERVAL_MS);

      return () => {
        clearInterval(intervalId);
      };
    }, [loadHomeData]),
  );

  const allItemsSorted = useMemo(
    () => [...items].sort((left, right) => left.name.localeCompare(right.name)),
    [items],
  );

  const filteredPreviewBrowseItems = useMemo(
    () =>
      allItemsSorted.filter((item) =>
        !browseCategory || item.category === browseCategory,
      ),
    [allItemsSorted, browseCategory],
  );

  const previewItems = useMemo(
    () => filteredPreviewBrowseItems.slice(0, 2),
    [filteredPreviewBrowseItems],
  );
  const hasSuggestedItems = predictedItems.length > 0;

  const homeDate = useMemo(() => new Date(), []);
  const greeting = getGreeting(homeDate);
  const browseSubtitle = `${items.length} items across ${CATEGORY_ORDER.length} categories`;
  const visibleCollapsedCategories = CATEGORY_ORDER.slice(0, 4);
  const moreCategoryCount = Math.max(
    CATEGORY_ORDER.length - visibleCollapsedCategories.length,
    0,
  );

  const openBrowse = useCallback(
    (
      nextCategory: ItemCategory | null = browseCategory,
      focusSearch = false,
      options: {
        routeCategory?: ItemCategory | null;
        homeCategory?: ItemCategory | null;
        focusItemId?: string | null;
        expandItem?: boolean;
        addItem?: boolean;
        requestId?: string | null;
      } = {},
    ) => {
      const homeCategory = options.homeCategory ?? nextCategory;
      const routeCategory = options.routeCategory ?? nextCategory;

      setBrowseCategory(homeCategory);
      router.push(
        mode.buildBrowseHref({
          category: routeCategory,
          focusSearch,
          focusItemId: options.focusItemId,
          expandItem: options.expandItem,
          addItem: options.addItem,
          requestId: options.requestId,
        }) as any,
      );
    },
    [browseCategory, mode],
  );

  const handleBrowseCardPress = useCallback(() => {
    openBrowse(browseCategory, false);
  }, [browseCategory, openBrowse]);

  const handleBrowseCardActionPress = useCallback(
    (onPress: () => void) => (event: GestureResponderEvent) => {
      event.stopPropagation?.();
      onPress();
    },
    [],
  );

  const handlePreviewAdd = useCallback(
    (item: InventoryItem) => {
      openBrowse(browseCategory, false, {
        routeCategory: item.category,
        homeCategory: browseCategory,
        focusItemId: item.id,
        expandItem: true,
        addItem: true,
        requestId: createBrowseFocusRequestId(item.id),
      });
    },
    [browseCategory, openBrowse],
  );

  const handleAddAllPredicted = useCallback(() => {
    predictedItems.forEach((item) => {
      addPredictedItem(item);
    });
  }, [addPredictedItem, predictedItems]);

  const handleQuickActionPress = useCallback(() => {
    if (!reorderOrder) {
      return;
    }

    const didReorder = reorderHistoricalOrder(reorderOrder);
    if (!didReorder) {
      return;
    }

    router.push(mode.cartRoute as any);
  }, [mode.cartRoute, reorderHistoricalOrder, reorderOrder]);

  const handleStockCheckPress = useCallback(() => {
    router.push('/(tabs)/stock-check' as any);
  }, []);

  const renderSuggestedItem = useCallback(
    ({ item }: { item: PredictedOrderItem }) => (
      <SuggestedItemCard item={item} onAdd={addPredictedItem} />
    ),
    [addPredictedItem],
  );

  if (itemsLoading && items.length === 0) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: glassColors.background }}
        edges={['top', 'left', 'right']}
      >
        <View className="flex-1 items-center justify-center">
          <LoadingIndicator showText text="Loading home..." />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <HomeScreenScroll
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={glassColors.accent}
        />
      }
    >
      <IdentityHeader
        identity={mode.identity}
        title={greeting}
        subtitle={formatHeaderDate(homeDate)}
        cartCount={totalCartCount}
        onPressCart={() => router.push(mode.cartRoute as any)}
      />

      {activeReminder ? (
        <GlassSurface
          intensity="medium"
          style={{
            borderRadius: glassRadii.surface,
            paddingHorizontal: ds.spacing(14),
            paddingVertical: ds.spacing(12),
            marginBottom: ds.spacing(14),
            backgroundColor: colors.primary[50],
            borderColor: colors.primary[100],
            borderWidth: 1,
          }}
        >
          <View className="flex-row items-start">
            <View
              style={{
                width: ds.icon(34),
                height: ds.icon(34),
                borderRadius: glassRadii.iconTile,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: glassColors.accentSoft,
                marginRight: ds.spacing(12),
              }}
            >
              <Ionicons
                name="notifications-outline"
                size={ds.icon(18)}
                color={glassColors.accent}
              />
            </View>
            <View style={{ flex: 1 }}>
              <View className="flex-row items-center justify-between">
                <Text
                  style={{
                    fontSize: ds.fontSize(12),
                    fontWeight: '600',
                    color: glassColors.accent,
                    textTransform: 'uppercase',
                    letterSpacing: 0.8,
                  }}
                >
                  Order reminder
                </Text>
                <Text
                  style={{
                    fontSize: ds.fontSize(11),
                    color: glassColors.textSecondary,
                  }}
                >
                  {activeReminder.senderName ||
                    `Updated ${formatReminderDate(activeReminder.createdAt)}`}
                </Text>
              </View>
              <Text
                style={{
                  marginTop: ds.spacing(6),
                  fontSize: ds.fontSize(14),
                  color: glassColors.textPrimary,
                  lineHeight: ds.fontSize(20),
                }}
              >
                {activeReminder.message}
              </Text>
            </View>
          </View>
        </GlassSurface>
      ) : null}

      <HomeSearchCard
        placeholder={`Search all ${items.length} items...`}
        onPress={() => openBrowse(browseCategory, true)}
        accessibilityLabel="Search inventory"
      />

      <View style={{ marginTop: ds.spacing(20) }}>
        <HomeModuleCard
          title="Suggestions"
          actionLabel={predictedItems.length > 0 ? 'Add all' : undefined}
          onPressAction={predictedItems.length > 0 ? handleAddAllPredicted : undefined}
        >
          {hasSuggestedItems ? (
            <FlashList
              data={predictedItems}
              renderItem={renderSuggestedItem}
              keyExtractor={(item) => `${item.inventoryItemId}:${item.unitType}`}
              horizontal
              showsHorizontalScrollIndicator={false}
              ItemSeparatorComponent={() => <View style={{ width: ds.spacing(10) }} />}
              contentContainerStyle={{
                paddingRight: ds.spacing(10),
              }}
            />
          ) : (
            <HomeModuleState
              icon="sparkles-outline"
              title={location?.id ? 'Collecting more data' : 'Choose a location'}
              message={
                location?.id
                  ? 'Suggestions will appear here as you place more orders.'
                  : 'Select a location to see suggested items.'
              }
            />
          )}
        </HomeModuleCard>
      </View>

      <View style={{ marginTop: ds.spacing(20) }}>
        <HomeModuleCard title="Quick Actions">
          <View style={{ gap: ds.spacing(10) }}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Perform stock check"
              accessibilityHint="Opens the stock check screen to count inventory and build an order"
              onPress={handleStockCheckPress}
              className="flex-row items-center"
              style={{
                paddingHorizontal: ds.spacing(14),
                paddingVertical: ds.spacing(14),
                borderRadius: glassRadii.surface,
                backgroundColor: colors.gray[100],
                borderWidth: glassHairlineWidth,
                borderColor: glassColors.cardBorder,
              }}
              activeOpacity={0.85}
            >
              <View
                style={{
                  width: ds.icon(36),
                  height: ds.icon(36),
                  borderRadius: glassRadii.iconTile,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: glassColors.accentSoft,
                  marginRight: ds.spacing(12),
                }}
              >
                <Ionicons
                  name="clipboard-outline"
                  size={ds.icon(18)}
                  color={glassColors.accent}
                />
              </View>
              <View style={{ flex: 1, paddingRight: ds.spacing(10) }}>
                <Text
                  style={{
                    fontSize: ds.fontSize(15),
                    fontWeight: '600',
                    color: glassColors.textPrimary,
                  }}
                >
                  Perform Stock Check
                </Text>
                <Text
                  style={{
                    marginTop: ds.spacing(4),
                    fontSize: ds.fontSize(12),
                    color: glassColors.textSecondary,
                  }}
                  numberOfLines={1}
                >
                  Walk your storage areas and build an order
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={ds.icon(18)}
                color={glassColors.textSecondary}
              />
            </TouchableOpacity>

            {reorderOrder ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Reorder last ${formatOrderDayLabel(reorderOrder.createdAt)}`}
                accessibilityHint="Adds the recommended reorder items to your cart and opens the cart"
                onPress={handleQuickActionPress}
                className="flex-row items-center"
                style={{
                  paddingHorizontal: ds.spacing(14),
                  paddingVertical: ds.spacing(14),
                  borderRadius: glassRadii.surface,
                  backgroundColor: colors.gray[100],
                  borderWidth: glassHairlineWidth,
                  borderColor: glassColors.cardBorder,
                }}
                activeOpacity={0.85}
              >
                <View
                  style={{
                    width: ds.icon(36),
                    height: ds.icon(36),
                    borderRadius: glassRadii.iconTile,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: glassColors.accentSoft,
                    marginRight: ds.spacing(12),
                  }}
                >
                  <Ionicons
                    name="star-outline"
                    size={ds.icon(18)}
                    color={glassColors.accent}
                  />
                </View>
                <View style={{ flex: 1, paddingRight: ds.spacing(10) }}>
                  <Text
                    style={{
                      fontSize: ds.fontSize(15),
                      fontWeight: '600',
                      color: glassColors.textPrimary,
                    }}
                  >
                    Reorder last {formatOrderDayLabel(reorderOrder.createdAt)}
                  </Text>
                  <Text
                    style={{
                      marginTop: ds.spacing(4),
                      fontSize: ds.fontSize(12),
                      color: glassColors.textSecondary,
                    }}
                    numberOfLines={1}
                  >
                    {reorderOrder.itemCount} items · {summarizeOrderItems(reorderOrder)}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={ds.icon(18)}
                  color={glassColors.textSecondary}
                />
              </TouchableOpacity>
            ) : null}
          </View>
        </HomeModuleCard>
      </View>

      <View style={{ marginTop: ds.spacing(20) }}>
        <GlassSurface
          intensity="subtle"
          style={{ borderRadius: glassRadii.surface }}
        >
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Browse inventory"
            accessibilityHint="Opens the full inventory browse screen"
            onPress={handleBrowseCardPress}
            activeOpacity={0.94}
            style={{
              borderRadius: glassRadii.surface,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                paddingHorizontal: ds.spacing(14),
                paddingTop: ds.spacing(14),
                paddingBottom: ds.spacing(12),
              }}
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center flex-1">
                  <View
                    style={{
                      width: ds.icon(40),
                      height: ds.icon(40),
                      borderRadius: glassRadii.iconTile,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: colors.gray[100],
                      marginRight: ds.spacing(12),
                      borderWidth: glassHairlineWidth,
                      borderColor: 'rgba(28, 28, 30, 0.08)',
                    }}
                  >
                    <Ionicons
                      name="grid-outline"
                      size={ds.icon(20)}
                      color={glassColors.textPrimary}
                    />
                  </View>
                  <View style={{ flex: 1, paddingRight: ds.spacing(10) }}>
                    <Text
                      style={{
                        fontSize: ds.fontSize(19),
                        fontWeight: '700',
                        color: glassColors.textPrimary,
                        letterSpacing: -0.25,
                      }}
                    >
                      Browse Inventory
                    </Text>
                    <Text
                      style={{
                        marginTop: ds.spacing(4),
                        fontSize: ds.fontSize(13),
                        color: glassColors.textSecondary,
                      }}
                    >
                      {browseSubtitle}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={handleBrowseCardActionPress(() => openBrowse(browseCategory, false))}
                  activeOpacity={0.88}
                  style={{
                    minHeight: Math.max(42, ds.buttonH),
                    paddingHorizontal: ds.spacing(15),
                    paddingVertical: ds.spacing(10),
                    borderRadius: glassRadii.pill,
                    backgroundColor: glassColors.accent,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    shadowColor: 'rgba(15, 23, 42, 0.22)',
                    shadowOpacity: 0.12,
                    shadowRadius: 12,
                    shadowOffset: { width: 0, height: 6 },
                    elevation: 2,
                  }}
                >
                  <Text
                    style={{
                      fontSize: ds.fontSize(14),
                      fontWeight: '700',
                      color: glassColors.textOnPrimary,
                    }}
                  >
                    Open
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={ds.icon(16)}
                    color={glassColors.textOnPrimary}
                    style={{ marginLeft: ds.spacing(4) }}
                  />
                </TouchableOpacity>
              </View>
            </View>

            <View
              style={{
                marginHorizontal: ds.spacing(14),
                borderTopWidth: glassHairlineWidth,
                borderTopColor: glassColors.divider,
              }}
            />

            <View
              style={{
                paddingHorizontal: ds.spacing(14),
                paddingTop: ds.spacing(12),
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: ds.spacing(8),
              }}
            >
              <TouchableOpacity
                onPress={handleBrowseCardActionPress(() => openBrowse(null, false))}
                style={{
                  paddingHorizontal: ds.spacing(16),
                  paddingVertical: ds.spacing(9),
                  borderRadius: glassRadii.pill,
                  backgroundColor:
                    browseCategory === null
                      ? colors.gray[200]
                      : colors.gray[100],
                  borderWidth: glassHairlineWidth,
                  borderColor:
                    browseCategory === null
                      ? 'rgba(28, 28, 30, 0.18)'
                      : glassColors.cardBorder,
                }}
              >
                <Text
                  style={{
                    fontSize: ds.fontSize(13),
                    fontWeight: browseCategory === null ? '700' : '600',
                    color: glassColors.textPrimary,
                  }}
                >
                  All
                </Text>
              </TouchableOpacity>
              {visibleCollapsedCategories.map((category) => {
                const isSelected = browseCategory === category;
                return (
                  <TouchableOpacity
                    key={category}
                    onPress={handleBrowseCardActionPress(() => openBrowse(category, false))}
                    style={{
                      paddingHorizontal: ds.spacing(16),
                      paddingVertical: ds.spacing(9),
                      borderRadius: glassRadii.pill,
                      backgroundColor: isSelected
                        ? colors.gray[200]
                        : colors.gray[100],
                      borderWidth: glassHairlineWidth,
                      borderColor: isSelected
                        ? 'rgba(28, 28, 30, 0.18)'
                        : glassColors.cardBorder,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: ds.fontSize(13),
                        fontWeight: isSelected ? '700' : '600',
                        color: glassColors.textPrimary,
                      }}
                    >
                      {getCategoryShortLabel(category)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {moreCategoryCount > 0 ? (
                <TouchableOpacity
                  onPress={handleBrowseCardActionPress(() => openBrowse(null, false))}
                  style={{
                    paddingHorizontal: ds.spacing(16),
                    paddingVertical: ds.spacing(9),
                    borderRadius: glassRadii.pill,
                    backgroundColor: colors.gray[100],
                    borderWidth: glassHairlineWidth,
                    borderColor: glassColors.cardBorder,
                  }}
                >
                  <Text
                    style={{
                      fontSize: ds.fontSize(13),
                      fontWeight: '600',
                      color: glassColors.textPrimary,
                    }}
                  >
                    +{moreCategoryCount} more
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <View
              style={{
                paddingHorizontal: ds.spacing(14),
                paddingTop: ds.spacing(12),
                gap: ds.spacing(8),
              }}
            >
              {previewItems.map((item) => (
                <BrowsePreviewRow
                  key={item.id}
                  item={item}
                  onAdd={handlePreviewAdd}
                />
              ))}
            </View>

            <View
              style={{
                alignItems: 'center',
                paddingTop: ds.spacing(12),
                paddingBottom: ds.spacing(14),
              }}
            >
              <Text
                style={{
                  fontSize: ds.fontSize(12),
                  color: glassColors.textSecondary,
                }}
              >
                Showing {previewItems.length} of {filteredPreviewBrowseItems.length}{' '}
                <Text
                  style={{
                    color: glassColors.accent,
                    fontWeight: '600',
                  }}
                >
                  View all
                </Text>
              </Text>
            </View>
          </TouchableOpacity>
        </GlassSurface>
      </View>
    </HomeScreenScroll>
  );
}
