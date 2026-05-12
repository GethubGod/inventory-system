import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { triggerConfirmationHaptic, triggerSelectionHaptic } from '@/lib/haptics';
import { colors, glassColors, glassHairlineWidth } from '@/theme/design';
import { QUICK_ORDER_ROW_MIN_HEIGHT, QuickOrderItemRow } from './QuickOrderItemRow';
import { getParsedItemKey, type ParsedQuickOrderItem } from './quickOrderItems';

/** Internal padding of the floating card. */
const CARD_PADDING = 18;
/** Gap between the header block and the list, and between the list and confirm button. */
const CARD_SECTION_GAP = 12;
/** Rows shown before the list starts scrolling internally. */
const VISIBLE_ROW_SLOTS = 4;
/** Height of the empty-state row. */
const EMPTY_ROW_HEIGHT = 44;

type QuickOrderListCardProps = {
  items: ParsedQuickOrderItem[];
  /** Number of items that still need attention before the order can be confirmed. */
  issueCount: number;
  isSubmitting: boolean;
  /** Opens the full edit modal (item picker + quantity + unit). */
  onEditItem: (item: ParsedQuickOrderItem) => void;
  /** Opens the focused quantity/unit dialog for items only missing a quantity/unit. */
  onResolveQuantity: (item: ParsedQuickOrderItem) => void;
  onConfirm: () => void;
  /** Reports the card's measured height so the chat list can reserve matching top space. */
  onHeightChange: (height: number) => void;
};

/**
 * The "Order List" card. It floats over the chat list (the chat scrolls beneath
 * it). The list area has a bounded `maxHeight` and scrolls internally when there
 * are more rows than fit, so the header and the Confirm button stay reachable no
 * matter how many items are in the cart.
 *
 * Layout is intentionally simple: a flex column of [header] / [scrollable rows] /
 * [confirm button]. No absolute positioning for rows, no `overflow: hidden`
 * around the rows, no animated opacity — every item row is always visible.
 */
