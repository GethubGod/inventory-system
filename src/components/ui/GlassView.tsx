import React from 'react';
import { StyleSheet, View, ViewProps, ViewStyle } from 'react-native';
import { colors, glass, radii } from '@/theme/design';

interface GlassViewProps extends ViewProps {
  variant?: 'card' | 'input' | 'circle' | 'pill' | 'stepper';
  size?: number;
}

const variants: Record<NonNullable<GlassViewProps['variant']>, ViewStyle> = {
  card: glass.card,
  input: glass.input,
  circle: glass.circle,
  pill: glass.pill,
  stepper: glass.stepper,
};

export function GlassView({
  variant = 'card',
  size,
  style,
  children,
  ...props
}: GlassViewProps) {
  const sizeStyle =
    variant === 'circle'
      ? {
          width: size ?? glass.circle.width,
          height: size ?? glass.circle.height,
          borderRadius: radii.circle,
        }
      : undefined;

  return (
    <View
      style={[
        styles.base,
        variants[variant],
        sizeStyle,
        style,
      ]}
      {...props}
    >
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          {
            borderRadius: variant === 'circle' ? radii.circle : undefined,
            backgroundColor:
              variant === 'stepper'
                ? colors.glassStrong
                : variant === 'circle'
                  ? colors.glassCircle
                  : colors.glass,
          },
        ]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
  },
});
