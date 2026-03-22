import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassSurface } from '@/components/ui';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassRadii,
} from '@/theme/design';

type EmptyStateAlignment = 'center' | 'leading';

interface EmptyStateCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message: string;
  alignment?: EmptyStateAlignment;
  actionLabel?: string;
  onPressAction?: () => void;
}

export function EmptyStateCard({
  icon,
  title,
  message,
  alignment = 'center',
  actionLabel,
  onPressAction,
}: EmptyStateCardProps) {
  const ds = useScaledStyles();
  const isCentered = alignment === 'center';

  return (
    <GlassSurface
      intensity="subtle"
      style={{
        borderRadius: glassRadii.surface,
        paddingHorizontal: ds.spacing(16),
        paddingVertical: ds.spacing(16),
      }}
    >
      <View
        style={{
          alignItems: isCentered ? 'center' : 'flex-start',
        }}
      >
        <View
          style={{
            width: ds.icon(36),
            height: ds.icon(36),
            borderRadius: glassRadii.iconTile,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: glassColors.mediumFill,
          }}
        >
          <Ionicons
            name={icon}
            size={ds.icon(18)}
            color={glassColors.textSecondary}
          />
        </View>
        <Text
          style={{
            marginTop: ds.spacing(12),
            fontSize: ds.fontSize(15),
            fontWeight: '600',
            color: glassColors.textPrimary,
            textAlign: isCentered ? 'center' : 'left',
          }}
        >
          {title}
        </Text>
        <Text
          style={{
            marginTop: ds.spacing(6),
            fontSize: ds.fontSize(12),
            color: glassColors.textSecondary,
            textAlign: isCentered ? 'center' : 'left',
            lineHeight: ds.fontSize(18),
          }}
        >
          {message}
        </Text>
        {actionLabel && onPressAction ? (
          <TouchableOpacity
            onPress={onPressAction}
            style={{
              marginTop: ds.spacing(14),
              minHeight: ds.buttonH,
              borderRadius: glassRadii.button,
              paddingHorizontal: ds.spacing(16),
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              backgroundColor: glassColors.accent,
            }}
            activeOpacity={0.85}
          >
            <Text
              style={{
                fontSize: ds.buttonFont,
                fontWeight: '700',
                color: glassColors.textOnPrimary,
              }}
            >
              {actionLabel}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </GlassSurface>
  );
}
