import {
  categoryTints,
  colors as designColors,
  grayScale,
  primaryScale,
  radii,
  spacing as designSpacing,
  uiTints,
} from '@/theme/design';

export const colors = {
  primary: primaryScale,
  gray: grayScale,
  white: designColors.white,
  text: designColors.text,
  textSecondary: designColors.textSecondary,
  textMuted: designColors.textMuted,
  success: designColors.statusGreen,
  successBg: designColors.statusGreenBg,
  warning: designColors.statusAmber,
  warningBg: designColors.statusAmberBg,
  error: designColors.statusRed,
  errorBg: designColors.statusRedBg,
  info: designColors.tagBlue,
  infoBg: designColors.tagBlueBg,
  overlay: designColors.overlay,
  scrim: designColors.scrim,
  scrimStrong: designColors.scrimStrong,
  divider: designColors.divider,
  background: designColors.background,
  card: designColors.glass,
  glassStrong: designColors.glassStrong,
  blue: uiTints.blue.icon,
  blueBg: uiTints.blue.background,
  green: uiTints.green.icon,
  greenBg: uiTints.green.background,
  amber: uiTints.amber.icon,
  amberBg: uiTints.amber.background,
  purple: uiTints.purple.icon,
  purpleBg: uiTints.purple.background,
  indigo: uiTints.indigo.icon,
  indigoBg: uiTints.indigo.background,
  red: uiTints.red.icon,
  redBg: uiTints.red.background,
  neutral: uiTints.neutral.icon,
  neutralBg: uiTints.neutral.background,
} as const;

export const spacing = {
  xs: designSpacing.xs,
  sm: designSpacing.sm,
  md: designSpacing.md,
  lg: designSpacing.lg,
  xl: designSpacing.xl,
  '2xl': designSpacing['2xl'],
  '3xl': designSpacing['3xl'],
} as const;

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
    shadowColor: designColors.background,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  md: {
    shadowColor: designColors.background,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  lg: {
    shadowColor: designColors.background,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
} as const;

// Category colors for inventory items
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

// Status colors for orders
export const statusColors: Record<string, { bg: string; text: string }> = {
  draft: { bg: designColors.glassCircle, text: designColors.textSecondary },
  submitted: { bg: designColors.statusAmberBg, text: designColors.statusAmber },
  processing: { bg: designColors.tagBlueBg, text: designColors.tagBlue },
  fulfilled: { bg: designColors.statusGreenBg, text: designColors.statusGreen },
  cancel_requested: { bg: designColors.statusRedBg, text: designColors.statusRed },
  cancelled: { bg: designColors.statusRedBg, text: designColors.statusRed },
} as const;
