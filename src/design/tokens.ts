import {
  categoryTints,
  colors,
  hairline,
  radii,
  spacing,
  statusStyles,
  tabBarHeight,
  typography,
} from '@/theme/design';

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
  successText: colors.statusGreen,
  successSoft: colors.statusGreenBg,
  warningText: colors.statusAmber,
  warningSoft: colors.statusAmberBg,
  dangerText: colors.statusRed,
  dangerSoft: colors.statusRedBg,
  infoText: colors.tagBlue,
  infoSoft: colors.tagBlueBg,
} as const;

export const glassTypography = {
  screenTitle: typography.screenTitle,
  cardTitle: typography.cardTitle,
  body: typography.body,
  caption: typography.caption,
  sectionLabel: typography.sectionLabel,
  button: typography.button,
  tabLabel: typography.tabLabel,
} as const;

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
