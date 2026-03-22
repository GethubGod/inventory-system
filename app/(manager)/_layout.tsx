import { useCallback, useEffect, useRef, useState } from "react";
import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { View, Text } from "react-native";
import { RealtimeChannel } from "@supabase/supabase-js";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useAuthStore,
  useOrderStore,
  useDraftStore,
} from "@/store";
import { supabase } from "@/lib/supabase";
import { colors, hairline, spacing } from "@/theme/design";

/**
 * Custom tab button matching the employee TabButton bubble style.
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

export default function ManagerLayout() {
  const { session, profile, user, viewMode } = useAuthStore();
  const cartCount = useOrderStore((state) =>
    state.getTotalCartCount("manager"),
  );
  const draftCount = useDraftStore((state) => state.getTotalItemCount());
  const insets = useSafeAreaInsets();
  const [pendingFulfillmentCount, setPendingFulfillmentCount] = useState(0);
  const badgeRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const badgeChannelRef = useRef<RealtimeChannel | null>(null);
  const badgePollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const metadataRole =
    typeof session?.user?.user_metadata?.role === "string"
      ? session.user.user_metadata.role
      : typeof session?.user?.app_metadata?.role === "string"
        ? session.user.app_metadata.role
        : null;
  const resolvedRole = user?.role ?? profile?.role ?? metadataRole;
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
  const refreshPendingFulfillmentCount = useCallback(async () => {
    if (!session || resolvedRole !== "manager") {
      setPendingFulfillmentCount(0);
      return;
    }

    try {
      // Count unique submitted orders that still have at least one pending order_item.
      // This tracks actual fulfillment workload more accurately than raw order status counts.
      const { data, error } = await supabase
        .from("order_items")
        .select("order_id,orders!inner(status)")
        .or("status.is.null,status.eq.pending")
        .eq("orders.status", "submitted")
        .limit(10000);

      if (error) throw error;

      const uniqueOrderIds = new Set(
        (Array.isArray(data) ? data : [])
          .map((row: any) =>
            typeof row?.order_id === "string" ? row.order_id : null,
          )
          .filter((value: string | null): value is string => Boolean(value)),
      );

      setPendingFulfillmentCount(uniqueOrderIds.size);
    } catch (error) {
      console.error(
        "[ManagerLayout] Failed to load fulfillment badge count:",
        error,
      );
      setPendingFulfillmentCount(0);
    }
  }, [resolvedRole, session]);

  useEffect(() => {
    void refreshPendingFulfillmentCount();
  }, [refreshPendingFulfillmentCount]);

  useEffect(() => {
    if (!session || resolvedRole !== "manager") {
      if (badgeRefreshTimeoutRef.current) {
        clearTimeout(badgeRefreshTimeoutRef.current);
        badgeRefreshTimeoutRef.current = null;
      }
      if (badgeChannelRef.current) {
        supabase.removeChannel(badgeChannelRef.current);
        badgeChannelRef.current = null;
      }
      if (badgePollIntervalRef.current) {
        clearInterval(badgePollIntervalRef.current);
        badgePollIntervalRef.current = null;
      }
      return;
    }

    const scheduleCountRefresh = () => {
      if (badgeRefreshTimeoutRef.current) {
        clearTimeout(badgeRefreshTimeoutRef.current);
      }
      badgeRefreshTimeoutRef.current = setTimeout(() => {
        void refreshPendingFulfillmentCount();
      }, 250);
    };

    const channel = supabase
      .channel("manager-fulfillment-tab-badge")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        scheduleCountRefresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_items" },
        scheduleCountRefresh,
      )
      .subscribe();

    badgeChannelRef.current = channel;
    badgePollIntervalRef.current = setInterval(() => {
      void refreshPendingFulfillmentCount();
    }, 15000);

    return () => {
      if (badgeRefreshTimeoutRef.current) {
        clearTimeout(badgeRefreshTimeoutRef.current);
        badgeRefreshTimeoutRef.current = null;
      }
      if (badgeChannelRef.current) {
        supabase.removeChannel(badgeChannelRef.current);
        badgeChannelRef.current = null;
      }
      if (badgePollIntervalRef.current) {
        clearInterval(badgePollIntervalRef.current);
        badgePollIntervalRef.current = null;
      }
    };
  }, [refreshPendingFulfillmentCount, resolvedRole, session]);

  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }

  if (!profile?.profile_completed) {
    return <Redirect href="/(auth)/complete-profile" />;
  }

  if (profile.is_suspended) {
    return <Redirect href="/suspended" />;
  }

  if (resolvedRole !== "manager") {
    return <Redirect href="/(tabs)/settings" />;
  }

  if (viewMode !== 'manager') {
    return <Redirect href="/(tabs)" />;
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
          fontSize: 0, // hide default label — rendered inside TabButton
          height: 0,
          margin: 0,
        },
        tabBarItemStyle: {
          paddingTop: 8,
        },
        headerShown: false,
      }}
    >
      {/* Home - Default Tab */}
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size, focused }) => (
            <TabButton name="home-outline" label="Home" size={size} color={color} focused={focused} />
          ),
        }}
      />

      {/* Browse (hidden — accessed from Home) */}
      <Tabs.Screen
        name="browse"
        options={{
          href: null,
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

      {/* Fulfillment (replaces Cart in manager mode) */}
      <Tabs.Screen
        name="fulfillment"
        options={{
          title: "Fulfillment",
          tabBarIcon: ({ color, size, focused }) => (
            <TabButton name="clipboard-outline" label="Fulfill" size={size} color={color} focused={focused} />
          ),
          tabBarBadge: pendingFulfillmentCount > 0 ? pendingFulfillmentCount : undefined,
          tabBarBadgeStyle: badgeStyle,
        }}
      />

      {/* Settings/Profile */}
      <Tabs.Screen
        name="profile"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size, focused }) => (
            <TabButton name="person-circle-outline" label="Settings" size={size} color={color} focused={focused} />
          ),
        }}
      />

      {/* Hidden screens (accessible via navigation) */}
      <Tabs.Screen
        name="orders"
        options={{
          href: null, // Hide from tab bar but keep accessible
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          href: null,
          tabBarStyle: { display: "none" },
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="voice"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="export-fish-order"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="fulfillment-confirmation"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="fulfillment-history"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="fulfillment-history-detail"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="past-orders/index"
        options={{
          href: null,
          tabBarStyle: { display: "none" },
        }}
      />
      <Tabs.Screen
        name="past-orders/[id]"
        options={{
          href: null,
          tabBarStyle: { display: "none" },
        }}
      />
      <Tabs.Screen
        name="manager-settings/export-format"
        options={{
          href: null,
          tabBarStyle: { display: "none" },
        }}
      />
      <Tabs.Screen
        name="manager-settings/user-management"
        options={{
          href: null,
          tabBarStyle: { display: "none" },
        }}
      />
      <Tabs.Screen
        name="manager-settings/profile"
        options={{
          href: null,
          tabBarStyle: { display: "none" },
        }}
      />
      <Tabs.Screen
        name="manager-settings/access-codes"
        options={{
          href: null,
          tabBarStyle: { display: "none" },
        }}
      />
      <Tabs.Screen
        name="employee-reminders"
        options={{
          href: null,
          tabBarStyle: { display: "none" },
        }}
      />
      <Tabs.Screen
        name="employee-reminders-recurring"
        options={{
          href: null,
          tabBarStyle: { display: "none" },
        }}
      />
      <Tabs.Screen
        name="employee-reminders-settings"
        options={{
          href: null,
          tabBarStyle: { display: "none" },
        }}
      />
      <Tabs.Screen
        name="employee-reminders-delivery"
        options={{
          href: null,
          tabBarStyle: { display: "none" },
        }}
      />
    </Tabs>
  );
}
