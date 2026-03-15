import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassSurface } from '@/components/ui';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassRadii,
} from '@/design/tokens';

interface HeaderCartButtonProps {
  count: number;
  onPress: () => void;
}

export function HeaderCartButton({
  count,
  onPress,
}: HeaderCartButtonProps) {
  const ds = useScaledStyles();
  const buttonSize = Math.max(44, ds.icon(40));

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
          size={ds.icon(20)}
          color={glassColors.textPrimary}
        />
      </TouchableOpacity>
      {count > 0 ? (
        <View
          style={{
            position: 'absolute',
            top: -6,
            right: -6,
            minWidth: ds.spacing(20),
            height: ds.spacing(20),
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
              fontSize: ds.fontSize(10),
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
