import React from 'react';
import { View, Text, Switch, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors } from '@/constants';
import { useDisplayStore } from '@/store';
import { useScaledStyles } from '@/hooks/useScaledStyles';

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
  const ds = useScaledStyles();
  const { hapticFeedback } = useDisplayStore();
  const switchScale = ds.isLarge ? 1.15 : ds.isCompact ? 0.95 : 1;

  const handleValueChange = (newValue: boolean) => {
    if (hapticFeedback && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onValueChange(newValue);
  };

  return (
    <View
      className={`bg-white flex-row items-center ${
        showBorder ? 'border-b border-gray-100' : ''
      } ${disabled ? 'opacity-50' : ''}`}
      style={{
        paddingHorizontal: ds.spacing(16),
        paddingVertical: ds.spacing(12),
        minHeight: Math.max(ds.rowH, 56),
      }}
    >
      {icon && (
        <View
          className="items-center justify-center"
          style={{
            width: Math.max(40, ds.icon(40)),
            height: Math.max(40, ds.icon(40)),
            borderRadius: ds.radius(12),
            marginRight: ds.spacing(14),
            backgroundColor: iconBgColor || colors.gray[100],
          }}
        >
          <Ionicons name={icon} size={ds.icon(22)} color={iconColor || colors.gray[500]} />
        </View>
      )}
      <View className="flex-1">
        <Text className="font-semibold text-gray-900" style={{ fontSize: ds.fontSize(16) }}>
          {title}
        </Text>
        {subtitle && (
          <Text className="text-gray-500 mt-0.5" style={{ fontSize: ds.fontSize(14) }}>
            {subtitle}
          </Text>
        )}
      </View>
      <Switch
        value={value}
        onValueChange={handleValueChange}
        trackColor={{ false: colors.gray[200], true: colors.primary[500] }}
        thumbColor={Platform.OS === 'android' ? (value ? colors.primary[600] : colors.gray[50]) : undefined}
        ios_backgroundColor={colors.gray[200]}
        disabled={disabled}
        style={{ transform: [{ scaleX: switchScale }, { scaleY: switchScale }] }}
      />
    </View>
  );
}
