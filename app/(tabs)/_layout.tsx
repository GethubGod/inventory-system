import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useOrderStore, useDraftStore } from '@/store';

export default function TabsLayout() {
  const cartTotal = useOrderStore((state) => state.getCartTotal());
  const draftCount = useDraftStore((state) => state.getTotalItemCount());

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#F97316',
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: '#E5E7EB',
          paddingTop: 8,
          paddingBottom: 8,
          height: 80,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '500',
        },
        headerStyle: {
          backgroundColor: '#FFFFFF',
        },
        headerTitleStyle: {
          fontWeight: '600',
          color: '#111827',
        },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Order',
          headerTitle: 'New Order',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="add-circle-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="quick-order"
        options={{
          title: 'Quick',
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="flash-outline" size={size} color={color} />
          ),
          tabBarBadge: draftCount > 0 ? draftCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: '#F97316',
            color: '#FFFFFF',
            fontSize: 10,
          },
        }}
      />
      <Tabs.Screen
        name="draft"
        options={{
          href: null, // Hide from tab bar, accessed via Quick Order
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: 'Cart',
          headerTitle: 'Order Cart',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cart-outline" size={size} color={color} />
          ),
          tabBarBadge: cartTotal > 0 ? cartTotal : undefined,
          tabBarBadgeStyle: {
            backgroundColor: '#F97316',
            color: '#FFFFFF',
            fontSize: 10,
          },
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'History',
          headerTitle: 'Order History',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          headerTitle: 'My Profile',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