export function QuickOrderListCard({
  items,
  issueCount,
  isSubmitting,
  onEditItem,
  onResolveQuantity,
  onConfirm,
  onHeightChange,
}: QuickOrderListCardProps) {
  const ds = useScaledStyles();
  const listRef = useRef<FlatList<ParsedQuickOrderItem> | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const count = items.length;
  const isEmpty = count === 0;
  const canCollapse = !isEmpty;
  const confirmDisabled = isEmpty || issueCount > 0 || isSubmitting;

  useEffect(() => {
    if (isEmpty && collapsed) {
      setCollapsed(false);
    }
  }, [collapsed, isEmpty]);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => onHeightChange(event.nativeEvent.layout.height),
    [onHeightChange],
  );

  const handleConfirmPress = useCallback(() => {
    if (confirmDisabled) return;
    void triggerConfirmationHaptic();
    onConfirm();
  }, [confirmDisabled, onConfirm]);

  const handleToggleCollapsed = useCallback(() => {
    if (!canCollapse) return;
    void triggerSelectionHaptic();
    setCollapsed((current) => !current);
  }, [canCollapse]);

  const rowSlot = ds.spacing(QUICK_ORDER_ROW_MIN_HEIGHT);
  const visibleRows = Math.min(count, VISIBLE_ROW_SLOTS);
  const scrollable = count > VISIBLE_ROW_SLOTS;
  const listHeight = rowSlot * Math.max(visibleRows, 1);

  const itemVersion = useMemo(
    () =>
      items
        .map((item) => `${getParsedItemKey(item)}:${item.quantity ?? ''}:${item.unit ?? ''}`)
        .join('|'),
    [items],
  );

  useEffect(() => {
    if (collapsed || count === 0) return;
    const frame = requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [collapsed, count, itemVersion]);

  const renderItem = useCallback(
    ({ item, index }: { item: ParsedQuickOrderItem; index: number }) => (
      <QuickOrderItemRow
        item={item}
        showDivider={index > 0}
        onEdit={onEditItem}
        onResolveQuantity={onResolveQuantity}
      />
    ),
    [onEditItem, onResolveQuantity],
  );

  const keyExtractor = useCallback(
    (item: ParsedQuickOrderItem, index: number) => `${getParsedItemKey(item)}::${index}`,
    [],
  );

  const getItemLayout = useCallback(
    (_: ArrayLike<ParsedQuickOrderItem> | null | undefined, index: number) => ({
      length: rowSlot,
      offset: rowSlot * index,
      index,
    }),
    [rowSlot],
  );

  const summary = `${count} item${count === 1 ? '' : 's'}${
    issueCount > 0 ? ` · ${issueCount} to fix` : ''
  }`;

  const confirmEnabled = !confirmDisabled;
  const confirmLabel = isEmpty
    ? 'Add items to confirm'
    : issueCount > 0
      ? 'Fix items to confirm'
      : 'Confirm order';
  const confirmBackground = confirmEnabled ? colors.primary : colors.glassCircle;
  const confirmForeground = confirmEnabled ? colors.textOnPrimary : colors.textMuted;

  return (
    <View
      onLayout={handleLayout}
      style={[
        styles.card,
        {
          left: ds.spacing(20),
          right: ds.spacing(20),
          borderRadius: ds.radius(24),
          padding: ds.spacing(CARD_PADDING),
        },
      ]}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { fontSize: ds.fontSize(18) }]}>Order List</Text>
        <View style={styles.headerRight}>
          <Text style={[styles.summary, { fontSize: ds.fontSize(13) }]} numberOfLines={1}>
            {summary}
          </Text>
          {canCollapse ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: !collapsed }}
              accessibilityLabel={collapsed ? 'Expand order list' : 'Collapse order list'}
              hitSlop={8}
              onPress={handleToggleCollapsed}
              style={({ pressed }) => [
                styles.chevronButton,
                {
                  marginLeft: ds.spacing(8),
                  borderRadius: ds.radius(14),
                  opacity: pressed ? 0.55 : 1,
                },
              ]}
            >
              <Ionicons
                name={collapsed ? 'chevron-down' : 'chevron-up'}
                size={ds.icon(18)}
                color={colors.textSecondary}
              />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={{ marginTop: collapsed && !isEmpty ? 0 : ds.spacing(CARD_SECTION_GAP) }}>
        {isEmpty ? (
          <View style={[styles.empty, { minHeight: ds.spacing(EMPTY_ROW_HEIGHT) }]}>
            <Text style={[styles.emptyText, { fontSize: ds.fontSize(15) }]}>
              Type below to start your order.
            </Text>
          </View>
        ) : collapsed ? null : (
          <FlatList
            ref={listRef}
            data={items}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            getItemLayout={getItemLayout}
            style={{ height: listHeight, maxHeight: rowSlot * VISIBLE_ROW_SLOTS }}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={scrollable}
            scrollEnabled={scrollable}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            bounces={false}
            initialNumToRender={VISIBLE_ROW_SLOTS}
            maxToRenderPerBatch={VISIBLE_ROW_SLOTS}
            windowSize={3}
            removeClippedSubviews={false}
          />
        )}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: confirmDisabled }}
        accessibilityLabel={
          isEmpty
            ? 'Add items before confirming'
            : confirmDisabled
              ? `Fix ${issueCount} item${issueCount === 1 ? '' : 's'} before confirming`
              : 'Confirm order'
        }
        disabled={confirmDisabled}
        onPress={handleConfirmPress}
        style={({ pressed }) => [
          styles.confirmButton,
          {
            marginTop: ds.spacing(CARD_SECTION_GAP),
            minHeight: ds.spacing(52),
            borderRadius: ds.radius(16),
            backgroundColor: confirmBackground,
            opacity: pressed && confirmEnabled ? 0.85 : 1,
          },
        ]}
      >
        {isSubmitting ? (
          <ActivityIndicator color={confirmForeground} />
        ) : (
          <View style={styles.confirmInner}>
            <Text style={[styles.confirmText, { fontSize: ds.fontSize(16), color: confirmForeground }]}>
              {confirmLabel}
            </Text>
            <Ionicons
              name="arrow-forward"
              size={ds.icon(18)}
              color={confirmForeground}
              style={{ marginLeft: ds.spacing(8) }}
            />
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    top: 0,
    backgroundColor: colors.white,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
    shadowColor: '#111111',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 8,
    zIndex: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    flexShrink: 0,
    color: colors.textPrimary,
    fontWeight: '800',
    letterSpacing: 0,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    marginLeft: 12,
  },
  summary: {
    color: colors.textSecondary,
    fontWeight: '700',
    letterSpacing: 0,
    flexShrink: 1,
    textAlign: 'right',
  },
  chevronButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glassCircle,
  },
  listContent: {},
  empty: {
    justifyContent: 'center',
  },
  emptyText: {
    color: colors.textMuted,
    fontWeight: '700',
    letterSpacing: 0,
  },
  confirmButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  confirmText: {
    fontWeight: '800',
    letterSpacing: 0,
  },
});
