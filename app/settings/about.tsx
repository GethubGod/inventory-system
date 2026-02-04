import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Platform, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Constants from 'expo-constants';
import { useSettingsStore } from '@/store';
import { colors } from '@/constants';
import { SettingsRow } from '@/components/settings';

function AboutSection() {
  const appVersion = Constants.expoConfig?.version || '1.0.0';
  const { hapticFeedback } = useSettingsStore();

  const handleLink = (url: string) => {
    if (hapticFeedback && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    Linking.openURL(url);
  };

  return (
    <View>
      <View className="px-4 py-4 flex-row justify-between items-center border-b border-gray-100">
        <Text className="text-base text-gray-900">App Version</Text>
        <Text className="text-base text-gray-500">{appVersion}</Text>
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

      <View className="h-px bg-gray-100 mx-4" />

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

      <View className="items-center py-6">
        <Text className="text-gray-400 text-sm">Made with love by Babytuna</Text>
      </View>
    </View>
  );
}

export default function AboutSettingsScreen() {
  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      <View className="bg-white px-4 py-3 border-b border-gray-100 flex-row items-center">
        <TouchableOpacity
          onPress={() => router.back()}
          className="p-2 mr-2"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={20} color={colors.gray[700]} />
        </TouchableOpacity>
        <Text className="text-lg font-bold text-gray-900">About & Support</Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        <AboutSection />
      </ScrollView>
    </SafeAreaView>
  );
}
