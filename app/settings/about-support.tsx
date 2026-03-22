import React from 'react';
import { View, Text, Alert } from 'react-native';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { BrandLogo, GlassSurface } from '@/components';
import {
  SettingsRow,
  SettingsScreenLayout,
  SettingsSectionLabel,
  settingsIconPalettes,
} from '@/components/settings';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { glassColors, glassRadii, glassSpacing } from '@/theme/design';

const APPSTORE_COMPLIANCE_LINKS = {
  support: 'https://www.babytunasystems.com/support',
  contact: 'https://www.babytunasystems.com/contact',
  privacy: 'https://www.babytunasystems.com/privacy',
} as const;

function AboutSection() {
  const appVersion = Constants.expoConfig?.version || '1.0.0';
  const ds = useScaledStyles();

  const openExternalUrl = async (url: string) => {
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        Alert.alert('Unable to open link.');
        return;
      }
      await Linking.openURL(url);
    } catch {
      Alert.alert('Unable to open link.');
    }
  };

  return (
    <GlassSurface
      intensity="subtle"
      blurred={false}
      style={{ marginHorizontal: glassSpacing.screen, borderRadius: glassRadii.surface }}
    >
      <View
        className="flex-row justify-between items-center"
        style={{
          paddingHorizontal: ds.spacing(16),
          paddingVertical: ds.spacing(14),
          minHeight: Math.max(ds.rowH, 56),
          borderBottomWidth: 1,
          borderBottomColor: glassColors.divider,
        }}
      >
        <Text style={{ fontSize: ds.fontSize(16), color: glassColors.textPrimary }}>App Version</Text>
        <Text style={{ fontSize: ds.fontSize(16), color: glassColors.textSecondary }}>{appVersion}</Text>
      </View>

      <SettingsRow
        icon="mail-outline"
        iconColor={settingsIconPalettes.profile.icon}
        iconBgColor={settingsIconPalettes.profile.background}
        title="Contact Support"
        subtitle="Get help with the app"
        onPress={() => {
          void openExternalUrl(APPSTORE_COMPLIANCE_LINKS.support);
        }}
      />

      <SettingsRow
        icon="chatbubble-outline"
        iconColor={settingsIconPalettes.reminders.icon}
        iconBgColor={settingsIconPalettes.reminders.background}
        title="Send Feedback"
        subtitle="Tell us what you think"
        onPress={() => {
          void openExternalUrl(APPSTORE_COMPLIANCE_LINKS.contact);
        }}
      />

      <SettingsRow
        icon="shield-outline"
        iconColor={settingsIconPalettes.neutral.icon}
        iconBgColor={settingsIconPalettes.neutral.background}
        title="Privacy Policy"
        onPress={() => {
          void openExternalUrl(APPSTORE_COMPLIANCE_LINKS.privacy);
        }}
        showBorder={false}
      />
    </GlassSurface>
  );
}

export default function AboutSupportSettingsScreen() {
  const ds = useScaledStyles();
  return (
    <SettingsScreenLayout title="About & Support">
      <SettingsSectionLabel
        label="Support"
        description="Version details, support links, and policy access all stay inside the same polished settings shell."
      />
      <AboutSection />
      <View
        className="items-center"
        style={{
          paddingHorizontal: ds.spacing(24),
          paddingTop: ds.spacing(24),
          paddingBottom: ds.spacing(40),
        }}
      >
          <BrandLogo variant="footer" size={40} />
      </View>
    </SettingsScreenLayout>
  );
}
