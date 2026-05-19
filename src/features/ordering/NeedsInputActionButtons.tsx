import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useScaledStyles } from "@/hooks/useScaledStyles";
import { colors } from "@/theme/design";

const PRIMARY_RED = colors.primary;
const PRIMARY_TEXT = "#FFFFFF";
const GHOST_BG = "#FFFFFF";
const GHOST_BORDER = "#D1D5DB";
const GHOST_TEXT = "#1F2937";

export type NeedsInputPrimaryAction = {
  key: string;
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
};

type NeedsInputActionButtonsProps = {
  primaryActions: NeedsInputPrimaryAction[];
  onReject: () => void;
  rejectAccessibilityLabel?: string;
};

/**
 * "Use this" + "No" row for NEEDS INPUT clarification / suggestion cards.
 * Styles are explicit (not variant-based) so backgrounds stay visible on iOS.
 */
export function NeedsInputActionButtons({
  primaryActions,
  onReject,
  rejectAccessibilityLabel = "No, dismiss this suggestion",
}: NeedsInputActionButtonsProps) {
  const ds = useScaledStyles();
  const pillRadius = ds.radius(999);

  return (
    <View
      style={[
        styles.row,
        { gap: ds.spacing(10), marginTop: ds.spacing(14) },
      ]}
    >
      {primaryActions.map((action) => (
        <Pressable
          key={action.key}
          accessibilityRole="button"
          accessibilityLabel={action.accessibilityLabel ?? action.label}
          onPress={action.onPress}
          style={({ pressed }) => [
            styles.primaryPressable,
            {
              borderRadius: pillRadius,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <View
            style={[
              styles.primaryInner,
              {
                borderRadius: pillRadius,
                paddingHorizontal: ds.spacing(18),
                paddingVertical: ds.spacing(10),
              },
            ]}
          >
            <Text
              style={[
                styles.primaryLabel,
                { fontSize: ds.fontSize(14) },
              ]}
            >
              {action.label}
            </Text>
          </View>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={rejectAccessibilityLabel}
        onPress={onReject}
        style={({ pressed }) => [
          styles.ghostPressable,
          {
            borderRadius: pillRadius,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <View
          style={[
            styles.ghostInner,
            {
              borderRadius: pillRadius,
              paddingHorizontal: ds.spacing(18),
              paddingVertical: ds.spacing(10),
            },
          ]}
        >
          <Text
            style={[
              styles.ghostLabel,
              { fontSize: ds.fontSize(14) },
            ]}
          >
            No
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "center",
    alignSelf: "flex-start",
  },
  primaryPressable: {
    flexShrink: 0,
  },
  primaryInner: {
    backgroundColor: PRIMARY_RED,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    minWidth: 110,
  },
  primaryLabel: {
    color: PRIMARY_TEXT,
    fontWeight: "700",
    letterSpacing: 0,
  },
  ghostPressable: {
    flexShrink: 0,
  },
  ghostInner: {
    backgroundColor: GHOST_BG,
    borderWidth: 1.5,
    borderColor: GHOST_BORDER,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    minWidth: 72,
  },
  ghostLabel: {
    color: GHOST_TEXT,
    fontWeight: "600",
    letterSpacing: 0,
  },
});
