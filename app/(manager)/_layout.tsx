import { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Sparkles } from 'lucide-react-native';
import { View, Text } from 'react-native';
import { RealtimeChannel } from '@supabase/supabase-js';
import { useAuthStore, useOrderStore, useDisplayStore, useTunaSpecialistStore } from '@/store';
import { supabase } from '@/lib/supabase';

export default function ManagerLayout() {
  const { session, profile, user } = useAuthStore();
  const { getTotalCartCount } = useOrderStore();
  const voiceCartCount = useTunaSpecialistStore((state) => state.cartItems.length);
  const [pendingFulfillmentCount, setPendingFulfillmentCount] = useState(0);
  const badgeRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const badgeChannelRef = useRef<RealtimeChannel | null>(null);
  const badgePollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ds = useDisplayStore();
  const cartCount = getTotalCartCount('manager');
  const isLarge = ds.uiScale === 'large';
  const isCompact = ds.uiScale === 'compact';
  const metadataRole =
    typeof session?.user?.user_metadata?.role === 'string'
      ? session.user.user_metadata.role
      : typeof session?.user?.app_metadata?.role === 'string'
        ? session.user.app_metadata.role
        : null;
  const resolvedRole = user?.role ?? profile?.role ?? metadataRole;
  // Match employee tab bar size for default/compact and only expand for large UI scale.
  const tabBarScale = isLarge ? 1.1 : 1;
  const badgeSize = Math.max(18, Math.round(18 * tabBarScale));
  const refreshPendingFulfillmentCount = useCallback(async () => {
    if (!session || resolvedRole !== 'manager') {
      setPendingFulfillmentCount(0);
      return;
    }

    try {
      // Count unique submitted orders that still have at least one pending order_item.
      // This tracks actual fulfillment workload more accurately than raw order status counts.
      const { data, error } = await supabase
        .from('order_items')
        .select('order_id,orders!inner(status)')
        .or('status.is.null,status.eq.pending')
        .eq('orders.status', 'submitted')
        .limit(10000);

      if (error) throw error;

      const uniqueOrderIds = new Set(
        (Array.isArray(data) ? data : [])
          .map((row: any) => (typeof row?.order_id === 'string' ? row.order_id : null))
          .filter((value: string | null): value is string => Boolean(value))
      );

      setPendingFulfillmentCount(uniqueOrderIds.size);
    } catch (error) {
      console.error('[ManagerLayout] Failed to load fulfillment badge count:', error);
      setPendingFulfillmentCount(0);
    }
  }, [resolvedRole, session]);

  useEffect(() => {
    void refreshPendingFulfillmentCount();
  }, [refreshPendingFulfillmentCount]);

  useEffect(() => {
    if (!session || resolvedRole !== 'manager') {
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
      .channel('manager-fulfillment-tab-badge')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        scheduleCountRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_items' },
        scheduleCountRefresh
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
            <View>
              <Ionicons name="clipboard-outline" size={size} color={color} />
              {pendingFulfillmentCount > 0 && (
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
                    {pendingFulfillmentCount > 99 ? '99+' : pendingFulfillmentCount}
                  </Text>
                </View>
              )}
            </View>
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
