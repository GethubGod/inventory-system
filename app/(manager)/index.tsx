import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Platform,
  LayoutAnimation,
  UIManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { RealtimeChannel } from '@supabase/supabase-js';
import * as Haptics from 'expo-haptics';
import { useAuthStore, useOrderStore, useDisplayStore } from '@/store';
import { supabase } from '@/lib/supabase';
import type { Location } from '@/types';
import { listEmployeesWithReminderStatus } from '@/services';
import { GlassSurface, IdentityHeader, LoadingIndicator } from '@/components';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassSpacing,
  glassTabBarHeight,
} from '@/theme/design';
import { useManagedRefresh } from '@/hooks/useManagedRefresh';
import { useScaledStyles } from '@/hooks/useScaledStyles';

interface EmployeeActivity {
  id: string;
  employeeName: string;
  employeeId: string;
  action: string;
  itemName?: string;
  quantity?: number;
  unit?: string;
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

export default function ManagerDashboard() {
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
            employeeId: order.user_id,
            action: `placed order #${order.order_number}`,
            itemName: firstItem?.inventory_item?.name,
            quantity: firstItem?.quantity,
            unit: firstItem?.unit_type,
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
    } finally {
      setIsLoading(false);
    }
  }, [selectedLocation?.id]);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  useFocusEffect(
    useCallback(() => {
      fetchDashboardData();
    }, [fetchDashboardData])
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
        fetchDashboardData();
      }, 250);
    };

    const channel = supabase
      .channel(`manager-dashboard-sync-${selectedLocation?.id ?? 'all'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        scheduleRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reminders' },
        scheduleRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        scheduleRefresh
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

  const handleSelectLocation = (loc: Location | null) => {
    if (hapticFeedback && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSelectedLocation(loc);
    setShowLocationPicker(false);
  };

  if (isLoading && employeeActivity.length === 0) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: glassColors.background }}
        edges={['top', 'left', 'right']}
      >
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <LoadingIndicator showText text="Loading dashboard..." />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: glassColors.background }}
      edges={['top', 'left', 'right']}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: glassSpacing.screen,
          paddingBottom: glassTabBarHeight + ds.spacing(24),
        }}
        showsVerticalScrollIndicator={false}
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

        {/* Location Picker */}
        <TouchableOpacity
          onPress={() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setShowLocationPicker((prev) => !prev);
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

        {showLocationPicker && (
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
              {!selectedLocation && (
                <Ionicons name="checkmark" size={ds.icon(18)} color={glassColors.accent} />
              )}
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
                  {isSelected && (
                    <Ionicons name="checkmark" size={ds.icon(18)} color={glassColors.accent} />
                  )}
                </TouchableOpacity>
              );
            })}
          </GlassSurface>
        )}

        {/* Employee Reminders Card */}
        <View style={{ marginTop: ds.spacing(20) }}>
          <GlassSurface
            intensity="subtle"
            style={{ borderRadius: glassRadii.surface }}
          >
            <View
              style={{
                paddingHorizontal: ds.spacing(14),
                paddingTop: ds.spacing(14),
                paddingBottom: ds.spacing(14),
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text
                  style={{
                    fontSize: ds.fontSize(15),
                    fontWeight: '700',
                    color: glassColors.textPrimary,
                  }}
                >
                  Employee Reminders
                </Text>
                <TouchableOpacity
                  onPress={() => router.push('/(manager)/employee-reminders')}
                  hitSlop={8}
                >
                  <Text
                    style={{
                      fontSize: ds.fontSize(13),
                      fontWeight: '700',
                      color: glassColors.accent,
                    }}
                  >
                    Manage
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={{ flexDirection: 'row', gap: ds.spacing(8), marginTop: ds.spacing(12) }}>
                <View
                  style={{
                    flex: 1,
                    borderRadius: glassRadii.button,
                    paddingHorizontal: ds.spacing(12),
                    paddingVertical: ds.spacing(12),
                    backgroundColor: glassColors.warningSoft,
                  }}
                >
                  <Text
                    style={{
                      fontSize: ds.fontSize(11),
                      fontWeight: '600',
                      color: glassColors.warningText,
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                    }}
                  >
                    Pending
                  </Text>
                  <Text
                    style={{
                      fontSize: ds.fontSize(22),
                      fontWeight: '800',
                      color: glassColors.textPrimary,
                      marginTop: ds.spacing(4),
                    }}
                  >
                    {reminderStats.pendingReminders}
                  </Text>
                </View>
                <View
                  style={{
                    flex: 1,
                    borderRadius: glassRadii.button,
                    paddingHorizontal: ds.spacing(12),
                    paddingVertical: ds.spacing(12),
                    backgroundColor: glassColors.dangerSoft,
                  }}
                >
                  <Text
                    style={{
                      fontSize: ds.fontSize(11),
                      fontWeight: '600',
                      color: glassColors.dangerText,
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                    }}
                  >
                    Overdue
                  </Text>
                  <Text
                    style={{
                      fontSize: ds.fontSize(22),
                      fontWeight: '800',
                      color: glassColors.textPrimary,
                      marginTop: ds.spacing(4),
                    }}
                  >
                    {reminderStats.overdueEmployees}
                  </Text>
                </View>
                <View
                  style={{
                    flex: 1,
                    borderRadius: glassRadii.button,
                    paddingHorizontal: ds.spacing(12),
                    paddingVertical: ds.spacing(12),
                    backgroundColor: glassColors.subtleFill,
                    borderWidth: glassHairlineWidth,
                    borderColor: glassColors.cardBorder,
                  }}
                >
                  <Text
                    style={{
                      fontSize: ds.fontSize(11),
                      fontWeight: '600',
                      color: glassColors.textSecondary,
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                    }}
                  >
                    Notifs off
                  </Text>
                  <Text
                    style={{
                      fontSize: ds.fontSize(22),
                      fontWeight: '800',
                      color: glassColors.textPrimary,
                      marginTop: ds.spacing(4),
                    }}
                  >
                    {reminderStats.notificationsOff}
                  </Text>
                </View>
              </View>
            </View>
          </GlassSurface>
        </View>

        {/* Employee Activity Card */}
        <View style={{ marginTop: ds.spacing(20) }}>
          <GlassSurface
            intensity="subtle"
            style={{ borderRadius: glassRadii.surface }}
          >
            <View
              style={{
                paddingHorizontal: ds.spacing(14),
                paddingTop: ds.spacing(14),
                paddingBottom: ds.spacing(14),
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text
                  style={{
                    fontSize: ds.fontSize(15),
                    fontWeight: '700',
                    color: glassColors.textPrimary,
                  }}
                >
                  Employee Activity
                </Text>
                <TouchableOpacity
                  onPress={() => router.push('/(manager)/orders')}
                  hitSlop={8}
                >
                  <Text
                    style={{
                      fontSize: ds.fontSize(13),
                      fontWeight: '700',
                      color: glassColors.accent,
                    }}
                  >
                    See All
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={{ marginTop: ds.spacing(12) }}>
                {employeeActivity.length === 0 ? (
                  <View
                    style={{
                      minHeight: ds.spacing(124),
                      justifyContent: 'center',
                    }}
                  >
                    <View
                      style={{
                        width: ds.icon(36),
                        height: ds.icon(36),
                        borderRadius: glassRadii.iconTile,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: glassColors.mediumFill,
                      }}
                    >
                      <Ionicons
                        name="people-outline"
                        size={ds.icon(18)}
                        color={glassColors.textSecondary}
                      />
                    </View>
                    <Text
                      style={{
                        marginTop: ds.spacing(12),
                        fontSize: ds.fontSize(15),
                        fontWeight: '600',
                        color: glassColors.textPrimary,
                      }}
                    >
                      No recent activity
                    </Text>
                    <Text
                      style={{
                        marginTop: ds.spacing(6),
                        fontSize: ds.fontSize(12),
                        color: glassColors.textSecondary,
                        lineHeight: ds.fontSize(18),
                      }}
                    >
                      Employee orders will appear here as they come in.
                    </Text>
                  </View>
                ) : (
                  employeeActivity.slice(0, 5).map((activity, index) => (
                    <TouchableOpacity
                      key={activity.id}
                      style={{
                        paddingVertical: ds.spacing(12),
                        borderTopWidth: index > 0 ? glassHairlineWidth : 0,
                        borderTopColor: glassColors.divider,
                      }}
                      onPress={() => activity.orderId && router.push(`/orders/${activity.orderId}`)}
                      activeOpacity={0.7}
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
                            {activity.itemName && (
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
                            )}
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

                        {activity.orderNumber && (
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
                        )}
                      </View>
                    </TouchableOpacity>
                  ))
                )}
              </View>
            </View>
          </GlassSurface>
        </View>

        {/* Browse Inventory Card */}
        <View style={{ marginTop: ds.spacing(20) }}>
          <GlassSurface
            intensity="subtle"
            style={{ borderRadius: glassRadii.surface }}
          >
            <TouchableOpacity
              onPress={() => router.push('/(manager)/browse')}
              activeOpacity={0.94}
              style={{
                borderRadius: glassRadii.surface,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  paddingHorizontal: ds.spacing(14),
                  paddingVertical: ds.spacing(14),
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
              >
                <View
                  style={{
                    width: ds.icon(40),
                    height: ds.icon(40),
                    borderRadius: glassRadii.iconTile,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: glassColors.accentSoft,
                    marginRight: ds.spacing(12),
                  }}
                >
                  <Ionicons
                    name="search-outline"
                    size={ds.icon(20)}
                    color={glassColors.accent}
                  />
                </View>
                <View style={{ flex: 1, paddingRight: ds.spacing(10) }}>
                  <Text
                    style={{
                      fontSize: ds.fontSize(15),
                      fontWeight: '700',
                      color: glassColors.textPrimary,
                    }}
                  >
                    Browse Inventory
                  </Text>
                  <Text
                    style={{
                      marginTop: ds.spacing(4),
                      fontSize: ds.fontSize(13),
                      color: glassColors.textSecondary,
                    }}
                  >
                    Search and add items by category
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={ds.icon(18)}
                  color={glassColors.textSecondary}
                />
              </View>
            </TouchableOpacity>
          </GlassSurface>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
