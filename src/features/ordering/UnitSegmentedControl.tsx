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
    <View
      style={[
        styles.card,
        {
          borderRadius: ds.radius(20),
          padding: ds.spacing(6),
          gap: ds.spacing(6),
        },
      ]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const unavailable = option.available === false;
        const segmentDisabled = disabled || unavailable;
        const background = selected
          ? '#E8503A'
          : 'transparent';
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
                opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.pillText,
                {
                  fontSize: ds.fontSize(16),
                  color: textColor,
                  fontWeight: selected ? '800' : '700',
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
  card: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  pill: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: {
    letterSpacing: 0,
    textAlign: 'center',
  },
});
