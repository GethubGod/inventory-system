import { Redirect, Tabs, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useOrderStore } from "@/store";
import { AuthLoadingScreen } from "@/components";
import { useProtectedAuthGuard } from "@/hooks";
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

      {/* Quick Order */}
      <Tabs.Screen
        name="quick-order"
        options={{
          title: "Quick",
          tabBarIcon: ({ color, size, focused }) => (
            <TabButton name="flash-outline" label="Quick" size={size} color={color} focused={focused} />
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

      {/* Stock Check — opened from Settings, not the tab bar */}
      <Tabs.Screen name="stock-check" options={{ href: null }} />

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
