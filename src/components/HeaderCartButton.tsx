import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassSurface } from '@/components/ui';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassRadii,
} from '@/theme/design';

interface HeaderCartButtonProps {
  count: number;
  onPress: () => void;
  size?: number;
  iconSize?: number;
}

export function HeaderCartButton({
  count,
  onPress,
  size,
  iconSize,
}: HeaderCartButtonProps) {
  const ds = useScaledStyles();
  const buttonSize = size ?? Math.max(52, ds.icon(48));
  const resolvedIconSize = iconSize ?? ds.icon(26);

  return (
    <View style={{ width: buttonSize, height: buttonSize }}>
      <GlassSurface
        intensity="medium"
        style={{
          ...StyleSheet.absoluteFillObject,
          borderRadius: glassRadii.round,
        }}
      >
        <View />
      </GlassSurface>
      <TouchableOpacity
        onPress={onPress}
        style={StyleSheet.absoluteFillObject}
        className="items-center justify-center"
        activeOpacity={0.8}
      >
        <Ionicons
          name="bag-handle-outline"
          size={resolvedIconSize}
          color={glassColors.textPrimary}
        />
      </TouchableOpacity>
      {count > 0 ? (
        <View
          style={{
            position: 'absolute',
            top: -4,
            right: -4,
            minWidth: ds.spacing(24),
            height: ds.spacing(24),
            paddingHorizontal: 4,
            borderRadius: glassRadii.round,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: glassColors.accent,
            borderWidth: 2,
            borderColor: '#FFFFFF',
            zIndex: 1,
          }}
        >
          <Text
            style={{
              color: glassColors.textOnPrimary,
              fontSize: ds.fontSize(13),
              fontWeight: '700',
            }}
          >
            {count > 99 ? '99+' : count}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
