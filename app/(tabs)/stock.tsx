import React from 'react';
import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants';

export default function StockScreen() {
  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      <View className="flex-1 items-center justify-center px-6">
        <View className="w-24 h-24 rounded-3xl bg-primary-50 items-center justify-center mb-6">
          <Ionicons name="hardware-chip-outline" size={48} color={colors.primary[500]} />
        </View>
        <Text className="text-2xl font-bold text-gray-900 mb-2">NFC Tap Functionality</Text>
        <Text className="text-gray-500 text-base text-center">
          Tap NFC Tag to Scan
        </Text>
      </View>
    </SafeAreaView>
  );
}
