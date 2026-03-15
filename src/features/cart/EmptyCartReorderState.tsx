import React, { memo, useCallback, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { GlassSurface, LoadingIndicator } from '@/components';
import {
  formatOrderDateLabel,
  type HistoricalOrderSummary,
  type LocationOrderInsights,
  fetchLocationOrderInsights,
} from '@/features/ordering/orderInsights';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassSpacing,
} from '@/design/tokens';
import { colors } from '@/constants';

interface EmptyCartReorderStateProps {
  browseRoute: string;
  locationName: string;
  locationId: string | null;
  onReorder: (order: HistoricalOrderSummary) => void;
  quickOrderRoute: string;
}

interface ReorderCardProps {
  isPrimary: boolean;
  locationName: string;
  onReorder: (order: HistoricalOrderSummary) => void;
  order: HistoricalOrderSummary;
}

function getPreviewLabels(order: HistoricalOrderSummary): string[] {
  return Array.from(new Set(order.items.map((item) => item.name)));
}

const ReorderCard = memo(function ReorderCard({
  isPrimary,
  locationName,
  onReorder,
  order,
}: ReorderCardProps) {
  const ds = useScaledStyles();
  const previewLabels = getPreviewLabels(order);
  const visibleLabels = previewLabels.slice(0, 3);
  const remainingCount = Math.max(previewLabels.length - visibleLabels.length, 0);

  return (
    <GlassSurface
      intensity="subtle"
      style={{
        borderRadius: glassRadii.surface,
      }}
    >
      <View style={{ padding: ds.spacing(14) }}>
        <View className="flex-row items-start justify-between">
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
            >
              {locationName} · {order.itemCount} items
            </Text>
          </View>
        </View>

        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: ds.spacing(8),
            marginTop: ds.spacing(12),
          }}
        >
          {visibleLabels.map((label) => (
            <View
              key={label}
              style={{
                backgroundColor: glassColors.mediumFill,
                borderWidth: glassHairlineWidth,
                borderColor: glassColors.cardBorder,
                borderRadius: glassRadii.button,
                paddingHorizontal: ds.spacing(10),
                paddingVertical: ds.spacing(5),
              }}
            >
              <Text
                style={{
                  fontSize: ds.fontSize(11),
                  color: glassColors.textSecondary,
                }}
              >
                {label}
              </Text>
            </View>
          ))}
          {remainingCount > 0 ? (
            <View
              style={{
                backgroundColor: glassColors.mediumFill,
                borderWidth: glassHairlineWidth,
                borderColor: glassColors.cardBorder,
                borderRadius: glassRadii.button,
                paddingHorizontal: ds.spacing(10),
                paddingVertical: ds.spacing(5),
              }}
            >
              <Text
                style={{
                  fontSize: ds.fontSize(11),
                  color: glassColors.textSecondary,
                }}
              >
                +{remainingCount} more
              </Text>
            </View>
          ) : null}
        </View>

        <TouchableOpacity
          onPress={() => onReorder(order)}
          style={{
            marginTop: ds.spacing(14),
            minHeight: Math.max(44, ds.buttonH),
            borderRadius: glassRadii.button,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: isPrimary
              ? colors.primary[500]
              : glassColors.mediumFill,
            borderWidth: isPrimary ? 0 : glassHairlineWidth,
            borderColor: isPrimary ? 'transparent' : glassColors.cardBorder,
          }}
          activeOpacity={0.85}
        >
          <Text
            style={{
              fontSize: ds.fontSize(13),
              fontWeight: '700',
              color: isPrimary
                ? glassColors.textOnPrimary
                : glassColors.textPrimary,
            }}
          >
            Reorder all {order.itemCount} items
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [recentOrders, setRecentOrders] = useState<HistoricalOrderSummary[]>([]);

  const loadOrders = useCallback(async () => {
    if (!locationId) {
      setRecentOrders([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const insights: LocationOrderInsights = await fetchLocationOrderInsights(locationId);
      setRecentOrders(insights.recentOrders);
    } catch (error) {
      console.error('Unable to load empty cart reorder suggestions', error);
      setRecentOrders([]);
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useFocusEffect(
    useCallback(() => {
      void loadOrders();
    }, [loadOrders]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadOrders();
    setRefreshing(false);
  }, [loadOrders]);

  const renderOrderCard = useCallback(
    ({ item, index }: { item: HistoricalOrderSummary; index: number }) => (
      <ReorderCard
        isPrimary={index === 0}
        locationName={locationName}
        onReorder={onReorder}
        order={item}
      />
    ),
    [locationName, onReorder],
  );

  return (
    <FlatList
      data={recentOrders}
      renderItem={renderOrderCard}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{
        paddingHorizontal: glassSpacing.screen,
        paddingBottom: glassSpacing.screen,
        flexGrow: recentOrders.length === 0 ? 1 : 0,
        gap: ds.spacing(10),
      }}
      ListHeaderComponent={
        <View style={{ paddingTop: ds.spacing(12), paddingBottom: ds.spacing(12) }}>
          <View className="items-center justify-center">
            <GlassSurface
              intensity="medium"
              style={{
                width: ds.icon(54),
                height: ds.icon(54),
                borderRadius: glassRadii.round,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons
                name="bag-handle-outline"
                size={ds.icon(24)}
                color={colors.gray[400]}
              />
            </GlassSurface>
            <Text
              style={{
                marginTop: ds.spacing(16),
                fontSize: ds.fontSize(18),
                fontWeight: '600',
                color: glassColors.textPrimary,
              }}
            >
              No items in cart
            </Text>
            <Text
              style={{
                marginTop: ds.spacing(6),
                fontSize: ds.fontSize(12),
                color: glassColors.textSecondary,
                textAlign: 'center',
              }}
            >
              Reorder from a past order or browse inventory
            </Text>
          </View>

          <Text
            style={{
              marginTop: ds.spacing(24),
              marginBottom: ds.spacing(12),
              color: glassColors.textSecondary,
              fontSize: ds.fontSize(12),
              fontWeight: '600',
              letterSpacing: 1.3,
              textTransform: 'uppercase',
            }}
          >
            Reorder A Past Order
          </Text>
        </View>
      }
      ListEmptyComponent={
        loading ? (
          <View style={{ paddingTop: ds.spacing(20) }}>
            <LoadingIndicator showText text="Loading suggestions..." />
          </View>
        ) : (
          <View>
            <GlassSurface
              intensity="subtle"
              style={{
                borderRadius: glassRadii.surface,
                padding: ds.spacing(18),
                alignItems: 'center',
              }}
            >
              <Text
                style={{
                  fontSize: ds.fontSize(15),
                  fontWeight: '600',
                  color: glassColors.textPrimary,
                }}
              >
                No recent orders for this location
              </Text>
              <Text
                style={{
                  marginTop: ds.spacing(6),
                  fontSize: ds.fontSize(12),
                  color: glassColors.textSecondary,
                  textAlign: 'center',
                }}
              >
                Start a new cart from Quick Order or browse inventory.
              </Text>
            </GlassSurface>

            <View
              className="flex-row"
              style={{ gap: ds.spacing(12), marginTop: ds.spacing(16) }}
            >
              <TouchableOpacity
                onPress={() => router.push(quickOrderRoute as never)}
                style={{
                  flex: 1,
                  borderRadius: glassRadii.button,
                  minHeight: ds.buttonH,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  backgroundColor: colors.primary[500],
                }}
                activeOpacity={0.85}
              >
                <Ionicons name="flash" size={ds.icon(18)} color={colors.white} />
                <Text
                  style={{
                    marginLeft: ds.spacing(8),
                    fontSize: ds.buttonFont,
                    fontWeight: '700',
                    color: glassColors.textOnPrimary,
                  }}
                >
                  Quick Order
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => router.push(browseRoute as never)}
                style={{
                  flex: 1,
                  borderRadius: glassRadii.button,
                  minHeight: ds.buttonH,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: glassColors.mediumFill,
                  borderWidth: glassHairlineWidth,
                  borderColor: glassColors.cardBorder,
                }}
                activeOpacity={0.85}
              >
                <Text
                  style={{
                    fontSize: ds.buttonFont,
                    fontWeight: '700',
                    color: glassColors.textPrimary,
                  }}
                >
                  Browse
                </Text>
              </TouchableOpacity>
            </View>
          </View>
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
