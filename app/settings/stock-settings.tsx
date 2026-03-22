import React from 'react';
import { View } from 'react-native';
import { useSettingsStore } from '@/store';
import {
  SettingToggle,
  SettingsGroup,
  SettingsScreenLayout,
  SettingsSectionLabel,
  settingsIconPalettes,
} from '@/components/settings';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { glassColors, glassHairlineWidth } from '@/theme/design';


function StockSection() {
  const { stockSettings, setStockSettings } = useSettingsStore();

  return (
    <View>
      <SettingToggle
        icon="warning-outline"
        iconColor={settingsIconPalettes.danger.icon}
        iconBgColor={settingsIconPalettes.danger.background}
        title="Flag unusual quantities"
        subtitle="Highlight suspiciously high stock counts in confirmation"
        value={stockSettings.flagUnusualQuantities}
        onValueChange={(value) => setStockSettings({ flagUnusualQuantities: value })}
      />

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
    </View>
  );
}

export default function StockSettingsScreen() {
  const ds = useScaledStyles();
  return (
    <SettingsScreenLayout title="Stock">
      <SettingsGroup>
        <SettingsSectionLabel
          label="Preferences"
          description="Tune the stock-check warnings and resume behavior without leaving the refined settings flow."
        />
        <View
          style={{
            height: glassHairlineWidth,
            backgroundColor: glassColors.divider,
            marginHorizontal: ds.spacing(16),
          }}
        />
        <View style={{ paddingTop: ds.spacing(4) }}>
          <StockSection />
        </View>
      </SettingsGroup>
    </SettingsScreenLayout>
  );
}
