import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { glassHairlineWidth, tipsTheme } from '@/theme/design';

/** One row inside a white settings card, tips colorway. */

interface SettingsCardRowProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle?: string | null;
  onPress?: () => void;
  isLast?: boolean;
  destructive?: boolean;
  /** Rendered at the trailing edge instead of the chevron. */
  rightElement?: React.ReactNode;
  showChevron?: boolean;
  accessibilityLabel?: string;
}

export function SettingsCardRow({
  icon,
  title,
  subtitle,
  onPress,
  isLast = false,
  destructive = false,
  rightElement,
  showChevron = true,
  accessibilityLabel,
}: SettingsCardRowProps) {
  const ds = useScaledStyles();
  const tint = destructive ? tipsTheme.alert : tipsTheme.ink;

  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: ds.spacing(11),
        paddingHorizontal: ds.spacing(16),
        paddingVertical: ds.spacing(13),
        minHeight: 52,
        borderBottomWidth: isLast ? 0 : glassHairlineWidth,
        borderBottomColor: 'rgba(0, 0, 0, 0.05)',
      }}
    >
      <Ionicons name={icon} size={ds.icon(20)} color={tint} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: ds.fontSize(14.5), fontWeight: '600', color: tint }}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ fontSize: ds.fontSize(11.5), color: tipsTheme.ink3, marginTop: 1 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {rightElement}
      {showChevron && !rightElement && onPress ? (
        <Ionicons name="chevron-forward" size={ds.icon(16)} color={tipsTheme.ink3} />
      ) : null}
    </View>
  );

  if (!onPress) return content;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
    >
      {content}
    </TouchableOpacity>
  );
}

/** White card wrapper for settings rows. */
export function SettingsCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: object;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: tipsTheme.card,
          borderWidth: glassHairlineWidth,
          borderColor: tipsTheme.hairline,
          borderRadius: 18,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
