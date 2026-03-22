import { grayScale } from '@/theme/design';
import { glassColors } from './tokens';

export const segmentedControlColors = {
  activeBackground: glassColors.accent,
  activeText: glassColors.textOnPrimary,
  inactiveBackground: grayScale[100],
  inactiveText: glassColors.textSecondary,
} as const;
