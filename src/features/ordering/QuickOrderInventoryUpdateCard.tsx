import React, { useCallback, useState } from "react";
import {
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useScaledStyles } from "@/hooks/useScaledStyles";
import { triggerSelectionHaptic } from "@/lib/haptics";
import {
  colors,
  glassColors,
  glassHairlineWidth,
  quickOrderAccent,
} from "@/theme/design";
import { formatQuickOrderQuantity } from "./quickOrderItems";
import {
  getInventoryUpdateStatus,
  type QuickOrderInventoryUpdate,
} from "./quickOrderInventoryUpdates";

const INVENTORY_UPDATE_COLLAPSED_COUNT = 4;

/**
 * Inventory-mode confirmation card. Replaces the older "Current stock" list and
 * the separate text reply: it shows each counted item as
 * `name current → ordered`, making the system's chosen order quantity obvious
 * at a glance. When more than {@link INVENTORY_UPDATE_COLLAPSED_COUNT} items
 * came back, the extra rows collapse behind a tappable "+N more" toggle.
 *
 * Row layout — every row is ONE line and must never wrap:
 *
 *   [ name + counted qty ............(ellipsizes)  ] [– / →  trailing ]
 *      flexShrink:1, minWidth:0, numberOfLines={1}     flexShrink:0
 *
 * The name takes the remaining width and truncates with an ellipsis; the
 * trailing cluster (the arrow + ordered qty, or "Needs input ›", or "– 0 unit")
 * is a non-shrinking row pinned right after it. There is deliberately NO
 * `flexWrap` anywhere: wrapping is what produced the old ragged two-line rows.
 * See docs/quick-order-inventory-row-layout.md before changing this.
 */
export const InventoryUpdateCard = React.memo(function InventoryUpdateCard({
  updates,
  onNeedsInput,
  onLayout,
}: {
  updates: QuickOrderInventoryUpdate[];
  onNeedsInput: (update: QuickOrderInventoryUpdate) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const ds = useScaledStyles();
  const [expanded, setExpanded] = useState(false);
  const handleToggle = useCallback(() => {
    void triggerSelectionHaptic();
    setExpanded((prev) => !prev);
  }, []);
  if (updates.length === 0) return null;
  const hasOverflow = updates.length > INVENTORY_UPDATE_COLLAPSED_COUNT;
  const visibleUpdates =
    expanded || !hasOverflow
      ? updates
      : updates.slice(0, INVENTORY_UPDATE_COLLAPSED_COUNT);
  const hiddenCount = updates.length - INVENTORY_UPDATE_COLLAPSED_COUNT;

  return (
    <View
      onLayout={onLayout}
      style={[
        styles.card,
        {
          borderRadius: ds.radius(16),
          padding: ds.spacing(12),
          marginTop: ds.spacing(10),
        },
      ]}
    >
      <Ionicons name="clipboard-outline" size={ds.icon(18)} color={quickOrderAccent} />
      <View style={[styles.textCluster, { marginLeft: ds.spacing(8), gap: ds.spacing(6) }]}>
        <Text style={[styles.title, { fontSize: ds.fontSize(13) }]}>
          Updated
        </Text>
        {visibleUpdates.map((update, index) => {
          const status = getInventoryUpdateStatus(update);
          const currentLabel =
            update.current_quantity != null
              ? formatQuickOrderQuantity(update.current_quantity, update.current_unit)
              : update.current_label?.trim() ?? "";
          const noOrderUnit = update.new_unit ?? update.current_unit;
          const noOrderLabel = noOrderUnit
            ? formatQuickOrderQuantity(0, noOrderUnit)
            : "No order";

          return (
            <View key={`${update.item_id}:${index}`} style={styles.row}>
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={[styles.rowName, { fontSize: ds.fontSize(14) }]}
              >
                {update.item_name}
                {currentLabel ? ` ${currentLabel}` : ""}
              </Text>
              <View style={[styles.trailing, { marginLeft: ds.spacing(6), gap: ds.spacing(4) }]}>
                {status === "ordered" && update.new_quantity != null ? (
                  <>
                    <Ionicons
                      name="arrow-forward"
                      size={ds.icon(14)}
                      color={colors.textSecondary}
                    />
                    <Text style={[styles.newText, { fontSize: ds.fontSize(14) }]}>
                      {formatQuickOrderQuantity(update.new_quantity, update.new_unit)}
                    </Text>
                  </>
                ) : status === "needs_input" ? (
                  <>
                    <Text style={[styles.dashText, { fontSize: ds.fontSize(14) }]}>
                      –
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Needs input for ${update.item_name}`}
                      hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                      onPress={() => onNeedsInput(update)}
                      style={({ pressed }) => [
                        styles.needsInputButton,
                        { opacity: pressed ? 0.6 : 1 },
                      ]}
                    >
                      <Text
                        numberOfLines={1}
                        style={[styles.needsInputText, { fontSize: ds.fontSize(14) }]}
                      >
                        Needs input
                      </Text>
                      <Ionicons
                        name="chevron-forward"
                        size={ds.icon(13)}
                        color={colors.statusAmber}
                        style={{ marginLeft: ds.spacing(2) }}
                      />
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Text style={[styles.dashText, { fontSize: ds.fontSize(14) }]}>
                      –
                    </Text>
                    <Text style={[styles.notOrderedText, { fontSize: ds.fontSize(14) }]}>
                      {noOrderLabel}
                    </Text>
                  </>
                )}
              </View>
            </View>
          );
        })}
        {hasOverflow ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              expanded ? "Show fewer items" : `Show ${hiddenCount} more items`
            }
            onPress={handleToggle}
            hitSlop={8}
          >
            <Text style={[styles.moreText, { fontSize: ds.fontSize(12) }]}>
              {expanded ? "Show less" : `+${hiddenCount} more`}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    alignSelf: "flex-start",
    maxWidth: "94%",
    flexDirection: "row",
    alignItems: "flex-start",
    borderWidth: glassHairlineWidth,
    backgroundColor: colors.white,
    borderColor: glassColors.cardBorder,
  },
  textCluster: {
    flex: 1,
  },
  title: {
    color: colors.textSecondary,
    fontWeight: "800",
    letterSpacing: 0,
  },
  // One inventory line. No flexWrap: the name shrinks/ellipsizes so the trailing
  // cluster always stays on the same line instead of dropping to a second row.
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  rowName: {
    flexShrink: 1,
    minWidth: 0,
    color: colors.textPrimary,
    fontWeight: "800",
    letterSpacing: 0,
  },
  // Pinned right after the name and never shrinks, so "→ 1 piece" /
  // "Needs input ›" / "– 0 cases" reads as one unit on the line.
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
  },
  newText: {
    color: quickOrderAccent,
    fontWeight: "800",
    letterSpacing: 0,
  },
  dashText: {
    color: colors.textSecondary,
    fontWeight: "800",
    letterSpacing: 0,
  },
  needsInputButton: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    flexWrap: "nowrap",
  },
  needsInputText: {
    color: colors.statusAmber,
    fontWeight: "800",
    letterSpacing: 0,
    textDecorationLine: "underline",
  },
  // Counted but not ordered (above range, no order needed, etc.): "– 0 unit" in
  // black so it reads as deliberately left alone, distinct from the red orders.
  notOrderedText: {
    color: colors.textPrimary,
    fontWeight: "800",
    letterSpacing: 0,
  },
  moreText: {
    color: colors.textMuted,
    fontWeight: "700",
    letterSpacing: 0,
  },
});
