import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { GlassSurface } from '@/components';
import {
  type HistoricalOrderItem,
  type HistoricalOrderSummary,
  type LocationOrderInsights,
  fetchLocationOrderInsights,
} from '@/features/ordering/orderInsights';
import { useManagedRefresh } from '@/hooks/useManagedRefresh';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassSpacing,
  glassTabBarHeight,
} from '@/theme/design';
import { colors } from '@/constants';

interface EmptyCartReorderStateProps {
  browseRoute: string;
  locationName: string;
  locationId: string | null;
  onReorder: (order: HistoricalOrderSummary) => void;
  quickOrderRoute: string;
}

interface ReorderCardModel {
  id: string;
  title: string;
  subtitle: string;
  itemCount: number;
  chips: string[];
  order: HistoricalOrderSummary | null;
}

interface ReorderCardProps {
  card: ReorderCardModel;
  onReorder: (order: HistoricalOrderSummary) => void;
}

const MOCK_REORDER_CARDS: ReorderCardModel[] = [
  {
    id: 'mock-order-last-tuesday',
    title: 'Last Tuesday',
    subtitle: 'Mar 11 · Babytuna Sushi',
    itemCount: 3,
    chips: ['Salmon 5lb', 'Hamachi 3lb', 'Sapporo 2cs'],
    order: null,
  },
  {
    id: 'mock-order-last-friday',
    title: 'Last Friday',
    subtitle: 'Mar 7 · Babytuna Poki & Pho',
    itemCount: 5,
    chips: ['Salmon 5lb', 'Unagi 2cs', '+3 more'],
    order: null,
  },
  {
    id: 'mock-order-mar-4',
    title: 'Tuesday, Mar 4',
    subtitle: 'Babytuna Sushi',
    itemCount: 2,
    chips: ['Albacore 1cs', 'Ebi 2cs'],
    order: null,
  },
];

function formatShortDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function formatRelativeOrderTitle(dateString: string): string {
  const orderDate = new Date(dateString);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const orderDay = new Date(orderDate.getFullYear(), orderDate.getMonth(), orderDate.getDate());
  const dayDelta = Math.round((today.getTime() - orderDay.getTime()) / 86_400_000);
  const weekday = orderDate.toLocaleDateString('en-US', { weekday: 'long' });

  if (dayDelta === 0) {
    return 'Today';
  }

  if (dayDelta === 1) {
    return 'Yesterday';
  }

  if (dayDelta > 1 && dayDelta < 7) {
    return `Last ${weekday}`;
  }

  return `${weekday}, ${formatShortDate(dateString)}`;
}

function formatOrderSubtitle(dateString: string, locationName: string): string {
  const orderDate = new Date(dateString);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const orderDay = new Date(orderDate.getFullYear(), orderDate.getMonth(), orderDate.getDate());
  const dayDelta = Math.round((today.getTime() - orderDay.getTime()) / 86_400_000);

  if (dayDelta > 1 && dayDelta < 7) {
    return `${formatShortDate(dateString)} · ${locationName}`;
  }

  return locationName;
}

function formatItemQuantity(quantity: number): string {
  const normalized = Number(quantity.toFixed(2));
  return Number.isInteger(normalized) ? normalized.toString() : normalized.toString();
}

function formatOrderItemChip(item: HistoricalOrderItem): string {
  const unitLabel = item.unitType === 'base' ? item.baseUnit : item.packUnit;
  const quantityLabel = formatItemQuantity(item.quantity);
  return unitLabel
    ? `${item.name} ${quantityLabel}${unitLabel}`
    : `${item.name} ${quantityLabel}`;
}

function buildReorderCard(order: HistoricalOrderSummary, locationName: string): ReorderCardModel {
  const previewLabels = Array.from(
    new Set(order.items.map((item) => formatOrderItemChip(item))),
  );
  const visibleLabels = previewLabels.slice(0, 3);
  const remainingCount = Math.max(previewLabels.length - visibleLabels.length, 0);

  return {
    id: order.id,
    title: formatRelativeOrderTitle(order.createdAt),
    subtitle: formatOrderSubtitle(order.createdAt, locationName),
    itemCount: order.itemCount,
    chips:
      remainingCount > 0
        ? [...visibleLabels.slice(0, 2), `+${remainingCount} more`]
        : visibleLabels,
    order,
  };
}

