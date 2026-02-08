import React from 'react';
import { Image, StyleProp, View, ViewStyle } from 'react-native';
import { useDisplayStore } from '@/store';

type BrandLogoVariant = 'header' | 'footer' | 'inline';
type BrandLogoColorMode = 'light' | 'dark';

interface BrandLogoProps {
  variant?: BrandLogoVariant;
  size?: number;
  colorMode?: BrandLogoColorMode;
  style?: StyleProp<ViewStyle>;
}

const BLACK_LOGO = require('../../assets/images/babytuna-logo-black.png');
const LIGHT_LOGO = require('../../assets/images/babytuna-logo.png');
const BLACK_LOGO_META = Image.resolveAssetSource(BLACK_LOGO);
const LIGHT_LOGO_META = Image.resolveAssetSource(LIGHT_LOGO);

const DEFAULT_SIZE: Record<BrandLogoVariant, number> = {
  header: 28,
  footer: 40,
  inline: 32,
};

const VARIANT_OPACITY: Record<BrandLogoVariant, number> = {
  header: 0.9,
  footer: 0.7,
  inline: 1,
};

const LOGO_SCALE_MULTIPLIER = {
  compact: 0.9,
  default: 1,
  large: 1.15,
} as const;

export function BrandLogo({
  variant = 'inline',
  size,
  colorMode = 'light',
  style,
}: BrandLogoProps) {
  const uiScale = useDisplayStore((state) => state.uiScale);
  const baseSize = size ?? DEFAULT_SIZE[variant];
  const resolvedSize = Math.round(baseSize * LOGO_SCALE_MULTIPLIER[uiScale]);
  const source = colorMode === 'dark' ? LIGHT_LOGO : BLACK_LOGO;
  const sourceMeta = colorMode === 'dark' ? LIGHT_LOGO_META : BLACK_LOGO_META;
  const aspectRatio =
    sourceMeta.width > 0 && sourceMeta.height > 0
      ? sourceMeta.width / sourceMeta.height
      : 1;

  return (
    <View style={[{ opacity: VARIANT_OPACITY[variant] }, style]} pointerEvents="none">
      <Image
        source={source}
        style={{
          width: resolvedSize * aspectRatio,
          height: resolvedSize,
          resizeMode: 'contain',
        }}
      />
    </View>
  );
}
