import { Redirect, Tabs } from "expo-router";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useAuthStore,
  useOrderStore,
  useDraftStore,
} from "@/store";
import { colors, hairline, spacing } from "@/theme/design";

/**
 * Custom tab button: renders a soft rounded bubble enclosing both
 * the icon and label when active, matching the reference screenshots.
 */
function TabButton({
  name,
  label,
  color,
  size,
  focused,
}: {
  name: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  size: number;
  focused: boolean;
}) {
  return (
    <View
      style={{
        width: 76,
        height: 56,
        borderRadius: 28,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: focused ? "rgba(232, 80, 58, 0.14)" : "transparent",
      }}
    >
      <Ionicons name={name} size={size} color={color} />
      <Text
        style={{
          fontSize: 10,
          fontWeight: "600",
          color,
          marginTop: 2,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  const { session, profile } = useAuthStore();
  const cartTotal = useOrderStore((state) =>
    state.getTotalCartCount("employee"),
  );
  const draftCount = useDraftStore((state) => state.getTotalItemCount());
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
    top: -4,
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
          fontSize: 0,  // hide default label — rendered inside TabButton
          height: 0,
          margin: 0,
        },
        tabBarItemStyle: {
          paddingTop: 8,
        },
        headerShown: false,
      }}
    >
      {/* Browse - Default Tab (index.tsx) */}
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size, focused }) => (
            <TabButton name="grid-outline" label="Home" size={size} color={color} focused={focused} />
          ),
        }}
      />

      {/* Quick Order */}
      <Tabs.Screen
        name="quick-order"
        options={{
          title: "Quick",
          tabBarIcon: ({ color, size, focused }) => (
            <TabButton name="flash-outline" label="Quick" size={size} color={color} focused={focused} />
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
            <TabButton name="bag-handle-outline" label="Cart" size={size} color={color} focused={focused} />
          ),
          tabBarBadge: cartTotal > 0 ? cartTotal : undefined,
          tabBarBadgeStyle: badgeStyle,
        }}
      />

      <Tabs.Screen
        name="voice"
        options={{
          title: "Smart",
          tabBarIcon: ({ color, size, focused }) => (
            <TabButton name="reader-outline" label="Smart" size={size} color={color} focused={focused} />
          ),
        }}
      />

      {/* Settings */}
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size, focused }) => (
            <TabButton name="person-circle-outline" label="Settings" size={size} color={color} focused={focused} />
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
