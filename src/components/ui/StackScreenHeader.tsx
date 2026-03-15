import React from 'react';
import { Text, TouchableOpacity, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { GlassView } from './GlassView';
import { colors, radii, spacing, typography } from '@/theme/design';

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
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: spacing.screen,
          paddingTop: spacing.md,
          paddingBottom: spacing.md,
        },
        style,
      ]}
    >
      <GlassView variant="circle" size={36}>
        <TouchableOpacity
          onPress={onBackPress ?? (() => router.back())}
          style={{
            width: 36,
            height: 36,
            borderRadius: radii.circle,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
      </GlassView>

      <View style={{ flex: 1, marginLeft: spacing.md }}>
        <Text
          style={{
            fontSize: typography.screenTitle,
            fontWeight: '600',
            color: colors.textPrimary,
          }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={{
              marginTop: 2,
              fontSize: typography.caption,
              color: colors.textSecondary,
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
