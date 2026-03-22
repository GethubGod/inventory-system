import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore, useSettingsStore } from '@/store';
import { getNotificationsModule } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import {
  SettingsGroup,
  SettingsScreenLayout,
  SettingsSectionLabel,
} from '@/components/settings';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassSpacing,
} from '@/theme/design';

interface DebugInfo {
  permissionStatus: string;
  lastPushToken: string | null;
  dbTokenCount: number;
  scheduledCount: number;
  profileNotificationsEnabled: boolean | null;
  localPushEnabled: boolean;
}

export default function NotificationsDebugScreen() {
  const ds = useScaledStyles();
  const { user, profile } = useAuthStore();
  const { notifications } = useSettingsStore();
  const [info, setInfo] = useState<DebugInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const Notifications = await getNotificationsModule();
      if (!Notifications) {
        setInfo({
          permissionStatus: 'unsupported',
          lastPushToken: null,
          dbTokenCount: 0,
          scheduledCount: 0,
          profileNotificationsEnabled: profile?.notifications_enabled ?? null,
          localPushEnabled: notifications.pushEnabled,
        });
        return;
      }

      const { status } = await Notifications.getPermissionsAsync();
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();

      let lastToken: string | null = null;
      let tokenCount = 0;

      if (user?.id) {
        const { data: tokens } = await (supabase as any)
          .from('device_push_tokens')
          .select('expo_push_token, active, updated_at')
          .eq('user_id', user.id)
          .eq('active', true)
          .order('updated_at', { ascending: false })
          .limit(5);

        tokenCount = tokens?.length ?? 0;
        lastToken = tokens?.[0]?.expo_push_token ?? null;
      }

      setInfo({
        permissionStatus: status,
        lastPushToken: lastToken,
        dbTokenCount: tokenCount,
        scheduledCount: scheduled.length,
        profileNotificationsEnabled: profile?.notifications_enabled ?? null,
        localPushEnabled: notifications.pushEnabled,
      });
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to load debug info');
    } finally {
      setLoading(false);
    }
  }, [notifications.pushEnabled, profile?.notifications_enabled, user?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sendTestNotification = async () => {
    try {
      const Notifications = await getNotificationsModule();
      if (!Notifications) {
        Alert.alert('Unavailable', 'Notifications are not supported on this platform.');
        return;
      }

      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Test Notification',
          body: `This is a test from Babytuna at ${new Date().toLocaleTimeString()}`,
          data: { type: 'debug-test' },
          sound: true,
        },
        trigger: null,
      });
      Alert.alert('Sent', 'Test local notification sent.');
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to send test notification');
    }
  };

  const renderRow = (label: string, value: string | number | boolean | null) => {
    const display =
      value === null
        ? 'null'
        : typeof value === 'boolean'
          ? value
            ? 'true'
            : 'false'
          : String(value);
    const color =
      value === true || value === 'granted'
        ? glassColors.successText
        : value === false || value === 'denied'
          ? glassColors.dangerText
          : glassColors.textPrimary;

    return (
      <View
        key={label}
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          paddingHorizontal: ds.spacing(16),
          paddingVertical: ds.spacing(14),
          borderBottomWidth: glassHairlineWidth,
          borderBottomColor: glassColors.divider,
        }}
      >
        <Text
          style={{
            flex: 1,
            paddingRight: ds.spacing(12),
            fontSize: ds.fontSize(13),
            color: glassColors.textSecondary,
          }}
        >
          {label}
        </Text>
        <Text
          style={{
            maxWidth: '55%',
            fontSize: ds.fontSize(13),
            color,
            textAlign: 'right',
            fontWeight: '600',
          }}
          selectable
          numberOfLines={2}
        >
          {display}
        </Text>
      </View>
    );
  };

  return (
    <SettingsScreenLayout title="Notifications Debug">
      <SettingsSectionLabel
        label="Diagnostics"
        description="Development-only notification state and token visibility inside the same settings shell."
      />

      <SettingsGroup>
        {loading ? (
          <View style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(18) }}>
            <Text
              style={{
                fontSize: ds.fontSize(14),
                color: glassColors.textSecondary,
              }}
            >
              Loading...
            </Text>
          </View>
        ) : info ? (
          <>
            {renderRow('OS Permission', info.permissionStatus)}
            {renderRow('Local pushEnabled Toggle', info.localPushEnabled)}
            {renderRow('DB notifications_enabled', info.profileNotificationsEnabled)}
            {renderRow('Active DB Tokens', info.dbTokenCount)}
            {renderRow(
              'Last Push Token',
              info.lastPushToken ? `...${info.lastPushToken.slice(-20)}` : 'none',
            )}
            {renderRow('Scheduled Notifications', info.scheduledCount)}
            {renderRow('Platform', Platform.OS)}
          </>
        ) : null}
      </SettingsGroup>

      <View
        style={{
          paddingHorizontal: glassSpacing.screen,
          paddingTop: ds.spacing(16),
          gap: ds.spacing(10),
        }}
      >
        <TouchableOpacity
          onPress={sendTestNotification}
          activeOpacity={0.82}
          style={{
            minHeight: Math.max(48, ds.buttonH),
            borderRadius: glassRadii.button,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: glassColors.accent,
          }}
        >
          <Text
            style={{
              fontSize: ds.fontSize(15),
              fontWeight: '700',
              color: glassColors.textOnPrimary,
            }}
          >
            Send Test Local Notification
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => {
            void refresh();
          }}
          activeOpacity={0.82}
          style={{
            minHeight: Math.max(48, ds.buttonH),
            borderRadius: glassRadii.button,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            backgroundColor: glassColors.mediumFill,
            borderWidth: glassHairlineWidth,
            borderColor: glassColors.controlBorder,
          }}
        >
          <Ionicons
            name="refresh-outline"
            size={ds.icon(18)}
            color={glassColors.textSecondary}
          />
          <Text
            style={{
              marginLeft: ds.spacing(8),
              fontSize: ds.fontSize(15),
              fontWeight: '700',
              color: glassColors.textSecondary,
            }}
          >
            Refresh
          </Text>
        </TouchableOpacity>
      </View>
    </SettingsScreenLayout>
  );
}
