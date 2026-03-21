import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  FlatList,
  RefreshControl,
  ScrollView,
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
  EmptyStateCard,
  GlassSurface,
  IdentityHeader,
  LoadingIndicator,
  SectionHeader,
} from '@/components';
import { colors } from '@/constants';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassSpacing,
  glassTabBarHeight,
} from '@/design/tokens';
import { BROWSE_INVENTORY_ROUTE, CATEGORY_ORDER, CATEGORY_SHORT_LABELS } from '@/features/browse/config';
import { useEmployeeCartActions } from '@/hooks/useEmployeeCartActions';
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

export function EmployeeHomeScreen() {
  const ds = useScaledStyles();
  const [refreshing, setRefreshing] = useState(false);
  const [browseCategory, setBrowseCategory] = useState<ItemCategory | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(true);
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
    addInventoryItem,
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

  const loadHomeData = useCallback(async () => {
    if (!location?.id) {
      setPredictedItems([]);
      setReorderOrder(null);
      setActiveReminder(null);
      setInsightsLoading(false);
      return;
    }

    setInsightsLoading(true);
    try {
      const [insights, reminder] = await Promise.all([
        fetchLocationOrderInsights(location.id),
        fetchActiveLocationReminder(location.id),
      ]);
      setPredictedItems(insights.predictedItems);
      setReorderOrder(insights.reorderOrder);
      setActiveReminder(reminder);
    } catch (error) {
      console.error('Unable to load home insights', error);
      setPredictedItems([]);
      setReorderOrder(null);
      setActiveReminder(null);
    } finally {
      setInsightsLoading(false);
    }
  }, [location?.id]);

  useFocusEffect(
    useCallback(() => {
      void loadHomeData();
    }, [loadHomeData]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchItems({ force: true });
    await loadHomeData();
    setRefreshing(false);
  }, [fetchItems, loadHomeData]);

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

  const homeDate = useMemo(() => new Date(), []);
  const greeting = getGreeting(homeDate);
  const browseSubtitle = `${items.length} items across ${CATEGORY_ORDER.length} categories`;
  const visibleCollapsedCategories = CATEGORY_ORDER.slice(0, 4);
  const moreCategoryCount = Math.max(CATEGORY_ORDER.length - visibleCollapsedCategories.length, 0);

  const openBrowse = useCallback(
    (nextCategory: ItemCategory | null = browseCategory, focusSearch = false) => {
      setBrowseCategory(nextCategory);
      router.push({
        pathname: BROWSE_INVENTORY_ROUTE,
        params: {
          ...(nextCategory ? { category: nextCategory } : {}),
          ...(focusSearch ? { focusSearch: '1' } : {}),
        },
      });
    },
    [browseCategory],
  );

  const handleAddAllPredicted = useCallback(() => {
    predictedItems.forEach((item) => {
      addPredictedItem(item);
    });
  }, [addPredictedItem, predictedItems]);

  const renderSuggestedItem = useCallback(
    ({ item }: { item: PredictedOrderItem }) => (
      <SuggestedItemCard item={item} onAdd={addPredictedItem} />
    ),
    [addPredictedItem],
  );

  if ((itemsLoading && items.length === 0) || (insightsLoading && !location)) {
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
    <SafeAreaView
      style={{ flex: 1, backgroundColor: glassColors.background }}
      edges={['top', 'left', 'right']}
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: glassSpacing.screen,
          paddingBottom: glassTabBarHeight + ds.spacing(24),
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={glassColors.accent}
          />
        }
        keyboardShouldPersistTaps="handled"
      >
        <IdentityHeader
          title={greeting}
          subtitle={formatHeaderDate(homeDate)}
          cartCount={totalCartCount}
          onPressCart={() => router.push('/cart')}
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

          <TouchableOpacity
            onPress={() => openBrowse(browseCategory, true)}
            activeOpacity={0.85}
          >
            <GlassSurface
              intensity="medium"
              style={{
                borderRadius: glassRadii.search,
                paddingHorizontal: ds.spacing(20),
                height: Math.max(50, ds.buttonH + 8),
              }}
            >
              <View className="flex-1 flex-row items-center">
                <Ionicons
                  name="search-outline"
                  size={ds.icon(22)}
                  color={glassColors.textSecondary}
                />
                <Text
                  style={{
                    marginLeft: ds.spacing(12),
                    fontSize: ds.fontSize(16),
                    color: glassColors.textMuted,
                  }}
                >
                  Search all {items.length} items...
                </Text>
              </View>
            </GlassSurface>
          </TouchableOpacity>

          <View style={{ marginTop: ds.spacing(20) }}>
            <SectionHeader
              title="Suggested for Today"
              actionLabel={predictedItems.length > 0 ? 'Add all' : undefined}
              onPressAction={predictedItems.length > 0 ? handleAddAllPredicted : undefined}
            />
            {insightsLoading && location?.id ? (
              <GlassSurface
                intensity="subtle"
                style={{
                  marginTop: ds.spacing(12),
                  borderRadius: glassRadii.surface,
                  paddingVertical: ds.spacing(18),
                }}
              >
                <LoadingIndicator showText text="Loading suggestions..." />
              </GlassSurface>
            ) : predictedItems.length > 0 ? (
              <FlatList
                data={predictedItems}
                renderItem={renderSuggestedItem}
                keyExtractor={(item) => `${item.inventoryItemId}:${item.unitType}`}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                  paddingTop: ds.spacing(12),
                  gap: ds.spacing(10),
                }}
              />
            ) : (
              <View style={{ marginTop: ds.spacing(12) }}>
                <EmptyStateCard
                  icon="sparkles-outline"
                  title="Not enough data yet"
                  message="Place orders for suggestions to show up."
                  alignment="leading"
                />
              </View>
            )}
          </View>

          <View style={{ marginTop: ds.spacing(20) }}>
            <SectionHeader title="Quick Actions" />
            {insightsLoading && location?.id ? (
              <GlassSurface
                intensity="subtle"
                style={{
                  marginTop: ds.spacing(12),
                  borderRadius: glassRadii.surface,
                  paddingVertical: ds.spacing(18),
                }}
              >
                <LoadingIndicator showText text="Loading quick actions..." />
              </GlassSurface>
            ) : reorderOrder ? (
              <GlassSurface
                intensity="subtle"
                style={{ marginTop: ds.spacing(12), borderRadius: glassRadii.surface }}
              >
                <TouchableOpacity
                  onPress={() => reorderHistoricalOrder(reorderOrder)}
                  className="flex-row items-center"
                  style={{
                    paddingHorizontal: ds.spacing(14),
                    paddingVertical: ds.spacing(14),
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
              </GlassSurface>
            ) : (
              <View style={{ marginTop: ds.spacing(12) }}>
                <EmptyStateCard
                  icon="flash-outline"
                  title="Not enough data yet"
                  message="Use the app to place orders and quick actions will appear here."
                  alignment="leading"
                />
              </View>
            )}
          </View>

          <View style={{ marginTop: ds.spacing(20) }}>
            <GlassSurface
              intensity="subtle"
              style={{ borderRadius: glassRadii.surface }}
            >
              <TouchableOpacity
                onPress={() => openBrowse(null, false)}
                activeOpacity={0.85}
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
                        width: ds.icon(36),
                        height: ds.icon(36),
                        borderRadius: glassRadii.iconTile,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: colors.gray[100],
                        marginRight: ds.spacing(12),
                      }}
                    >
                      <Ionicons
                        name="grid-outline"
                        size={ds.icon(18)}
                        color={glassColors.textPrimary}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          fontSize: ds.fontSize(16),
                          fontWeight: '600',
                          color: glassColors.textPrimary,
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
                  <View
                    style={{
                      paddingHorizontal: ds.spacing(12),
                      paddingVertical: ds.spacing(7),
                      borderRadius: glassRadii.pill,
                      backgroundColor: colors.gray[100],
                      borderWidth: glassHairlineWidth,
                      borderColor: 'rgba(28, 28, 30, 0.08)',
                      flexDirection: 'row',
                      alignItems: 'center',
                    }}
                  >
                    <Text
                      style={{
                        fontSize: ds.fontSize(13),
                        fontWeight: '600',
                        color: glassColors.textPrimary,
                      }}
                    >
                      Open
                    </Text>
                    <Ionicons
                      name="chevron-forward"
                      size={ds.icon(15)}
                      color={glassColors.textSecondary}
                      style={{ marginLeft: ds.spacing(4) }}
                    />
                  </View>
                </View>
              </TouchableOpacity>

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
                  onPress={() => openBrowse(null, false)}
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
                      onPress={() => openBrowse(category, false)}
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
                    onPress={() => openBrowse(null, false)}
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
                    onAdd={addInventoryItem}
                  />
                ))}
              </View>

              <TouchableOpacity
                onPress={() => openBrowse(null, false)}
                activeOpacity={0.8}
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
              </TouchableOpacity>
            </GlassSurface>
          </View>
        </ScrollView>
    </SafeAreaView>
  );
}
