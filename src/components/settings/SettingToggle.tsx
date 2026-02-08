import React from 'react';
import { View, Text, Switch, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors } from '@/constants';
import { useDisplayStore } from '@/store';

interface SettingToggleProps {
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  iconBgColor?: string;
  title: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  showBorder?: boolean;
}

export function SettingToggle({
  icon,
  iconColor,
  iconBgColor,
  title,
  subtitle,
  value,
  onValueChange,
  disabled = false,
  showBorder = true,
}: SettingToggleProps) {
  const { hapticFeedback } = useDisplayStore();

  const handleValueChange = (newValue: boolean) => {
    if (hapticFeedback && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onValueChange(newValue);
  };

  return (
    <View
      className={`bg-white px-4 py-4 flex-row items-center ${
        showBorder ? 'border-b border-gray-100' : ''
      } ${disabled ? 'opacity-50' : ''}`}
    >
      {icon && (
        <View
          className="w-10 h-10 rounded-xl items-center justify-center mr-4"
          style={{ backgroundColor: iconBgColor || colors.gray[100] }}
        >
          <Ionicons name={icon} size={22} color={iconColor || colors.gray[500]} />
        </View>
      )}
      <View className="flex-1">
        <Text className="font-semibold text-base text-gray-900">{title}</Text>
        {subtitle && (
          <Text className="text-gray-500 text-sm mt-0.5">{subtitle}</Text>
        )}
      </View>
      <Switch
        value={value}
        onValueChange={handleValueChange}
        trackColor={{ false: colors.gray[200], true: colors.primary[500] }}
        thumbColor={Platform.OS === 'android' ? (value ? colors.primary[600] : colors.gray[50]) : undefined}
        ios_backgroundColor={colors.gray[200]}
        disabled={disabled}
      />
    </View>
  );
}
