import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  FlatList,
  GestureResponderEvent,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useShallow } from 'zustand/react/shallow';
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
  BROWSE_INVENTORY_ROUTE,
  CATEGORY_ORDER,
  CATEGORY_SHORT_LABELS,
  createBrowseInventoryRouteParams,
} from '@/features/browse/config';
import { useEmployeeCartActions } from '@/hooks/useEmployeeCartActions';
import { useManagedRefresh } from '@/hooks/useManagedRefresh';
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
import { fetchActiveLocationReminder, type LocationReminderBanner } from '@/services/locationReminderService';
import {
  HomeModuleCard,
  HomeModuleLoading,
  HomeModuleState,
  HomeScreenScroll,
  HomeSearchCard,
} from './components/HomeScreenPrimitives';

type HomeInsightsStatus = 'idle' | 'loading' | 'ready' | 'error';

const HOME_INSIGHTS_TIMEOUT_MS = 8000;
const HOME_REMINDER_TIMEOUT_MS = 6000;

class HomeDataTimeoutError extends Error {
  label: string;

  constructor(label: string) {
    super(`${label} timed out`);
    this.name = 'HomeDataTimeoutError';
    this.label = label;
  }
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
    <GlassSurface
      intensity="subtle"
      style={{
        width: ds.spacing(168),
        borderRadius: glassRadii.surface,
      }}
    >
      <View style={{ padding: ds.spacing(14) }}>
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
        <AddButton
          onPress={() => onAdd(item)}
          style={{
            marginTop: ds.spacing(12),
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
    </GlassSurface>
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
          {CATEGORY_SHORT_LABELS[item.category]} · per {item.pack_unit}
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

export function EmployeeHomeScreen() {
  const ds = useScaledStyles();
  const [browseCategory, setBrowseCategory] = useState<ItemCategory | null>(null);
  const [orderInsightsStatus, setOrderInsightsStatus] =
    useState<HomeInsightsStatus>('idle');
  const [predictedItems, setPredictedItems] = useState<PredictedOrderItem[]>([]);
  const [reorderOrder, setReorderOrder] = useState<HistoricalOrderSummary | null>(null);
  const [activeReminder, setActiveReminder] = useState<LocationReminderBanner | null>(null);
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
      totalCartCount: state.getTotalCartCount('employee'),
    })),
  );
  const {
    addPredictedItem,
    reorderHistoricalOrder,
  } = useEmployeeCartActions();

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
    setPredictedItems([]);
    setReorderOrder(null);
    setActiveReminder(null);
    setOrderInsightsStatus(location?.id ? 'loading' : 'ready');
  }, [location?.id]);

  const loadHomeData = useCallback(async () => {
    const locationId = location?.id ?? null;
    if (!locationId) {
      setPredictedItems([]);
      setReorderOrder(null);
      setActiveReminder(null);
      setOrderInsightsStatus('ready');
      return;
    }

    setOrderInsightsStatus('loading');

    const [insightsResult, reminderResult] = await Promise.allSettled([
      withTimeout(
        fetchLocationOrderInsights(locationId),
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
      setOrderInsightsStatus('ready');
    } else if (isHomeDataTimeoutError(insightsResult.reason)) {
      setOrderInsightsStatus('ready');
    } else {
      console.error('Unable to load order insights', insightsResult.reason);
      setOrderInsightsStatus('error');
    }

    if (reminderResult.status === 'fulfilled') {
      setActiveReminder(reminderResult.value);
    } else if (isHomeDataTimeoutError(reminderResult.reason)) {
      // Keep the current banner state on transient timeouts.
    } else {
      console.error('Unable to load home reminder', reminderResult.reason);
      setActiveReminder(null);
    }
  }, [location?.id]);

  useFocusEffect(
    useCallback(() => {
      void loadHomeData();
    }, [loadHomeData]),
  );

  const { refreshing, onRefresh } = useManagedRefresh(
    useCallback(async () => {
      await Promise.allSettled([
        fetchItems({ force: true }),
        loadHomeData(),
      ]);
    }, [fetchItems, loadHomeData]),
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
  const hasQuickAction = Boolean(reorderOrder);
  const showSuggestedLoading =
    orderInsightsStatus === 'loading' && !hasSuggestedItems;
  const showQuickActionsLoading =
    orderInsightsStatus === 'loading' && !hasQuickAction;

  const homeDate = useMemo(() => new Date(), []);
  const greeting = getGreeting(homeDate);
  const browseSubtitle = `${items.length} items across ${CATEGORY_ORDER.length} categories`;
  const visibleCollapsedCategories = CATEGORY_ORDER.slice(0, 4);
  const moreCategoryCount = Math.max(CATEGORY_ORDER.length - visibleCollapsedCategories.length, 0);

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
      router.push({
        pathname: BROWSE_INVENTORY_ROUTE,
        params: createBrowseInventoryRouteParams({
          category: routeCategory,
          focusSearch,
          focusItemId: options.focusItemId,
          expandItem: options.expandItem,
          addItem: options.addItem,
          requestId: options.requestId,
        }),
      });
    },
    [browseCategory],
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

    router.push('/(tabs)/cart');
  }, [reorderHistoricalOrder, reorderOrder]);

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
          title={greeting}
          subtitle={formatHeaderDate(homeDate)}
          cartCount={totalCartCount}
          onPressCart={() => router.push('/(tabs)/cart')}
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
                    {activeReminder.senderName || `Updated ${formatReminderDate(activeReminder.createdAt)}`}
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
              {showSuggestedLoading ? (
                <HomeModuleLoading text="Loading suggestions..." />
              ) : hasSuggestedItems ? (
                <FlatList
                  data={predictedItems}
                  renderItem={renderSuggestedItem}
                  keyExtractor={(item) => `${item.inventoryItemId}:${item.unitType}`}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{
                    gap: ds.spacing(10),
                  }}
                />
              ) : orderInsightsStatus === 'error' ? (
                <HomeModuleState
                  icon="cloud-offline-outline"
                  title="Suggestions unavailable"
                  message="We couldn't load suggestions right now."
                  actionLabel="Retry"
                  onPressAction={() => {
                    void loadHomeData();
                  }}
                  tone="error"
                />
              ) : (
                <HomeModuleState
                  icon="sparkles-outline"
                  title={location?.id ? 'No suggestions yet' : 'Choose a location'}
                  message={
                    location?.id
                      ? 'Recent ordering patterns will show up here when they are available.'
                      : 'Select a location to see suggested items.'
                  }
                />
              )}
            </HomeModuleCard>
          </View>

          <View style={{ marginTop: ds.spacing(20) }}>
            <HomeModuleCard title="Quick Actions">
              {showQuickActionsLoading ? (
                <HomeModuleLoading text="Loading quick actions..." />
              ) : reorderOrder ? (
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
                    backgroundColor: glassColors.background,
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
              ) : orderInsightsStatus === 'error' ? (
                <HomeModuleState
                  icon="cloud-offline-outline"
                  title="Quick actions unavailable"
                  message="We couldn't load your latest shortcuts right now."
                  actionLabel="Retry"
                  onPressAction={() => {
                    void loadHomeData();
                  }}
                  tone="error"
                />
              ) : (
                <HomeModuleState
                  icon="flash-outline"
                  title={location?.id ? 'No quick actions yet' : 'Choose a location'}
                  message={
                    location?.id
                      ? 'Your latest reorder shortcuts will appear here once recent orders are available.'
                      : 'Select a location to see quick actions.'
                  }
                />
              )}
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
                          {CATEGORY_SHORT_LABELS[category]}
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
