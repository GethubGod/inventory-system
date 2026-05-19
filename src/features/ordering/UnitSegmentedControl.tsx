import React from 'react';
import { Pressable, Text, View } from 'react-native';
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
 * Full-width segmented control for unit selection (pack / case / lb / piece).
 *
 * Renders as a single white rounded card with evenly-spaced segments inside.
 * The selected segment gets a red pill background with white text.
 * Unselected segments show dark text on the white background.
 * Unavailable units still take up space so the row never collapses.
 *
 * Layout: all segments use `flex: 1` inside a `flexDirection: 'row'` container
 * to guarantee equal widths. `overflow: 'hidden'` on segments + `numberOfLines={1}`
 * on text prevents any overlap between adjacent labels like "lb" and "piece".
 */
export function UnitSegmentedControl({ options, value, onChange, disabled = false }: UnitSegmentedControlProps) {
  return (
    <View
      style={{
        width: '100%',
        alignSelf: 'stretch',
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        borderRadius: 999,
        padding: 6,
        minHeight: 62,
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
        elevation: 3,
        overflow: 'hidden',
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const unavailable = option.available === false;
        const segmentDisabled = disabled || unavailable;
        const selectedAndAvailable = selected && !unavailable;

        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled: segmentDisabled }}
            accessibilityLabel={
              unavailable
                ? `${option.label} unavailable`
                : `Use unit ${option.label}`
            }
            disabled={segmentDisabled}
            onPress={() => {
              if (segmentDisabled) return;
              void triggerSelectionHaptic();
              onChange(option.value);
            }}
            style={{
              flex: 1,
              minWidth: 0,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 999,
              minHeight: 50,
              paddingVertical: 12,
              paddingHorizontal: 2,
              overflow: 'hidden',
              backgroundColor: selectedAndAvailable
                ? '#EF4B3D'
                : unavailable
                  ? '#F6F3ED'
                  : 'transparent',
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <Text
              numberOfLines={1}
              allowFontScaling={false}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              style={{
                fontSize: 17,
                fontWeight: selectedAndAvailable ? '800' : '600',
                color: selectedAndAvailable
                  ? '#FFFFFF'
                  : unavailable
                    ? '#C7C1B8'
                    : '#5D5D63',
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
