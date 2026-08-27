import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Redirect, Tabs, usePathname } from "expo-router";
import { RealtimeChannel } from "@supabase/supabase-js";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthStore, useOrderStore } from "@/store";
import { supabase } from "@/lib/supabase";
import { AuthLoadingScreen } from "@/components";
import { useMyModules, useProtectedAuthGuard } from "@/hooks";
import { extractConsumedOrderItemIds } from "@/store/helpers";
import { loadQueuedOrderLaterSourceOrderItemIds } from "@/services/fulfillmentDataSource";
import { getPendingFulfillmentOrderIdsFromItemRows } from "@/services/fulfillmentEligibility";
import { colors } from "@/theme/design";
import {
  TabButton,
  getTabBarScreenOptions,
  getTabBarBottomInset,
  tabBarBadgeStyle,
} from "@/components/navigation";

export default function ManagerLayout() {
  const session = useAuthStore((s) => s.session);
  const locations = useAuthStore((s) => s.locations);
  const fetchPastOrders = useOrderStore((s) => s.fetchPastOrders);
  const insets = useSafeAreaInsets();
  const [pendingFulfillmentCount, setPendingFulfillmentCount] = useState(0);
  const badgeRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const badgeChannelRef = useRef<RealtimeChannel | null>(null);
  const guard = useProtectedAuthGuard({ requireManager: true });
  const resolvedRole = guard.resolvedRole;
  // Phase 3: managers default to every module on; the fulfillment module can
  // still be toggled off per user. Subscription-driven, so a live flip
  // adds/removes the tab without re-login.
  const { modules } = useMyModules(resolvedRole);
  const tabBarBottomInset = getTabBarBottomInset(insets.bottom);
  const pathname = usePathname();
  const isBrowseRoute = pathname.includes("browse");
  const managerLocationIds = useMemo(
    () =>
      locations
        .map((location) => (typeof location.id === "string" ? location.id.trim() : ""))
        .filter((id) => id.length > 0),
    [locations],
  );

  const refreshPendingFulfillmentCount = useCallback(async () => {
    if (!session || resolvedRole !== "manager") {
      setPendingFulfillmentCount(0);
      return;
    }

    try {
      // Match the screen's source data: scoped submitted orders, its pending
      // item shape, queued order-later exclusions, and already-consumed items.
      const buildPendingOrderItemsQuery = (includeReviewColumns: boolean) => {
        const orderSelect = includeReviewColumns
          ? "status,entry_method,quick_session_id,manager_review_status"
          : "status";
        let query = supabase
          .from("order_items")
          .select(
            "id,order_id,quantity,input_mode,remaining_reported,decided_quantity,status,inventory_item:inventory_items(id),orders!inner(" +
              orderSelect +
              ")",
          )
          .or("status.is.null,status.eq.pending")
          .eq("orders.status", "submitted")
          .limit(10000);

        if (managerLocationIds.length > 0) {
          query = query.in("orders.location_id", managerLocationIds);
        }

        return query;
      };

      const [pendingOrderItemsResult, pastOrders, orderLaterSourceOrderItemIds] = await Promise.all([
        buildPendingOrderItemsQuery(true),
        fetchPastOrders(session.user.id),
        loadQueuedOrderLaterSourceOrderItemIds(),
      ]);
      let { data, error } = pendingOrderItemsResult;

      if (error && (error as any).code === "42703") {
        ({ data, error } = await buildPendingOrderItemsQuery(false));
      }

      if (error) throw error;

      const uniqueOrderIds = getPendingFulfillmentOrderIdsFromItemRows(
        Array.isArray(data) ? data : [],
        {
          consumedOrderItemIds: extractConsumedOrderItemIds(pastOrders),
          orderLaterSourceOrderItemIds,
        },
      );

      setPendingFulfillmentCount(uniqueOrderIds.size);
    } catch (error) {
      console.error(
        "[ManagerLayout] Failed to load fulfillment badge count:",
        error,
      );
      setPendingFulfillmentCount(0);
    }
  }, [fetchPastOrders, managerLocationIds, resolvedRole, session]);

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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_later_items" },
        scheduleCountRefresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "past_orders" },
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

      {/* Quick Order — gated by the ordering_advanced module (managers
          default all-on). */}
      <Tabs.Screen
        name="quick-order"
        options={{
          href: modules.ordering_advanced ? undefined : null,
          title: "Quick",
          tabBarIcon: ({ color, size, focused }) => (
            <TabButton name="flash-outline" label="Quick" size={size} color={color} focused={focused} />
          ),
        }}
      />

      {/* Fulfillment (replaces Cart in manager mode) — gated by the
          fulfillment module (managers default all-on). */}
      <Tabs.Screen
        name="fulfillment"
        options={{
          href: modules.fulfillment ? undefined : null,
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
      <Tabs.Screen name="fulfillment-send-all" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="fulfillment-history" options={{ href: null }} />
      <Tabs.Screen name="fulfillment-history-detail" options={{ href: null }} />
      <Tabs.Screen name="past-orders/index" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="past-orders/[id]" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="manager-settings/export-format" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="manager-settings/user-management" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="manager-settings/profile" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="manager-settings/access-codes" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="manager-settings/quick-order-config" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="manager-settings/supplier-contacts" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="manager-settings/team" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="manager-settings/team-invite" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="manager-settings/team-invite-link" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="manager-settings/team-member" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="manager-settings/team-preview" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="manager-settings/team-defaults" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="employee-reminders" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="employee-reminders-recurring" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="employee-reminders-settings" options={{ href: null, tabBarStyle: { display: "none" } }} />
      <Tabs.Screen name="employee-reminders-delivery" options={{ href: null, tabBarStyle: { display: "none" } }} />
    </Tabs>
  );
}
