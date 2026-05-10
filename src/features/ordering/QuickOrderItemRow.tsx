import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
const INFO_BUTTON_SIZE = 28;

type QuickOrderItemRowProps = {
  item: ParsedQuickOrderItem;
  /** Renders a hairline divider above the row (used for every row except the first). */
  showDivider: boolean;
  /** Opens the full edit popup (item picker + quantity + unit) for this item. */
  onEdit: (item: ParsedQuickOrderItem) => void;
  /** Opens the focused quantity/unit dialog for an item that only needs that. */
  onResolveQuantity: (item: ParsedQuickOrderItem) => void;
};

/**
 * One compact line inside the Order List card:
 * [status icon] [name + info button] [quantity / tappable issue action].
 *
 * Deliberately a plain `View` with explicit colors and no opacity / transform /
 * layout animation, so the row text is always visible regardless of animation
 * state. When the item has an issue, the trailing text becomes a tappable
 * orange action: "Add quantity" / "Pick unit" open the focused quantity dialog;
 * "Choose item" / "Needs review" open the full edit modal.
 */
export const QuickOrderItemRow = React.memo(function QuickOrderItemRow({
  item,
  showDivider,
  onEdit,
  onResolveQuantity,
}: QuickOrderItemRowProps) {
  const ds = useScaledStyles();
  const issue = getParsedItemIssue(item);
  const name = getParsedItemDisplayName(item);
  const nameIsPlaceholder = !hasParsedItemName(item) && !item.raw_token?.trim();
  const accent = issue ? colors.statusAmber : colors.statusGreen;
  const trailingLabel = issue ? issue.label : formatParsedItemQuantity(item);

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

  return (
    <View
      style={[
        styles.row,
        {
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Adjust details for ${name}`}
          hitSlop={{ top: 10, right: 10, bottom: 10, left: 8 }}
          onPress={handleEditPress}
          style={({ pressed }) => [
            styles.infoButton,
            {
              width: ds.spacing(INFO_BUTTON_SIZE),
              height: ds.spacing(INFO_BUTTON_SIZE),
              borderRadius: ds.radius(INFO_BUTTON_SIZE / 2),
              marginLeft: ds.spacing(6),
              opacity: pressed ? 0.68 : 1,
            },
          ]}
        >
          <Ionicons name="information-circle" size={ds.icon(17)} color={colors.tagBlue} />
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
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={[styles.trailingText, { fontSize: ds.fontSize(14), color: colors.textSecondary, marginLeft: ds.spacing(10) }]}
        >
          {trailingLabel}
        </Text>
      )}
    </View>
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
  name: {
    fontWeight: '700',
    letterSpacing: 0,
    flexShrink: 1,
  },
  trailingText: {
    minWidth: 76,
    maxWidth: 116,
    textAlign: 'right',
    fontWeight: '800',
    letterSpacing: 0,
    flexShrink: 1,
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
  infoButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.tagBlueBg,
    borderWidth: glassHairlineWidth,
    borderColor: colors.tagBlue,
  },
});