const ReorderCard = memo(function ReorderCard({
  card,
  onReorder,
}: ReorderCardProps) {
  const ds = useScaledStyles();
  const cardRadius = ds.radius(20);
  const buttonHeight = Math.max(40, Math.min(ds.buttonH, 48) - 4);

  return (
    <GlassSurface
      intensity="subtle"
      style={{
        borderRadius: cardRadius,
      }}
    >
      <View style={{ padding: ds.spacing(16) }}>
        <View className="flex-row items-start justify-between">
          <Text
            style={{
              flex: 1,
              paddingRight: ds.spacing(12),
              fontSize: ds.fontSize(16),
              fontWeight: '700',
              color: glassColors.textPrimary,
            }}
          >
            {card.title}
          </Text>
          <Text
            style={{
              fontSize: ds.fontSize(12),
              fontWeight: '600',
              color: glassColors.textSecondary,
            }}
          >
            {card.itemCount} {card.itemCount === 1 ? 'item' : 'items'}
          </Text>
        </View>

        <Text
          style={{
            marginTop: ds.spacing(4),
            fontSize: ds.fontSize(13),
            color: glassColors.textSecondary,
          }}
        >
          {card.subtitle}
        </Text>

        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: ds.spacing(8),
            marginTop: ds.spacing(12),
          }}
        >
          {card.chips.map((chip) => (
            <View
              key={`${card.id}-${chip}`}
              style={{
                borderRadius: ds.radius(12),
                paddingHorizontal: ds.spacing(10),
                paddingVertical: ds.spacing(6),
                backgroundColor: glassColors.background,
                borderWidth: glassHairlineWidth,
                borderColor: glassColors.cardBorder,
              }}
            >
              <Text
                style={{
                  fontSize: ds.fontSize(11),
                  fontWeight: '500',
                  color: glassColors.textSecondary,
                }}
              >
                {chip}
              </Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          onPress={() => {
            if (card.order) {
              onReorder(card.order);
              return;
            }

            Alert.alert(
              'No past orders yet',
              'Place an order to enable one-tap reordering from your cart.',
            );
          }}
          style={{
            marginTop: ds.spacing(14),
            minHeight: buttonHeight,
            borderRadius: ds.radius(14),
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: glassColors.background,
            borderWidth: glassHairlineWidth,
            borderColor: glassColors.cardBorder,
          }}
          activeOpacity={0.85}
        >
          <Text
            style={{
              fontSize: ds.fontSize(13),
              fontWeight: '700',
              color: glassColors.textPrimary,
            }}
          >
            Reorder all {card.itemCount} {card.itemCount === 1 ? 'item' : 'items'}
          </Text>
        </TouchableOpacity>
      </View>
    </GlassSurface>
  );
});

export function EmptyCartReorderState({
  browseRoute,
  locationId,
  locationName,
  onReorder,
  quickOrderRoute,
}: EmptyCartReorderStateProps) {
  const ds = useScaledStyles();
  const { height } = useWindowDimensions();
  const [recentOrders, setRecentOrders] = useState<HistoricalOrderSummary[]>([]);

  useEffect(() => {
    setRecentOrders([]);
  }, [locationId]);

  const loadOrders = useCallback(async () => {
    if (!locationId) {
      setRecentOrders([]);
      return;
    }

    try {
      const insights: LocationOrderInsights = await fetchLocationOrderInsights(locationId);
      setRecentOrders(insights.recentOrders);
    } catch (error) {
      console.error('Unable to load empty cart reorder suggestions', error);
    }
  }, [locationId]);

  useFocusEffect(
    useCallback(() => {
      void loadOrders();
    }, [loadOrders]),
  );

  const { refreshing, onRefresh } = useManagedRefresh(loadOrders);
  const heroMinHeight = Math.min(
    Math.max(ds.spacing(286), Math.round(height * 0.38)),
    ds.spacing(356),
  );
  const actionButtonHeight = Math.max(40, Math.min(ds.buttonH, 42));
  const actionButtonRadius = ds.radius(14);
  const actionButtonHorizontalPadding = ds.spacing(10);
  const actionButtonGap = ds.spacing(12);
  const actionIconSize = ds.icon(15);
  const supportTextMaxWidth = ds.spacing(280);
  const reorderCards = useMemo(
    () =>
      recentOrders.length > 0
        ? recentOrders.map((order) => buildReorderCard(order, locationName))
        : MOCK_REORDER_CARDS,
    [locationName, recentOrders],
  );

  const renderOrderCard = useCallback(
    ({ item }: { item: ReorderCardModel }) => (
      <ReorderCard card={item} onReorder={onReorder} />
    ),
    [onReorder],
  );

  return (
    <FlatList
      data={reorderCards}
      renderItem={renderOrderCard}
      keyExtractor={(item) => item.id}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: glassSpacing.screen,
        paddingTop: ds.spacing(8),
        paddingBottom: glassTabBarHeight + ds.spacing(20),
      }}
      ItemSeparatorComponent={() => <View style={{ height: ds.spacing(10) }} />}
      ListHeaderComponent={
        <View style={{ paddingBottom: ds.spacing(8) }}>
          <View
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: heroMinHeight,
              paddingTop: ds.spacing(20),
              paddingBottom: ds.spacing(26),
            }}
          >
            <View
              style={{
                width: ds.icon(64),
                height: ds.icon(64),
                borderRadius: glassRadii.round,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.white,
                borderWidth: glassHairlineWidth,
                borderColor: glassColors.cardBorder,
              }}
            >
              <Ionicons
                name="bag-outline"
                size={ds.icon(28)}
                color={glassColors.textTertiary}
              />
            </View>

            <Text
              style={{
                marginTop: ds.spacing(20),
                fontSize: ds.fontSize(19),
                fontWeight: '700',
                color: glassColors.textPrimary,
                textAlign: 'center',
              }}
            >
              Your cart is empty
            </Text>

            <Text
              style={{
                marginTop: ds.spacing(8),
                maxWidth: supportTextMaxWidth,
                fontSize: ds.fontSize(13),
                lineHeight: ds.fontSize(18),
                color: glassColors.textSecondary,
                textAlign: 'center',
              }}
            >
              Browse inventory or place a quick order to get started.
            </Text>

            <View
              style={{
                width: '100%',
                maxWidth: ds.spacing(320),
                alignSelf: 'center',
                flexDirection: 'row',
                gap: actionButtonGap,
                marginTop: ds.spacing(24),
              }}
            >
              <TouchableOpacity
                onPress={() => router.push(browseRoute as never)}
                style={{
                  flex: 1,
                  minHeight: actionButtonHeight,
                  borderRadius: actionButtonRadius,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  backgroundColor: colors.primary[500],
                  paddingHorizontal: actionButtonHorizontalPadding,
                }}
                activeOpacity={0.85}
              >
                <Ionicons
                  name="grid-outline"
                  size={actionIconSize}
                  color={glassColors.textOnPrimary}
                />
                <Text
                  style={{
                    marginLeft: ds.spacing(6),
                    fontSize: ds.fontSize(12),
                    fontWeight: '700',
                    color: glassColors.textOnPrimary,
                  }}
                >
                  Browse
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => router.push(quickOrderRoute as never)}
                style={{
                  flex: 1,
                  minHeight: actionButtonHeight,
                  borderRadius: actionButtonRadius,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  backgroundColor: colors.white,
                  borderWidth: glassHairlineWidth,
                  borderColor: glassColors.cardBorder,
                  paddingHorizontal: actionButtonHorizontalPadding,
                }}
                activeOpacity={0.85}
              >
                <Ionicons
                  name="flash-outline"
                  size={actionIconSize}
                  color={glassColors.textPrimary}
                />
                <Text
                  style={{
                    marginLeft: ds.spacing(6),
                    fontSize: ds.fontSize(12),
                    fontWeight: '700',
                    color: glassColors.textPrimary,
                  }}
                >
                  Quick Order
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text
            style={{
              marginTop: ds.spacing(8),
              marginBottom: ds.spacing(8),
              color: glassColors.textTertiary,
              fontSize: ds.fontSize(11),
              fontWeight: '600',
              letterSpacing: 1.4,
            }}
          >
            REORDER A PAST ORDER
          </Text>
        </View>
      }
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={glassColors.accent}
        />
      }
    />
  );
}
