import React, { memo, type ReactNode } from 'react';
import {
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
  type ScrollViewProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  GlassSurface,
  LoadingIndicator,
} from '@/components';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassRadii,
  glassSpacing,
  glassTabBarHeight,
} from '@/theme/design';

interface HomeScreenScrollProps {
  children: ReactNode;
  refreshControl?: React.ReactElement<React.ComponentProps<typeof RefreshControl>>;
  keyboardShouldPersistTaps?: ScrollViewProps['keyboardShouldPersistTaps'];
}

interface HomeSearchCardProps {
  placeholder: string;
  onPress: () => void;
  accessibilityLabel?: string;
}

interface HomeModuleCardProps {
  title: string;
  actionLabel?: string;
  onPressAction?: () => void;
  children: ReactNode;
}

interface HomeModuleStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message: string;
  actionLabel?: string;
  onPressAction?: () => void;
  tone?: 'default' | 'error';
}

export const HomeScreenScroll = memo(function HomeScreenScroll({
  children,
  refreshControl,
  keyboardShouldPersistTaps = 'handled',
}: HomeScreenScrollProps) {
  const ds = useScaledStyles();

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: glassColors.background }}
      edges={['top', 'left', 'right']}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: glassSpacing.screen,
          paddingBottom: glassTabBarHeight + ds.spacing(24),
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
});

export const HomeSearchCard = memo(function HomeSearchCard({
  placeholder,
  onPress,
  accessibilityLabel,
}: HomeSearchCardProps) {
  const ds = useScaledStyles();

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? placeholder}
    >
      <GlassSurface
        intensity="medium"
        style={{
          borderRadius: glassRadii.search,
          paddingHorizontal: ds.spacing(20),
          height: Math.max(50, ds.buttonH + 8),
        }}
      >
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons
            name="search-outline"
            size={ds.icon(22)}
            color={glassColors.textSecondary}
          />
          <Text
            style={{
              marginLeft: ds.spacing(12),
              fontSize: ds.fontSize(16),
              color: glassColors.textMuted,
            }}
            numberOfLines={1}
          >
            {placeholder}
          </Text>
        </View>
      </GlassSurface>
    </TouchableOpacity>
  );
});

export const HomeModuleCard = memo(function HomeModuleCard({
  title,
  actionLabel,
  onPressAction,
  children,
}: HomeModuleCardProps) {
  const ds = useScaledStyles();

  return (
    <GlassSurface
      intensity="subtle"
      style={{ borderRadius: glassRadii.surface }}
    >
      <View
        style={{
          paddingHorizontal: ds.spacing(14),
          paddingTop: ds.spacing(14),
          paddingBottom: ds.spacing(14),
        }}
      >
        <View className="flex-row items-center justify-between">
          <Text
            style={{
              fontSize: ds.fontSize(15),
              fontWeight: '700',
              color: glassColors.textPrimary,
            }}
          >
            {title}
          </Text>
          {actionLabel && onPressAction ? (
            <TouchableOpacity onPress={onPressAction} hitSlop={8}>
              <Text
                style={{
                  fontSize: ds.fontSize(13),
                  fontWeight: '700',
                  color: glassColors.accent,
                }}
              >
                {actionLabel}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={{ marginTop: ds.spacing(12) }}>{children}</View>
      </View>
    </GlassSurface>
  );
});

export const HomeModuleState = memo(function HomeModuleState({
  icon,
  title,
  message,
  actionLabel,
  onPressAction,
  tone = 'default',
}: HomeModuleStateProps) {
  const ds = useScaledStyles();
  const isError = tone === 'error';

  return (
    <View
      style={{
        minHeight: ds.spacing(124),
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: ds.icon(36),
          height: ds.icon(36),
          borderRadius: glassRadii.iconTile,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: isError ? glassColors.dangerSoft : glassColors.mediumFill,
        }}
      >
        <Ionicons
          name={icon}
          size={ds.icon(18)}
          color={isError ? glassColors.dangerText : glassColors.textSecondary}
        />
      </View>
      <Text
        style={{
          marginTop: ds.spacing(12),
          fontSize: ds.fontSize(15),
          fontWeight: '600',
          color: glassColors.textPrimary,
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          marginTop: ds.spacing(6),
          fontSize: ds.fontSize(12),
          color: glassColors.textSecondary,
          lineHeight: ds.fontSize(18),
        }}
      >
        {message}
      </Text>
      {actionLabel && onPressAction ? (
        <TouchableOpacity
          onPress={onPressAction}
          activeOpacity={0.85}
          style={{
            alignSelf: 'flex-start',
            marginTop: ds.spacing(14),
            minHeight: Math.max(38, ds.buttonH - ds.spacing(8)),
            paddingHorizontal: ds.spacing(14),
            borderRadius: glassRadii.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: glassColors.accent,
          }}
        >
          <Text
            style={{
              fontSize: ds.fontSize(13),
              fontWeight: '700',
              color: glassColors.textOnPrimary,
            }}
          >
            {actionLabel}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
});

export const HomeModuleLoading = memo(function HomeModuleLoading({
  text,
}: {
  text: string;
}) {
  const ds = useScaledStyles();

  return (
    <View
      style={{
        minHeight: ds.spacing(124),
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <LoadingIndicator showText text={text} />
    </View>
  );
});
