import { Platform, StyleSheet } from 'react-native';
import type { ItemCategory, KnownItemCategory } from '@/types';

export const primaryScale = {
  50: '#FFF3F1',
  100: '#FFE0DB',
  200: '#FDC1B7',
  300: '#F79B8C',
  400: '#F06F59',
  500: '#E8503A',
  600: '#D64331',
  700: '#B93628',
  800: '#932C22',
  900: '#73231B',
} as const;

export const grayScale = {
  50: '#F8F8F8',
  100: '#F2F2F2',
  200: '#E8E8E8',
  300: '#D1D5DB',
  400: '#B0B0B0',
  500: '#999999',
  600: '#666666',
  700: '#333333',
  800: '#1F2937',
  900: '#1A1A1A',
} as const;

export const colors = {
  background: '#F7F5F2', // softer off-white native background
  white: '#FFFFFF',
  black: '#1A1A1A',
  primary: '#E8503A', // strong orange-red
  primaryLight: 'rgba(232, 80, 58, 0.12)',
  primaryPale: 'rgba(232, 80, 58, 0.08)',
  text: '#1C1C1E', // stronger iOS native text
  textPrimary: '#1C1C1E',
  textSecondary: '#8E8E93',
  textMuted: '#AEAEB2',
  textOnPrimary: '#FFFFFF',
  glass: 'rgba(255, 255, 255, 1)', // Make glass cards pure white
  glassCircle: 'rgba(255, 255, 255, 1)',
  glassStrong: 'rgba(255, 255, 255, 1)',
  glassBorder: 'rgba(0, 0, 0, 0.04)', // softer lighter borders
  divider: 'rgba(0, 0, 0, 0.05)',
  tabBarBg: 'rgba(247, 245, 242, 0.95)', // match background
  overlay: 'rgba(249, 248, 246, 0.92)',
  scrim: 'rgba(0, 0, 0, 0.3)',
  scrimStrong: 'rgba(0, 0, 0, 0.45)',
  statusGreen: '#22C55E',
  statusGreenBg: 'rgba(34, 197, 94, 0.1)',
  statusAmber: '#C2410C',
  statusAmberBg: 'rgba(245, 158, 11, 0.14)',
  statusRed: '#A32D2D',
  statusRedBg: 'rgba(226, 75, 74, 0.08)',
  tagBlue: '#3B82F6',
  tagBlueBg: 'rgba(59, 130, 246, 0.08)',
  tagRed: '#EF4444',
  tagRedBg: 'rgba(239, 68, 68, 0.08)',
  tagGreen: '#22C55E',
  tagGreenBg: 'rgba(34, 197, 94, 0.08)',
  tagAmber: '#F59E0B',
  tagAmberBg: 'rgba(245, 158, 11, 0.08)',
  tagPurple: '#8B5CF6',
  tagPurpleBg: 'rgba(139, 92, 246, 0.08)',
  tagCyan: '#06B6D4',
  tagCyanBg: 'rgba(6, 182, 212, 0.08)',
  tagPink: '#DB2777',
  tagPinkBg: 'rgba(219, 39, 119, 0.08)',
  tagIndigo: '#4F46E5',
  tagIndigoBg: 'rgba(79, 70, 229, 0.08)',
} as const;

export const radii = {
  card: 24, // softer, larger radius for cards
  pill: 999, // fully rounded pills
  circle: 999,
  button: 16, // softer buttons
  tag: 8,
  stepper: 12,
  submitButton: 16,
  iconTile: 16,
} as const;

export const spacing = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  '2xl': 32,
  '3xl': 40,
  screen: 20, // generous side padding
  card: 16, // generous card padding
  row: 14, // row separation
  gap: 12, // standard gap
  sectionGap: 8, // space between title/content
  tabBarHorizontal: 12, // match screenshot horizontal insets
  tabBarTop: 10,
  tabBarBottom: 16,
} as const;

