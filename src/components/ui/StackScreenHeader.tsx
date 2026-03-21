import React from 'react';
import { Text, TouchableOpacity, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { GlassView } from './GlassView';
import {
  glassColors,
  glassRadii,
  glassSpacing,
  glassTypography,
} from '@/design/tokens';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { useSettingsNavigationContext } from '@/hooks/useSettingsBackRoute';

interface StackScreenHeaderProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onBackPress?: () => void;
  style?: ViewStyle;
}

export function StackScreenHeader({
  title,
  subtitle,
  right,
  onBackPress,
  style,
}: StackScreenHeaderProps) {
  const ds = useScaledStyles();
  const { backTo } = useSettingsNavigationContext();

  const handleBackPress = () => {
    if (onBackPress) {
      onBackPress();
      return;
    }

    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace(backTo);
  };

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: glassSpacing.screen,
          paddingTop: ds.spacing(6),
          paddingBottom: ds.spacing(10),
        },
        style,
      ]}
    >
      <GlassView variant="circle" size={Math.max(44, ds.icon(40))}>
        <TouchableOpacity
          onPress={handleBackPress}
          style={{
            width: Math.max(44, ds.icon(40)),
            height: Math.max(44, ds.icon(40)),
            borderRadius: glassRadii.round,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons
            name="arrow-back"
            size={ds.icon(20)}
            color={glassColors.textPrimary}
          />
        </TouchableOpacity>
      </GlassView>

      <View style={{ flex: 1, marginLeft: ds.spacing(12) }}>
        <Text
          style={{
            fontSize: glassTypography.screenTitle,
            fontWeight: '700',
            color: glassColors.textPrimary,
          }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={{
              marginTop: ds.spacing(4),
              fontSize: ds.fontSize(12),
              color: glassColors.textSecondary,
            }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>

      {right}
    </View>
  );
}
