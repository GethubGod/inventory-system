import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { triggerSelectionHaptic } from '@/lib/haptics';
import { colors, quickOrderAccent } from '@/theme/design';
import type { QuantityUnitOption } from './quickOrderQuantityFlow';

type UnitSegmentedControlProps = {
  options: QuantityUnitOption[];
  /** Currently-selected option `value`, or null when nothing is picked yet. */
  value: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
};

/**
 * Full-width segmented control for unit selection (pack / case / lb / piece).
 *
 * Only renders units that are actually selectable for the current item so the
 * row stays compact and every segment is tappable.
 */
export function UnitSegmentedControl({ options, value, onChange, disabled = false }: UnitSegmentedControlProps) {
  const availableOptions = useMemo(
    () => options.filter((option) => option.available !== false),
    [options],
  );

  if (availableOptions.length === 0) return null;

  return (
    <View
      style={{
        width: '100%',
        alignSelf: 'stretch',
        flexDirection: 'row',
        alignItems: 'stretch',
        backgroundColor: colors.white,
        borderRadius: 999,
        padding: 4,
        minHeight: 48,
        shadowColor: colors.textPrimary,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
        elevation: 3,
        overflow: 'hidden',
      }}
    >
      {availableOptions.map((option) => {
        const selected = option.value === value;

        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={`Use unit ${option.label}`}
            disabled={disabled}
            onPress={() => {
              if (disabled) return;
              void triggerSelectionHaptic();
              onChange(option.value);
            }}
            style={{
              flex: 1,
              minWidth: 0,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 999,
              minHeight: 40,
              paddingVertical: 8,
              paddingHorizontal: 2,
              overflow: 'hidden',
              backgroundColor: selected ? quickOrderAccent : 'transparent',
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <Text
              numberOfLines={1}
              allowFontScaling={false}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              style={{
                fontSize: 14,
                fontWeight: selected ? '800' : '600',
                color: selected ? colors.textOnPrimary : colors.textSecondary,
                textAlign: 'center',
                letterSpacing: 0,
                width: '100%',
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
