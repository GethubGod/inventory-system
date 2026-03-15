import React from 'react';
import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { GlassSurface } from '@/components';
import {
  glassColors,
  glassRadii,
  glassSpacing,
  glassTypography,
} from '@/design/tokens';

export default function VoiceScreen() {
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: glassColors.background }}
      edges={['top', 'left', 'right']}
    >
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: glassSpacing.screen,
        }}
      >
        <GlassSurface
          intensity="strong"
          style={{
            width: 80,
            height: 80,
            borderRadius: glassRadii.round,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 24,
          }}
        >
          <Ionicons
            name="mic-outline"
            size={34}
            color={glassColors.accent}
          />
        </GlassSurface>
        <Text
          style={{
            fontSize: glassTypography.screenTitle,
            fontWeight: '600',
            color: glassColors.textPrimary,
          }}
        >
          Voice ordering
        </Text>
        <Text
          style={{
            marginTop: 8,
            fontSize: glassTypography.body,
            color: glassColors.textSecondary,
          }}
        >
          Coming soon
        </Text>
        <Text
          style={{
            marginTop: 12,
            maxWidth: 240,
            textAlign: 'center',
            fontSize: 12,
            lineHeight: 18,
            color: glassColors.textSecondary,
          }}
        >
          Order inventory using voice commands in English or Chinese.
        </Text>
      </View>
    </SafeAreaView>
  );
}
