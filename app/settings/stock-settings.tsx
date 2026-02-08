import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSettingsStore } from '@/store';
import { colors } from '@/constants';
import { SettingToggle } from '@/components/settings';
import { useScaledStyles } from '@/hooks/useScaledStyles';

function StockSection() {
  const { stockSettings, setStockSettings } = useSettingsStore();

  return (
    <View>
      <SettingToggle
        icon="warning-outline"
        iconColor="#EF4444"
        iconBgColor="#FEE2E2"
        title="Flag unusual quantities"
        subtitle="Highlight suspiciously high stock counts in confirmation"
        value={stockSettings.flagUnusualQuantities}
        onValueChange={(value) => setStockSettings({ flagUnusualQuantities: value })}
      />

      <SettingToggle
        icon="notifications-outline"
        iconColor="#2563EB"
        iconBgColor="#DBEAFE"
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
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      <View className="bg-white border-b border-gray-100 flex-row items-center" style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12) }}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ padding: ds.spacing(8), marginRight: ds.spacing(8), minWidth: 44, minHeight: 44, justifyContent: 'center' }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={ds.icon(20)} color={colors.gray[700]} />
        </TouchableOpacity>
        <Text className="font-bold text-gray-900" style={{ fontSize: ds.fontSize(18) }}>Stock</Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: ds.spacing(32) }}>
        <StockSection />
      </ScrollView>
    </SafeAreaView>
  );
}
