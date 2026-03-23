import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Alert,
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
import { useOrderingCartActions } from '@/hooks/useOrderingCartActions';
import { useManagedRefresh } from '@/hooks/useManagedRefresh';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import type {
  RecentOrder,
  SuggestionItem,
} from '@/features/ordering/dailySuggestions';
import type { OrderingMode } from '@/features/ordering/types';
import { useAuthStore, useOrderStore } from '@/store';
import { GlassView } from '@/components/ui';
import { useDailySuggestions } from './useDailySuggestions';

function getSuggestionKey(item: SuggestionItem): string {
  return `${item.item_id}:${item.unit_type}`;
}

interface SuggestionRowProps {
  item: SuggestionItem;
  quantity: number;
  onIncrement: (key: string) => void;
  onDecrement: (key: string) => void;
}

const SuggestionRow = memo(function SuggestionRow({
  item,
  quantity,
  onIncrement,
  onDecrement,
}: SuggestionRowProps) {
  const ds = useScaledStyles();
  const itemKey = getSuggestionKey(item);

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
          {item.item_name}
        </Text>
        <Text
          style={{
            marginTop: ds.spacing(4),
            fontSize: ds.fontSize(12),
            color: glassColors.textSecondary,
          }}
          numberOfLines={1}
        >
          {item.supplier_name ?? 'Supplier unavailable'}
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
          {item.unit ?? 'unit'}
        </Text>
      </View>
    </View>
  );
});

interface RecentOrderCardProps {
  order: RecentOrder;
  onReorder: (order: RecentOrder) => void;
}

