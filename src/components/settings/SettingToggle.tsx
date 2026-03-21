import React from 'react';
import { View, Text, Switch, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { glassColors, glassHairlineWidth, glassRadii } from '@/design/tokens';

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
  const switchScale = ds.isLarge ? 1.15 : ds.isCompact ? 0.95 : 1;

  const handleValueChange = (newValue: boolean) => {
    onValueChange(newValue);
  };

  return (
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
            fontSize: ds.fontSize(15),
            fontWeight: '600',
            color: glassColors.textPrimary,
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
