import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { BrandLogo, GlassSurface, StackScreenHeader } from '@/components';
import { SettingsRow, settingsIconPalettes } from '@/components/settings';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { glassColors, glassRadii, glassSpacing } from '@/design/tokens';

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
    <SafeAreaView style={{ flex: 1, backgroundColor: glassColors.background }} edges={['top', 'left', 'right']}>
      <StackScreenHeader title="About & Support" />
      <ScrollView contentContainerStyle={{ paddingBottom: ds.spacing(32) }}>
        <AboutSection />
        <View className="items-center" style={{ paddingHorizontal: ds.spacing(24), paddingTop: ds.spacing(24), paddingBottom: ds.spacing(40) }}>
          <BrandLogo variant="footer" size={40} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