const RecentOrderCard = memo(function RecentOrderCard({
  order,
  onReorder,
}: RecentOrderCardProps) {
  const ds = useScaledStyles();
  const supplierText = order.suppliers.filter(Boolean).join(', ') || 'No supplier';

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
            {order.display_date}
          </Text>
          <Text
            style={{
              marginTop: ds.spacing(4),
              fontSize: ds.fontSize(12),
              color: glassColors.textSecondary,
            }}
            numberOfLines={1}
          >
            {order.item_count} {order.item_count === 1 ? 'item' : 'items'} · {supplierText}
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

interface SmartOrderScreenProps {
  mode: OrderingMode;
  identity?: string;
  title?: string;
  subtitle?: string;
}

export function SmartOrderScreen({
  mode,
  identity,
  title = 'Smart order',
  subtitle = 'Suggestions based on your order history',
}: SmartOrderScreenProps) {
  const ds = useScaledStyles();
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
      totalCartCount: state.getTotalCartCount(mode.scope),
    })),
  );
  const {
    activeLocationId,
    addSuggestedItem,
    reorderHistoricalOrder,
  } = useOrderingCartActions(mode.scope);
  const locationCart = useOrderStore((state) =>
    activeLocationId ? state.getCartItems(activeLocationId, mode.scope) : []
  );
  const {
    suggestions,
    recentOrders,
    loading: smartOrderLoading,
    error: smartOrderError,
    reload: reloadSuggestions,
  } = useDailySuggestions(activeLocationId);

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
      setQuantitiesByKey({});
    }
    try {
      await reloadSuggestions();
    } catch (error) {
      console.error('Unable to load smart order data', error);
    }
  }, [activeLocationId, reloadSuggestions]);

  useFocusEffect(
    useCallback(() => {
      void loadSmartData();
    }, [loadSmartData]),
  );

  const { refreshing, onRefresh } = useManagedRefresh(loadSmartData);

  useEffect(() => {
    setQuantitiesByKey(
      suggestions.items.reduce<Record<string, number>>((accumulator, item) => {
        accumulator[getSuggestionKey(item)] = Math.max(1, item.suggested_qty);
        return accumulator;
      }, {}),
    );
  }, [suggestions.items]);

  const handleIncrementSuggestion = useCallback((itemKey: string) => {
    setQuantitiesByKey((previous) => ({
      ...previous,
      [itemKey]: Math.max(1, (previous[itemKey] ?? 0) + 1),
    }));
  }, []);

  const handleDecrementSuggestion = useCallback((itemKey: string) => {
    setQuantitiesByKey((previous) => ({
      ...previous,
      [itemKey]: Math.max(1, (previous[itemKey] ?? 1) - 1),
    }));
  }, []);

  const handleAddAllSuggestions = useCallback(() => {
    suggestions.items.forEach((item) => {
      const itemKey = getSuggestionKey(item);
      const quantity = Math.max(1, quantitiesByKey[itemKey] ?? item.suggested_qty);
      addSuggestedItem(item, quantity);
    });
  }, [addSuggestedItem, quantitiesByKey, suggestions.items]);

  const renderSuggestionRow = useCallback(
    ({ item }: { item: SuggestionItem }) => {
      const itemKey = getSuggestionKey(item);
      return (
        <SuggestionRow
          item={item}
          quantity={Math.max(1, quantitiesByKey[itemKey] ?? item.suggested_qty)}
          onIncrement={handleIncrementSuggestion}
          onDecrement={handleDecrementSuggestion}
        />
      );
    },
    [handleDecrementSuggestion, handleIncrementSuggestion, quantitiesByKey],
  );

  const handleReorderOrder = useCallback((order: RecentOrder) => {
    const didReorder = reorderHistoricalOrder(order);
    if (!didReorder) {
      return;
    }

    Alert.alert(
      'Added to cart',
      `Added ${order.item_count} ${order.item_count === 1 ? 'item' : 'items'} from ${order.display_date}.`,
    );
  }, [reorderHistoricalOrder]);

  const renderRecentOrder = useCallback(
    ({ item }: { item: RecentOrder }) => (
      <RecentOrderCard order={item} onReorder={handleReorderOrder} />
    ),
    [handleReorderOrder],
  );

  const allSuggestionsAdded = useMemo(
    () =>
      suggestions.items.length > 0 &&
      suggestions.items.every((item) => {
        const desiredQuantity = Math.max(
          1,
          quantitiesByKey[getSuggestionKey(item)] ?? item.suggested_qty,
        );
        const existing = locationCart.find(
          (cartItem) =>
            cartItem.inventoryItemId === item.item_id &&
            cartItem.unitType === item.unit_type &&
            cartItem.inputMode === 'quantity',
        );

        if (!existing) {
          return false;
        }

        return (existing.quantityRequested ?? existing.quantity) >= desiredQuantity;
      }),
    [locationCart, quantitiesByKey, suggestions.items],
  );

  const renderListHeader = useCallback(
    () => (
      <View>
        <IdentityHeader
          identity={identity}
          title={title}
          subtitle={subtitle}
          cartCount={totalCartCount}
          onPressCart={() => router.push(mode.cartRoute as any)}
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
                Usually ordered on {suggestions.day_label}
              </Text>
              <Text
                style={{
                  marginTop: ds.spacing(4),
                  fontSize: ds.fontSize(12),
                  color: glassColors.textSecondary,
                }}
              >
                Based on your past {suggestions.day_label} orders
              </Text>
            </View>
          </View>

          {smartOrderLoading && suggestions.items.length === 0 ? (
            <GlassSurface
              intensity="subtle"
              style={{
                marginTop: ds.spacing(12),
                borderRadius: glassRadii.surface,
                paddingVertical: ds.spacing(18),
              }}
            >
              <LoadingIndicator showText text="Loading daily suggestions..." />
            </GlassSurface>
          ) : smartOrderError ? (
            <View style={{ marginTop: ds.spacing(12) }}>
              <EmptyStateCard
                icon="cloud-offline-outline"
                title="Suggestions unavailable"
                message={smartOrderError}
                alignment="leading"
                actionLabel="Retry"
                onPressAction={() => {
                  void loadSmartData();
                }}
              />
            </View>
          ) : suggestions.items.length > 0 ? (
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
                  data={suggestions.items}
                  renderItem={renderSuggestionRow}
                  keyExtractor={getSuggestionKey}
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
                onPress={handleAddAllSuggestions}
                disabled={allSuggestionsAdded}
                style={{
                  marginTop: ds.spacing(12),
                  minHeight: ds.buttonH,
                  borderRadius: glassRadii.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: allSuggestionsAdded
                    ? glassColors.accentSoft
                    : glassColors.accent,
                }}
                activeOpacity={0.85}
              >
                <Text
                  style={{
                    color: allSuggestionsAdded
                      ? glassColors.accent
                      : glassColors.textOnPrimary,
                    fontSize: ds.buttonFont,
                    fontWeight: '700',
                  }}
                >
                  {allSuggestionsAdded
                    ? 'Added to cart'
                    : `Add all ${suggestions.items.length} to cart`}
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={{ marginTop: ds.spacing(12) }}>
              <EmptyStateCard
                icon="time-outline"
                title={`Usually ordered on ${suggestions.day_label}`}
                message={`Not enough ${suggestions.day_label} order history yet. Keep ordering through the app and suggestions will appear.`}
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
      allSuggestionsAdded,
      ds,
      handleAddAllSuggestions,
      identity,
      loadSmartData,
      mode.cartRoute,
      renderSuggestionRow,
      suggestions.day_label,
      suggestions.items,
      smartOrderError,
      smartOrderLoading,
      totalCartCount,
      subtitle,
      title,
    ],
  );

  if (!location && locations.length === 0) {
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
          smartOrderLoading ? (
            <View style={{ paddingTop: ds.spacing(24) }}>
              <LoadingIndicator showText text="Loading smart order..." />
            </View>
          ) : (
            <EmptyStateCard
              icon="reader-outline"
              title="No recent orders yet"
              message="No past orders yet. Place your first order and it'll show up here."
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
