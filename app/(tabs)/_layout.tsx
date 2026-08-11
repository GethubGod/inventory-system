import { Redirect, Tabs, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useOrderStore } from "@/store";
import { AuthLoadingScreen } from "@/components";
import { useMyModules, useProtectedAuthGuard } from "@/hooks";
import { colors } from "@/theme/design";
import {
  TabButton,
  getTabBarScreenOptions,
  getTabBarBottomInset,
  tabBarBadgeStyle,
} from "@/components/navigation";

export default function TabsLayout() {
  const cartTotal = useOrderStore((state) =>
    state.getTotalCartCount("employee"),
  );
  const insets = useSafeAreaInsets();
  const tabBarBottomInset = getTabBarBottomInset(insets.bottom);
  const guard = useProtectedAuthGuard();
  // Phase 3: tabs render from per-user module state (rpc get_effective_modules,
  // kept live via the user_modules realtime channel — a manager flipping a
  // toggle adds/removes tabs here without re-login). Falls back to role
  // defaults if the fetch fails so nobody gets locked out.
  const { modules } = useMyModules(guard.resolvedRole);
  const pathname = usePathname();
  const isBrowseRoute = pathname.includes("inventory-browse");

  if (guard.isChecking) {
    return <AuthLoadingScreen />;
  }

  if (guard.redirectTo) {
    return <Redirect href={guard.redirectTo} />;
  }

  return (
    <Tabs screenOptions={getTabBarScreenOptions(tabBarBottomInset)}>
      {/* Browse - Default Tab (index.tsx) */}
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

      {/* Simple ordering checklist (Phase 5a surface, ordering_simple module) */}
      <Tabs.Screen
        name="simple-order"
        options={{
          href: modules.ordering_simple ? undefined : null,
          title: "Order",
          tabBarIcon: ({ color, size, focused }) => (
            <TabButton name="list-outline" label="Order" size={size} color={color} focused={focused} />
          ),
        }}
      />

      {/* Advanced ordering (Beta) — the former Quick Order surface, gated by
          ordering_advanced. Tab label is the space-constrained "Advanced";
          the full "Advanced ordering (Beta)" hint lives on the screen header. */}
      <Tabs.Screen
        name="quick-order"
        options={{
          href: modules.ordering_advanced ? undefined : null,
          title: "Advanced",
          tabBarIcon: ({ color, size, focused }) => (
            <TabButton name="flash-outline" label="Advanced" size={size} color={color} focused={focused} />
          ),
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
          tabBarBadgeStyle: tabBarBadgeStyle,
        }}
      />

      {/* Stock Check — opened from Settings, not the tab bar. The stock_check
          module gates the screens themselves via useModuleAccessGuard. */}
      <Tabs.Screen name="stock-check" options={{ href: null }} />

      {/* TODO-PHASE4: render the tips tab here once the tips surface ships.
          The `tips` module gate already exists (modules.tips) but must never
          show a broken screen, so no tab is rendered yet. */}

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
      <Tabs.Screen name="draft" options={{ href: null }} />
      <Tabs.Screen name="orders" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ href: null }} />
      <Tabs.Screen name="inventory-browse" options={{ href: null }} />
      <Tabs.Screen name="stock-check-list" options={{ href: null }} />
      <Tabs.Screen name="past-checks" options={{ href: null }} />
    </Tabs>
  );
}
