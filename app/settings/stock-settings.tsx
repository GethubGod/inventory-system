import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useSettingsStore } from '@/store';
import {
  SettingToggle,
  SettingsGroup,
  SettingsRow,
  SettingsScreenLayout,
  SettingsSectionLabel,
  settingsIconPalettes,
} from '@/components/settings';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { buildSettingsHref } from '@/lib/settingsNavigation';
import { useSettingsNavigationContext } from '@/hooks/useSettingsBackRoute';
import { glassColors, glassHairlineWidth } from '@/theme/design';

function StockWarningsSection() {
  const { stockSettings, setStockSettings } = useSettingsStore();

  return (
    <SettingToggle
      icon="warning-outline"
      iconColor={settingsIconPalettes.danger.icon}
      iconBgColor={settingsIconPalettes.danger.background}
      title="Flag unusual quantities"
      subtitle="Highlight suspiciously high stock counts in confirmation"
      value={stockSettings.flagUnusualQuantities}
      onValueChange={(value) => setStockSettings({ flagUnusualQuantities: value })}
      showBorder={false}
    />
  );
}

function StockPreferencesSection() {
  const { stockSettings, setStockSettings } = useSettingsStore();

  return (
    <SettingToggle
      icon="notifications-outline"
      iconColor={settingsIconPalettes.users.icon}
      iconBgColor={settingsIconPalettes.users.background}
      title="Resume reminders"
      subtitle="Send a local reminder after pausing stock count"
      value={stockSettings.resumeReminders}
      onValueChange={(value) => setStockSettings({ resumeReminders: value })}
      showBorder={false}
    />
  );
}

export default function StockSettingsScreen() {
  const ds = useScaledStyles();
  const { origin } = useSettingsNavigationContext();

  const openStockCheck = () => {
    router.push(
      buildSettingsHref('/(tabs)/stock-check', {
        origin,
        backTo: buildSettingsHref('/settings/stock-settings', { origin }),
      }),
    );
  };

  return (
    <SettingsScreenLayout title="Stock Settings">
      <SettingsGroup>
        <SettingsRow
          icon="clipboard-outline"
          iconColor={settingsIconPalettes.stock.icon}
          iconBgColor={settingsIconPalettes.stock.background}
          title="Stock"
          subtitle="Count and update inventory by station"
          onPress={openStockCheck}
        />
      </SettingsGroup>

      <SettingsGroup style={{ marginTop: ds.spacing(12) }}>
        <SettingsSectionLabel
          label="Stock Warnings"
          description="Control how unusual stock counts are flagged during confirmation."
        />
        <View
          style={{
            height: glassHairlineWidth,
            backgroundColor: glassColors.divider,
            marginHorizontal: ds.spacing(16),
          }}
        />
        <View style={{ paddingTop: ds.spacing(4) }}>
          <StockWarningsSection />
        </View>
      </SettingsGroup>

      <SettingsGroup style={{ marginTop: ds.spacing(12) }}>
        <SettingsSectionLabel
          label="Preferences"
          description="Tune resume behavior when a stock count is paused."
        />
        <View
          style={{
            height: glassHairlineWidth,
            backgroundColor: glassColors.divider,
            marginHorizontal: ds.spacing(16),
          }}
        />
        <View style={{ paddingTop: ds.spacing(4) }}>
          <StockPreferencesSection />
        </View>
      </SettingsGroup>
    </SettingsScreenLayout>
  );
}
