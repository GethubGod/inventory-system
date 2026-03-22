import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, Alert, Linking } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { GlassSurface } from '@/components';
import { useAuthStore, useSettingsStore } from '@/store';
import { colors } from '@/constants';
import {
  SettingToggle,
  SettingsGroup,
  SettingsScreenLayout,
  SettingsSectionLabel,
  TimePickerRow,
  settingsIconPalettes,
} from '@/components/settings';
import {
  deactivatePushTokensForUser,
  registerCurrentDevicePushToken,
  requestNotificationPermissions,
  syncNotificationPreference,
} from '@/services/notificationService';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { buildSettingsHref, buildSettingsPath } from '@/lib/settingsNavigation';
import { useSettingsNavigationContext } from '@/hooks/useSettingsBackRoute';
import { glassColors, glassHairlineWidth, glassRadii, glassSpacing } from '@/theme/design';


function NotificationsSection() {
  const ds = useScaledStyles();
  const { user, profile, setProfile } = useAuthStore();
  const { notifications, setNotificationSettings, setQuietHours } = useSettingsStore();
  const isManager = (user?.role ?? profile?.role) === 'manager';

  useEffect(() => {
    if (typeof profile?.notifications_enabled !== 'boolean') return;
    if (notifications.pushEnabled !== profile.notifications_enabled) {
      setNotificationSettings({ pushEnabled: profile.notifications_enabled });
    }
  }, [notifications.pushEnabled, profile?.notifications_enabled, setNotificationSettings]);

  const handlePushToggle = async (enabled: boolean) => {
    const userId = user?.id;
    if (enabled) {
      const granted = await requestNotificationPermissions();
      if (!granted) {
        Alert.alert(
          'Permission Required',
          'Please enable notifications in your device settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]
        );
        return;
      }
    }

    const previousValue = notifications.pushEnabled;
    setNotificationSettings({ pushEnabled: enabled });
    if (profile) {
      setProfile({ ...profile, notifications_enabled: enabled });
    }

    if (!userId) return;

    try {
      await syncNotificationPreference(userId, enabled);
      if (enabled) {
        await registerCurrentDevicePushToken(userId);
      } else {
        await deactivatePushTokensForUser(userId);
      }
    } catch (error: any) {
      setNotificationSettings({ pushEnabled: previousValue });
      if (profile) {
        setProfile({ ...profile, notifications_enabled: previousValue });
      }
      Alert.alert(
        'Sync Failed',
        error?.message || 'Unable to save notification preference. Please try again.'
      );
    }
  };

  return (
    <View>
      <SettingToggle
        icon="notifications"
        iconColor={settingsIconPalettes.notifications.icon}
        iconBgColor={settingsIconPalettes.notifications.background}
        title="Push Notifications"
        subtitle="Receive alerts on your device"
        value={notifications.pushEnabled}
        onValueChange={handlePushToggle}
      />

      {notifications.pushEnabled && (
        <>
          <View style={{ paddingHorizontal: ds.spacing(16), paddingTop: ds.spacing(12), paddingBottom: ds.spacing(8) }}>
            <Text style={{ fontSize: ds.fontSize(15), fontWeight: '600', color: glassColors.textPrimary }}>
              Notification Types
            </Text>
          </View>

          <SettingToggle
            title="Order Status Updates"
            subtitle="When your orders are fulfilled"
            value={notifications.orderStatus}
            onValueChange={(v) => setNotificationSettings({ orderStatus: v })}
          />

          {isManager && (
            <SettingToggle
              title="New Orders"
              subtitle="When employees submit orders"
              value={notifications.newOrders}
              onValueChange={(v) => setNotificationSettings({ newOrders: v })}
            />
          )}

          <SettingToggle
            title="Daily Summary"
            subtitle="End of day order summary"
            value={notifications.dailySummary}
            onValueChange={(v) => setNotificationSettings({ dailySummary: v })}
          />

          <View
            style={{
              height: glassHairlineWidth,
              backgroundColor: glassColors.divider,
              marginHorizontal: ds.spacing(16),
              marginVertical: ds.spacing(8),
            }}
          />

          <View style={{ paddingHorizontal: ds.spacing(16), paddingTop: ds.spacing(12), paddingBottom: ds.spacing(8) }}>
            <Text style={{ fontSize: ds.fontSize(15), fontWeight: '600', color: glassColors.textPrimary }}>
              Sound & Vibration
            </Text>
          </View>

          <SettingToggle
            title="Sound"
            subtitle="Play sound for notifications"
            value={notifications.soundEnabled}
            onValueChange={(v) => setNotificationSettings({ soundEnabled: v })}
          />

          <SettingToggle
            title="Vibration"
            subtitle="Vibrate for notifications"
            value={notifications.vibrationEnabled}
            onValueChange={(v) => setNotificationSettings({ vibrationEnabled: v })}
          />

          <View
            style={{
              height: glassHairlineWidth,
              backgroundColor: glassColors.divider,
              marginHorizontal: ds.spacing(16),
              marginVertical: ds.spacing(8),
            }}
          />

          <SettingToggle
            title="Quiet Hours"
            subtitle="Silence notifications during set times"
            value={notifications.quietHours.enabled}
            onValueChange={(v) => setQuietHours({ enabled: v })}
          />

          {notifications.quietHours.enabled && (
            <View style={{ paddingHorizontal: ds.spacing(16), paddingBottom: ds.spacing(16) }}>
              <GlassSurface
                intensity="medium"
                blurred={false}
                style={{ paddingHorizontal: ds.spacing(14), borderRadius: glassRadii.surface }}
              >
                <TimePickerRow
                  title="Start"
                  value={notifications.quietHours.startTime}
                  onTimeChange={(t) => setQuietHours({ startTime: t })}
                />
                <View style={{ height: glassHairlineWidth, backgroundColor: glassColors.divider }} />
                <TimePickerRow
                  title="End"
                  value={notifications.quietHours.endTime}
                  onTimeChange={(t) => setQuietHours({ endTime: t })}
                />
              </GlassSurface>
              <Text style={{ fontSize: ds.fontSize(12), marginTop: ds.spacing(8), color: glassColors.textSecondary }}>
                Notifications will be silenced during these hours
              </Text>
            </View>
          )}
        </>
      )}
    </View>
  );
}