export const typography = {
  screenTitle: 34, // larger, bolder page titles (V2)
  cardTitle: 17, // easier to scan item names
  body: 15,
  caption: 13, // readable metadata
  sectionLabel: 12, // small caps section headers 
  button: 17, // confident button text
  tabLabel: 10, 
} as const;

export const hairline = StyleSheet.hairlineWidth;

export const glass = {
  card: {
    backgroundColor: colors.glass,
    borderWidth: hairline,
    borderColor: colors.glassBorder,
    borderRadius: radii.card,
  },
  input: {
    backgroundColor: colors.glass,
    borderWidth: hairline,
    borderColor: colors.glassBorder,
    borderRadius: radii.card,
  },
  circle: {
    backgroundColor: colors.glassCircle,
    borderWidth: hairline,
    borderColor: colors.glassBorder,
    borderRadius: radii.circle,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    backgroundColor: colors.glass,
    borderWidth: hairline,
    borderColor: colors.glassBorder,
    borderRadius: radii.pill,
  },
  stepper: {
    backgroundColor: colors.glassStrong,
    borderWidth: hairline,
    borderColor: colors.glassBorder,
    borderRadius: radii.stepper,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBar: {
    backgroundColor: colors.tabBarBg,
    borderTopWidth: hairline,
    borderTopColor: colors.glassBorder,
  },
} as const;

const knownCategoryTints: Record<KnownItemCategory, { background: string; icon: string }> = {
  fish: { background: colors.tagBlueBg, icon: colors.tagBlue },
  protein: { background: colors.tagRedBg, icon: colors.tagRed },
  produce: { background: colors.tagGreenBg, icon: colors.tagGreen },
  dry: { background: colors.tagAmberBg, icon: colors.tagAmber },
  dairy_cold: { background: colors.tagPurpleBg, icon: colors.tagPurple },
  frozen: { background: colors.tagCyanBg, icon: colors.tagCyan },
  sauces: { background: colors.tagPinkBg, icon: colors.tagPink },
  alcohol: { background: colors.tagIndigoBg, icon: colors.tagIndigo },
  packaging: { background: grayScale[200], icon: grayScale[700] },
};

const defaultCategoryTint = { background: grayScale[100], icon: grayScale[600] };

export const categoryTints: Record<string, { background: string; icon: string }> = knownCategoryTints;

export function getCategoryTint(category: ItemCategory): { background: string; icon: string } {
  return (knownCategoryTints as Record<string, { background: string; icon: string }>)[category] ?? defaultCategoryTint;
}

export const uiTints = {
  accent: { background: colors.primaryLight, icon: colors.primary },
  blue: { background: colors.tagBlueBg, icon: colors.tagBlue },
  red: { background: colors.tagRedBg, icon: colors.tagRed },
  green: { background: colors.tagGreenBg, icon: colors.tagGreen },
  amber: { background: colors.tagAmberBg, icon: colors.tagAmber },
  purple: { background: colors.tagPurpleBg, icon: colors.tagPurple },
  cyan: { background: colors.tagCyanBg, icon: colors.tagCyan },
  pink: { background: colors.tagPinkBg, icon: colors.tagPink },
  indigo: { background: colors.tagIndigoBg, icon: colors.tagIndigo },
  neutral: { background: grayScale[100], icon: grayScale[600] },
} as const;

export const statusStyles = {
  success: { text: colors.statusGreen, background: colors.statusGreenBg },
  warning: { text: colors.statusAmber, background: colors.statusAmberBg },
  danger: { text: colors.statusRed, background: colors.statusRedBg },
  info: { text: colors.tagBlue, background: colors.tagBlueBg },
  draft: { text: colors.textSecondary, background: colors.glassCircle },
} as const;

export const tabBarHeight = Platform.OS === 'ios' ? 84 : 76;

/* ─── Derived aliases (previously in constants/theme.ts) ──────────── */

export const borderRadius = {
  sm: 4,
  md: radii.stepper,
  lg: radii.button,
  xl: radii.card,
  full: radii.circle,
} as const;

export const fontSize = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
} as const;

