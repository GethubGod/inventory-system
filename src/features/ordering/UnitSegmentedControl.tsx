import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { triggerSelectionHaptic } from '@/lib/haptics';
import { colors, glassColors, glassHairlineWidth } from '@/theme/design';
import type { QuantityUnitOption } from './quickOrderQuantityFlow';

type UnitSegmentedControlProps = {
  options: QuantityUnitOption[];
  /** Currently-selected option `value`, or null when nothing is picked yet. */
  value: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
};

/**
 * Segmented control for the units valid for an item (1–4 segments). Wraps to a
 * second line rather than overflowing on the narrowest phones. The shared
 * {@link import('@/components/ui').UnitTypeSegmentedControl} is hard-wired to
 * exactly two pack/base segments, so the Quick Order quantity sheet uses this
 * feature-local N-segment variant instead.
 */
export function UnitSegmentedControl({ options, value, onChange, disabled = false }: UnitSegmentedControlProps) {
  const ds = useScaledStyles();

  return (
    <View style={[styles.row, { gap: ds.spacing(8) }]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={`Use unit ${option.label}`}
            disabled={disabled}
            onPress={() => {
              void triggerSelectionHaptic();
              onChange(option.value);
            }}
            style={({ pressed }) => [
              styles.segment,
              {
                borderRadius: ds.radius(999),
                paddingHorizontal: ds.spacing(14),
                paddingVertical: ds.spacing(11),
                backgroundColor: selected ? colors.primary : colors.white,
                borderColor: selected ? colors.primary : glassColors.cardBorder,
                opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.segmentText,
                { fontSize: ds.fontSize(14), color: selected ? colors.textOnPrimary : colors.textPrimary },
              ]}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  segment: {
    flex: 1,
    minWidth: 0,
    borderWidth: glassHairlineWidth,
    alignItems: 'center',
  },
  segmentText: {
    fontWeight: '800',
    letterSpacing: 0,
  },
});
