import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassSurface } from '@/components/ui';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassRadii,
} from '@/theme/design';

interface LocationSelectorButtonProps {
  label: string;
  expanded: boolean;
  onPress: () => void;
}

export function LocationSelectorButton({
  label,
  expanded,
  onPress,
}: LocationSelectorButtonProps) {
  const ds = useScaledStyles();
  const buttonSize = Math.max(48, ds.icon(44));

  return (
    <GlassSurface
      intensity="medium"
      style={{
        flex: 1,
        borderRadius: glassRadii.pill,
      }}
    >
      <TouchableOpacity
        onPress={onPress}
        className="flex-row items-center"
        style={{
          minHeight: buttonSize,
          paddingHorizontal: ds.spacing(16),
        }}
        activeOpacity={0.7}
      >
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: glassRadii.round,
            backgroundColor: glassColors.accent,
            marginRight: ds.spacing(10),
          }}
        />
        <Text
          style={{
            flex: 1,
            fontSize: ds.fontSize(16),
            fontWeight: '700',
            color: glassColors.textPrimary,
            marginRight: ds.spacing(8),
          }}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {label}
        </Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={ds.icon(18)}
          color={glassColors.textSecondary}
        />
      </TouchableOpacity>
    </GlassSurface>
  );
}
