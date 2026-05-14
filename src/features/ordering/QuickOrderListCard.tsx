import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useScaledStyles } from "@/hooks/useScaledStyles";
import { triggerConfirmationHaptic } from "@/lib/haptics";
import { colors, glassColors, glassHairlineWidth } from "@/theme/design";
import {
  QUICK_ORDER_ROW_MIN_HEIGHT,
  QuickOrderItemRow,
} from "./QuickOrderItemRow";
import {
  getParsedItemIssue,
  getParsedItemKey,
  type ParsedQuickOrderItem,
} from "./quickOrderItems";

const CARD_PADDING = 14;
const CARD_SECTION_GAP = 10;
const VISIBLE_ROW_SLOTS = 4;
const CTA_HEIGHT = 52;

type QuickOrderListCardProps = {
  items: ParsedQuickOrderItem[];
  /** Number of items that still need attention before the order can be confirmed. */
  issueCount: number;
  isSubmitting: boolean;
  onEditItem: (item: ParsedQuickOrderItem) => void;
  onResolveQuantity: (item: ParsedQuickOrderItem) => void;
  onConfirm: () => void;
  onHeightChange: (height: number) => void;
};

type ConfirmState = "empty" | "needs-fixing" | "ready" | "confirming";

/**
 * Order List card.
 *
 *   1. Header               — title + summary, compact padding
 *   2. List slot            — empty hint (slim) or ScrollView capped at 4 rows
 *      Scroll affordance     — chevron-down on the right when more rows exist
 *   3. Confirm footer        — TouchableOpacity with inline solid background.
 *      Decorative overlay    — in the `ready` state, an extra absolutely-
 *                              positioned pill is rendered on top of the
 *                              footer so the Confirm Order CTA is visible even
 *                              if the underlying Pressable paint fails.
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
  const scrollRef = useRef<ScrollView | null>(null);

  const count = items.length;
  const isEmpty = count === 0;

  const confirmState: ConfirmState = isSubmitting
    ? "confirming"
    : isEmpty
      ? "empty"
      : issueCount > 0
        ? "needs-fixing"
        : "ready";

  const rowSlot = ds.spacing(QUICK_ORDER_ROW_MIN_HEIGHT);
  const scrollable = count > VISIBLE_ROW_SLOTS;
  const listMaxHeight = rowSlot * VISIBLE_ROW_SLOTS;

  // Tracks how close the scroll position is to the bottom so the scroll-hint
  // pill can flip its direction (down → up) once the user is already at the
  // end of the list. Defaults to "not at bottom" until we get a real event.
  const [isAtBottom, setIsAtBottom] = useState(false);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;
      const distanceFromBottom =
        contentSize.height - layoutMeasurement.height - contentOffset.y;
      setIsAtBottom(distanceFromBottom <= rowSlot * 0.5);
    },
    [rowSlot],
  );

  const handleScrollHintPress = useCallback(() => {
    if (!scrollRef.current) return;
    if (isAtBottom) {
      scrollRef.current.scrollTo({ y: 0, animated: true });
    } else {
      scrollRef.current.scrollToEnd({ animated: true });
    }
  }, [isAtBottom]);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) =>
      onHeightChange(event.nativeEvent.layout.height),
    [onHeightChange],
  );

  const handleConfirmPress = useCallback(() => {
    if (confirmState !== "ready") return;
    void triggerConfirmationHaptic();
    onConfirm();
  }, [confirmState, onConfirm]);

  const summary = `${count} item${count === 1 ? "" : "s"}${
    issueCount > 0 ? ` · ${issueCount} to fix` : ""
  }`;

  // Find the first item that needs attention so we can scroll it into view.
  const firstIssueIndex = useMemo(() => {
    if (issueCount === 0) return -1;
    for (let i = 0; i < items.length; i += 1) {
      if (getParsedItemIssue(items[i]) != null) return i;
    }
    return -1;
  }, [items, issueCount]);

  // When the list grows, follow the newest row.
  const previousCount = useRef(count);
  useEffect(() => {
    const grew = count > previousCount.current;
    previousCount.current = count;
    if (count === 0 || !grew) return;
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [count]);

  // When an issue appears, scroll the offending item into view (only useful
  // when it sits below the visible window).
  useEffect(() => {
    if (firstIssueIndex < 0 || !scrollable) return;
    if (firstIssueIndex < VISIBLE_ROW_SLOTS) return;
    const frame = requestAnimationFrame(() => {
      const offset = Math.max(0, (firstIssueIndex - 1) * rowSlot);
      scrollRef.current?.scrollTo({ y: offset, animated: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [firstIssueIndex, rowSlot, scrollable]);

  return (
    <View
      onLayout={handleLayout}
      style={[
        styles.container,
        {
          left: ds.spacing(20),
          right: ds.spacing(20),
        },
      ]}
    >
      <View
        style={[
          styles.card,
          {
            borderRadius: ds.radius(22),
            padding: ds.spacing(CARD_PADDING),
          },
        ]}
      >
        {/* 1. Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { fontSize: ds.fontSize(17) }]}>
            Order list
          </Text>
          <Text
            style={[styles.summary, { fontSize: ds.fontSize(13) }]}
            numberOfLines={1}
          >
            {summary}
          </Text>
        </View>

        {/* 2. List slot */}
        <View
          style={{
            marginTop: ds.spacing(CARD_SECTION_GAP),
            position: "relative",
          }}
        >
          {isEmpty ? (
            <View
              style={[
                styles.emptyPanel,
                {
                  borderRadius: ds.radius(14),
                  paddingVertical: ds.spacing(10),
                  paddingHorizontal: ds.spacing(12),
                  gap: ds.spacing(6),
                },
              ]}
            >
              <MaterialCommunityIcons
                name="keyboard-outline"
                size={ds.icon(18)}
                color={colors.textMuted}
              />
              <Text
                style={[styles.emptyText, { fontSize: ds.fontSize(13) }]}
                numberOfLines={1}
              >
                Type below or tap a shortcut
              </Text>
            </View>
          ) : (
            <ScrollView
              ref={scrollRef}
              style={{ maxHeight: listMaxHeight }}
              contentContainerStyle={{ paddingRight: ds.spacing(14) }}
              showsVerticalScrollIndicator={scrollable}
              indicatorStyle="black"
              scrollIndicatorInsets={{ right: 2, top: 2, bottom: 2 }}
              onScroll={handleScroll}
              scrollEventThrottle={32}
              scrollEnabled={scrollable}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              bounces={false}
            >
              {items.map((item, index) => (
                <QuickOrderItemRow
                  key={`${getParsedItemKey(item)}::${index}`}
                  item={item}
                  showDivider={index > 0}
                  onEdit={onEditItem}
                  onResolveQuantity={onResolveQuantity}
                />
              ))}
            </ScrollView>
          )}

          {/* Scroll affordance: a clearly-tappable chevron pill horizontally
              centered at the bottom of the list slot, just above the confirm
              button. Tap to jump to the bottom (or back to the top once you're
              already there). */}
          {scrollable ? (
            <View style={styles.scrollHintWrap} pointerEvents="box-none">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isAtBottom ? "Scroll to top of order list" : "Scroll to bottom of order list"
                }
                hitSlop={10}
                onPress={handleScrollHintPress}
                style={({ pressed }) => [
                  styles.scrollHint,
                  {
                    width: ds.spacing(36),
                    height: ds.spacing(28),
                    borderRadius: ds.radius(999),
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Ionicons
                  name={isAtBottom ? "chevron-up" : "chevron-down"}
                  size={ds.icon(20)}
                  color={colors.textSecondary}
                />
              </Pressable>
            </View>
          ) : null}
        </View>

        {/* 3. Confirm footer + decorative overlay (ready state).
            The footer is a relative-positioned wrapper. The underlying
            TouchableOpacity is the real CTA. In the `ready` state we also
            mount an absolutely-positioned decorative pill on top — it has the
            same press handler, so it is the visible Confirm Order button. */}
        <View
          style={[
            styles.footerWrap,
            {
              marginTop: ds.spacing(CARD_SECTION_GAP),
              height: ds.spacing(CTA_HEIGHT),
            },
          ]}
        >
          <ConfirmButton
            state={confirmState}
            onPress={handleConfirmPress}
            radius={ds.radius(999)}
            fontSize={ds.fontSize(15)}
            paddingHorizontal={ds.spacing(20)}
          />

          {confirmState === "ready" ? (
            <DecorativeConfirmOverlay
              onPress={handleConfirmPress}
              radius={ds.radius(999)}
              fontSize={ds.fontSize(15)}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}

type ConfirmButtonProps = {
  state: ConfirmState;
  onPress: () => void;
  radius: number;
  fontSize: number;
  paddingHorizontal: number;
};

const FOOTER_LABEL: Record<ConfirmState, string> = {
  empty: "Add items to confirm",
  "needs-fixing": "Fix cart to confirm",
  ready: "Confirm order",
  confirming: "Adding to cart…",
};

function ConfirmButton({
  state,
  onPress,
  radius,
  fontSize,
  paddingHorizontal,
}: ConfirmButtonProps) {
  const disabled = state !== "ready";
  const variant = FOOTER_VARIANT[state];
  const label = FOOTER_LABEL[state];

  return (
    <TouchableOpacity
      activeOpacity={disabled ? 1 : 0.85}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        backgroundColor: variant.background,
        borderColor: variant.border,
        borderWidth: variant.borderWidth,
        borderRadius: radius,
        paddingHorizontal,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
      }}
    >
      {state === "confirming" ? (
        <ActivityIndicator
          color={variant.foreground}
          style={{ marginRight: 10 }}
        />
      ) : null}
      <Text
        style={{
          color: variant.foreground,
          fontSize,
          fontWeight: "800",
          letterSpacing: 0,
          textAlign: "center",
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/**
 * Visible "Confirm order" pill stacked on top of the real CTA. Exists because
 * the underlying button has historically failed to paint in some states; this
 * overlay guarantees the user sees the button and can tap it.
 */
function DecorativeConfirmOverlay({
  onPress,
  radius,
  fontSize,
}: {
  onPress: () => void;
  radius: number;
  fontSize: number;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel="Confirm order"
      onPress={onPress}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        backgroundColor: "#E8503A",
        borderRadius: radius,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          color: "#FFFFFF",
          fontSize,
          fontWeight: "800",
          letterSpacing: 0,
          textAlign: "center",
        }}
        numberOfLines={1}
      >
        Confirm order
      </Text>
    </TouchableOpacity>
  );
}

type FooterVariant = {
  background: string;
  foreground: string;
  border: string;
  borderWidth: number;
};

// Opaque backgrounds in every state. The previous translucent amber wash made
// the pill read as plain text.
const FOOTER_VARIANT: Record<ConfirmState, FooterVariant> = {
  ready: {
    background: "#E8503A",
    foreground: "#FFFFFF",
    border: "#E8503A",
    borderWidth: 0,
  },
  confirming: {
    background: "#E8503A",
    foreground: "#FFFFFF",
    border: "#E8503A",
    borderWidth: 0,
  },
  "needs-fixing": {
    background: "#FEEBC8",
    foreground: "#C2410C",
    border: "#C2410C",
    borderWidth: 1,
  },
  empty: {
    background: "#E5E5EA",
    foreground: "#6E6E73",
    border: "#D1D1D6",
    borderWidth: glassHairlineWidth,
  },
};

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    zIndex: 10,
  },
  card: {
    backgroundColor: colors.white,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
    overflow: "visible",
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    flexShrink: 0,
    color: colors.textPrimary,
    fontWeight: "800",
    letterSpacing: 0,
  },
  summary: {
    color: colors.textSecondary,
    fontWeight: "700",
    letterSpacing: 0,
    flexShrink: 1,
    marginLeft: 12,
    textAlign: "right",
  },
  emptyPanel: {
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    backgroundColor: colors.background,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
  },
  emptyText: {
    color: colors.textSecondary,
    fontWeight: "700",
    letterSpacing: 0,
  },
  scrollHintWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: -2,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  scrollHint: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
  },
  footerWrap: {
    width: "100%",
    position: "relative",
  },
});
