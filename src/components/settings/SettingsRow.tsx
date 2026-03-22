import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { glassColors, glassHairlineWidth, glassRadii } from '@/theme/design';

export interface SettingsRowProps {
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  iconBgColor?: string;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  showChevron?: boolean;
  destructive?: boolean;
  rightElement?: React.ReactNode;
  disabled?: boolean;
  showBorder?: boolean;
}

export function SettingsRow({
  icon,
  iconColor,
  iconBgColor,
  title,
  subtitle,
  onPress,
  showChevron = true,
  destructive = false,
  rightElement,
  disabled = false,
  showBorder = true,
}: SettingsRowProps) {
  const ds = useScaledStyles();

  const handlePress = () => {
    if (disabled || !onPress) return;
    onPress();
  };

  const content = (
    <View
      className={`flex-row items-center ${disabled ? 'opacity-50' : ''}`}
      style={{
        paddingHorizontal: ds.spacing(16),
        paddingVertical: ds.spacing(14),
        minHeight: Math.max(ds.rowH, 60),
        borderBottomWidth: showBorder ? glassHairlineWidth : 0,
        borderBottomColor: glassColors.divider,
      }}
    >
      {icon && (
        <View
          className="items-center justify-center"
          style={{
            width: Math.max(40, ds.icon(40)),
            height: Math.max(40, ds.icon(40)),
            borderRadius: glassRadii.iconTile,
            marginRight: ds.spacing(14),
            backgroundColor: iconBgColor || glassColors.mediumFill,
          }}
        >
          <Ionicons name={icon} size={ds.icon(20)} color={iconColor || colors.gray[500]} />
        </View>
      )}
      <View className="flex-1">
        <Text
          style={{
            fontSize: ds.fontSize(16),
            fontWeight: '600',
            color: destructive ? glassColors.dangerText : glassColors.textPrimary,
          }}
        >
          {title}
        </Text>
        {subtitle && (
          <Text
            style={{
              fontSize: ds.fontSize(12),
              marginTop: ds.spacing(4),
              color: glassColors.textSecondary,
              lineHeight: ds.fontSize(16),
            }}
          >
            {subtitle}
          </Text>
        )}
      </View>
      {rightElement}
      {showChevron && !rightElement && (
        <Ionicons name="chevron-forward" size={ds.icon(18)} color={colors.gray[400]} />
      )}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        onPress={handlePress}
        activeOpacity={0.82}
        disabled={disabled}
      >
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}
