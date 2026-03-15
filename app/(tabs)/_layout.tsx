import { Redirect, Tabs } from "expo-router";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useAuthStore,
  useOrderStore,
  useDraftStore,
  useDisplayStore,
} from "@/store";
import { colors, hairline, radii, spacing } from "@/theme/design";

/**
 * Custom tab icon: renders a rounded-square tinted container behind the icon
 * when active, matching the reference screenshots exactly.
 */
function TabIcon({
  name,
  color,
  size,
  focused,
}: {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
  size: number;
  focused: boolean;
}) {
  return (
    <View
      style={{
        width: 64,
        height: 52,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: focused ? "rgba(232, 80, 58, 0.15)" : "transparent",
      }}
    >
      <Ionicons name={name} size={size} color={color} />
    </View>
  );
}

export default function TabsLayout() {
  const { session, profile } = useAuthStore();
  const cartTotal = useOrderStore((state) =>
    state.getTotalCartCount("employee"),
  );
  const draftCount = useDraftStore((state) => state.getTotalItemCount());
  const uiScale = useDisplayStore((state) => state.uiScale);
  const scaledFontSize = useDisplayStore((state) => state.scaledFontSize);
  const insets = useSafeAreaInsets();
  const tabBarBottomInset = Math.max(insets.bottom, spacing.tabBarBottom);
  const tabBarHeight = 60 + tabBarBottomInset;
  const badgeStyle = {
    backgroundColor: colors.primary,
    color: colors.textOnPrimary,
    fontSize: 10,
    fontWeight: "700" as const,
    minWidth: 18,
    height: 18,
    lineHeight: 16,
    borderRadius: 9,
    top: -2,
    right: -6,
  };

  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }

  if (!profile?.profile_completed) {
    return <Redirect href="/(auth)/complete-profile" />;
  }

  if (profile.is_suspended) {
    return <Redirect href="/suspended" />;
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: colors.tabBarBg,
          borderTopWidth: hairline,
          borderTopColor: colors.glassBorder,
          paddingTop: 6,
          paddingBottom: tabBarBottomInset,
          paddingHorizontal: spacing.tabBarHorizontal,
          height: tabBarHeight,
          elevation: 0,
        },
        tabBarLabelStyle: {
          fontSize: Math.max(10, scaledFontSize(10)),
          fontWeight: "600",
          marginTop: 0,
        },
        tabBarItemStyle: {
          paddingTop: 2,
        },
        headerShown: false,
      }}
    >
      {/* Browse - Default Tab (index.tsx) */}
      <Tabs.Screen
        name="index"
        options={{
          title: "Browse",
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon name="grid-outline" size={size} color={color} focused={focused} />
          ),
        }}
      />

      {/* Quick Order */}
      <Tabs.Screen
        name="quick-order"
        options={{
          title: "Quick",
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon name="flash-outline" size={size} color={color} focused={focused} />
          ),
          tabBarBadge: draftCount > 0 ? draftCount : undefined,
          tabBarBadgeStyle: badgeStyle,
        }}
      />

      {/* Cart */}
      <Tabs.Screen
        name="cart"
        options={{
          title: "Cart",
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon name="bag-handle-outline" size={size} color={color} focused={focused} />
          ),
          tabBarBadge: cartTotal > 0 ? cartTotal : undefined,
          tabBarBadgeStyle: badgeStyle,
        }}
      />

      <Tabs.Screen
        name="voice"
        options={{
          title: "Voice",
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon name="time-outline" size={size} color={color} focused={focused} />
          ),
        }}
      />

      {/* Settings */}
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon name="person-circle-outline" size={size} color={color} focused={focused} />
          ),
        }}
      />

      {/* Hidden screens */}
      <Tabs.Screen
        name="draft"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}
