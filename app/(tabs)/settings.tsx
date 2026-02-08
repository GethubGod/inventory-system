import React from 'react';
import {
  View,
  Text,
  ScrollView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Constants from 'expo-constants';
import { useAuthStore, useDisplayStore, useDraftStore } from '@/store';
import { shadow } from '@/constants';
import { SettingsRow } from '@/components/settings';
import { BrandLogo } from '@/components';
import { useScaledStyles } from '@/hooks/useScaledStyles';

export default function SettingsScreen() {
  const ds = useScaledStyles();
  const { user, profile, signOut, setViewMode } = useAuthStore();
  const { hapticFeedback } = useDisplayStore();
  const { getTotalItemCount, clearAllDrafts } = useDraftStore();

  const isManager = (user?.role ?? profile?.role) === 'manager';
  const draftCount = getTotalItemCount();
  const appVersion = Constants.expoConfig?.version || '1.0.0';

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

  const handleSwitchToManager = () => {
    if (hapticFeedback && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    setViewMode('manager');
    router.replace('/(manager)');
  };

  const handleClearDrafts = () => {
    if (draftCount === 0) {
      Alert.alert('No Drafts', 'You have no draft items to clear.');
      return;
    }

    Alert.alert(
      'Clear Drafts',
      `Are you sure you want to clear all ${draftCount} draft item${draftCount !== 1 ? 's' : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: () => {
            if (hapticFeedback && Platform.OS !== 'web') {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
            clearAllDrafts();
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row items-center" style={{ paddingHorizontal: ds.spacing(20), paddingVertical: ds.spacing(16) }}>
          <BrandLogo variant="header" size={28} style={{ marginRight: 10 }} />
          <Text className="font-bold text-gray-900" style={{ fontSize: ds.fontSize(22) }}>Settings</Text>
        </View>

        <View
          className="bg-white rounded-xl mx-4 overflow-hidden mb-4"
          style={shadow.md}
        >
          <SettingsRow
            icon="person-outline"
            iconColor="#3B82F6"
            iconBgColor="#DBEAFE"
            title="Profile"
            subtitle="Manage your account details"
            onPress={() => router.push('/settings/profile')}
            showBorder={false}
          />
        </View>

        <View
          className="bg-white rounded-xl mx-4 overflow-hidden mb-4"
          style={shadow.md}
        >
          <SettingsRow
            icon="eye-outline"
            iconColor="#8B5CF6"
            iconBgColor="#EDE9FE"
            title="Display & Accessibility"
            subtitle="Text size, theme, and interaction settings"
            onPress={() => router.push('/settings/display-accessibility')}
            showBorder={false}
          />
        </View>

        <View
          className="bg-white rounded-xl mx-4 overflow-hidden mb-4"
          style={shadow.md}
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
          className="bg-white rounded-xl mx-4 overflow-hidden mb-4"
          style={shadow.md}
        >
          <SettingsRow
            icon="alarm-outline"
            iconColor="#10B981"
            iconBgColor="#D1FAE5"
            title="Reminders"
            subtitle="Configure quick and custom reminders"
            onPress={() => router.push('/settings/reminders')}
            showBorder={false}
          />
        </View>

        <View
          className="bg-white rounded-xl mx-4 overflow-hidden mb-4"
          style={shadow.md}
        >
          <SettingsRow
            icon="cube-outline"
            iconColor="#EA580C"
            iconBgColor="#FFEDD5"
            title="Stock"
            subtitle="Tune stock warning preferences"
            onPress={() => router.push('/settings/stock-settings')}
            showBorder={false}
          />
        </View>

        <View
          className="bg-white rounded-xl mx-4 overflow-hidden mb-4"
          style={shadow.md}
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
          className="bg-white rounded-xl mx-4 overflow-hidden mb-4"
          style={shadow.md}
        >
          <SettingsRow
            icon="hardware-chip-outline"
            iconColor="#EA580C"
            iconBgColor="#FFEDD5"
            title="Stock Levels"
            subtitle="Update and view current stock"
            onPress={() => router.push('/(tabs)/stock')}
            showBorder={false}
          />
        </View>

        <View
          className="bg-white rounded-xl mx-4 overflow-hidden mb-4"
          style={shadow.md}
        >
          <SettingsRow
            icon="receipt-outline"
            iconColor="#F97316"
            iconBgColor="#FFEDD5"
            title="My Orders"
            subtitle="View your order history"
            onPress={() => router.push('/orders/history')}
            showBorder={false}
          />
        </View>

        <View
          className="bg-white rounded-xl mx-4 overflow-hidden mb-4"
          style={shadow.md}
        >
          <SettingsRow
            icon="document-text-outline"
            iconColor="#F59E0B"
            iconBgColor="#FEF3C7"
            title="Draft Items"
            subtitle={
              draftCount > 0
                ? `${draftCount} item${draftCount !== 1 ? 's' : ''} saved`
                : 'No drafts'
            }
            onPress={() => router.push('/draft')}
          />
          <SettingsRow
            icon="trash-outline"
            iconColor="#EF4444"
            iconBgColor="#FEE2E2"
            title="Clear All Drafts"
            onPress={handleClearDrafts}
            showChevron={false}
            showBorder={false}
          />
        </View>

        {isManager && (
          <View
            className="bg-white rounded-xl mx-4 overflow-hidden mb-4"
            style={shadow.md}
          >
            <SettingsRow
              icon="people-outline"
              iconColor="#2563EB"
              iconBgColor="#DBEAFE"
              title="User Management"
              subtitle="Suspend inactive users and delete accounts"
              onPress={() => router.push('/(manager)/settings/user-management')}
            />
            <SettingsRow
              icon="swap-horizontal"
              iconColor="#7C3AED"
              iconBgColor="#EDE9FE"
              title="Switch to Manager View"
              subtitle="Manage orders and fulfillment"
              onPress={handleSwitchToManager}
              showBorder={false}
            />
          </View>
        )}

        <View
          className="bg-white rounded-xl mx-4 overflow-hidden mb-4"
          style={shadow.md}
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

        <View className="items-center mt-2">
          <Text className="text-gray-400 text-sm">
            Signed in as {user?.email}
          </Text>
        </View>

        <View className="items-center px-6 pt-6 pb-10">
          <BrandLogo variant="footer" size={40} />
          <Text className="text-xs text-gray-500 mt-2">Babytuna Systems</Text>
          <Text className="text-xs text-gray-400 mt-1">Version {appVersion}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