export default function NotificationsSettingsScreen() {
  const ds = useScaledStyles();
  const { origin, backTo } = useSettingsNavigationContext();
  return (
    <SettingsScreenLayout title="Notifications">
      <SettingsGroup>
        <SettingsSectionLabel
          label="Delivery"
        />
        <View
          style={{
            height: glassHairlineWidth,
            backgroundColor: glassColors.divider,
            marginHorizontal: ds.spacing(16),
          }}
        />
        <View style={{ paddingTop: ds.spacing(4) }}>
          <NotificationsSection />
        </View>
      </SettingsGroup>

      {__DEV__ && (
        <TouchableOpacity
          onPress={() =>
            router.push(
              buildSettingsHref('/settings/notifications-debug', {
                origin,
                backTo: buildSettingsPath('/settings/notifications', {
                  origin,
                  backTo,
                }),
              }),
            )
          }
          style={{
            marginHorizontal: glassSpacing.screen,
            marginTop: ds.spacing(16),
            minHeight: Math.max(44, 44),
            borderRadius: glassRadii.surface,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            backgroundColor: glassColors.mediumFill,
            borderWidth: glassHairlineWidth,
            borderColor: glassColors.cardBorder,
          }}
        >
          <Ionicons name="bug-outline" size={16} color={colors.gray[500]} />
          <Text
            style={{
              fontSize: ds.fontSize(13),
              marginLeft: ds.spacing(8),
              color: glassColors.textSecondary,
              fontWeight: '500',
            }}
          >
            Notifications Debug (DEV)
          </Text>
        </TouchableOpacity>
      )}
    </SettingsScreenLayout>
  );
}
