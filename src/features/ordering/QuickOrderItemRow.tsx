import React, { useCallback, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { triggerSelectionHaptic } from '@/lib/haptics';
import { colors, glassHairlineWidth } from '@/theme/design';
import {
  formatParsedItemQuantity,
  getParsedItemDisplayName,
  getParsedItemIssue,
  hasParsedItemName,
  type ParsedQuickOrderItem,
} from './quickOrderItems';

/** Compact row slot used by the bounded Order List FlatList. */
export const QUICK_ORDER_ROW_MIN_HEIGHT = 44;

type OrderListQuantityLine = {
  label: string;
  item: ParsedQuickOrderItem;
};

export type ResolveQuantityOptions = {
  /** Edit only the tapped row instead of walking every item missing a quantity. */
  single?: boolean;
};

type QuickOrderItemRowProps = {
  item: ParsedQuickOrderItem;
  quantityLines?: OrderListQuantityLine[];
  /** Renders a hairline divider above the row (used for every row except the first). */
  showDivider: boolean;
  /** Opens the full edit popup (item picker + quantity + unit) for this item. */
  onEdit: (item: ParsedQuickOrderItem) => void;
  /** Opens the focused quantity/unit dialog for an item that only needs that. */
  onResolveQuantity: (
    item: ParsedQuickOrderItem,
    options?: ResolveQuantityOptions,
  ) => void;
  /**
   * Removes this row from the order. When provided, the row becomes swipeable
   * (left or right) to reveal a Delete action. Omit to render a static row.
   */
  onRemove?: () => void;
};

/**
 * One compact line inside the Order List card:
 * [status icon] [name, tappable to edit] [quantity / tappable issue action].
 *
 * Deliberately a plain `View` with explicit colors and no opacity / transform /
 * layout animation, so the row text is always visible regardless of animation
 * state. When the item has an issue, the trailing text becomes a tappable
 * orange action: "Add quantity" / "Pick unit" open the focused quantity dialog;
 * "Choose item" / "Needs review" open the full edit modal.
 *
 * When `onRemove` is supplied the row is wrapped in a Swipeable so a left- or
 * right-swipe reveals a Delete action the user can tap.
 */
export const QuickOrderItemRow = React.memo(function QuickOrderItemRow({
  item,
  quantityLines,
  showDivider,
  onEdit,
  onResolveQuantity,
  onRemove,
}: QuickOrderItemRowProps) {
  const ds = useScaledStyles();
  const swipeableRef = useRef<SwipeableMethods | null>(null);
  const issue = getParsedItemIssue(item);
  const name = getParsedItemDisplayName(item);
  const nameIsPlaceholder = !hasParsedItemName(item) && !item.raw_token?.trim();
  const accent = issue ? colors.statusAmber : colors.statusGreen;
  const quantityEntries = quantityLines?.length
    ? quantityLines
    : [{ label: formatParsedItemQuantity(item), item }];
  const trailingLabel = issue ? issue.label : quantityEntries[0].label;
  const reviewQuantityLabel = issue ? formatParsedItemQuantity(item) : null;
  const suggested =
    item.isSuggested === true ||
    item.source === 'inventory_recommendation' ||
    item.source === 'remaining_recommendation';

  const handleEditPress = useCallback(() => {
    void triggerSelectionHaptic();
    onEdit(item);
  }, [item, onEdit]);

  const handleIssuePress = useCallback(() => {
    void triggerSelectionHaptic();
    if (issue?.kind === 'pick-quantity' || issue?.kind === 'pick-unit') {
      onResolveQuantity(item);
    } else {
      onEdit(item);
    }
  }, [issue?.kind, item, onEdit, onResolveQuantity]);

  const handleQuantityPress = useCallback(
    (lineItem: ParsedQuickOrderItem) => {
      void triggerSelectionHaptic();
      onResolveQuantity(lineItem, { single: true });
    },
    [onResolveQuantity],
  );

  const handleDeletePress = useCallback(() => {
    swipeableRef.current?.close();
    void triggerSelectionHaptic();
    onRemove?.();
  }, [onRemove]);

  const renderDeleteAction = useCallback(
    () => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${name}`}
        onPress={handleDeletePress}
        style={({ pressed }) => [
          styles.deleteAction,
          { width: ds.spacing(84), opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Ionicons name="trash-outline" size={ds.icon(20)} color={colors.white} />
        <Text style={[styles.deleteActionText, { fontSize: ds.fontSize(12) }]}>
          Delete
        </Text>
      </Pressable>
    ),
    [ds, handleDeletePress, name],
  );

  const rowContent = (
    <View
      style={[
        styles.row,
        {
          backgroundColor: colors.white,
          minHeight: ds.spacing(QUICK_ORDER_ROW_MIN_HEIGHT),
          paddingVertical: ds.spacing(6),
          borderTopWidth: showDivider ? glassHairlineWidth : 0,
          borderTopColor: colors.divider,
        },
      ]}
    >
      <View style={styles.statusColumn}>
        <Ionicons
          name={issue ? 'alert-circle' : 'checkmark-circle'}
          size={ds.icon(19)}
          color={accent}
        />
      </View>

      <View style={styles.nameCluster}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Adjust details for ${name}`}
          hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          onPress={handleEditPress}
          style={({ pressed }) => [styles.namePressable, { opacity: pressed ? 0.65 : 1 }]}
        >
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[
              styles.name,
              {
                fontSize: ds.fontSize(15),
                color: nameIsPlaceholder ? colors.textSecondary : colors.textPrimary,
              },
            ]}
          >
            {name}
          </Text>
          {reviewQuantityLabel && reviewQuantityLabel !== 'Quantity needed' ? (
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[styles.reviewQuantityText, { fontSize: ds.fontSize(12), color: colors.textSecondary }]}
            >
              {reviewQuantityLabel}
            </Text>
          ) : null}
          {!issue && suggested ? (
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[styles.suggestedText, { fontSize: ds.fontSize(11), marginTop: ds.spacing(2) }]}
            >
              Suggested
            </Text>
          ) : null}
        </Pressable>
      </View>

      {issue ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${issue.label} for ${name}`}
          hitSlop={{ top: 10, right: 6, bottom: 10, left: 10 }}
          onPress={handleIssuePress}
          style={({ pressed }) => [styles.trailingAction, { marginLeft: ds.spacing(10), opacity: pressed ? 0.6 : 1 }]}
        >
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[styles.trailingActionText, { fontSize: ds.fontSize(14), color: colors.statusAmber }]}
          >
            {trailingLabel}
          </Text>
          <Ionicons
            name="chevron-forward"
            size={ds.icon(13)}
            color={colors.statusAmber}
            style={{ marginLeft: ds.spacing(2) }}
          />
        </Pressable>
      ) : (
        <View style={[styles.trailingStack, { marginLeft: ds.spacing(10) }]}>
          {quantityEntries.map((entry, index) => (
            <Pressable
              key={`${entry.label}:${index}`}
              accessibilityRole="button"
              accessibilityLabel={`Change quantity for ${name}, currently ${entry.label}`}
              hitSlop={{ top: 10, right: 6, bottom: 10, left: 10 }}
              onPress={() => handleQuantityPress(entry.item)}
              style={({ pressed }) => [
                styles.trailingQuantityPressable,
                {
                  borderTopWidth: index > 0 ? glassHairlineWidth : 0,
                  borderTopColor: colors.divider,
                  paddingTop: index > 0 ? ds.spacing(3) : 0,
                  marginTop: index > 0 ? ds.spacing(3) : 0,
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={[
                  styles.trailingText,
                  {
                    fontSize: ds.fontSize(14),
                    color: colors.textSecondary,
                  },
                ]}
              >
                {entry.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );

  if (!onRemove) return rowContent;

  return (
    <ReanimatedSwipeable
      ref={swipeableRef}
      friction={2}
      leftThreshold={40}
      rightThreshold={40}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={renderDeleteAction}
      renderRightActions={renderDeleteAction}
    >
      {rowContent}
    </ReanimatedSwipeable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusColumn: {
    width: 28,
    alignItems: 'flex-start',
  },
  nameCluster: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  namePressable: {
    flexShrink: 1,
    minWidth: 0,
  },
  name: {
    fontWeight: '700',
    letterSpacing: 0,
  },
  reviewQuantityText: {
    marginTop: 2,
    fontWeight: '700',
    letterSpacing: 0,
  },
  suggestedText: {
    color: colors.textSecondary,
    fontWeight: '500',
    fontStyle: 'italic',
    letterSpacing: 0,
  },
  trailingText: {
    minWidth: 76,
    maxWidth: 116,
    textAlign: 'right',
    fontWeight: '800',
    letterSpacing: 0,
  },
  trailingStack: {
    minWidth: 86,
    maxWidth: 128,
    flexShrink: 1,
    alignItems: 'stretch',
  },
  trailingQuantityPressable: {
    alignItems: 'flex-end',
  },
  trailingAction: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  trailingActionText: {
    fontWeight: '800',
    letterSpacing: 0,
    textDecorationLine: 'underline',
  },
  deleteAction: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.tagRed,
  },
  deleteActionText: {
    color: colors.white,
    fontWeight: '800',
    letterSpacing: 0,
    marginTop: 2,
  },
});
