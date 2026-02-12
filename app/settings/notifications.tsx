import React, { useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore, useSettingsStore } from '@/store';
import { colors } from '@/constants';
import { SettingToggle, TimePickerRow } from '@/components/settings';
import {
  deactivatePushTokensForUser,
  registerCurrentDevicePushToken,
  requestNotificationPermissions,
  syncNotificationPreference,
} from '@/services/notificationService';
import { useScaledStyles } from '@/hooks/useScaledStyles';


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
        iconColor="#F59E0B"
        iconBgColor="#FEF3C7"
        title="Push Notifications"
        subtitle="Receive alerts on your device"
        value={notifications.pushEnabled}
        onValueChange={handlePushToggle}
      />

      {notifications.pushEnabled && (
        <>
          <View style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(8) }}>
            <Text className="text-gray-500 uppercase tracking-wide" style={{ fontSize: ds.fontSize(11) }}>
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

          <View className="h-px bg-gray-100" style={{ marginHorizontal: ds.spacing(16), marginVertical: ds.spacing(8) }} />

          <View style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(8) }}>
            <Text className="text-gray-500 uppercase tracking-wide" style={{ fontSize: ds.fontSize(11) }}>
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

          <View className="h-px bg-gray-100" style={{ marginHorizontal: ds.spacing(16), marginVertical: ds.spacing(8) }} />

          <SettingToggle
            title="Quiet Hours"
            subtitle="Silence notifications during set times"
            value={notifications.quietHours.enabled}
            onValueChange={(v) => setQuietHours({ enabled: v })}
          />

          {notifications.quietHours.enabled && (
            <View style={{ paddingHorizontal: ds.spacing(16), paddingBottom: ds.spacing(16) }}>
              <View className="bg-gray-50 rounded-xl" style={{ paddingHorizontal: ds.spacing(14), borderRadius: ds.radius(12) }}>
                <TimePickerRow
                  title="Start"
                  value={notifications.quietHours.startTime}
                  onTimeChange={(t) => setQuietHours({ startTime: t })}
                />
                <View className="h-px bg-gray-200" />
                <TimePickerRow
                  title="End"
                  value={notifications.quietHours.endTime}
                  onTimeChange={(t) => setQuietHours({ endTime: t })}
                />
              </View>
              <Text className="text-gray-400" style={{ fontSize: ds.fontSize(12), marginTop: ds.spacing(8) }}>
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
  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      <View className="bg-white border-b border-gray-100 flex-row items-center" style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12) }}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ padding: ds.spacing(8), marginRight: ds.spacing(8), minWidth: 44, minHeight: 44, justifyContent: 'center' }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={ds.icon(20)} color={colors.gray[700]} />
        </TouchableOpacity>
        <Text className="font-bold text-gray-900" style={{ fontSize: ds.fontSize(18) }}>Notifications</Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: ds.spacing(32) }}>
        <NotificationsSection />

        {__DEV__ && (
          <TouchableOpacity
            onPress={() => router.push('/settings/notifications-debug')}
            className="bg-gray-100 rounded-xl flex-row items-center justify-center"
            style={{
              marginHorizontal: ds.spacing(16),
              marginTop: ds.spacing(16),
              minHeight: Math.max(44, 44),
              borderRadius: 12,
            }}
          >
            <Ionicons name="bug-outline" size={16} color={colors.gray[500]} />
            <Text className="text-gray-500 font-medium ml-2" style={{ fontSize: ds.fontSize(13) }}>
              Notifications Debug (DEV)
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
