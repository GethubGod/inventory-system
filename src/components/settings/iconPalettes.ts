import { uiTints } from '@/theme/design';

export const settingsSectionPalettes = {
  account: uiTints.blue,
  preferences: uiTints.purple,
  orderingInventory: uiTints.accent,
  management: uiTints.indigo,
  supportHistory: uiTints.neutral,
  viewSwitching: uiTints.amber,
  auth: uiTints.red,
} as const;

export const settingsIconPalettes = {
  profile: settingsSectionPalettes.account,
  display: settingsSectionPalettes.preferences,
  notifications: settingsSectionPalettes.preferences,
  reminders: settingsSectionPalettes.preferences,
  stock: settingsSectionPalettes.orderingInventory,
  support: settingsSectionPalettes.supportHistory,
  orders: settingsSectionPalettes.supportHistory,
  quickSearch: settingsSectionPalettes.orderingInventory,
  users: settingsSectionPalettes.management,
  switchView: settingsSectionPalettes.viewSwitching,
  accessCodes: settingsSectionPalettes.management,
  inventory: settingsSectionPalettes.orderingInventory,
  neutral: uiTints.neutral,
  danger: settingsSectionPalettes.auth,
} as const;
