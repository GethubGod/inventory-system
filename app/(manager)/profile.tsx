import React from 'react';
import { View, Text, ScrollView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Constants from 'expo-constants';
import { useAuthStore, useDisplayStore } from '@/store';
import { SettingsRow, settingsIconPalettes } from '@/components/settings';
import { BrandLogo, GlassSurface } from '@/components';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassRadii,
  glassSpacing,
  glassTabBarHeight,
  glassTypography,
} from '@/design/tokens';

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
    <SafeAreaView style={{ flex: 1, backgroundColor: glassColors.background }} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: glassTabBarHeight + ds.spacing(20) }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: glassSpacing.screen, paddingVertical: ds.spacing(16), flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: glassTypography.screenTitle, fontWeight: '600', color: glassColors.textPrimary }}>
              Settings
            </Text>
          </View>
          <GlassSurface intensity="medium" style={{ borderRadius: glassRadii.pill }}>
            <View style={{ paddingHorizontal: ds.spacing(12), paddingVertical: ds.spacing(6) }}>
              <Text style={{ fontSize: ds.fontSize(11), fontWeight: '600', color: glassColors.textPrimary }}>Manager</Text>
            </View>
          </GlassSurface>
        </View>

        <GlassSurface
          intensity="subtle"
          blurred={false}
          style={{ marginHorizontal: glassSpacing.screen, marginBottom: ds.spacing(12), borderRadius: glassRadii.surface }}
        >
          <SettingsRow
            icon="person-outline"
            iconColor={settingsIconPalettes.profile.icon}
            iconBgColor={settingsIconPalettes.profile.background}
            title="Profile"
            subtitle="Manage account details and locations"
            onPress={() => router.push('/(manager)/settings/profile')}
            showBorder={false}
          />
        </GlassSurface>

        <GlassSurface
          intensity="subtle"
          blurred={false}
          style={{ marginHorizontal: glassSpacing.screen, marginBottom: ds.spacing(12), borderRadius: glassRadii.surface }}
        >
          <SettingsRow
            icon="eye-outline"
            iconColor={settingsIconPalettes.display.icon}
            iconBgColor={settingsIconPalettes.display.background}
            title="Display & Accessibility"
            subtitle="Text size, button size, and interaction settings"
            onPress={() => router.push('/settings/display-accessibility')}
            showBorder={false}
          />
        </GlassSurface>

        <GlassSurface
          intensity="subtle"
          blurred={false}
          style={{ marginHorizontal: glassSpacing.screen, marginBottom: ds.spacing(12), borderRadius: glassRadii.surface }}
        >
          <SettingsRow
            icon="notifications-outline"
            iconColor={settingsIconPalettes.notifications.icon}
            iconBgColor={settingsIconPalettes.notifications.background}
            title="Notifications"
            subtitle="Control alerts, sounds, and quiet hours"
            onPress={() => router.push('/settings/notifications')}
            showBorder={false}
          />
        </GlassSurface>

        <GlassSurface
          intensity="subtle"
          blurred={false}
          style={{ marginHorizontal: glassSpacing.screen, marginBottom: ds.spacing(12), borderRadius: glassRadii.surface }}
        >
          <SettingsRow
            icon="key-outline"
            iconColor={settingsIconPalettes.accessCodes.icon}
            iconBgColor={settingsIconPalettes.accessCodes.background}
            title="Access Codes"
            subtitle="Update employee and manager sign-up codes"
            onPress={() => router.push('/(manager)/settings/access-codes')}
            showBorder={false}
          />
        </GlassSurface>

        <GlassSurface
          intensity="subtle"
          blurred={false}
          style={{ marginHorizontal: glassSpacing.screen, marginBottom: ds.spacing(12), borderRadius: glassRadii.surface }}
        >
          <SettingsRow
            icon="cube-outline"
            iconColor={settingsIconPalettes.inventory.icon}
            iconBgColor={settingsIconPalettes.inventory.background}
            title="Inventory"
            subtitle="Manage station inventory and stock levels"
            onPress={() => router.push('/(manager)/inventory')}
            showBorder={false}
          />
        </GlassSurface>

        <GlassSurface
          intensity="subtle"
          blurred={false}
          style={{ marginHorizontal: glassSpacing.screen, marginBottom: ds.spacing(12), borderRadius: glassRadii.surface }}
        >
          <SettingsRow
            icon="information-circle-outline"
            iconColor={settingsIconPalettes.support.icon}
            iconBgColor={settingsIconPalettes.support.background}
            title="About & Support"
            subtitle="Version info, support, and policies"
            onPress={() => router.push('/settings/about-support')}
            showBorder={false}
          />
        </GlassSurface>

        <GlassSurface
          intensity="subtle"
          blurred={false}
          style={{ marginHorizontal: glassSpacing.screen, marginBottom: ds.spacing(12), borderRadius: glassRadii.surface }}
        >
          <SettingsRow
            icon="people-outline"
            iconColor={settingsIconPalettes.users.icon}
            iconBgColor={settingsIconPalettes.users.background}
            title="User Management"
            subtitle="Suspend inactive users and delete accounts"
            onPress={() => router.push('/(manager)/settings/user-management')}
            showBorder={false}
          />
        </GlassSurface>

        <GlassSurface
          intensity="subtle"
          blurred={false}
          style={{ marginHorizontal: glassSpacing.screen, marginBottom: ds.spacing(12), borderRadius: glassRadii.surface }}
        >
          <SettingsRow
            icon="swap-horizontal"
            iconColor={settingsIconPalettes.switchView.icon}
            iconBgColor={settingsIconPalettes.switchView.background}
            title="Switch to Employee View"
            subtitle="Place orders in employee mode"
            onPress={handleSwitchToEmployee}
            showBorder={false}
          />
        </GlassSurface>

        <GlassSurface
          intensity="subtle"
          blurred={false}
          style={{ marginHorizontal: glassSpacing.screen, marginBottom: ds.spacing(12), borderRadius: glassRadii.surface }}
        >
          <SettingsRow
            icon="log-out-outline"
            iconColor={settingsIconPalettes.danger.icon}
            iconBgColor={settingsIconPalettes.danger.background}
            title="Sign Out"
            onPress={handleSignOut}
            showChevron={false}
            destructive
            showBorder={false}
          />
        </GlassSurface>

        <View className="items-center" style={{ marginTop: ds.spacing(8) }}>
          <Text style={{ fontSize: ds.fontSize(11), color: glassColors.textSecondary }}>
            Signed in as {user?.email ?? 'Unknown'}
          </Text>
        </View>

        <View className="items-center" style={{ paddingHorizontal: ds.spacing(24), paddingTop: ds.spacing(24), paddingBottom: ds.spacing(40) }}>
          <BrandLogo variant="footer" size={40} />
          <Text style={{ fontSize: ds.fontSize(12), marginTop: ds.spacing(8), color: glassColors.textPrimary }}>Babytuna Systems</Text>
          <Text style={{ fontSize: ds.fontSize(11), marginTop: ds.spacing(4), color: glassColors.textSecondary }}>Version {appVersion}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
