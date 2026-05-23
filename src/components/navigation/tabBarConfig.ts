import { Platform, ViewStyle, TextStyle } from 'react-native';
import { colors, hairline, spacing } from '@/theme/design';

/**
 * Returns the shared tab bar screen options used by both employee and manager layouts.
 */
export function getTabBarScreenOptions(tabBarBottomInset: number) {
  const tabBarHeight = 60 + tabBarBottomInset;

  return {
    tabBarActiveTintColor: colors.primary,
    tabBarInactiveTintColor: colors.textSecondary,
    tabBarStyle: {
      position: 'absolute' as const,
      backgroundColor: colors.tabBarBg,
      borderTopWidth: hairline,
      borderTopColor: colors.glassBorder,
      paddingTop: 6,
      paddingBottom: tabBarBottomInset,
      paddingHorizontal: spacing.tabBarHorizontal,
      height: tabBarHeight,
      elevation: 0,
    } satisfies ViewStyle,
    // Android rejects fontSize: 0 when measuring letterSpacing; labels live in TabButton.
    ...(Platform.OS === 'android'
      ? { tabBarShowLabel: false as const }
      : {
          tabBarLabelStyle: {
            fontSize: 0, // hide default label — rendered inside TabButton
            height: 0,
            margin: 0,
          } satisfies TextStyle,
        }),
    tabBarItemStyle: {
      paddingTop: 8,
    } satisfies ViewStyle,
    headerShown: false as const,
  };
}

/**
 * Computes the bottom inset for the tab bar, ensuring a minimum value.
 */
export function getTabBarBottomInset(insetsBottom: number): number {
  return Math.max(insetsBottom, spacing.tabBarBottom);
}

/**
 * Shared badge style for tab bar badges.
 */
export const tabBarBadgeStyle = {
  backgroundColor: colors.primary,
  color: colors.textOnPrimary,
  fontSize: 10,
  fontWeight: '700' as const,
  minWidth: 18,
  height: 18,
  lineHeight: 16,
  borderRadius: 9,
  top: -4,
  right: -6,
};
