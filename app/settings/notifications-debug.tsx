import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { colors } from '@/constants';
import { useAuthStore, useSettingsStore } from '@/store';
import { supabase } from '@/lib/supabase';
import { useScaledStyles } from '@/hooks/useScaledStyles';

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
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to load debug info');
    } finally {
      setLoading(false);
    }
  }, [user?.id, profile?.notifications_enabled, notifications.pushEnabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const sendTestNotification = async () => {
    try {
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
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to send test notification');
    }
  };

  const renderRow = (label: string, value: string | number | boolean | null) => {
    const display =
      value === null ? 'null' : typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
    const color =
      value === true || value === 'granted'
        ? '#16A34A'
        : value === false || value === 'denied'
          ? '#DC2626'
          : colors.gray[700];

    return (
      <View
        key={label}
        className="flex-row items-start justify-between bg-white border-b border-gray-100"
        style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12) }}
      >
        <Text className="text-gray-500 flex-1" style={{ fontSize: ds.fontSize(13) }}>
          {label}
        </Text>
        <Text
          style={{ fontSize: ds.fontSize(13), color, maxWidth: '55%', textAlign: 'right' }}
          selectable
          numberOfLines={2}
        >
          {display}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      <View
        className="bg-white border-b border-gray-100 flex-row items-center"
        style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12) }}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ padding: ds.spacing(8), marginRight: ds.spacing(8), minWidth: 44, minHeight: 44, justifyContent: 'center' }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={ds.icon(20)} color={colors.gray[700]} />
        </TouchableOpacity>
        <Text className="font-bold text-gray-900" style={{ fontSize: ds.fontSize(18) }}>
          Notifications Debug
        </Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: ds.spacing(32) }}>
        <View style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(10) }}>
          <Text className="text-gray-400 uppercase tracking-wide" style={{ fontSize: ds.fontSize(11) }}>
            Status
          </Text>
        </View>

        {loading ? (
          <View style={{ padding: ds.spacing(16) }}>
            <Text className="text-gray-400" style={{ fontSize: ds.fontSize(14) }}>Loading...</Text>
          </View>
        ) : info ? (
          <>
            {renderRow('OS Permission', info.permissionStatus)}
            {renderRow('Local pushEnabled Toggle', info.localPushEnabled)}
            {renderRow('DB notifications_enabled', info.profileNotificationsEnabled)}
            {renderRow('Active DB Tokens', info.dbTokenCount)}
            {renderRow('Last Push Token', info.lastPushToken ? `...${info.lastPushToken.slice(-20)}` : 'none')}
            {renderRow('Scheduled Notifications', info.scheduledCount)}
            {renderRow('Platform', Platform.OS)}
          </>
        ) : null}

        <View style={{ paddingHorizontal: ds.spacing(16), paddingTop: ds.spacing(20), gap: ds.spacing(10) }}>
          <TouchableOpacity
            onPress={sendTestNotification}
            className="bg-primary-500 rounded-xl items-center justify-center"
            style={{ minHeight: Math.max(48, ds.buttonH), borderRadius: ds.radius(12) }}
          >
            <Text className="text-white font-semibold" style={{ fontSize: ds.fontSize(15) }}>
              Send Test Local Notification
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={refresh}
            className="bg-gray-200 rounded-xl items-center justify-center"
            style={{ minHeight: Math.max(48, ds.buttonH), borderRadius: ds.radius(12) }}
          >
            <Text className="text-gray-700 font-semibold" style={{ fontSize: ds.fontSize(15) }}>
              Refresh
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
