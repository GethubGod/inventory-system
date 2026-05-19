import React from "react";
import { LayoutChangeEvent, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  ZoomIn,
} from "react-native-reanimated";
import { useScaledStyles } from "@/hooks/useScaledStyles";
import { colors, glassColors, glassHairlineWidth } from "@/theme/design";
import {
  QUICK_ORDER_WELCOME_BODY_PARAGRAPHS,
  QUICK_ORDER_WELCOME_TITLE,
} from "./quickOrderWelcome";

type QuickOrderWelcomeMessageProps = {
  onLayout?: (event: LayoutChangeEvent) => void;
};

export const QuickOrderWelcomeMessageCard = React.memo(
  function QuickOrderWelcomeMessageCard({
    onLayout,
  }: QuickOrderWelcomeMessageProps) {
    const ds = useScaledStyles();

    return (
      <Animated.View
        onLayout={onLayout}
        entering={ZoomIn.duration(180).easing(Easing.out(Easing.cubic))}
        style={[
          styles.card,
          {
            borderRadius: ds.radius(16),
            padding: ds.spacing(14),
            marginTop: ds.spacing(10),
          },
        ]}
      >
        <Text style={[styles.title, { fontSize: ds.fontSize(16) }]}>
          {QUICK_ORDER_WELCOME_TITLE}
        </Text>

        <View style={{ marginTop: ds.spacing(12), gap: ds.spacing(10) }}>
          {QUICK_ORDER_WELCOME_BODY_PARAGRAPHS.map((paragraph) => (
            <Text
              key={paragraph}
              style={[styles.body, { fontSize: ds.fontSize(15) }]}
            >
              {paragraph}
            </Text>
          ))}
        </View>
      </Animated.View>
    );
  },
);

const styles = StyleSheet.create({
  card: {
    alignSelf: "flex-start",
    width: "94%",
    backgroundColor: colors.white,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 4,
  },
  title: {
    color: colors.textPrimary,
    fontWeight: "800",
    letterSpacing: 0,
  },
  body: {
    color: colors.textPrimary,
    fontWeight: "500",
    letterSpacing: 0,
    lineHeight: 22,
  },
});
