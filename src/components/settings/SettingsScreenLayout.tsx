import React from 'react';
import {
  ScrollView,
  Text,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  glassColors,
  glassRadii,
  glassSpacing,
} from '@/design/tokens';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { GlassSurface } from '@/components/ui';
import { StackScreenHeader } from '@/components/ui/StackScreenHeader';

interface SettingsScreenLayoutProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  scrollProps?: Omit<ScrollViewProps, 'contentContainerStyle'>;
}

interface SettingsGroupProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

interface SettingsSectionLabelProps {
  label: string;
  description?: string;
}

export function SettingsScreenLayout({
  title,
  subtitle,
  right,
  children,
  contentContainerStyle,
  scrollProps,
}: SettingsScreenLayoutProps) {
  const ds = useScaledStyles();

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: glassColors.background }}
      edges={['top', 'left', 'right']}
    >
      <View style={{ backgroundColor: glassColors.background }}>
        <StackScreenHeader title={title} subtitle={subtitle} right={right} />
      </View>
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          {
            paddingBottom: ds.spacing(32),
          },
          contentContainerStyle,
        ]}
        {...scrollProps}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function SettingsGroup({ children, style }: SettingsGroupProps) {
  return (
    <GlassSurface
      intensity="subtle"
      blurred={false}
      style={[
        {
          marginHorizontal: glassSpacing.screen,
          borderRadius: glassRadii.surface,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children}
    </GlassSurface>
  );
}

export function SettingsSectionLabel({
  label,
  description,
}: SettingsSectionLabelProps) {
  const ds = useScaledStyles();

  return (
    <View
      style={{
        paddingHorizontal: glassSpacing.screen,
        paddingTop: ds.spacing(18),
        paddingBottom: ds.spacing(10),
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <View
          style={{
            width: ds.spacing(18),
            height: 1,
            marginRight: ds.spacing(8),
            backgroundColor: glassColors.divider,
          }}
        />
        <View
          style={{
            width: ds.spacing(6),
            height: ds.spacing(6),
            marginRight: ds.spacing(8),
            borderRadius: glassRadii.round,
            backgroundColor: glassColors.accentSoft,
          }}
        />
        <Text
          style={{
            fontSize: ds.fontSize(11),
            fontWeight: '700',
            color: glassColors.textSecondary,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}
        >
          {label}
        </Text>
      </View>
      {description ? (
        <Text
          style={{
            marginTop: ds.spacing(6),
            fontSize: ds.fontSize(12),
            color: glassColors.textSecondary,
          }}
        >
          {description}
        </Text>
      ) : null}
    </View>
  );
}
