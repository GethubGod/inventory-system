import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassSurface } from '@/components/ui';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassRadii,
  glassSpacing,
} from '@/design/tokens';

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
  const buttonSize = Math.max(44, ds.icon(40));

  return (
    <GlassSurface
      intensity="medium"
      style={{
        flexShrink: 1,
        marginRight: glassSpacing.gap,
        borderRadius: glassRadii.pill,
      }}
    >
      <TouchableOpacity
        onPress={onPress}
        className="flex-row items-center"
        style={{
          minHeight: buttonSize,
          paddingHorizontal: ds.spacing(14),
        }}
        activeOpacity={0.7}
      >
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: glassRadii.round,
            backgroundColor: glassColors.accent,
            marginRight: ds.spacing(8),
          }}
        />
        <Text
          style={{
            fontSize: ds.fontSize(14),
            fontWeight: '600',
            color: glassColors.textPrimary,
            marginRight: ds.spacing(6),
            maxWidth: ds.spacing(170),
          }}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {label}
        </Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={ds.icon(13)}
          color={glassColors.textSecondary}
        />
      </TouchableOpacity>
    </GlassSurface>
  );
}
