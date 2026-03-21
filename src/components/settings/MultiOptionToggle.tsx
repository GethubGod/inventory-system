import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
} from '@/design/tokens';

interface Option<T> {
  value: T;
  label: string;
  preview?: React.ReactNode;
  disabled?: boolean;
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
  const ds = useScaledStyles();

  const handleSelect = (optionValue: T, optionDisabled: boolean) => {
    if (disabled || optionDisabled) return;
    onValueChange(optionValue);
  };

  return (
    <View
      style={{
        flexDirection: 'row',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {options.map((option, index) => {
        const isSelected = value === option.value;
        const isOptionDisabled = disabled || Boolean(option.disabled);
        return (
          <TouchableOpacity
            key={String(option.value)}
            onPress={() => handleSelect(option.value, isOptionDisabled)}
            disabled={isOptionDisabled}
            style={{
              flex: 1,
              marginRight: index < options.length - 1 ? ds.spacing(8) : 0,
              minHeight: Math.max(46, ds.buttonH),
              paddingHorizontal: ds.spacing(10),
              paddingVertical: ds.spacing(8),
              borderRadius: glassRadii.button,
              borderWidth: isSelected ? 1.5 : glassHairlineWidth,
              borderColor: isSelected
                ? glassColors.accent
                : glassColors.controlBorder,
              backgroundColor: isSelected
                ? glassColors.accentSoft
                : glassColors.mediumFill,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: isOptionDisabled && !isSelected ? 0.6 : 1,
            }}
            activeOpacity={0.82}
          >
            {option.preview && (
              <View style={{ marginBottom: ds.spacing(4) }}>{option.preview}</View>
            )}
            <Text
              style={{
                fontSize: ds.fontSize(14),
                fontWeight: '600',
                color: isSelected
                  ? glassColors.accent
                  : glassColors.textSecondary,
              }}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
