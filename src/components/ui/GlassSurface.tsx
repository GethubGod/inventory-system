import React from 'react';
import { StyleProp, StyleSheet, ViewStyle } from 'react-native';
import { colors } from '@/theme/design';
import { GlassView } from './GlassView';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
} from '@/design/tokens';

type GlassIntensity = 'subtle' | 'medium' | 'strong';

interface GlassSurfaceProps {
  intensity?: GlassIntensity;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  blurred?: boolean;
}

export function GlassSurface({
  intensity = 'subtle',
  style,
  children,
  blurred = true,
}: GlassSurfaceProps) {
  const flattenedStyle = StyleSheet.flatten(style);
  const borderRadius =
    typeof flattenedStyle?.borderRadius === 'number'
      ? flattenedStyle.borderRadius
      : glassRadii.surface;
  const backgroundColor =
    intensity === 'strong'
      ? colors.glassStrong
      : intensity === 'medium'
        ? colors.glassCircle
        : colors.glass;

  return (
    <GlassView
      variant="card"
      style={[
        {
          borderRadius,
          borderWidth: glassHairlineWidth,
          borderColor: glassColors.cardBorder,
          backgroundColor,
        },
        style,
      ]}
    >
      {children}
    </GlassView>
  );
}
