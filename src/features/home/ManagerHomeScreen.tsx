import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  LayoutAnimation,
  Platform,
  RefreshControl,
  Text,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { RealtimeChannel } from '@supabase/supabase-js';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { listEmployeesWithReminderStatus } from '@/services';
import { useManagedRefresh } from '@/hooks/useManagedRefresh';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { useAuthStore, useDisplayStore, useOrderStore } from '@/store';
import {
  GlassSurface,
  IdentityHeader,
  LoadingIndicator,
} from '@/components';
import type { Location } from '@/types';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
} from '@/theme/design';
import {
  HomeModuleCard,
  HomeModuleState,
  HomeScreenScroll,
  HomeSearchCard,
} from './components/HomeScreenPrimitives';

interface EmployeeActivity {
  id: string;
  employeeName: string;
  itemName?: string;
  locationName: string;
  timestamp: Date;
  orderNumber?: number;
  orderId?: string;
  itemCount?: number;
}

interface ReminderStats {
  pendingReminders: number;
  overdueEmployees: number;
  notificationsOff: number;
}

const DEFAULT_REMINDER_STATS: ReminderStats = {
  pendingReminders: 0,
  overdueEmployees: 0,
  notificationsOff: 0,
};

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function getGreeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatHeaderDate(now: Date): string {
  return now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function formatTimeAgo(date: Date) {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

const ManagerStatTile = memo(function ManagerStatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'warning' | 'danger' | 'neutral';
}) {
  const ds = useScaledStyles();
  const stylesByTone = {
    warning: {
      backgroundColor: glassColors.warningSoft,
      labelColor: glassColors.warningText,
      borderColor: 'transparent',
    },
    danger: {
      backgroundColor: glassColors.dangerSoft,
      labelColor: glassColors.dangerText,
      borderColor: 'transparent',
    },
    neutral: {
      backgroundColor: glassColors.subtleFill,
      labelColor: glassColors.textSecondary,
      borderColor: glassColors.cardBorder,
    },
  }[tone];

  return (
    <View
      style={{
        flex: 1,
        borderRadius: glassRadii.button,
        paddingHorizontal: ds.spacing(12),
        paddingVertical: ds.spacing(12),
        backgroundColor: stylesByTone.backgroundColor,
        borderWidth: tone === 'neutral' ? glassHairlineWidth : 0,
        borderColor: stylesByTone.borderColor,
      }}
    >
      <Text
        style={{
          fontSize: ds.fontSize(11),
          fontWeight: '600',
          color: stylesByTone.labelColor,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontSize: ds.fontSize(22),
          fontWeight: '800',
          color: glassColors.textPrimary,
          marginTop: ds.spacing(4),
        }}
      >
        {value}
      </Text>
    </View>
  );
});

