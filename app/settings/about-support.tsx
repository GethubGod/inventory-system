import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import Constants from 'expo-constants';
import { colors } from '@/constants';
import { SettingsRow } from '@/components/settings';
import { useScaledStyles } from '@/hooks/useScaledStyles';

const SUPPORT_EMAIL = 'babytunalovessushi@gmail.com';
const PRIVACY_POLICY_URL =
  'https://www.notion.so/Babytuna-Internal-Privacy-Policy-3032ac6e131b807da732efe1834f2531';

function AboutSection() {
  const appVersion = Constants.expoConfig?.version || '1.0.0';
  const ds = useScaledStyles();
  const platformLabel =
    Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : Platform.OS;

  const openMailDraft = async (email: string, subject: string) => {
    try {
      const body = `Hi Babytuna Team,\n\nApp Version: ${appVersion}\nPlatform: ${platformLabel}\n\n`;
      const url = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        Alert.alert('No email app available.');
        return;
      }
      await Linking.openURL(url);
    } catch {
      Alert.alert('No email app available.');
    }
  };

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
        onPress={() => {
          void openMailDraft(SUPPORT_EMAIL, 'Babytuna Support');
        }}
      />

      <SettingsRow
        icon="chatbubble-outline"
        iconColor="#10B981"
        iconBgColor="#D1FAE5"
        title="Send Feedback"
        subtitle="Tell us what you think"
        onPress={() => {
          void openMailDraft(SUPPORT_EMAIL, 'Babytuna Feedback');
        }}
      />

      <SettingsRow
        icon="shield-outline"
        iconColor="#6B7280"
        iconBgColor="#F3F4F6"
        title="Privacy Policy"
        onPress={() => {
          void openExternalUrl(PRIVACY_POLICY_URL);
        }}
        showBorder={false}
      />
    </View>
  );
}

export default function AboutSupportSettingsScreen() {
  const ds = useScaledStyles();
  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      <View
        className="bg-white border-b border-gray-100 flex-row items-center"
        style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12) }}
      >
        <TouchableOpacity
          onPress={() => router.back()}
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
