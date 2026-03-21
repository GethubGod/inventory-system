import React from 'react';
import { Text, View } from 'react-native';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassTypography,
} from '@/design/tokens';
import { HeaderCartButton } from './HeaderCartButton';

interface IdentityHeaderProps {
  identity?: string;
  title: string;
  subtitle?: string;
  cartCount: number;
  onPressCart: () => void;
}

export function IdentityHeader({
  identity,
  title,
  subtitle,
  cartCount,
  onPressCart,
}: IdentityHeaderProps) {
  const ds = useScaledStyles();

  return (
    <View style={{ paddingTop: ds.spacing(8), paddingBottom: ds.spacing(14) }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flex: 1, paddingRight: ds.spacing(16) }}>
          {identity ? (
            <Text
              style={{
                fontSize: ds.fontSize(13),
                fontWeight: '700',
                color: glassColors.accent,
                letterSpacing: 0.4,
              }}
              numberOfLines={1}
            >
              {identity}
            </Text>
          ) : null}
          <Text
            style={{
              marginTop: identity ? ds.spacing(4) : 0,
              fontSize: ds.fontSize(glassTypography.screenTitle - 2),
              fontWeight: '800',
              color: glassColors.textPrimary,
              letterSpacing: -0.5,
            }}
            numberOfLines={2}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={{
                marginTop: ds.spacing(6),
                fontSize: ds.fontSize(14),
                color: glassColors.textSecondary,
              }}
              numberOfLines={2}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={{ paddingTop: ds.spacing(4) }}>
          <HeaderCartButton count={cartCount} onPress={onPressCart} />
        </View>
      </View>
    </View>
  );
}