const ManagerQuickActionRow = memo(function ManagerQuickActionRow({
  icon,
  iconTint,
  title,
  description,
  onPress,
  showDivider = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconTint: string;
  title: string;
  description: string;
  onPress: () => void;
  showDivider?: boolean;
}) {
  const ds = useScaledStyles();

  return (
    <>
      {showDivider ? (
        <View
          style={{
            borderTopWidth: glassHairlineWidth,
            borderTopColor: glassColors.divider,
          }}
        />
      ) : null}
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.85}
        style={{
          paddingVertical: ds.spacing(12),
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <View
          style={{
            width: ds.icon(36),
            height: ds.icon(36),
            borderRadius: glassRadii.iconTile,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: iconTint,
            marginRight: ds.spacing(12),
          }}
        >
          <Ionicons
            name={icon}
            size={ds.icon(18)}
            color={glassColors.textPrimary}
          />
        </View>
        <View style={{ flex: 1, paddingRight: ds.spacing(10) }}>
          <Text
            style={{
              fontSize: ds.fontSize(15),
              fontWeight: '600',
              color: glassColors.textPrimary,
            }}
          >
            {title}
          </Text>
          <Text
            style={{
              marginTop: ds.spacing(4),
              fontSize: ds.fontSize(12),
              color: glassColors.textSecondary,
            }}
            numberOfLines={2}
          >
            {description}
          </Text>
        </View>
        <Ionicons
          name="chevron-forward"
          size={ds.icon(18)}
          color={glassColors.textSecondary}
        />
      </TouchableOpacity>
    </>
  );
});

const EmployeeActivityRow = memo(function EmployeeActivityRow({
  activity,
  onPress,
  showDivider = false,
}: {
  activity: EmployeeActivity;
  onPress: () => void;
  showDivider?: boolean;
}) {
  const ds = useScaledStyles();

  return (
    <>
      {showDivider ? (
        <View
          style={{
            borderTopWidth: glassHairlineWidth,
            borderTopColor: glassColors.divider,
          }}
        />
      ) : null}
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.8}
        style={{
          paddingVertical: ds.spacing(12),
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View
            style={{
              width: ds.icon(36),
              height: ds.icon(36),
              borderRadius: glassRadii.iconTile,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: glassColors.accentSoft,
              marginRight: ds.spacing(12),
            }}
          >
            <Text
              style={{
                fontSize: ds.fontSize(14),
                fontWeight: '700',
                color: glassColors.accent,
              }}
            >
              {activity.employeeName.charAt(0).toUpperCase()}
            </Text>
          </View>

          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
              <Text
                style={{
                  fontSize: ds.fontSize(14),
                  fontWeight: '600',
                  color: glassColors.textPrimary,
                }}
              >
                {activity.employeeName}
              </Text>
              <Text
                style={{
                  fontSize: ds.fontSize(14),
                  color: glassColors.textSecondary,
                  marginLeft: ds.spacing(4),
                }}
              >
                ordered
              </Text>
              {activity.itemName ? (
                <Text
                  style={{
                    fontSize: ds.fontSize(14),
                    fontWeight: '600',
                    color: glassColors.accent,
                    marginLeft: ds.spacing(4),
                  }}
                  numberOfLines={1}
                >
                  {activity.itemName}
                  {activity.itemCount && activity.itemCount > 1
                    ? ` +${activity.itemCount - 1} more`
                    : ''}
                </Text>
              ) : null}
            </View>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginTop: ds.spacing(4),
              }}
            >
              <Ionicons
                name="location-outline"
                size={ds.icon(12)}
                color={glassColors.textSecondary}
              />
              <Text
                style={{
                  fontSize: ds.fontSize(12),
                  color: glassColors.textSecondary,
                  marginLeft: ds.spacing(4),
                }}
              >
                {activity.locationName}
              </Text>
              <Text
                style={{
                  fontSize: ds.fontSize(12),
                  color: glassColors.textMuted,
                  marginHorizontal: ds.spacing(6),
                }}
              >
                ·
              </Text>
              <Ionicons
                name="time-outline"
                size={ds.icon(12)}
                color={glassColors.textSecondary}
              />
              <Text
                style={{
                  fontSize: ds.fontSize(12),
                  color: glassColors.textSecondary,
                  marginLeft: ds.spacing(4),
                }}
              >
                {formatTimeAgo(activity.timestamp)}
              </Text>
            </View>
          </View>

          {activity.orderNumber ? (
            <View
              style={{
                backgroundColor: glassColors.subtleFill,
                borderWidth: glassHairlineWidth,
                borderColor: glassColors.cardBorder,
                paddingHorizontal: ds.spacing(8),
                paddingVertical: ds.spacing(4),
                borderRadius: glassRadii.tag,
              }}
            >
              <Text
                style={{
                  fontSize: ds.fontSize(11),
                  fontWeight: '600',
                  color: glassColors.textSecondary,
                }}
              >
                #{activity.orderNumber}
              </Text>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    </>
  );
});

export function ManagerHomeScreen() {
  const ds = useScaledStyles();
  const { locations, fetchLocations, user, profile, session } = useAuthStore();
  const { hapticFeedback } = useDisplayStore();
  const cartCount = useOrderStore((state) => state.getTotalCartCount('manager'));
  const profileName = profile?.full_name?.trim() || '';
  const userName = user?.name?.trim() || '';
  const metadataName =
    typeof session?.user?.user_metadata?.name === 'string'
      ? session.user.user_metadata.name.trim()
      : '';
  const greetingName = profileName || userName || metadataName || 'there';
  const [reminderStats, setReminderStats] = useState<ReminderStats>({
    ...DEFAULT_REMINDER_STATS,
  });
  const [employeeActivity, setEmployeeActivity] = useState<EmployeeActivity[]>([]);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const homeDate = useMemo(() => new Date(), []);
  const greeting = `${getGreeting(homeDate)}, ${greetingName}`;

  const fetchDashboardData = useCallback(async () => {
    try {
      let recentQuery = supabase
        .from('orders')
        .select(`
          *,
          location:locations(*),
          user:users!orders_user_id_fkey(*),
          order_items(
            quantity,
            unit_type,
            inventory_item:inventory_items(name)
          )
        `)
        .neq('status', 'draft')
        .order('created_at', { ascending: false })
        .limit(10);

      if (selectedLocation?.id) {
        recentQuery = recentQuery.eq('location_id', selectedLocation.id);
      }

      const { data: recentOrders, error: recentError } = await recentQuery;
      if (recentError) {
        throw recentError;
      }

      try {
        const reminderOverview = await listEmployeesWithReminderStatus({
          locationId: selectedLocation?.id ?? null,
        });
        setReminderStats({
          pendingReminders: reminderOverview.stats.pendingReminders,
          overdueEmployees: reminderOverview.stats.overdueEmployees,
          notificationsOff: reminderOverview.stats.notificationsOff,
        });
      } catch {
        setReminderStats(DEFAULT_REMINDER_STATS);
      }

      if (recentOrders) {
        const activities: EmployeeActivity[] = recentOrders.map((order: any) => {
          const firstItem = order.order_items?.[0];
          const itemCount = order.order_items?.length || 0;

          return {
            id: order.id,
            employeeName: order.user?.name || 'Unknown',
            itemName: firstItem?.inventory_item?.name,
            locationName: order.location?.name || 'Unknown',
            timestamp: new Date(order.created_at),
            orderNumber: order.order_number,
            orderId: order.id,
            itemCount,
          };
        });
        setEmployeeActivity(activities);
      }
    } catch {
      setReminderStats(DEFAULT_REMINDER_STATS);
      setEmployeeActivity([]);
    } finally {
      setIsLoading(false);
    }
  }, [selectedLocation?.id]);

  useEffect(() => {
    void fetchLocations();
  }, [fetchLocations]);

  useFocusEffect(
    useCallback(() => {
      void fetchDashboardData();
    }, [fetchDashboardData]),
  );

  useEffect(() => {
    if (realtimeChannelRef.current) {
      supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }

    const scheduleRefresh = () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      refreshTimeoutRef.current = setTimeout(() => {
        void fetchDashboardData();
      }, 250);
    };

    const channel = supabase
      .channel(`manager-dashboard-sync-${selectedLocation?.id ?? 'all'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        scheduleRefresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reminders' },
        scheduleRefresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        scheduleRefresh,
      )
      .subscribe();

    realtimeChannelRef.current = channel;

    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
    };
  }, [fetchDashboardData, selectedLocation?.id]);

  const { refreshing, onRefresh } = useManagedRefresh(fetchDashboardData);

  const handleSelectLocation = useCallback(
    (loc: Location | null) => {
      if (hapticFeedback && Platform.OS !== 'web') {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setSelectedLocation(loc);
      setShowLocationPicker(false);
    },
    [hapticFeedback],
  );

  if (isLoading && employeeActivity.length === 0) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: glassColors.background }}
        edges={['top', 'left', 'right']}
      >
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <LoadingIndicator showText text="Loading home..." />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <HomeScreenScroll
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={glassColors.accent}
        />
      }
    >
      <IdentityHeader
        identity="Manager"
        title={greeting}
        subtitle={formatHeaderDate(homeDate)}
        cartCount={cartCount}
        onPressCart={() => router.push('/(manager)/cart')}
      />

      <HomeSearchCard
        placeholder="Search inventory..."
        onPress={() => router.push('/(manager)/browse')}
        accessibilityLabel="Search manager inventory"
      />

      <View style={{ marginTop: ds.spacing(12) }}>
        <TouchableOpacity
          onPress={() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setShowLocationPicker((previous) => !previous);
          }}
          activeOpacity={0.85}
        >
          <GlassSurface
            intensity="medium"
            style={{
              borderRadius: glassRadii.search,
              paddingHorizontal: ds.spacing(20),
              height: Math.max(50, ds.buttonH + 8),
            }}
          >
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons
                name="location"
                size={ds.icon(20)}
                color={glassColors.accent}
              />
              <Text
                style={{
                  marginLeft: ds.spacing(12),
                  fontSize: ds.fontSize(16),
                  fontWeight: '600',
                  color: glassColors.textPrimary,
                  flex: 1,
                }}
                numberOfLines={1}
              >
                {selectedLocation?.name || 'All Locations'}
              </Text>
              <Ionicons
                name={showLocationPicker ? 'chevron-up' : 'chevron-down'}
                size={ds.icon(18)}
                color={glassColors.textSecondary}
              />
            </View>
          </GlassSurface>
        </TouchableOpacity>

        {showLocationPicker ? (
          <GlassSurface
            intensity="subtle"
            style={{
              borderRadius: glassRadii.surface,
              marginTop: ds.spacing(8),
              overflow: 'hidden',
            }}
          >
            <TouchableOpacity
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: ds.spacing(16),
                paddingVertical: ds.spacing(14),
              }}
              onPress={() => handleSelectLocation(null)}
              activeOpacity={0.7}
            >
              <View
                style={{
                  width: ds.icon(32),
                  height: ds.icon(32),
                  borderRadius: glassRadii.iconTile,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: glassColors.accentSoft,
                  marginRight: ds.spacing(12),
                }}
              >
                <Ionicons name="globe" size={ds.icon(16)} color={glassColors.accent} />
              </View>
              <Text
                style={{
                  flex: 1,
                  fontSize: ds.fontSize(15),
                  fontWeight: '600',
                  color: glassColors.textPrimary,
                }}
              >
                All Locations
              </Text>
              {!selectedLocation ? (
                <Ionicons name="checkmark" size={ds.icon(18)} color={glassColors.accent} />
              ) : null}
            </TouchableOpacity>

            {locations.map((loc) => {
              const isSelected = selectedLocation?.id === loc.id;
              return (
                <TouchableOpacity
                  key={loc.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: ds.spacing(16),
                    paddingVertical: ds.spacing(14),
                    borderTopWidth: glassHairlineWidth,
                    borderTopColor: glassColors.divider,
                  }}
                  onPress={() => handleSelectLocation(loc)}
                  activeOpacity={0.7}
                >
                  <View
                    style={{
                      width: ds.icon(32),
                      height: ds.icon(32),
                      borderRadius: glassRadii.iconTile,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: isSelected
                        ? glassColors.accent
                        : glassColors.mediumFill,
                      marginRight: ds.spacing(12),
                    }}
                  >
                    <Ionicons
                      name="business-outline"
                      size={ds.icon(16)}
                      color={isSelected ? glassColors.textOnPrimary : glassColors.textSecondary}
                    />
                  </View>
                  <Text
                    style={{
                      flex: 1,
                      fontSize: ds.fontSize(15),
                      fontWeight: '600',
                      color: glassColors.textPrimary,
                    }}
                  >
                    {loc.name}
                  </Text>
                  {isSelected ? (
                    <Ionicons name="checkmark" size={ds.icon(18)} color={glassColors.accent} />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </GlassSurface>
        ) : null}
      </View>

      <View style={{ marginTop: ds.spacing(20) }}>
        <HomeModuleCard title="Quick Actions">
          <ManagerQuickActionRow
            icon="reader-outline"
            iconTint={glassColors.accentSoft}
            title="Smart order"
            description="Review predictive suggestions in manager mode."
            onPress={() => router.push('/(manager)/voice')}
          />
          <ManagerQuickActionRow
            icon="clipboard-outline"
            iconTint={glassColors.warningSoft}
            title="Fulfillment queue"
            description="Open pending submitted orders and continue fulfillment."
            onPress={() => router.push('/(manager)/fulfillment')}
            showDivider
          />
          <ManagerQuickActionRow
            icon="notifications-outline"
            iconTint={glassColors.mediumFill}
            title="Employee reminders"
            description="Manage reminder schedules and notification coverage."
            onPress={() => router.push('/(manager)/employee-reminders')}
            showDivider
          />
        </HomeModuleCard>
      </View>

      <View style={{ marginTop: ds.spacing(20) }}>
        <HomeModuleCard
          title="Employee Reminders"
          actionLabel="Manage"
          onPressAction={() => router.push('/(manager)/employee-reminders')}
        >
          <View style={{ flexDirection: 'row', gap: ds.spacing(8) }}>
            <ManagerStatTile
              label="Pending"
              value={reminderStats.pendingReminders}
              tone="warning"
            />
            <ManagerStatTile
              label="Overdue"
              value={reminderStats.overdueEmployees}
              tone="danger"
            />
            <ManagerStatTile
              label="Notifs Off"
              value={reminderStats.notificationsOff}
              tone="neutral"
            />
          </View>
        </HomeModuleCard>
      </View>

      <View style={{ marginTop: ds.spacing(20) }}>
        <HomeModuleCard
          title="Recent Activity"
          actionLabel="See All"
          onPressAction={() => router.push('/(manager)/orders')}
        >
          {employeeActivity.length === 0 ? (
            <HomeModuleState
              icon="people-outline"
              title="No recent activity"
              message="Employee orders will appear here as they come in."
            />
          ) : (
            employeeActivity.slice(0, 5).map((activity, index) => (
              <EmployeeActivityRow
                key={activity.id}
                activity={activity}
                onPress={() => {
                  if (activity.orderId) {
                    router.push(`/orders/${activity.orderId}`);
                  }
                }}
                showDivider={index > 0}
              />
            ))
          )}
        </HomeModuleCard>
      </View>
    </HomeScreenScroll>
  );
}
