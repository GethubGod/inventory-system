import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Constants from 'expo-constants';
import { useAuthStore, useDisplayStore } from '@/store';
import { shadow } from '@/constants';
import { SettingsRow } from '@/components/settings';
import { BrandLogo } from '@/components';
import { useScaledStyles } from '@/hooks/useScaledStyles';

export default function ManagerSettingsScreen() {
  const ds = useScaledStyles();
  const { user, signOut, setViewMode } = useAuthStore();
  const { hapticFeedback } = useDisplayStore();
  const appVersion = Constants.expoConfig?.version || '1.0.0';

  const handleSwitchToEmployee = () => {
    if (hapticFeedback && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    setViewMode('employee');
    router.replace('/(tabs)');
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          if (hapticFeedback && Platform.OS !== 'web') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          }
          await signOut();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: ds.spacing(32) }}
        showsVerticalScrollIndicator={false}
      >
        <View
          className="flex-row items-center justify-between"
          style={{ paddingHorizontal: ds.spacing(20), paddingVertical: ds.spacing(16) }}
        >
          <View className="flex-row items-center">
            <BrandLogo variant="header" size={28} style={{ marginRight: ds.spacing(10) }} />
            <Text className="font-bold text-gray-900" style={{ fontSize: ds.fontSize(24) }}>Settings</Text>
          </View>
          <View
            className="bg-purple-100 rounded-full"
            style={{ paddingHorizontal: ds.spacing(12), paddingVertical: ds.spacing(4) }}
          >
            <Text className="text-purple-700 font-semibold" style={{ fontSize: ds.fontSize(12) }}>Manager</Text>
          </View>
        </View>

        <View
          className="bg-white rounded-xl overflow-hidden"
          style={[shadow.md, { marginHorizontal: ds.spacing(16), marginBottom: ds.spacing(16) }]}
        >
          <SettingsRow
            icon="person-outline"
            iconColor="#3B82F6"
            iconBgColor="#DBEAFE"
            title="Profile"
            subtitle="Manage account details and locations"
            onPress={() => router.push('/(manager)/settings/profile')}
            showBorder={false}
          />
        </View>

        <View
          className="bg-white rounded-xl overflow-hidden"
          style={[shadow.md, { marginHorizontal: ds.spacing(16), marginBottom: ds.spacing(16) }]}
        >
          <SettingsRow
            icon="eye-outline"
            iconColor="#8B5CF6"
            iconBgColor="#EDE9FE"
            title="Display & Accessibility"
            subtitle="Text size, button size, and interaction settings"
            onPress={() => router.push('/settings/display-accessibility')}
            showBorder={false}
          />
        </View>

        <View
          className="bg-white rounded-xl overflow-hidden"
          style={[shadow.md, { marginHorizontal: ds.spacing(16), marginBottom: ds.spacing(16) }]}
        >
          <SettingsRow
            icon="notifications-outline"
            iconColor="#F59E0B"
            iconBgColor="#FEF3C7"
            title="Notifications"
            subtitle="Control alerts, sounds, and quiet hours"
            onPress={() => router.push('/settings/notifications')}
            showBorder={false}
          />
        </View>

        <View
          className="bg-white rounded-xl overflow-hidden"
          style={[shadow.md, { marginHorizontal: ds.spacing(16), marginBottom: ds.spacing(16) }]}
        >
          <SettingsRow
            icon="key-outline"
            iconColor="#F97316"
            iconBgColor="#FFEDD5"
            title="Access Codes"
            subtitle="Update employee and manager sign-up codes"
            onPress={() => router.push('/(manager)/settings/access-codes')}
            showBorder={false}
          />
        </View>

        <View
          className="bg-white rounded-xl overflow-hidden"
          style={[shadow.md, { marginHorizontal: ds.spacing(16), marginBottom: ds.spacing(16) }]}
        >
          <SettingsRow
            icon="cube-outline"
            iconColor="#EA580C"
            iconBgColor="#FFEDD5"
            title="Inventory"
            subtitle="Manage station inventory and stock levels"
            onPress={() => router.push('/(manager)/inventory')}
            showBorder={false}
          />
        </View>

        <View
          className="bg-white rounded-xl overflow-hidden"
          style={[shadow.md, { marginHorizontal: ds.spacing(16), marginBottom: ds.spacing(16) }]}
        >
          <SettingsRow
            icon="information-circle-outline"
            iconColor="#6366F1"
            iconBgColor="#E0E7FF"
            title="About & Support"
            subtitle="Version info, support, and policies"
            onPress={() => router.push('/settings/about-support')}
            showBorder={false}
          />
        </View>

        <View
          className="bg-white rounded-xl overflow-hidden"
          style={[shadow.md, { marginHorizontal: ds.spacing(16), marginBottom: ds.spacing(16) }]}
        >
          <SettingsRow
            icon="people-outline"
            iconColor="#2563EB"
            iconBgColor="#DBEAFE"
            title="User Management"
            subtitle="Suspend inactive users and delete accounts"
            onPress={() => router.push('/(manager)/settings/user-management')}
            showBorder={false}
          />
        </View>

        <View
          className="bg-white rounded-xl overflow-hidden"
          style={[shadow.md, { marginHorizontal: ds.spacing(16), marginBottom: ds.spacing(16) }]}
        >
          <SettingsRow
            icon="swap-horizontal"
            iconColor="#7C3AED"
            iconBgColor="#EDE9FE"
            title="Switch to Employee View"
            subtitle="Place orders in employee mode"
            onPress={handleSwitchToEmployee}
            showBorder={false}
          />
        </View>

        <View
          className="bg-white rounded-xl overflow-hidden"
          style={[shadow.md, { marginHorizontal: ds.spacing(16), marginBottom: ds.spacing(16) }]}
        >
          <SettingsRow
            icon="log-out-outline"
            iconColor="#EF4444"
            iconBgColor="#FEE2E2"
            title="Sign Out"
            onPress={handleSignOut}
            showChevron={false}
            destructive
            showBorder={false}
          />
        </View>

        <View className="items-center" style={{ marginTop: ds.spacing(8) }}>
          <Text className="text-gray-400" style={{ fontSize: ds.fontSize(14) }}>
            Signed in as {user?.email ?? 'Unknown'}
          </Text>
        </View>

        <View className="items-center" style={{ paddingHorizontal: ds.spacing(24), paddingTop: ds.spacing(24), paddingBottom: ds.spacing(40) }}>
          <BrandLogo variant="footer" size={40} />
          <Text className="text-gray-500" style={{ fontSize: ds.fontSize(12), marginTop: ds.spacing(8) }}>Babytuna Systems</Text>
          <Text className="text-gray-400" style={{ fontSize: ds.fontSize(12), marginTop: ds.spacing(4) }}>Version {appVersion}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
