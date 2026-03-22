import { grayScale, glassColors } from '@/theme/design';

export const segmentedControlColors = {
  activeBackground: glassColors.accent,
  activeText: glassColors.textOnPrimary,
  inactiveBackground: grayScale[100],
  inactiveText: glassColors.textSecondary,
} as const;
