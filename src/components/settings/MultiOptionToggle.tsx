import React from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSettingsStore } from '@/store';

interface Option<T> {
  value: T;
  label: string;
  preview?: React.ReactNode;
}

interface MultiOptionToggleProps<T> {
  options: Option<T>[];
  value: T;
  onValueChange: (value: T) => void;
  disabled?: boolean;
}

export function MultiOptionToggle<T extends string | number>({
  options,
  value,
  onValueChange,
  disabled = false,
}: MultiOptionToggleProps<T>) {
  const { hapticFeedback } = useSettingsStore();

  const handleSelect = (optionValue: T) => {
    if (disabled) return;
    if (hapticFeedback && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onValueChange(optionValue);
  };

  return (
    <View className={`flex-row ${disabled ? 'opacity-50' : ''}`}>
      {options.map((option, index) => {
        const isSelected = value === option.value;
        return (
          <TouchableOpacity
            key={String(option.value)}
            onPress={() => handleSelect(option.value)}
            disabled={disabled}
            className={`flex-1 py-3 rounded-xl items-center border-2 ${
              index < options.length - 1 ? 'mr-2' : ''
            } ${
              isSelected
                ? 'border-primary-500 bg-primary-50'
                : 'border-gray-200 bg-gray-50'
            }`}
            activeOpacity={0.7}
          >
            {option.preview && (
              <View className="mb-1">{option.preview}</View>
            )}
            <Text
              className={`text-sm font-medium ${
                isSelected ? 'text-primary-600' : 'text-gray-600'
              }`}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
