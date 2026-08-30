import React from 'react';
import { Image, StyleProp, View, ViewStyle } from 'react-native';
import { useDisplayStore } from '@/store';

type BrandLogoVariant = 'header' | 'footer' | 'inline';

interface BrandLogoProps {
  variant?: BrandLogoVariant;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

// The delivered mark, used as-is on every background. Only the area outside its
// circle is transparent, so the white inside the swirl stays white on the black
// auth screens. See brand/README.md.
const MARK = require('../../assets/images/smelter-mark.png');

const DEFAULT_SIZE: Record<BrandLogoVariant, number> = {
  header: 28,
  footer: 40,
  inline: 32,
};

const VARIANT_OPACITY: Record<BrandLogoVariant, number> = {
  header: 1,
  footer: 0.85,
  inline: 1,
};

const LOGO_SCALE_MULTIPLIER = {
  compact: 0.9,
  default: 1,
  large: 1.15,
} as const;

export function BrandLogo({ variant = 'inline', size, style }: BrandLogoProps) {
  const uiScale = useDisplayStore((state) => state.uiScale);
  const baseSize = size ?? DEFAULT_SIZE[variant];
  const resolvedSize = Math.round(baseSize * LOGO_SCALE_MULTIPLIER[uiScale]);

  return (
    <View style={[{ opacity: VARIANT_OPACITY[variant] }, style]} pointerEvents="none">
      <Image
        source={MARK}
        style={{ width: resolvedSize, height: resolvedSize, resizeMode: 'contain' }}
      />
    </View>
  );
}
