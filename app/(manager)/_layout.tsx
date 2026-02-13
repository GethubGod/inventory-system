import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Sparkles } from 'lucide-react-native';
import { View, Text } from 'react-native';
import { useAuthStore, useOrderStore, useDisplayStore, useTunaSpecialistStore } from '@/store';

export default function ManagerLayout() {
  const { session, profile, user } = useAuthStore();
  const { getTotalCartCount } = useOrderStore();
  const voiceCartCount = useTunaSpecialistStore((state) => state.cartItems.length);
  const ds = useDisplayStore();
  const cartCount = getTotalCartCount();
  const isLarge = ds.uiScale === 'large';
  const isCompact = ds.uiScale === 'compact';
  // Match employee tab bar size for default/compact and only expand for large UI scale.
  const tabBarScale = isLarge ? 1.1 : 1;
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

  const metadataRole =
    typeof session.user?.user_metadata?.role === 'string'
      ? session.user.user_metadata.role
      : typeof session.user?.app_metadata?.role === 'string'
        ? session.user.app_metadata.role
        : null;
  const resolvedRole = user?.role ?? profile.role ?? metadataRole;

  if (resolvedRole !== 'manager') {
    return <Redirect href="/(tabs)/settings" />;
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

      {/* Voice */}
      <Tabs.Screen
        name="voice"
        options={{
          title: 'Voice',
          tabBarIcon: ({ color }) => (
            <Sparkles size={24} color={color} />
          ),
          tabBarBadge: voiceCartCount > 0 ? voiceCartCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: '#F97316',
            color: '#FFFFFF',
            fontSize: Math.max(9, ds.scaledFontSize(9)),
          },
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
        name="inventory"
        options={{
          href: null,
          tabBarStyle: { display: 'none' },
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
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="past-orders/[id]"
        options={{
          href: null,
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="settings/export-format"
        options={{
          href: null,
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="settings/user-management"
        options={{
          href: null,
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="settings/profile"
        options={{
          href: null,
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="settings/access-codes"
        options={{
          href: null,
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="employee-reminders"
        options={{
          href: null,
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="employee-reminders-recurring"
        options={{
          href: null,
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="employee-reminders-settings"
        options={{
          href: null,
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="employee-reminders-delivery"
        options={{
          href: null,
          tabBarStyle: { display: 'none' },
        }}
      />
    </Tabs>
  );
}
