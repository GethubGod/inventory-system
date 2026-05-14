import { useCallback, useEffect, useRef, useState } from "react";
import { Redirect, Tabs, usePathname } from "expo-router";
import { RealtimeChannel } from "@supabase/supabase-js";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthStore, useDraftStore } from "@/store";
import { supabase } from "@/lib/supabase";
import { AuthLoadingScreen } from "@/components";
import { useProtectedAuthGuard } from "@/hooks";
import { colors } from "@/theme/design";
import {
  TabButton,
  getTabBarScreenOptions,
  getTabBarBottomInset,
  tabBarBadgeStyle,
} from "@/components/navigation";

export default function ManagerLayout() {
  const session = useAuthStore((s) => s.session);
  const draftCount = useDraftStore((state) => state.getTotalItemCount());
  const insets = useSafeAreaInsets();
  const [pendingFulfillmentCount, setPendingFulfillmentCount] = useState(0);
  const badgeRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const badgeChannelRef = useRef<RealtimeChannel | null>(null);
  const guard = useProtectedAuthGuard({ requireManager: true });
  const resolvedRole = guard.resolvedRole;
  const tabBarBottomInset = getTabBarBottomInset(insets.bottom);
  const pathname = usePathname();
  const isBrowseRoute = pathname.includes("browse");

  const refreshPendingFulfillmentCount = useCallback(async () => {
    if (!session || resolvedRole !== "manager") {
      setPendingFulfillmentCount(0);
      return;
    }

    try {
      // Count unique submitted orders that still have at least one pending order_item.
      // This tracks actual fulfillment workload more accurately than raw order status counts.
      let { data, error } = await supabase
        .from("order_items")
        .select("order_id,orders!inner(status,entry_method,quick_session_id,manager_review_status)")
        .or("status.is.null,status.eq.pending")
        .eq("orders.status", "submitted")
        .limit(10000);

      if (error && (error as any).code === "42703") {
        ({ data, error } = await supabase
          .from("order_items")
          .select("order_id,orders!inner(status)")
          .or("status.is.null,status.eq.pending")
          .eq("orders.status", "submitted")
          .limit(10000));
      }

      if (error) throw error;

      const uniqueOrderIds = new Set(
        (Array.isArray(data) ? data : [])
          .filter((row: any) => {
            const order = Array.isArray(row?.orders) ? row.orders[0] : row?.orders;
            if (order?.entry_method !== "quick_order" && !order?.quick_session_id) {
              return true;
            }
            return order?.manager_review_status === "approved";
          })
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

    return () => {
      if (badgeRefreshTimeoutRef.current) {
        clearTimeout(badgeRefreshTimeoutRef.current);
        badgeRefreshTimeoutRef.current = null;
      }
      if (badgeChannelRef.current) {
        supabase.removeChannel(badgeChannelRef.current);
        badgeChannelRef.current = null;
      }
    };
  }, [refreshPendingFulfillmentCount, resolvedRole, session]);

  if (guard.isChecking) {
    return <AuthLoadingScreen />;
  }

  if (guard.redirectTo) {
    return <Redirect href={guard.redirectTo} />;
  }

  return (
    <Tabs screenOptions={getTabBarScreenOptions(tabBarBottomInset)}>
      {/* Home - Default Tab */}
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size, focused }) => (
            <TabButton
              name="home-outline"
              label="Home"
              size={size}
              color={isBrowseRoute ? colors.primary : color}
              focused={focused || isBrowseRoute}
            />
          ),
        }}
      />

      {/* Browse (hidden — accessed from Home) */}
      <Tabs.Screen name="browse" options={{ href: null }} />

      {/* Quick Order */}
      <Tabs.Screen
        name="quick-order"
        options={{
          title: "Quick",
          tabBarIcon: ({ color, size, focused }) => (
            <TabButton name="flash-outline" label="Quick" size={size} color={color} focused={focused} />
          ),
          tabBarBadge: draftCount > 0 ? draftCount : undefined,
          tabBarBadgeStyle: tabBarBadgeStyle,
        }}
      />

      {/* Fulfillment (replaces Cart in manager mode) */}
      <Tabs.Screen
        name="fulfillment"
        options={{
          title: "Fulfillment",
          tabBarIcon: ({ color, size, focused }) => (
            <TabButton name="clipboard-outline" label="Fulfillment" size={size} color={color} focused={focused} />
          ),
          tabBarBadge: pendingFulfillmentCount > 0 ? pendingFulfillmentCount : undefined,
          tabBarBadgeStyle: tabBarBadgeStyle,
        }}
      />

      {/* Smart */}
      <Tabs.Screen
        name="voice"
        options={{
          href: null,
          title: "Smart",
          tabBarIcon: ({ color, size, focused }) => (
            <TabButton name="reader-outline" label="Smart" size={size} color={color} focused={focused} />
          ),
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
      <Tabs.Screen name="orders" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="orders/pending" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="inventory" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="cart" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="export-fish-order" options={{ href: null }} />
      <Tabs.Screen name="fulfillment-confirmation" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="fulfillment-history" options={{ href: null }} />
      <Tabs.Screen name="fulfillment-history-detail" options={{ href: null }} />
      <Tabs.Screen name="past-orders/index" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="past-orders/[id]" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="manager-settings/export-format" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="manager-settings/user-management" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="manager-settings/profile" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="manager-settings/access-codes" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="manager-settings/quick-order-config" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="employee-reminders" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="employee-reminders-recurring" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="employee-reminders-settings" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="employee-reminders-delivery" options={{ href: null, tabBarStyle: { display: "none" } }} />
    </Tabs>
  );
}
