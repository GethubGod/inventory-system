import React, { memo, useCallback } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { glassColors, glassRadii } from '@/theme/design';
import { segmentedControlColors } from '@/theme/segmentedControls';
import type { UnitType } from '@/types';

export interface UnitTypeSegmentedControlProps {
  /** Current selected unit type. */
  value: UnitType;
  /** Display label for the pack segment (e.g. "case", "box"). */
  packLabel: string;
  /** Display label for the base segment (e.g. "lb", "ea", "gal"). */
  baseLabel: string;
  /** When false, the pack segment is rendered disabled and uninteractive. */
  packEnabled?: boolean;
  /** When false, the base segment is rendered disabled and uninteractive. */
  baseEnabled?: boolean;
  /** Fired only when the user taps the segment that isn't already active. */
  onChange: (next: UnitType) => void;
  /** Optional accessible label for the whole control (defaults to "Unit type"). */
  accessibilityLabel?: string;
}

/**
 * UnitTypeSegmentedControl
 *
 * Pack ↔ Base segmented selector that mirrors the visual primitive used in
 * the Cart and Quick-Order screens (red active fill from
 * `segmentedControlColors.activeBackground`, neutral inactive fill, 12px
 * pill radius). Extracted into `components/ui/` so the next time we need
 * the same toggle in another flow we don't duplicate the styling.
 *
 * The component is purely presentational — it doesn't touch the cart or
 * any store. Pass the current unit, capability flags, and an `onChange`
 * callback; the parent owns persistence.
 */
export const UnitTypeSegmentedControl = memo(
  function UnitTypeSegmentedControl({
    value,
    packLabel,
    baseLabel,
    packEnabled = true,
    baseEnabled = true,
    onChange,
    accessibilityLabel = 'Unit type',
  }: UnitTypeSegmentedControlProps) {
    const ds = useScaledStyles();

    const handlePackPress = useCallback(() => {
      if (!packEnabled || value === 'pack') return;
      onChange('pack');
    }, [onChange, packEnabled, value]);

    const handleBasePress = useCallback(() => {
      if (!baseEnabled || value === 'base') return;
      onChange('base');
    }, [baseEnabled, onChange, value]);

    const buttonHeight = Math.max(40, ds.buttonH - ds.spacing(8));

    return (
      <View
        accessibilityRole="tablist"
        accessibilityLabel={accessibilityLabel}
        style={{
          flexDirection: 'row',
          backgroundColor: segmentedControlColors.inactiveBackground,
          borderRadius: glassRadii.surface,
          overflow: 'hidden',
          alignSelf: 'flex-start',
        }}
      >
        <Segment
          label={packLabel}
          isActive={value === 'pack'}
          isDisabled={!packEnabled}
          onPress={handlePackPress}
          height={buttonHeight}
          horizontalPadding={ds.spacing(16)}
          fontSize={ds.fontSize(14)}
        />
        <Segment
          label={baseLabel}
          isActive={value === 'base'}
          isDisabled={!baseEnabled}
          onPress={handleBasePress}
          height={buttonHeight}
          horizontalPadding={ds.spacing(16)}
          fontSize={ds.fontSize(14)}
        />
      </View>
    );
  },
);

interface SegmentProps {
  label: string;
  isActive: boolean;
  isDisabled: boolean;
  onPress: () => void;
  height: number;
  horizontalPadding: number;
  fontSize: number;
}

const Segment = memo(function Segment({
  label,
  isActive,
  isDisabled,
  onPress,
  height,
  horizontalPadding,
  fontSize,
}: SegmentProps) {
  // Resolve background + text in a single place so the active/disabled
  // matrix can be reasoned about easily.
  const background = isActive
    ? segmentedControlColors.activeBackground
    : 'transparent';
  const textColor = isActive
    ? segmentedControlColors.activeText
    : isDisabled
      ? glassColors.textMuted
      : segmentedControlColors.inactiveText;

  return (
    <TouchableOpacity
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: isActive, disabled: isDisabled }}
      onPress={onPress}
      activeOpacity={isDisabled ? 1 : 0.75}
      disabled={isDisabled}
      style={{
        height,
        paddingHorizontal: horizontalPadding,
        backgroundColor: background,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: isDisabled ? 0.55 : 1,
      }}
    >
      <Text style={{ fontSize, fontWeight: '600', color: textColor }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
});
