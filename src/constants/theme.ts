/**
 * Re-exports from the canonical design file.
 * New code should import directly from '@/theme/design'.
 */
export {
  borderRadius,
  categoryColors,
  fontSize,
  fontWeight,
  primaryScale,
  grayScale,
  radii,
  shadow,
  statusColors,
  uiTints,
} from '@/theme/design';

import {
  colors as designColors,
  primaryScale,
  grayScale,
  uiTints,
  spacing as designSpacing,
} from '@/theme/design';

/** Convenience alias with flattened semantic names */
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
