import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, Text } from 'react-native';
import { useAuthStore, useOrderStore, useDisplayStore } from '@/store';

export default function ManagerLayout() {
  const { session, profile, user } = useAuthStore();
  const { getTotalCartCount } = useOrderStore();
  const ds = useDisplayStore();
  const cartCount = getTotalCartCount();
  const isLarge = ds.uiScale === 'large';
  const isCompact = ds.uiScale === 'compact';
  const buttonScale = ds.buttonSize === 'large' ? 1.08 : ds.buttonSize === 'small' ? 0.94 : 1;
  const textScale = ds.textScale > 1 ? 1 + (ds.textScale - 1) * 0.15 : 1 - (1 - ds.textScale) * 0.08;
  const tabBarScale = Math.max(0.9, Math.min(1.25, (isLarge ? 1.1 : isCompact ? 0.95 : 1) * buttonScale * textScale));
  const badgeSize = Math.max(18, Math.round(18 * tabBarScale));

  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }

  if (!profile?.profile_completed) {
    return <Redirect href="/(auth)/complete-profile" />;
  }

  if (profile.is_suspended) {
    return <Redirect href="/suspended" />;
  }

  if ((user?.role ?? profile.role) !== 'manager') {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#F97316',
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: '#E5E7EB',
          paddingTop: Math.round(12 * tabBarScale),
          paddingBottom: Math.round(12 * tabBarScale),
          height: Math.round(90 * tabBarScale),
        },
        tabBarLabelStyle: {
          fontSize: Math.max(10, ds.scaledFontSize(10)),
          fontWeight: '600',
          marginTop: Math.round(4 * tabBarScale),
        },
        tabBarIconStyle: {
          transform: [{ scale: isLarge ? 1.15 : isCompact ? 0.95 : 1 }],
        },
        headerShown: false,
      }}
    >
      {/* Dashboard - Default Tab */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" size={size} color={color} />
          ),
        }}
      />

      {/* Quick Order - Replaces Orders */}
      <Tabs.Screen
        name="quick-order"
        options={{
          title: 'Quick',
          tabBarIcon: ({ color, size }) => (
            <View>
              <Ionicons name="flash-outline" size={size} color={color} />
              {cartCount > 0 && (
                <View
                  style={{
                    position: 'absolute',
                    top: -Math.round(4 * tabBarScale),
                    right: -Math.round(8 * tabBarScale),
                    backgroundColor: '#F97316',
                    borderRadius: badgeSize / 2,
                    minWidth: badgeSize,
                    height: badgeSize,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: Math.round(4 * tabBarScale),
                  }}
                >
                  <Text style={{ color: 'white', fontSize: Math.max(9, ds.scaledFontSize(9)), fontWeight: 'bold' }}>
                    {cartCount > 99 ? '99+' : cartCount}
                  </Text>
                </View>
              )}
            </View>
          ),
        }}
      />

      {/* Fulfillment */}
      <Tabs.Screen
        name="fulfillment"
        options={{
          title: 'Fulfillment',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="clipboard-outline" size={size} color={color} />
          ),
        }}
      />

      {/* Inventory */}
      <Tabs.Screen
        name="inventory"
        options={{
          title: 'Inventory',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cube-outline" size={size} color={color} />
          ),
        }}
      />

      {/* Settings/Profile */}
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
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
        name="cart"
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
        name="settings/export-format"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="settings/user-management"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}
