import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { triggerSelectionHaptic } from '@/lib/haptics';
import type { QuantityUnitOption } from './quickOrderQuantityFlow';

type UnitSegmentedControlProps = {
  options: QuantityUnitOption[];
  /** Currently-selected option `value`, or null when nothing is picked yet. */
  value: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
};

/**
 * The four unit pills under the stepper. Each option renders as a SEPARATE
 * rounded pill so the layout matches the mockup: white-filled pills with a
 * subtle border for unselected/available units, a red filled pill with white
 * text for the selected unit, and a dimmed transparent pill for unavailable
 * units (kept in place so the row never reflows).
 */
export function UnitSegmentedControl({ options, value, onChange, disabled = false }: UnitSegmentedControlProps) {
  const ds = useScaledStyles();

  return (
    <View style={[styles.row, { gap: ds.spacing(8) }]}>
      {options.map((option) => {
        const selected = option.value === value;
        const unavailable = option.available === false;
        const segmentDisabled = disabled || unavailable;
        const background = selected
          ? '#E8503A'
          : unavailable
            ? 'transparent'
            : '#FFFFFF';
        const borderColor = selected
          ? '#E8503A'
          : unavailable
            ? '#E5E5EA'
            : '#E5E5EA';
        const textColor = selected
          ? '#FFFFFF'
          : unavailable
            ? '#C7C7CC'
            : '#1C1C1E';
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled: segmentDisabled }}
            accessibilityLabel={`Use unit ${option.label}`}
            disabled={segmentDisabled}
            onPress={() => {
              if (segmentDisabled) return;
              void triggerSelectionHaptic();
              onChange(option.value);
            }}
            style={({ pressed }) => [
              styles.pill,
              {
                borderRadius: 999,
                paddingVertical: ds.spacing(13),
                paddingHorizontal: ds.spacing(8),
                backgroundColor: background,
                borderColor,
                opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.pillText,
                {
                  fontSize: ds.fontSize(15),
                  color: textColor,
                  fontWeight: selected ? '800' : '600',
                },
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
    alignItems: 'stretch',
  },
  pill: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  pillText: {
    letterSpacing: 0,
    textAlign: 'center',
  },
});
