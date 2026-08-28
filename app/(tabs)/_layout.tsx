import { Redirect, Tabs } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useOrderStore } from "@/store";
import { AuthLoadingScreen } from "@/components";
import { useMyModules, useProtectedAuthGuard } from "@/hooks";
import { getVisibleEmployeeTabs } from "@/store/moduleStore.helpers";
import { FloatingPillTabBar } from "@/components/navigation";

export default function TabsLayout() {
  const cartTotal = useOrderStore((state) =>
    state.getTotalCartCount("employee"),
  );
  const guard = useProtectedAuthGuard();
  // Phase 3: tabs render from per-user module state (rpc get_effective_modules,
  // kept live via the user_modules realtime channel — a manager flipping a
  // toggle adds/removes tabs here without re-login). Falls back to role
  // defaults if the fetch fails so nobody gets locked out.
  const { modules } = useMyModules(guard.resolvedRole);
  // Checklist-first restructure: the floating pill toolbar replaces the
  // attached tab bar, rendering from the same derivation the invite preview
  // and Preview-as use. Home and Cart are gone for checklist-only employees.
  const visibleTabs = getVisibleEmployeeTabs(modules);

  if (guard.isChecking) {
    return <AuthLoadingScreen />;
  }

  if (guard.redirectTo) {
    return <Redirect href={guard.redirectTo} />;
  }

  return (
    <>
      {/* The employee surfaces paint fixed light backgrounds (#F7F5F2 /
          #F5F5F4) regardless of the stored theme, and expo-status-bar keeps
          whatever the dark auth screens last set. Dark glyphs are the only
          readable choice here, so assert them unconditionally — following the
          theme preference put light glyphs on a light screen. */}
      <StatusBar style="dark" />
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={(props) => (
          <FloatingPillTabBar
            {...props}
            visibleTabs={visibleTabs}
            cartCount={cartTotal}
          />
        )}
      >
        {/* Home is no longer an employee surface — index redirects to the first
            visible pill tab (see index.tsx). */}
        <Tabs.Screen name="index" options={{ href: null }} />

        {/* Simple ordering checklist (Phase 5a surface, ordering_simple module) */}
        <Tabs.Screen
          name="simple-order"
          options={{ href: modules.ordering_simple ? undefined : null, title: "Order" }}
        />

        {/* Advanced ordering — the former Quick Order surface, gated by
            ordering_advanced. Shipping in 2.3, so no beta marker. */}
        <Tabs.Screen
          name="quick-order"
          options={{ href: modules.ordering_advanced ? undefined : null, title: "Advanced" }}
        />

        {/* Cart only serves the advanced flow, so it shares its gate. */}
        <Tabs.Screen
          name="cart"
          options={{ href: modules.ordering_advanced ? undefined : null, title: "Cart" }}
        />

        {/* Past sent orders with one-tap reorder. */}
        <Tabs.Screen name="history" options={{ title: "History" }} />

        <Tabs.Screen name="settings" options={{ title: "Settings" }} />

        {/* Stock Check — opened from Settings, not the pill. The stock_check
            module gates the screens themselves via useModuleAccessGuard. */}
        <Tabs.Screen name="stock-check" options={{ href: null }} />

        {/* TODO-PHASE4: render the tips tab here once the tips surface ships.
            The `tips` module gate already exists (modules.tips) but must never
            show a broken screen, so no tab is rendered yet. */}

        <Tabs.Screen name="voice" options={{ href: null }} />

        {/* Hidden screens */}
        <Tabs.Screen name="draft" options={{ href: null }} />
        <Tabs.Screen name="orders" options={{ href: null }} />
        <Tabs.Screen name="profile" options={{ href: null }} />
        <Tabs.Screen name="inventory-browse" options={{ href: null }} />
        <Tabs.Screen name="stock-check-list" options={{ href: null }} />
        <Tabs.Screen name="past-checks" options={{ href: null }} />
        <Tabs.Screen name="receive-delivery" options={{ href: null }} />
      </Tabs>
    </>
  );
}
