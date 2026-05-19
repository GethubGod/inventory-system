import type { Href } from 'expo-router';
import type { Ionicons } from '@expo/vector-icons';
import {
  settingsSectionPalettes,
  type SettingsRowProps,
} from '@/components/settings';
import {
  buildSettingsHref,
  EMPLOYEE_SETTINGS_ROOT,
  MANAGER_SETTINGS_ROOT,
  type SettingsOrigin,
} from '@/lib/settingsNavigation';

type SettingsIconName = keyof typeof Ionicons.glyphMap;
type SettingsSectionKey =
  | 'account'
  | 'preferences'
  | 'orderingInventory'
  | 'management'
  | 'supportHistory'
  | 'viewSwitching';

export type SettingsViewMode = 'employee' | 'manager';

export type SettingsItem = Omit<
  SettingsRowProps,
  'showBorder' | 'borderColor'
> & {
  key: string;
};

export interface SettingsGroupModel {
  key: SettingsSectionKey;
  items: SettingsItem[];
}

interface BuildSettingsGroupsOptions {
  view: SettingsViewMode;
  canSwitchViews: boolean;
  onNavigate: (href: Href | string) => void;
  onSwitchToEmployee: () => void;
  onSwitchToManager: () => void;
}

const settingsRoots: Record<SettingsViewMode, string> = {
  employee: EMPLOYEE_SETTINGS_ROOT,
  manager: MANAGER_SETTINGS_ROOT,
};

function routeFor(
  view: SettingsViewMode,
  pathname: string,
): Href {
  return buildSettingsHref(pathname, {
    origin: view as SettingsOrigin,
    backTo: settingsRoots[view],
  });
}

function withSectionPalette(
  section: SettingsSectionKey,
  item: Omit<SettingsItem, 'iconColor' | 'iconBgColor'>,
): SettingsItem {
  const palette = settingsSectionPalettes[section];

  return {
    ...item,
    iconColor: palette.icon,
    iconBgColor: palette.background,
  };
}

function makeItem(
  section: SettingsSectionKey,
  item: Omit<SettingsItem, 'iconColor' | 'iconBgColor'> & {
    icon: SettingsIconName;
  },
): SettingsItem {
  return withSectionPalette(section, item);
}

export function buildSettingsGroups({
  view,
  canSwitchViews,
  onNavigate,
  onSwitchToEmployee,
  onSwitchToManager,
}: BuildSettingsGroupsOptions): SettingsGroupModel[] {
  const groups: SettingsGroupModel[] = [
    {
      key: 'account',
      items: [
        makeItem('account', {
          key: 'profile',
          icon: 'person-outline',
          title: 'Profile',
          subtitle:
            view === 'manager'
              ? 'Manage account details and locations'
              : 'Manage your account details',
          onPress: () =>
            onNavigate(
              view === 'manager'
                ? routeFor(view, '/(manager)/manager-settings/profile')
                : routeFor(view, '/settings/profile'),
            ),
        }),
      ],
    },
    {
      key: 'preferences',
      items: [
        makeItem('preferences', {
          key: 'display',
          icon: 'eye-outline',
          title: 'Display & Accessibility',
          subtitle: 'Text size, button size, and interaction settings',
          onPress: () =>
            onNavigate(routeFor(view, '/settings/display-accessibility')),
        }),
        makeItem('preferences', {
          key: 'notifications',
          icon: 'notifications-outline',
          title: 'Notifications',
          subtitle: 'Control alerts, sounds, and quiet hours',
          onPress: () => onNavigate(routeFor(view, '/settings/notifications')),
        }),
        makeItem('preferences', {
          key: 'reminders',
          icon: 'alarm-outline',
          title: 'Reminders',
          subtitle: 'Configure quick and custom reminders',
          onPress: () => onNavigate(routeFor(view, '/settings/reminders')),
        }),
      ],
    },
    {
      key: 'orderingInventory',
      items: [
        ...(view === 'manager'
          ? [
              makeItem('orderingInventory', {
                key: 'quick-order-ai',
                icon: 'sparkles-outline',
                title: 'Quick Order',
                subtitle: 'Manage aliases and parser examples',
                onPress: () =>
                  onNavigate(
                    routeFor(
                      view,
                      '/(manager)/manager-settings/quick-order-config',
                    ),
                  ),
              }),
            ]
          : []),
        makeItem('orderingInventory', {
          key: 'quick-search',
          icon: 'search-outline',
          title: 'Quick Search',
          subtitle: 'Use the classic item search ordering flow',
          onPress: () => onNavigate(routeFor(view, '/settings/quick-search')),
        }),
        makeItem('orderingInventory', {
          key: view === 'manager' ? 'inventory' : 'stock',
          icon: 'cube-outline',
          title: view === 'manager' ? 'Inventory' : 'Stock',
          subtitle:
            view === 'manager'
              ? 'Manage station inventory and stock levels'
              : 'Tune stock warning preferences',
          onPress: () =>
            onNavigate(
              view === 'manager'
                ? '/(manager)/inventory'
                : routeFor(view, '/settings/stock-settings'),
            ),
        }),
      ],
    },
  ];

  if (view === 'manager') {
    groups.push({
      key: 'management',
      items: [
        makeItem('management', {
          key: 'access-codes',
          icon: 'key-outline',
          title: 'Access Codes',
          subtitle: 'Update employee and manager sign-up codes',
          onPress: () =>
            onNavigate(
              routeFor(view, '/(manager)/manager-settings/access-codes'),
            ),
        }),
        makeItem('management', {
          key: 'user-management',
          icon: 'people-outline',
          title: 'User Management',
          subtitle: 'Suspend inactive users and delete accounts',
          onPress: () =>
            onNavigate(
              routeFor(view, '/(manager)/manager-settings/user-management'),
            ),
        }),
      ],
    });
  }

  groups.push({
    key: 'supportHistory',
    items: [
      makeItem('supportHistory', {
        key: 'about-support',
        icon: 'information-circle-outline',
        title: 'About & Support',
        subtitle: 'Version info, support, and policies',
        onPress: () => onNavigate(routeFor(view, '/settings/about-support')),
      }),
      makeItem('supportHistory', {
        key: view === 'manager' ? 'past-orders' : 'my-orders',
        icon: 'receipt-outline',
        title: view === 'manager' ? 'Past Orders' : 'My Orders',
        subtitle:
          view === 'manager'
            ? 'View fulfillment and order history'
            : 'View your order history',
        onPress: () =>
          onNavigate(
            view === 'manager'
              ? '/(manager)/past-orders'
              : `/orders/history?backTo=${encodeURIComponent(EMPLOYEE_SETTINGS_ROOT)}`,
          ),
      }),
    ],
  });

  if (canSwitchViews) {
    groups.push({
      key: 'viewSwitching',
      items: [
        makeItem('viewSwitching', {
          key: view === 'manager' ? 'switch-employee' : 'switch-manager',
          icon: 'swap-horizontal',
          title:
            view === 'manager'
              ? 'Switch to Employee View'
              : 'Switch to Manager View',
          subtitle:
            view === 'manager'
              ? 'Place orders in employee mode'
              : 'Manage orders and fulfillment',
          onPress:
            view === 'manager' ? onSwitchToEmployee : onSwitchToManager,
        }),
      ],
    });
  }

  return groups;
}
