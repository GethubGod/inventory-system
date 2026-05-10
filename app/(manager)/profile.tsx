import React, { useCallback, useMemo } from 'react';
import { View, Text, ScrollView } from 'react-native';
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
import { BrandLogo, GlassSurface } from '@/components';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  buildSettingsGroups,
  type SettingsGroupModel,
} from '@/features/settings/settingsSections';
import {
  glassColors,
  glassRadii,
  glassSpacing,
  glassTabBarHeight,
} from '@/theme/design';

const SETTINGS_DIVIDER_COLOR = '#EAEAEA';

export default function ManagerSettingsScreen() {
  const ds = useScaledStyles();
  const { user, setViewMode } = useAuthStore();
  const { isSigningOut, requestSignOut } = useSignOutAction();
  const appVersion = Constants.expoConfig?.version || '1.0.0';

  const handleSwitchToEmployee = useCallback(() => {
    setViewMode('employee');
    router.replace('/(tabs)');
  }, [setViewMode]);

  const settingsGroups = useMemo<SettingsGroupModel[]>(
    () =>
      buildSettingsGroups({
        view: 'manager',
        canSwitchViews: true,
        onNavigate: (href) => router.push(href as any),
        onSwitchToEmployee: handleSwitchToEmployee,
        onSwitchToManager: () => {},
      }),
    [handleSwitchToEmployee],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: glassColors.background }} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: glassTabBarHeight + ds.spacing(20) }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: glassSpacing.screen, paddingVertical: ds.spacing(16), flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
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
          <GlassSurface intensity="medium" style={{ borderRadius: glassRadii.pill }}>
            <View style={{ paddingHorizontal: ds.spacing(12), paddingVertical: ds.spacing(6) }}>
              <Text style={{ fontSize: ds.fontSize(11), fontWeight: '600', color: glassColors.accent }}>Manager</Text>
            </View>
          </GlassSurface>
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
