import React, { memo, useCallback, useMemo } from 'react';
import {
  FlatList,
  RefreshControl,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { GlassSurface, LoadingIndicator } from '@/components';
import {
  type RecentOrder,
  type RecentOrderItem,
} from '@/features/ordering/dailySuggestions';
import { useDailySuggestions } from '@/features/smart/useDailySuggestions';
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
  onReorder: (order: RecentOrder) => void;
}

interface ReorderCardModel {
  id: string;
  title: string;
  subtitle: string;
  itemCount: number;
  chips: string[];
  isPrimary: boolean;
  order: RecentOrder;
}

interface ReorderCardProps {
  card: ReorderCardModel;
  onReorder: (order: RecentOrder) => void;
}

function truncateItemName(item: RecentOrderItem): string {
  return item.item_name.length > 15
    ? `${item.item_name.substring(0, 15)}...`
    : item.item_name;
}

function buildReorderCard(
  order: RecentOrder,
  locationName: string,
  index: number,
): ReorderCardModel {
  const chips = order.items.slice(0, 3).map(truncateItemName);
  if (order.items.length > 3) {
    chips.push(`+${order.items.length - 3} more`);
  }

  return {
    id: order.id,
    title: order.display_date,
    subtitle: order.suppliers.filter(Boolean).join(', ') || locationName,
    itemCount: order.item_count,
    chips,
    isPrimary: index === 0,
    order,
  };
}

const ReorderCard = memo(function ReorderCard({
  card,
  onReorder,
}: ReorderCardProps) {
  const ds = useScaledStyles();
  const buttonHeight = Math.max(40, Math.min(ds.buttonH, 48) - 4);
  const buttonBackground = card.isPrimary ? colors.primary[500] : glassColors.background;
  const buttonBorderColor = card.isPrimary ? colors.primary[500] : glassColors.cardBorder;
  const buttonTextColor = card.isPrimary ? glassColors.textOnPrimary : glassColors.textPrimary;

  return (
    <GlassSurface
      intensity="subtle"
      style={{ borderRadius: ds.radius(20) }}
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
          numberOfLines={1}
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
          onPress={() => onReorder(card.order)}
          style={{
            marginTop: ds.spacing(14),
            minHeight: buttonHeight,
            borderRadius: ds.radius(14),
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: buttonBackground,
            borderWidth: glassHairlineWidth,
            borderColor: buttonBorderColor,
          }}
          activeOpacity={0.85}
        >
          <Text
            style={{
              fontSize: ds.fontSize(13),
              fontWeight: '700',
              color: buttonTextColor,
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
}: EmptyCartReorderStateProps) {
  const ds = useScaledStyles();
  const { height } = useWindowDimensions();
  const {
    recentOrders,
    loading,
    error,
    reload,
  } = useDailySuggestions(locationId);

  const loadOrders = useCallback(async () => {
    try {
      await reload();
    } catch (error) {
      console.error('Unable to load empty cart reorder suggestions', error);
    }
  }, [reload]);

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
  const actionIconSize = ds.icon(15);
  const supportTextMaxWidth = ds.spacing(280);
  const reorderCards = useMemo(
    () =>
      recentOrders
        .slice(0, 5)
        .map((order, index) => buildReorderCard(order, locationName, index)),
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
        flexGrow: reorderCards.length === 0 ? 1 : 0,
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
              No items in cart
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
              Reorder from a past order or browse inventory.
            </Text>

            <View
              style={{
                width: '100%',
                maxWidth: ds.spacing(220),
                alignSelf: 'center',
                marginTop: ds.spacing(24),
              }}
            >
              <TouchableOpacity
                onPress={() => router.push(browseRoute as never)}
                style={{
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
                  Browse inventory
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
      ListEmptyComponent={
        loading ? (
          <GlassSurface
            intensity="subtle"
            style={{
              borderRadius: ds.radius(18),
              paddingVertical: ds.spacing(18),
            }}
          >
            <LoadingIndicator showText text="Loading past orders..." />
          </GlassSurface>
        ) : error ? (
          <GlassSurface
            intensity="subtle"
            style={{
              borderRadius: ds.radius(18),
              paddingHorizontal: ds.spacing(16),
              paddingVertical: ds.spacing(16),
            }}
          >
            <Text
              style={{
                fontSize: ds.fontSize(14),
                fontWeight: '600',
                color: glassColors.textPrimary,
              }}
            >
              Past orders unavailable
            </Text>
            <Text
              style={{
                marginTop: ds.spacing(6),
                fontSize: ds.fontSize(12),
                color: glassColors.textSecondary,
              }}
            >
              {error}
            </Text>
          </GlassSurface>
        ) : (
          <GlassSurface
            intensity="subtle"
            style={{
              borderRadius: ds.radius(18),
              paddingHorizontal: ds.spacing(16),
              paddingVertical: ds.spacing(16),
            }}
          >
            <Text
              style={{
                fontSize: ds.fontSize(14),
                fontWeight: '600',
                color: glassColors.textPrimary,
              }}
            >
              No past orders yet
            </Text>
            <Text
              style={{
                marginTop: ds.spacing(6),
                fontSize: ds.fontSize(12),
                color: glassColors.textSecondary,
              }}
            >
              Place your first order and it&apos;ll show up here.
            </Text>
          </GlassSurface>
        )
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
