import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSettingsStore } from '@/store';
import { colors } from '@/constants';
import { MultiOptionToggle, SettingToggle } from '@/components/settings';
import { TEXT_SCALE_LABELS } from '@/types/settings';

function DisplaySection() {
  const {
    textScale,
    setTextScale,
    uiScale,
    setUIScale,
    buttonSize,
    setButtonSize,
    theme,
    setTheme,
    hapticFeedback,
    setHapticFeedback,
    reduceMotion,
    setReduceMotion,
    resetDisplayToDefaults,
  } = useSettingsStore();

  const handleReset = () => {
    Alert.alert(
      'Reset Display Settings',
      'Reset all display and accessibility settings to defaults?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            if (hapticFeedback && Platform.OS !== 'web') {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            }
            resetDisplayToDefaults();
          },
        },
      ]
    );
  };

  return (
    <View>
      <View className="px-4 py-4">
        <Text className="text-base font-medium text-gray-900 mb-3">Text Size</Text>
        <View className="flex-row justify-between mb-2">
          {TEXT_SCALE_LABELS.map((label, index) => {
            const scaleValue = [0.8, 0.9, 1.0, 1.1, 1.4][index] as 0.8 | 0.9 | 1.0 | 1.1 | 1.4;
            const isSelected = textScale === scaleValue;
            return (
              <TouchableOpacity
                key={label}
                onPress={() => setTextScale(scaleValue)}
                className={`px-3 py-2 rounded-lg ${
                  isSelected ? 'bg-primary-500' : 'bg-gray-100'
                }`}
                activeOpacity={0.7}
              >
                <Text
                  className={`text-sm font-medium ${
                    isSelected ? 'text-white' : 'text-gray-600'
                  }`}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text className="text-xs text-gray-500">
          Preview
        </Text>
        <Text className="text-gray-700 mt-1" style={{ fontSize: 14 * textScale }}>
          The quick brown fox jumps over the lazy dog
        </Text>
      </View>

      <MultiOptionToggle
        title="UI Scale"
        subtitle="Adjust overall interface size"
        value={uiScale}
        options={[
          { label: 'Compact', value: 'compact' },
          { label: 'Default', value: 'default' },
          { label: 'Large', value: 'large' },
        ]}
        onChange={setUIScale}
      />

      <MultiOptionToggle
        title="Button Size"
        subtitle="Adjust button size for easier tapping"
        value={buttonSize}
        options={[
          { label: 'Small', value: 'small' },
          { label: 'Medium', value: 'medium' },
          { label: 'Large', value: 'large' },
        ]}
        onChange={setButtonSize}
      />

      <MultiOptionToggle
        title="Theme"
        subtitle="Choose light or dark mode"
        value={theme}
        options={[
          {
            label: 'Light',
            value: 'light',
            preview: <Ionicons name="sunny" size={16} color={theme === 'light' ? colors.primary[600] : colors.gray[500]} />,
          },
          {
            label: 'System',
            value: 'system',
            preview: <Ionicons name="phone-portrait" size={16} color={theme === 'system' ? colors.primary[600] : colors.gray[500]} />,
          },
          {
            label: 'Dark',
            value: 'dark',
            preview: <Ionicons name="moon" size={16} color={theme === 'dark' ? colors.primary[600] : colors.gray[500]} />,
          },
        ]}
        onChange={setTheme}
      />

      <SettingToggle
        title="Haptic Feedback"
        subtitle="Vibrate on taps and actions"
        value={hapticFeedback}
        onValueChange={setHapticFeedback}
      />

      <SettingToggle
        title="Reduce Motion"
        subtitle="Minimize animations"
        value={reduceMotion}
        onValueChange={setReduceMotion}
      />

      <TouchableOpacity
        onPress={handleReset}
        className="mx-4 my-6 py-3 bg-gray-100 rounded-xl items-center"
      >
        <Text className="text-gray-600 font-semibold">Reset to Defaults</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function DisplaySettingsScreen() {
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
        <Text className="text-lg font-bold text-gray-900">Display & Accessibility</Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        <DisplaySection />
      </ScrollView>
    </SafeAreaView>
  );
}
