import React from 'react';
import { View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSettingsStore } from '@/store';
import { GlassSurface, StackScreenHeader } from '@/components';
import { SettingToggle, settingsIconPalettes } from '@/components/settings';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { glassColors, glassRadii, glassSpacing } from '@/design/tokens';


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
    <SafeAreaView style={{ flex: 1, backgroundColor: glassColors.background }} edges={['top', 'left', 'right']}>
      <StackScreenHeader title="Stock" />
      <ScrollView contentContainerStyle={{ paddingBottom: ds.spacing(32) }}>
        <GlassSurface
          intensity="subtle"
          blurred={false}
          style={{ marginHorizontal: glassSpacing.screen, borderRadius: glassRadii.surface }}
        >
          <StockSection />
        </GlassSurface>
      </ScrollView>
    </SafeAreaView>
  );
}
