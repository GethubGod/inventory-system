import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '@/components/BottomSheetShell';
import { EmptyStateCard, LoadingIndicator } from '@/components';
import { getFloatingPillClearance } from '@/components/navigation';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { ImpactFeedbackStyle, triggerImpactHaptic } from '@/lib/haptics';
import { glassHairlineWidth, radii, tipsTheme } from '@/theme/design';
import { useSimpleOrderUiStore } from '@/store/simpleOrderUiStore';
import {
  formatHistoryDate,
  formatSentTime,
  listMyRecentOrders,
  type RecentOrder,
} from './recentOrders';

/**
 * History tab: the employee's past sent orders (past_orders), one card per
 * send, with Reorder loading that order's items + quantities into today's
 * checklist and returning to the Order tab. Tapping a card shows the archived
 * message text, read-only.
 */

export function HistoryScreen() {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();
  const setPendingReorder = useSimpleOrderUiStore((state) => state.setPendingReorder);

  const [orders, setOrders] = useState<RecentOrder[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [detailOrder, setDetailOrder] = useState<RecentOrder | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setOrders(await listMyRecentOrders(50));
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Could not load your past orders.',
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await load();
    } finally {
      setIsRefreshing(false);
    }
  }, [load]);

  const handleReorder = useCallback(
    (order: RecentOrder) => {
      if (order.reorderItems.length === 0) return;
      void triggerImpactHaptic(ImpactFeedbackStyle.Light);
      setPendingReorder({
        items: order.reorderItems,
        sourceLabel: formatHistoryDate(order.createdAt) || 'that order',
      });
      router.push('/(tabs)/simple-order' as never);
    },
    [setPendingReorder],
  );

  const bottomPadding = getFloatingPillClearance(insets.bottom) + ds.spacing(12);

  const renderOrder = useCallback(
    ({ item }: { item: RecentOrder }) => {
      const countBit =
        item.itemCount !== null
          ? `${item.itemCount} ${item.itemCount === 1 ? 'item' : 'items'}`
          : item.supplierName;
      const timeBit = formatSentTime(item.createdAt);
      return (
        <TouchableOpacity
          onPress={() => setDetailOrder(item)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`Order from ${formatHistoryDate(item.createdAt)}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: ds.spacing(12),
            backgroundColor: tipsTheme.card,
            borderWidth: glassHairlineWidth,
            borderColor: tipsTheme.hairline,
            borderRadius: 18,
            paddingHorizontal: ds.spacing(16),
            paddingVertical: ds.spacing(14),
            marginBottom: ds.spacing(10),
          }}
        >
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: radii.circle,
              backgroundColor: tipsTheme.well,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="receipt-outline" size={ds.icon(18)} color={tipsTheme.ink} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              numberOfLines={1}
              style={{ fontSize: ds.fontSize(14.5), fontWeight: '700', color: tipsTheme.ink }}
            >
              {formatHistoryDate(item.createdAt)}
            </Text>
            <Text style={{ fontSize: ds.fontSize(12), color: tipsTheme.ink2, marginTop: 1 }}>
              {countBit}
              {timeBit ? ` · sent ${timeBit}` : ''}
            </Text>
          </View>
          {item.reorderItems.length > 0 ? (
            <TouchableOpacity
              onPress={() => handleReorder(item)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`Reorder ${countBit}`}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              style={{
                backgroundColor: tipsTheme.tint,
                borderRadius: radii.pill,
                paddingHorizontal: ds.spacing(13),
                paddingVertical: ds.spacing(7),
              }}
            >
              <Text
                style={{ fontSize: ds.fontSize(12), fontWeight: '700', color: tipsTheme.accent }}
              >
                Reorder
              </Text>
            </TouchableOpacity>
          ) : null}
        </TouchableOpacity>
      );
    },
    [ds, handleReorder],
  );

  let content: React.ReactNode;
  if (orders === null && !loadError) {
    content = <LoadingIndicator />;
  } else if (loadError) {
    content = (
      <View style={{ paddingTop: ds.spacing(24) }}>
        <EmptyStateCard
          icon="alert-circle-outline"
          title="History unavailable"
          message={loadError}
          actionLabel="Try again"
          onPressAction={() => void load()}
        />
      </View>
    );
  } else if ((orders ?? []).length === 0) {
    content = (
      <View style={{ paddingTop: ds.spacing(24) }}>
        <EmptyStateCard
          icon="receipt-outline"
          title="No sent orders yet"
          message="Orders appear here after they are sent to suppliers. Orders waiting for manager review show up once they are processed."
        />
      </View>
    );
  } else {
    content = (
      <FlatList
        data={orders}
        keyExtractor={(item) => item.id}
        renderItem={renderOrder}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: bottomPadding }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void handleRefresh()}
            tintColor={tipsTheme.accent}
          />
        }
      />
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: tipsTheme.page }}>
      <View style={{ flex: 1, paddingHorizontal: ds.spacing(18) }}>
        <View style={{ paddingTop: ds.spacing(2), paddingBottom: ds.spacing(10) }}>
          <Text style={{ fontSize: ds.fontSize(24), fontWeight: '700', color: tipsTheme.ink }}>
            Past orders
          </Text>
        </View>
        {content}
      </View>

      <BottomSheetShell
        visible={detailOrder !== null}
        onClose={() => setDetailOrder(null)}
        bottomPadding={Math.max(insets.bottom, ds.spacing(12))}
      >
        {detailOrder ? (
          <>
            <Text style={{ fontSize: ds.fontSize(20), fontWeight: '700', color: tipsTheme.ink }}>
              {formatHistoryDate(detailOrder.createdAt)}
            </Text>
            <Text
              style={{
                fontSize: ds.fontSize(13),
                color: tipsTheme.ink2,
                marginBottom: ds.spacing(12),
              }}
            >
              {detailOrder.supplierName}
              {formatSentTime(detailOrder.createdAt)
                ? ` · sent ${formatSentTime(detailOrder.createdAt)}`
                : ''}
            </Text>
            <ScrollView style={{ maxHeight: ds.spacing(320) }} showsVerticalScrollIndicator={false}>
              <View
                style={{
                  backgroundColor: tipsTheme.card,
                  borderWidth: glassHairlineWidth,
                  borderColor: tipsTheme.hairline,
                  borderRadius: 16,
                  padding: ds.spacing(14),
                }}
              >
                <Text style={{ fontSize: ds.fontSize(13), color: tipsTheme.ink, lineHeight: 19 }}>
                  {detailOrder.messageText || 'No message text was archived for this order.'}
                </Text>
              </View>
            </ScrollView>
            {detailOrder.reorderItems.length > 0 ? (
              <TouchableOpacity
                onPress={() => {
                  const order = detailOrder;
                  setDetailOrder(null);
                  handleReorder(order);
                }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Reorder these items"
                style={{
                  marginTop: ds.spacing(14),
                  minHeight: 50,
                  borderRadius: radii.pill,
                  backgroundColor: tipsTheme.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: ds.fontSize(15), fontWeight: '700', color: '#FFFFFF' }}>
                  Reorder these items
                </Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : null}
      </BottomSheetShell>
    </SafeAreaView>
  );
}
