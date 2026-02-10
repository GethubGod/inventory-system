import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useDisplayStore } from '@/store';
import { colors } from '@/constants';
import { MultiOptionToggle, SettingToggle } from '@/components/settings';
import { TEXT_SCALE_LABELS } from '@/types/settings';
import { useScaledStyles } from '@/hooks/useScaledStyles';


function PreviewCard() {
  const ds = useScaledStyles();

  return (
    <View style={{ marginHorizontal: ds.spacing(16), marginTop: ds.spacing(16), marginBottom: ds.spacing(8) }}>
      <Text className="text-gray-500 uppercase tracking-wide" style={{ fontSize: ds.fontSize(11), marginBottom: ds.spacing(8) }}>
        Live Preview
      </Text>
      <View
        className="bg-white border border-gray-200 overflow-hidden"
        style={{ borderRadius: ds.radius(12), padding: ds.cardPad }}
      >
        {/* Mini inventory item preview */}
        <View className="flex-row items-center justify-between" style={{ minHeight: ds.rowH }}>
          <View className="flex-1" style={{ marginRight: ds.spacing(12) }}>
            <Text
              className="font-semibold text-gray-900"
              style={{ fontSize: ds.fontSize(15) }}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              Atlantic Salmon (Sushi Grade)
            </Text>
            <View className="flex-row items-center" style={{ marginTop: ds.spacing(4) }}>
              <View
                className="rounded"
                style={{ backgroundColor: '#EF444420', paddingHorizontal: ds.spacing(8), paddingVertical: ds.spacing(2) }}
              >
                <Text style={{ color: '#EF4444', fontSize: ds.fontSize(11) }} className="font-medium">
                  Fish & Seafood
                </Text>
              </View>
              <Text className="text-gray-400" style={{ fontSize: ds.fontSize(11), marginLeft: ds.spacing(8) }}>
                10 lb/case
              </Text>
            </View>
          </View>
          <TouchableOpacity
            className="bg-primary-500 items-center justify-center"
            style={{
              height: ds.buttonH,
              paddingHorizontal: ds.buttonPadH,
              borderRadius: ds.radius(8),
              minWidth: 44,
            }}
          >
            <Text className="text-white font-semibold" style={{ fontSize: ds.buttonFont }}>
              Add
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function DisplaySection() {
  const {
    textScale,
    setTextScale,
    uiScale,
    setUIScale,
    buttonSize,
    setButtonSize,
    hapticFeedback,
    setHapticFeedback,
    reduceMotion,
    setReduceMotion,
    resetToDefaults,
  } = useDisplayStore();

  const ds = useScaledStyles();

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
            resetToDefaults();
          },
        },
      ]
    );
  };

  return (
    <View>
      <PreviewCard />

      <View style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(16) }}>
        <Text className="font-medium text-gray-900" style={{ fontSize: ds.fontSize(15), marginBottom: ds.spacing(12) }}>Text Size</Text>
        <View className="flex-row justify-between" style={{ marginBottom: ds.spacing(8) }}>
          {TEXT_SCALE_LABELS.map((label, index) => {
            const scaleValue = [0.8, 0.9, 1.0, 1.1, 1.4][index] as 0.8 | 0.9 | 1.0 | 1.1 | 1.4;
            const isSelected = textScale === scaleValue;
            return (
              <TouchableOpacity
                key={label}
                onPress={() => setTextScale(scaleValue)}
                className={`rounded-lg ${
                  isSelected ? 'border-2 border-primary-500' : 'border border-gray-200'
                }`}
                style={{
                  paddingHorizontal: ds.spacing(12),
                  height: Math.max(44, ds.buttonH - 8),
                  justifyContent: 'center',
                  alignItems: 'center',
                  backgroundColor: isSelected ? '#FFF7ED' : '#FFFFFF',
                }}
                activeOpacity={0.7}
              >
                <Text
                  className="font-medium"
                  style={{
                    fontSize: ds.fontSize(13),
                    color: isSelected ? colors.primary[600] : colors.gray[600],
                  }}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text
          className="text-gray-500"
          style={{ fontSize: ds.fontSize(14), marginTop: ds.spacing(8) }}
        >
          Preview: The quick brown fox jumps over the lazy dog
        </Text>
      </View>

      <View className="h-px bg-gray-100" style={{ marginHorizontal: ds.spacing(16) }} />

      <View style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(16) }}>
        <Text className="font-medium text-gray-900" style={{ fontSize: ds.fontSize(15), marginBottom: ds.spacing(12) }}>UI Scale</Text>
        <MultiOptionToggle
          options={[
            { value: 'compact', label: 'Compact' },
            { value: 'default', label: 'Default' },
            { value: 'large', label: 'Large' },
          ]}
          value={uiScale}
          onValueChange={setUIScale}
        />
        <Text className="text-gray-400" style={{ fontSize: ds.fontSize(12), marginTop: ds.spacing(8) }}>
          Affects button sizes, card padding, and spacing
        </Text>
      </View>

      <View className="h-px bg-gray-100" style={{ marginHorizontal: ds.spacing(16) }} />

      <View style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(16) }}>
        <Text className="font-medium text-gray-900" style={{ fontSize: ds.fontSize(15), marginBottom: ds.spacing(12) }}>Button Size</Text>
        <MultiOptionToggle
          options={[
            { value: 'small', label: 'Small' },
            { value: 'medium', label: 'Medium' },
            { value: 'large', label: 'Large' },
          ]}
          value={buttonSize}
          onValueChange={setButtonSize}
        />
        <View className="items-center" style={{ marginTop: ds.spacing(12) }}>
          <TouchableOpacity
            className="bg-primary-500 items-center justify-center"
            style={{
              height: ds.buttonH,
              paddingHorizontal: ds.buttonPadH + 8,
              borderRadius: ds.radius(12),
            }}
          >
            <Text className="text-white font-semibold" style={{ fontSize: ds.buttonFont }}>Sample Button</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View className="h-px bg-gray-100" style={{ marginHorizontal: ds.spacing(16) }} />

      <SettingToggle
        title="Haptic Feedback"
        subtitle="Vibration on button presses"
        value={hapticFeedback}
        onValueChange={setHapticFeedback}
      />

      <SettingToggle
        title="Reduce Motion"
        subtitle="Minimize animations"
        value={reduceMotion}
        onValueChange={setReduceMotion}
        showBorder={false}
      />

      <View className="h-px bg-gray-100" style={{ marginHorizontal: ds.spacing(16) }} />

      <TouchableOpacity
        onPress={handleReset}
        style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(16) }}
      >
        <Text className="text-red-500 font-medium" style={{ fontSize: ds.fontSize(14) }}>Reset to Defaults</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function DisplayAccessibilitySettingsScreen() {
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
        <Text className="font-bold text-gray-900" style={{ fontSize: ds.fontSize(18) }}>Display & Accessibility</Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: ds.spacing(32) }}>
        <DisplaySection />
      </ScrollView>
    </SafeAreaView>
  );
}
