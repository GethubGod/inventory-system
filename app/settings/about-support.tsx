import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Platform, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Constants from 'expo-constants';
import { useDisplayStore } from '@/store';
import { colors } from '@/constants';
import { SettingsRow } from '@/components/settings';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { useSettingsBackRoute } from '@/hooks/useSettingsBackRoute';

function AboutSection() {
  const appVersion = Constants.expoConfig?.version || '1.0.0';
  const { hapticFeedback } = useDisplayStore();
  const ds = useScaledStyles();

  const handleLink = (url: string) => {
    if (hapticFeedback && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    Linking.openURL(url);
  };

  return (
    <View>
      <View
        className="flex-row justify-between items-center border-b border-gray-100"
        style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(14), minHeight: Math.max(ds.rowH, 56) }}
      >
        <Text className="text-gray-900" style={{ fontSize: ds.fontSize(16) }}>App Version</Text>
        <Text className="text-gray-500" style={{ fontSize: ds.fontSize(16) }}>{appVersion}</Text>
      </View>

      <SettingsRow
        icon="mail-outline"
        iconColor="#3B82F6"
        iconBgColor="#DBEAFE"
        title="Contact Support"
        subtitle="Get help with the app"
        onPress={() => handleLink('mailto:support@babytuna.com?subject=Babytuna App Support')}
      />

      <SettingsRow
        icon="chatbubble-outline"
        iconColor="#10B981"
        iconBgColor="#D1FAE5"
        title="Send Feedback"
        subtitle="Tell us what you think"
        onPress={() => handleLink('mailto:feedback@babytuna.com?subject=Babytuna App Feedback')}
      />

      <View className="h-px bg-gray-100" style={{ marginHorizontal: ds.spacing(16) }} />

      <SettingsRow
        icon="document-text-outline"
        iconColor="#6B7280"
        iconBgColor="#F3F4F6"
        title="Terms of Service"
        onPress={() => handleLink('https://babytuna.com/terms')}
      />

      <SettingsRow
        icon="shield-outline"
        iconColor="#6B7280"
        iconBgColor="#F3F4F6"
        title="Privacy Policy"
        onPress={() => handleLink('https://babytuna.com/privacy')}
      />

      <SettingsRow
        icon="code-slash-outline"
        iconColor="#6B7280"
        iconBgColor="#F3F4F6"
        title="Open Source Licenses"
        onPress={() => handleLink('https://babytuna.com/licenses')}
        showBorder={false}
      />

      <View className="items-center" style={{ paddingVertical: ds.spacing(24) }}>
        <Text className="text-gray-400" style={{ fontSize: ds.fontSize(14) }}>Made with love by Babytuna</Text>
      </View>
    </View>
  );
}

export default function AboutSupportSettingsScreen() {
  const ds = useScaledStyles();
  const settingsBackRoute = useSettingsBackRoute();

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      <View
        className="bg-white border-b border-gray-100 flex-row items-center"
        style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12) }}
      >
        <TouchableOpacity
          onPress={() => router.replace(settingsBackRoute)}
          style={{ padding: ds.spacing(8), marginRight: ds.spacing(8), minWidth: 44, minHeight: 44, justifyContent: 'center' }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={ds.icon(20)} color={colors.gray[700]} />
        </TouchableOpacity>
        <Text className="font-bold text-gray-900" style={{ fontSize: ds.fontSize(18) }}>About & Support</Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: ds.spacing(32) }}>
        <AboutSection />
      </ScrollView>
    </SafeAreaView>
  );
}
