import React from 'react';
import { TouchableOpacity, View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
} from '@/theme/design';

type ReminderTone = 'warning' | 'success' | 'neutral';

const TONE_STYLES: Record<
  ReminderTone,
  {
    backgroundColor: string;
    borderColor: string;
    iconBackground: string;
    iconColor: string;
    titleColor: string;
    subtitleColor: string;
  }
> = {
  warning: {
    backgroundColor: '#FFF8F5',
    borderColor: '#F4D8D0',
    iconBackground: '#FFF0EA',
    iconColor: glassColors.accent,
    titleColor: '#EE573F',
    subtitleColor: glassColors.textSecondary,
  },
  success: {
    backgroundColor: glassColors.subtleFill,
    borderColor: glassColors.cardBorder,
    iconBackground: glassColors.successSoft,
    iconColor: glassColors.successText,
    titleColor: glassColors.textPrimary,
    subtitleColor: glassColors.textSecondary,
  },
  neutral: {
    backgroundColor: glassColors.subtleFill,
    borderColor: glassColors.cardBorder,
    iconBackground: glassColors.mediumFill,
    iconColor: glassColors.textSecondary,
    titleColor: glassColors.textPrimary,
    subtitleColor: glassColors.textSecondary,
  },
};

interface FulfillmentReminderBannerProps {
  title: string;
  subtitle: string;
  tone?: ReminderTone;
  onPress: () => void;
}

export function FulfillmentReminderBanner({
  title,
  subtitle,
  tone = 'warning',
  onPress,
}: FulfillmentReminderBannerProps) {
  const ds = useScaledStyles();
  const palette = TONE_STYLES[tone];
  const iconName = tone === 'warning' ? 'alert-outline' : tone === 'success' ? 'checkmark-circle-outline' : 'notifications-outline';

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.86}
      style={{
        backgroundColor: palette.backgroundColor,
        borderColor: palette.borderColor,
        borderWidth: glassHairlineWidth,
        borderRadius: 18,
        paddingHorizontal: ds.spacing(16),
        paddingVertical: ds.spacing(13),
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: glassRadii.iconTile,
          backgroundColor: palette.iconBackground,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: ds.spacing(12),
        }}
      >
        <Ionicons name={iconName} size={16} color={palette.iconColor} />
      </View>

      <View style={{ flex: 1, paddingRight: ds.spacing(8) }}>
        <Text
          style={{
            color: palette.titleColor,
            fontSize: ds.fontSize(14),
            fontWeight: '700',
          }}
          numberOfLines={1}
        >
          {title}
        </Text>
        <Text
          style={{
            color: palette.subtitleColor,
            fontSize: ds.fontSize(12),
            lineHeight: ds.fontSize(16),
            marginTop: 2,
          }}
          numberOfLines={2}
        >
          {subtitle}
        </Text>
      </View>

      <Ionicons name="chevron-forward" size={15} color={palette.iconColor} />
    </TouchableOpacity>
  );
}
