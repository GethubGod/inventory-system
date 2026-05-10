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
  type SettingsRowProps,
} from '@/components/settings';
import { BrandLogo } from '@/components';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  buildSettingsHref,
  EMPLOYEE_SETTINGS_ROOT,
} from '@/lib/settingsNavigation';
import {
  glassColors,
  glassSpacing,
  glassTabBarHeight,
} from '@/theme/design';

const SETTINGS_DIVIDER_COLOR = '#EAEAEA';

type SettingsItem = Omit<
  SettingsRowProps,
  'showBorder' | 'borderColor'
> & {
  key: string;
};

interface SettingsGroupModel {
  key: string;
  items: SettingsItem[];
}

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
    () => [
      {
        key: 'account',
        items: [
          {
            key: 'profile',
            icon: 'person-outline',
            iconColor: settingsIconPalettes.profile.icon,
            iconBgColor: settingsIconPalettes.profile.background,
            title: 'Profile',
            subtitle: 'Manage your account details',
            onPress: () =>
              router.push(
                buildSettingsHref('/settings/profile', {
                  origin: 'employee',
                  backTo: EMPLOYEE_SETTINGS_ROOT,
                }),
              ),
          },
        ],
      },
      {
        key: 'preferences',
        items: [
          {
            key: 'display',
            icon: 'eye-outline',
            iconColor: settingsIconPalettes.display.icon,
            iconBgColor: settingsIconPalettes.display.background,
            title: 'Display & Accessibility',
            subtitle: 'Text size, button size, and interaction settings',
            onPress: () =>
              router.push(
                buildSettingsHref('/settings/display-accessibility', {
                  origin: 'employee',
                  backTo: EMPLOYEE_SETTINGS_ROOT,
                }),
              ),
          },
          {
            key: 'notifications',
            icon: 'notifications-outline',
            iconColor: settingsIconPalettes.notifications.icon,
            iconBgColor: settingsIconPalettes.notifications.background,
            title: 'Notifications',
            subtitle: 'Control alerts, sounds, and quiet hours',
            onPress: () =>
              router.push(
                buildSettingsHref('/settings/notifications', {
                  origin: 'employee',
                  backTo: EMPLOYEE_SETTINGS_ROOT,
                }),
              ),
          },
          {
            key: 'reminders',
            icon: 'alarm-outline',
            iconColor: settingsIconPalettes.reminders.icon,
            iconBgColor: settingsIconPalettes.reminders.background,
            title: 'Reminders',
            subtitle: 'Configure quick and custom reminders',
            onPress: () =>
              router.push(
                buildSettingsHref('/settings/reminders', {
                  origin: 'employee',
                  backTo: EMPLOYEE_SETTINGS_ROOT,
                }),
              ),
          },
        ],
      },
      {
        key: 'workflows',
        items: [
          {
            key: 'quick-search',
            icon: 'search-outline',
            iconColor: settingsIconPalettes.quickSearch.icon,
            iconBgColor: settingsIconPalettes.quickSearch.background,
            title: 'Quick Search',
            subtitle: 'Use the classic item search ordering flow',
            onPress: () =>
              router.push(
                buildSettingsHref('/settings/quick-search', {
                  origin: 'employee',
                  backTo: EMPLOYEE_SETTINGS_ROOT,
                }),
              ),
          },
          {
            key: 'stock',
            icon: 'cube-outline',
            iconColor: settingsIconPalettes.stock.icon,
            iconBgColor: settingsIconPalettes.stock.background,
            title: 'Stock',
            subtitle: 'Tune stock warning preferences',
            onPress: () =>
              router.push(
                buildSettingsHref('/settings/stock-settings', {
                  origin: 'employee',
                  backTo: EMPLOYEE_SETTINGS_ROOT,
                }),
              ),
          },
        ],
      },
      {
        key: 'info-management',
        items: [
          {
            key: 'about-support',
            icon: 'information-circle-outline',
            iconColor: settingsIconPalettes.support.icon,
            iconBgColor: settingsIconPalettes.support.background,
            title: 'About & Support',
            subtitle: 'Version info, support, and policies',
            onPress: () =>
              router.push(
                buildSettingsHref('/settings/about-support', {
                  origin: 'employee',
                  backTo: EMPLOYEE_SETTINGS_ROOT,
                }),
              ),
          },
          {
            key: 'my-orders',
            icon: 'receipt-outline',
            iconColor: settingsIconPalettes.orders.icon,
            iconBgColor: settingsIconPalettes.orders.background,
            title: 'My Orders',
            subtitle: 'View your order history',
            onPress: () =>
              router.push(
                `/orders/history?backTo=${encodeURIComponent(EMPLOYEE_SETTINGS_ROOT)}`,
              ),
          },
          ...(isManager
            ? [
                {
                  key: 'switch-manager',
                  icon: 'swap-horizontal' as const,
                  iconColor: settingsIconPalettes.switchView.icon,
                  iconBgColor: settingsIconPalettes.switchView.background,
                  title: 'Switch to Manager View',
                  subtitle: 'Manage orders and fulfillment',
                  onPress: handleSwitchToManager,
                },
              ]
            : []),
        ],
      },
    ],
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
