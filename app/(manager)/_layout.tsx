import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, Text } from 'react-native';
import { useAuthStore, useOrderStore } from '@/store';

export default function ManagerLayout() {
  const { session, profile, user } = useAuthStore();
  const { getTotalCartCount } = useOrderStore();
  const cartCount = getTotalCartCount();

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
          paddingTop: 12,
          paddingBottom: 12,
          height: 90,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: 4,
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
                    top: -4,
                    right: -8,
                    backgroundColor: '#F97316',
                    borderRadius: 10,
                    minWidth: 18,
                    height: 18,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 4,
                  }}
                >
                  <Text style={{ color: 'white', fontSize: 10, fontWeight: 'bold' }}>
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
