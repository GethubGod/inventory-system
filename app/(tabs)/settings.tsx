import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { useAuthStore } from '@/store';
import { useSignOutAction } from '@/hooks/useSignOutAction';
import {
  SettingsGroup,
  SettingsRow,
  settingsIconPalettes,
} from '@/components/settings';
import { BrandLogo } from '@/components';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  buildSettingsGroups,
  type SettingsGroupModel,
} from '@/features/settings/settingsSections';
import {
  glassColors,
  glassSpacing,
  glassTabBarHeight,
} from '@/theme/design';

const SETTINGS_DIVIDER_COLOR = '#EAEAEA';

export default function SettingsScreen() {
  const ds = useScaledStyles();
  const { user, profile, session, setViewMode } = useAuthStore();
  const { isSigningOut, requestSignOut } = useSignOutAction();

  const metadataRole =
    typeof session?.user?.user_metadata?.role === 'string'
      ? session.user.user_metadata.role
      : typeof session?.user?.app_metadata?.role === 'string'
        ? session.user.app_metadata.role
        : null;
  const isManager = (user?.role ?? profile?.role ?? metadataRole) === 'manager';
  const appVersion = Constants.expoConfig?.version || '1.0.0';

  const handleSwitchToManager = useCallback(() => {
    setViewMode('manager');
    router.replace('/(manager)');
  }, [setViewMode]);

  const settingsGroups = useMemo<SettingsGroupModel[]>(
    () =>
      buildSettingsGroups({
        view: 'employee',
        canSwitchViews: isManager,
        onNavigate: (href) => router.push(href as any),
        onSwitchToEmployee: () => {},
        onSwitchToManager: handleSwitchToManager,
      }),
    [handleSwitchToManager, isManager],
  );

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: glassColors.background }}
      edges={['top', 'left', 'right']}
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: glassTabBarHeight + ds.spacing(20) }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: glassSpacing.screen, paddingVertical: ds.spacing(16) }}>
          <Text
            style={{
              fontSize: ds.fontSize(32),
              fontWeight: '800',
              color: glassColors.textPrimary,
              letterSpacing: -0.5,
            }}
          >
            Settings
          </Text>
        </View>

        {settingsGroups.map((group) => (
          <SettingsGroup
            key={group.key}
            style={{ marginBottom: ds.spacing(12) }}
          >
            {group.items.map((item, index) => {
              const { key, ...rowProps } = item;
              return (
                <SettingsRow
                  key={key}
                  {...rowProps}
                  showBorder={index < group.items.length - 1}
                  borderColor={SETTINGS_DIVIDER_COLOR}
                />
              );
            })}
          </SettingsGroup>
        ))}

        <SettingsGroup style={{ marginBottom: ds.spacing(12) }}>
          <SettingsRow
            icon="log-out-outline"
            iconColor={settingsIconPalettes.danger.icon}
            iconBgColor={settingsIconPalettes.danger.background}
            title={isSigningOut ? 'Signing Out...' : 'Sign Out'}
            onPress={requestSignOut}
            showChevron={false}
            destructive
            disabled={isSigningOut}
            showBorder={false}
          />
        </SettingsGroup>

        <View className="items-center" style={{ marginTop: ds.spacing(8) }}>
          <Text style={{ fontSize: ds.fontSize(11), color: glassColors.textSecondary }}>
            Signed in as {user?.email}
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