export const fontWeight = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export const shadow = {
  sm: {
    shadowColor: colors.background,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  md: {
    shadowColor: colors.background,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  lg: {
    shadowColor: colors.background,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
} as const;

export const categoryColors: Record<string, string> = {
  fish: categoryTints.fish.icon,
  protein: categoryTints.protein.icon,
  produce: categoryTints.produce.icon,
  dry: categoryTints.dry.icon,
  dairy_cold: categoryTints.dairy_cold.icon,
  frozen: categoryTints.frozen.icon,
  sauces: categoryTints.sauces.icon,
  packaging: categoryTints.packaging.icon,
  alcohol: categoryTints.alcohol.icon,
} as const;

export const statusColors: Record<string, { bg: string; text: string }> = {
  draft: { bg: colors.glassCircle, text: colors.textSecondary },
  submitted: { bg: colors.statusAmberBg, text: colors.statusAmber },
  processing: { bg: colors.tagBlueBg, text: colors.tagBlue },
  fulfilled: { bg: colors.statusGreenBg, text: colors.statusGreen },
  cancel_requested: { bg: colors.statusRedBg, text: colors.statusRed },
  cancelled: { bg: colors.statusRedBg, text: colors.statusRed },
} as const;

/* ─── Glass design-system aliases (previously in design/tokens.ts) ── */

export const glassColors = {
  background: colors.background,
  textPrimary: colors.textPrimary,
  textSecondary: colors.textSecondary,
  textMuted: colors.textSecondary,
  textTertiary: colors.textMuted,
  textOnPrimary: colors.textOnPrimary,
  accent: colors.primary,
  accentStrong: colors.primary,
  accentSoft: colors.primaryLight,
  accentBorder: 'rgba(232, 80, 58, 0.18)',
  cardBorder: colors.glassBorder,
  controlBorder: colors.glassBorder,
  subtleFill: colors.glass,
  mediumFill: colors.glassCircle,
  strongFill: colors.glassStrong,
  tabBarFill: colors.tabBarBg,
  iosFallback: colors.glass,
  androidFallbackSubtle: colors.glass,
  androidFallbackMedium: colors.glassCircle,
  androidFallbackStrong: colors.glassStrong,
  divider: colors.divider,
  successText: '#2E7D32',
  successSoft: 'rgba(46, 125, 50, 0.12)',
  warningText: colors.statusAmber,
  warningSoft: colors.statusAmberBg,
  dangerText: colors.statusRed,
  dangerSoft: colors.statusRedBg,
  infoText: colors.tagBlue,
  infoSoft: colors.tagBlueBg,
} as const;

export const glassTypography = typography;
export const glassSpacing = {
  screen: spacing.screen,
  card: spacing.card,
  row: spacing.row,
  gap: spacing.gap,
  sectionGap: spacing.sectionGap,
  tabBarHorizontal: spacing.tabBarHorizontal,
  tabBarTop: spacing.tabBarTop,
  tabBarBottom: spacing.tabBarBottom,
} as const;

export const glassRadii = {
  surface: radii.card,
  search: radii.card,
  button: radii.button,
  submitButton: radii.submitButton,
  pill: radii.pill,
  tabPill: radii.pill,
  iconTile: radii.iconTile,
  tag: radii.tag,
  stepper: radii.stepper,
  round: radii.circle,
} as const;

export const glassHairlineWidth = hairline;

export const glassSurfacePresets = {
  subtle: {
    overlayColor: colors.glass,
    blurIntensity: 0,
    fallbackColor: colors.glass,
  },
  medium: {
    overlayColor: colors.glassCircle,
    blurIntensity: 0,
    fallbackColor: colors.glassCircle,
  },
  strong: {
    overlayColor: colors.glassStrong,
    blurIntensity: 0,
    fallbackColor: colors.glassStrong,
  },
} as const;

export const categoryGlassTints = categoryTints;

export const glassStatusStyles = {
  success: statusStyles.success,
  warning: statusStyles.warning,
  danger: statusStyles.danger,
  info: statusStyles.info,
} as const;

export const glassTabBarHeight = tabBarHeight;
