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
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useShallow } from 'zustand/react/shallow';
import {
  EmptyStateCard,
  GlassSurface,
  IdentityHeader,
  LoadingIndicator,
} from '@/components';
import {
  categoryGlassTints,
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassSpacing,
  glassTabBarHeight,
} from '@/theme/design';
import { useEmployeeCartActions } from '@/hooks/useEmployeeCartActions';
import { useManagedRefresh } from '@/hooks/useManagedRefresh';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  fetchLocationOrderInsights,
  formatOrderDateLabel,
  getItemSupplierLabel,
  summarizeOrderItems,
  type HistoricalOrderSummary,
  type PredictedOrderItem,
} from '@/features/ordering/orderInsights';
import { useAuthStore, useOrderStore } from '@/store';
import { GlassView } from '@/components/ui';

interface PredictedRowProps {
  item: PredictedOrderItem;
  quantity: number;
  onIncrement: (key: string) => void;
  onDecrement: (key: string) => void;
}

const PredictedRow = memo(function PredictedRow({
  item,
  quantity,
  onIncrement,
  onDecrement,
}: PredictedRowProps) {
  const ds = useScaledStyles();
  const itemKey = `${item.inventoryItemId}:${item.unitType}`;

  return (
    <View
      style={{
        paddingHorizontal: ds.spacing(14),
        paddingVertical: ds.spacing(12),
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <View style={{ flex: 1, paddingRight: ds.spacing(12) }}>
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
          {getItemSupplierLabel(item)}
        </Text>
      </View>
      <View className="items-end">
        <View className="flex-row items-center">
          <GlassView variant="stepper">
            <TouchableOpacity
              onPress={() => onDecrement(itemKey)}
              style={{
                width: 36,
                height: 36,
                alignItems: 'center',
                justifyContent: 'center',
              }}
              activeOpacity={0.75}
            >
              <Ionicons
                name="remove"
                size={ds.icon(16)}
                color={glassColors.textPrimary}
              />
            </TouchableOpacity>
          </GlassView>
          <Text
            style={{
              minWidth: ds.spacing(30),
              textAlign: 'center',
              fontSize: ds.fontSize(16),
              fontWeight: '700',
              color: glassColors.textPrimary,
              marginHorizontal: ds.spacing(10),
            }}
          >
            {quantity}
          </Text>
          <GlassView variant="stepper">
            <TouchableOpacity
              onPress={() => onIncrement(itemKey)}
              style={{
                width: 36,
                height: 36,
                alignItems: 'center',
                justifyContent: 'center',
              }}
              activeOpacity={0.75}
            >
              <Ionicons
                name="add"
                size={ds.icon(16)}
                color={glassColors.textPrimary}
              />
            </TouchableOpacity>
          </GlassView>
        </View>
        <Text
          style={{
            marginTop: ds.spacing(6),
            fontSize: ds.fontSize(11),
            color: glassColors.textSecondary,
          }}
        >
          {item.unitType === 'base' ? item.baseUnit : item.packUnit}
        </Text>
      </View>
    </View>
  );
});

interface RecentOrderCardProps {
  order: HistoricalOrderSummary;
  onReorder: (order: HistoricalOrderSummary) => void;
}

const RecentOrderCard = memo(function RecentOrderCard({
  order,
  onReorder,
}: RecentOrderCardProps) {
  const ds = useScaledStyles();

  return (
    <GlassSurface
      intensity="subtle"
      style={{
        borderRadius: glassRadii.surface,
      }}
    >
      <View
        style={{
          paddingHorizontal: ds.spacing(14),
          paddingVertical: ds.spacing(14),
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flex: 1, paddingRight: ds.spacing(10) }}>
          <Text
            style={{
              fontSize: ds.fontSize(15),
              fontWeight: '600',
              color: glassColors.textPrimary,
            }}
          >
            {formatOrderDateLabel(order.createdAt)}
          </Text>
          <Text
            style={{
              marginTop: ds.spacing(4),
              fontSize: ds.fontSize(12),
              color: glassColors.textSecondary,
            }}
            numberOfLines={1}
          >
            {order.itemCount} items · {summarizeOrderItems(order)}
          </Text>
        </View>
        <GlassSurface
          intensity="medium"
          style={{ borderRadius: glassRadii.pill }}
        >
          <TouchableOpacity
            onPress={() => onReorder(order)}
            style={{
              minHeight: 40,
              paddingHorizontal: ds.spacing(14),
              alignItems: 'center',
              justifyContent: 'center',
            }}
            activeOpacity={0.8}
          >
            <Text
              style={{
                fontSize: ds.fontSize(13),
                fontWeight: '600',
                color: glassColors.textPrimary,
              }}
            >
              Reorder
            </Text>
          </TouchableOpacity>
        </GlassSurface>
      </View>
    </GlassSurface>
  );
});

export function SmartOrderScreen() {
  const ds = useScaledStyles();
  const [loading, setLoading] = useState(true);
  const [recentOrders, setRecentOrders] = useState<HistoricalOrderSummary[]>([]);
  const [predictedItems, setPredictedItems] = useState<PredictedOrderItem[]>([]);
  const [quantitiesByKey, setQuantitiesByKey] = useState<Record<string, number>>({});
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
    totalCartCount,
  } = useOrderStore(
    useShallow((state) => ({
      totalCartCount: state.getTotalCartCount('employee'),
    })),
  );
  const {
    activeLocationId,
    addPredictedItem,
    reorderHistoricalOrder,
  } = useEmployeeCartActions();

  useEffect(() => {
    void fetchLocations();
  }, [fetchLocations]);

  useEffect(() => {
    if (locations.length > 0 && !location) {
      setLocation(locations[0]);
    }
  }, [location, locations, setLocation]);

  const loadSmartData = useCallback(async () => {
    if (!activeLocationId) {
      setRecentOrders([]);
      setPredictedItems([]);
      setQuantitiesByKey({});
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const insights = await fetchLocationOrderInsights(activeLocationId);
      setRecentOrders(insights.recentOrders);
      setPredictedItems(insights.predictedItems);
      setQuantitiesByKey(
        insights.predictedItems.reduce<Record<string, number>>((accumulator, item) => {
          accumulator[`${item.inventoryItemId}:${item.unitType}`] = item.quantity;
          return accumulator;
        }, {}),
      );
    } catch (error) {
      console.error('Unable to load smart order insights', error);
      setRecentOrders([]);
      setPredictedItems([]);
      setQuantitiesByKey({});
    } finally {
      setLoading(false);
    }
  }, [activeLocationId]);

  useFocusEffect(
    useCallback(() => {
      void loadSmartData();
    }, [loadSmartData]),
  );

  const { refreshing, onRefresh } = useManagedRefresh(loadSmartData);

  const handleIncrementPrediction = useCallback((itemKey: string) => {
    setQuantitiesByKey((previous) => ({
      ...previous,
      [itemKey]: Math.max(1, (previous[itemKey] ?? 0) + 1),
    }));
  }, []);

  const handleDecrementPrediction = useCallback((itemKey: string) => {
    setQuantitiesByKey((previous) => ({
      ...previous,
      [itemKey]: Math.max(1, (previous[itemKey] ?? 1) - 1),
    }));
  }, []);

  const handleAddAllPredicted = useCallback(() => {
    predictedItems.forEach((item) => {
      const itemKey = `${item.inventoryItemId}:${item.unitType}`;
      const quantity = Math.max(1, quantitiesByKey[itemKey] ?? item.quantity);
      addPredictedItem(item, quantity);
    });
  }, [addPredictedItem, predictedItems, quantitiesByKey]);

  const renderPredictedRow = useCallback(
    ({ item }: { item: PredictedOrderItem }) => {
      const itemKey = `${item.inventoryItemId}:${item.unitType}`;
      return (
        <PredictedRow
          item={item}
          quantity={Math.max(1, quantitiesByKey[itemKey] ?? item.quantity)}
          onIncrement={handleIncrementPrediction}
          onDecrement={handleDecrementPrediction}
        />
      );
    },
    [handleDecrementPrediction, handleIncrementPrediction, quantitiesByKey],
  );

  const renderRecentOrder = useCallback(
    ({ item }: { item: HistoricalOrderSummary }) => (
      <RecentOrderCard order={item} onReorder={reorderHistoricalOrder} />
    ),
    [reorderHistoricalOrder],
  );

  const predictedDayLabel = useMemo(
    () =>
      new Date().toLocaleDateString('en-US', {
        weekday: 'long',
      }),
    [],
  );

  const renderListHeader = useCallback(
    () => (
      <View>
        <IdentityHeader
          title="Smart order"
          subtitle="Suggestions based on your order history"
          cartCount={totalCartCount}
          onPressCart={() => router.push('/cart')}
        />

        <View style={{ marginTop: ds.spacing(8), marginBottom: ds.spacing(20) }}>
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
                name="time-outline"
                size={ds.icon(18)}
                color={glassColors.accent}
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
                Today&apos;s predicted order
              </Text>
              <Text
                style={{
                  marginTop: ds.spacing(4),
                  fontSize: ds.fontSize(12),
                  color: glassColors.textSecondary,
                }}
              >
                You usually order these on {predictedDayLabel}
              </Text>
            </View>
          </View>

          {loading ? (
            <GlassSurface
              intensity="subtle"
              style={{
                marginTop: ds.spacing(12),
                borderRadius: glassRadii.surface,
                paddingVertical: ds.spacing(18),
              }}
            >
              <LoadingIndicator showText text="Loading smart suggestions..." />
            </GlassSurface>
          ) : predictedItems.length > 0 ? (
            <>
              <GlassSurface
                intensity="subtle"
                style={{
                  marginTop: ds.spacing(12),
                  borderRadius: glassRadii.surface,
                  overflow: 'hidden',
                }}
              >
                <FlatList
                  data={predictedItems}
                  renderItem={renderPredictedRow}
                  keyExtractor={(item) => `${item.inventoryItemId}:${item.unitType}`}
                  scrollEnabled={false}
                  ItemSeparatorComponent={() => (
                    <View
                      style={{
                        marginHorizontal: ds.spacing(14),
                        borderTopWidth: glassHairlineWidth,
                        borderTopColor: glassColors.divider,
                      }}
                    />
                  )}
                />
              </GlassSurface>

              <TouchableOpacity
                onPress={handleAddAllPredicted}
                style={{
                  marginTop: ds.spacing(12),
                  minHeight: ds.buttonH,
                  borderRadius: glassRadii.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: glassColors.accent,
                }}
                activeOpacity={0.85}
              >
                <Text
                  style={{
                    color: glassColors.textOnPrimary,
                    fontSize: ds.buttonFont,
                    fontWeight: '700',
                  }}
                >
                  Add all {predictedItems.length} to cart
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={{ marginTop: ds.spacing(12) }}>
              <EmptyStateCard
                icon="time-outline"
                title="Not enough data yet"
                message="Place orders and smart suggestions will appear here."
                alignment="leading"
              />
            </View>
          )}
        </View>

        <View style={{ marginBottom: ds.spacing(12) }}>
          <View className="flex-row items-start">
            <View
              style={{
                width: ds.icon(34),
                height: ds.icon(34),
                borderRadius: glassRadii.iconTile,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: categoryGlassTints.packaging.background,
                marginRight: ds.spacing(12),
              }}
            >
              <Ionicons
                name="bag-handle-outline"
                size={ds.icon(18)}
                color={categoryGlassTints.packaging.icon}
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
                Recent orders
              </Text>
              <Text
                style={{
                  marginTop: ds.spacing(4),
                  fontSize: ds.fontSize(12),
                  color: glassColors.textSecondary,
                }}
              >
                Re-add your recent location orders to the cart
              </Text>
            </View>
          </View>
        </View>
      </View>
    ),
    [
      ds,
      handleAddAllPredicted,
      predictedDayLabel,
      predictedItems,
      renderPredictedRow,
      totalCartCount,
      loading,
    ],
  );

  if (loading && !location) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: glassColors.background }}
        edges={['top', 'left', 'right']}
      >
        <View className="flex-1 items-center justify-center">
          <LoadingIndicator showText text="Loading smart order..." />
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
        data={recentOrders}
        renderItem={renderRecentOrder}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={renderListHeader}
        ListEmptyComponent={
          loading ? (
            <View style={{ paddingTop: ds.spacing(24) }}>
              <LoadingIndicator showText text="Loading smart order..." />
            </View>
          ) : (
            <EmptyStateCard
              icon="reader-outline"
              title="No recent orders yet"
              message="Submit a few orders from this location to unlock smart suggestions."
            />
          )
        }
        contentContainerStyle={{
          paddingHorizontal: glassSpacing.screen,
          paddingBottom: glassTabBarHeight + ds.spacing(20),
          gap: ds.spacing(8),
          flexGrow: recentOrders.length === 0 ? 1 : 0,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={glassColors.accent}
          />
        }
      />
    </SafeAreaView>
  );
}
