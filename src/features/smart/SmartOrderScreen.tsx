import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  FlatList,
  LayoutAnimation,
  Platform,
  RefreshControl,
  Text,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useShallow } from 'zustand/react/shallow';
import { BrandLogo, GlassSurface, HeaderCartButton, LoadingIndicator, LocationSelectorButton } from '@/components';
import {
  categoryGlassTints,
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassSpacing,
  glassTabBarHeight,
} from '@/design/tokens';
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
import type { Location } from '@/types';
import { GlassView } from '@/components/ui';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
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
    addToCart,
    getLocationCartTotal,
    totalCartCount,
  } = useOrderStore(
    useShallow((state) => ({
      addToCart: state.addToCart,
      getLocationCartTotal: state.getLocationCartTotal,
      totalCartCount: state.getTotalCartCount('employee'),
    })),
  );

  useEffect(() => {
    void fetchLocations();
  }, [fetchLocations]);

  useEffect(() => {
    if (locations.length > 0 && !location) {
      setLocation(locations[0]);
    }
  }, [location, locations, setLocation]);

  const loadSmartData = useCallback(async () => {
    if (!location?.id) {
      setRecentOrders([]);
      setPredictedItems([]);
      setQuantitiesByKey({});
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const insights = await fetchLocationOrderInsights(location.id);
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
  }, [location?.id]);

  useFocusEffect(
    useCallback(() => {
      void loadSmartData();
    }, [loadSmartData]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSmartData();
    setRefreshing(false);
  }, [loadSmartData]);

  const toggleLocationDropdown = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowLocationDropdown((previous) => !previous);
  }, []);

  const handleSelectLocation = useCallback(
    (selectedLocation: Location) => {
      if (Platform.OS !== 'web') {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      setLocation(selectedLocation);
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setShowLocationDropdown(false);
    },
    [setLocation],
  );

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

  const handleReorderOrder = useCallback(
    (order: HistoricalOrderSummary) => {
      if (!location?.id) {
        return;
      }

      order.items.forEach((item) => {
        addToCart(location.id, item.inventoryItemId, item.quantity, item.unitType, {
          context: 'employee',
          inputMode: 'quantity',
          quantityRequested: item.quantity,
          note: item.note,
        });
      });
    },
    [addToCart, location?.id],
  );

  const handleAddAllPredicted = useCallback(() => {
    if (!location?.id) {
      return;
    }

    predictedItems.forEach((item) => {
      const itemKey = `${item.inventoryItemId}:${item.unitType}`;
      const quantity = Math.max(1, quantitiesByKey[itemKey] ?? item.quantity);
      addToCart(location.id, item.inventoryItemId, quantity, item.unitType, {
        context: 'employee',
        inputMode: 'quantity',
        quantityRequested: quantity,
        note: item.note,
      });
    });
  }, [addToCart, location?.id, predictedItems, quantitiesByKey]);

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
      <RecentOrderCard order={item} onReorder={handleReorderOrder} />
    ),
    [handleReorderOrder],
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
        <View style={{ paddingTop: ds.spacing(8), paddingBottom: ds.spacing(10) }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
            }}
          >
            <View style={{ flex: 1, paddingRight: ds.spacing(12) }}>
              <Text
                style={{
                  fontSize: ds.fontSize(32),
                  fontWeight: '800',
                  color: glassColors.textPrimary,
                  letterSpacing: -0.5,
                }}
              >
                Smart order
              </Text>
              <Text
                style={{
                  marginTop: ds.spacing(6),
                  fontSize: ds.fontSize(14),
                  color: glassColors.textSecondary,
                }}
              >
                Suggestions based on your order history
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <View className="flex-row items-center" style={{ marginBottom: ds.spacing(10) }}>
                <LocationSelectorButton
                  label={location?.name || 'Select Location'}
                  expanded={showLocationDropdown}
                  onPress={toggleLocationDropdown}
                />
                <HeaderCartButton
                  count={totalCartCount}
                  onPress={() => router.push('/cart')}
                />
              </View>
            </View>
          </View>

          {showLocationDropdown ? (
            <GlassSurface
              intensity="strong"
              style={{
                marginTop: ds.spacing(2),
                borderRadius: glassRadii.surface,
              }}
            >
              <View>
                {locations.map((loc, index) => {
                  const isSelected = location?.id === loc.id;
                  const cartCount = getLocationCartTotal(loc.id);
                  return (
                    <TouchableOpacity
                      key={loc.id}
                      onPress={() => handleSelectLocation(loc)}
                      activeOpacity={0.7}
                      className="flex-row items-center justify-between"
                      style={{
                        minHeight: ds.rowH,
                        paddingHorizontal: ds.spacing(16),
                        paddingVertical: ds.spacing(12),
                        borderTopWidth: index > 0 ? glassHairlineWidth : 0,
                        borderTopColor: glassColors.divider,
                      }}
                    >
                      <View className="flex-row items-center flex-1">
                        <View
                          style={{
                            width: ds.icon(32),
                            height: ds.icon(32),
                            marginRight: ds.spacing(12),
                            borderRadius: glassRadii.round,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: isSelected
                              ? glassColors.accentSoft
                              : glassColors.mediumFill,
                          }}
                        >
                          <BrandLogo variant="inline" size={16} colorMode="light" />
                        </View>
                        <Text
                          style={{
                            fontSize: ds.fontSize(13),
                            fontWeight: isSelected ? '500' : '400',
                            color: isSelected ? glassColors.accent : glassColors.textPrimary,
                          }}
                        >
                          {loc.name}
                        </Text>
                      </View>
                      <View className="flex-row items-center">
                        {cartCount > 0 ? (
                          <Text
                            style={{
                              color: glassColors.textSecondary,
                              fontSize: ds.fontSize(11),
                              marginRight: ds.spacing(8),
                            }}
                          >
                            {cartCount} items
                          </Text>
                        ) : null}
                        {isSelected ? (
                          <Ionicons
                            name="checkmark"
                            size={ds.icon(18)}
                            color={glassColors.accent}
                          />
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </GlassSurface>
          ) : null}
        </View>

        {predictedItems.length > 0 ? (
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
          </View>
        ) : null}

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
      getLocationCartTotal,
      handleAddAllPredicted,
      handleSelectLocation,
      locations,
      location?.id,
      location?.name,
      predictedDayLabel,
      predictedItems,
      renderPredictedRow,
      showLocationDropdown,
      toggleLocationDropdown,
      totalCartCount,
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
            <GlassSurface
              intensity="subtle"
              style={{
                borderRadius: glassRadii.surface,
                padding: ds.spacing(18),
                alignItems: 'center',
              }}
            >
              <Ionicons
                name="reader-outline"
                size={ds.icon(30)}
                color={glassColors.textSecondary}
              />
              <Text
                style={{
                  marginTop: ds.spacing(12),
                  fontSize: ds.fontSize(15),
                  fontWeight: '600',
                  color: glassColors.textPrimary,
                }}
              >
                No recent orders yet
              </Text>
              <Text
                style={{
                  marginTop: ds.spacing(6),
                  fontSize: ds.fontSize(12),
                  color: glassColors.textSecondary,
                  textAlign: 'center',
                }}
              >
                Submit a few orders from this location to unlock smart suggestions.
              </Text>
            </GlassSurface>
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
