import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { triggerSelectionHaptic } from '@/lib/haptics';
import { colors, glassColors, glassHairlineWidth } from '@/theme/design';

type QuantityStepperProps = {
  value: number;
  /** Unit label shown beneath the big number (e.g. "cases", "lb"). */
  unitLabel: string;
  onChange: (next: number) => void;
  /** Smallest value the stepper will go down to. Defaults to 0. */
  min?: number;
  disabled?: boolean;
};

const QUICK_INCREMENTS = [1, 5, 10] as const;

/** Formats a stepper value, trimming a trailing ".0" / float noise. */
function formatStepperValue(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

/**
 * The large quantity picker used inside {@link QuickOrderQuantitySheet}: a big
 * centered number with the unit beneath it, round −/+ buttons on either side, a
 * row of +1/+5/+10 shortcuts, and a "Type" toggle that swaps the number for a
 * numeric text field for exact entry.
 */
export function QuantityStepper({ value, unitLabel, onChange, min = 0, disabled = false }: QuantityStepperProps) {
  const ds = useScaledStyles();
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const inputRef = useRef<TextInput | null>(null);

  useEffect(() => {
    if (typing) {
      setText(value > 0 ? formatStepperValue(value) : '');
      const handle = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(handle);
    }
    return undefined;
  }, [typing, value]);

  const bump = useCallback(
    (delta: number) => {
      if (disabled) return;
      void triggerSelectionHaptic();
      const next = Math.max(min, Math.round((value + delta) * 100) / 100);
      onChange(next);
    },
    [disabled, min, onChange, value],
  );

  const commitTyped = useCallback(() => {
    const parsed = Number(text);
    if (Number.isFinite(parsed) && parsed >= 0) {
      onChange(Math.max(min, Math.round(parsed * 100) / 100));
    }
    setTyping(false);
  }, [min, onChange, text]);

  const canDecrement = !disabled && value > min;

  return (
    <View
      style={[
        styles.card,
        { borderRadius: ds.radius(20), padding: ds.spacing(16), gap: ds.spacing(14) },
      ]}
    >
      <View style={styles.valueRow}>
        <StepperRoundButton
          icon="remove"
          accessibilityLabel="Decrease quantity"
          disabled={!canDecrement}
          onPress={() => bump(-1)}
          size={ds.spacing(40)}
          radius={ds.radius(20)}
          iconSize={ds.icon(20)}
        />

        <View style={styles.valueColumn}>
          {typing ? (
            <TextInput
              ref={inputRef}
              value={text}
              onChangeText={(next) => setText(next.replace(/[^0-9.]/g, ''))}
              onBlur={commitTyped}
              onSubmitEditing={commitTyped}
              keyboardType="decimal-pad"
              returnKeyType="done"
              placeholder="0"
              placeholderTextColor={colors.textMuted}
              style={[styles.valueInput, { fontSize: ds.fontSize(34), minWidth: ds.spacing(80) }]}
            />
          ) : (
            <Text style={[styles.valueText, { fontSize: ds.fontSize(34) }]} numberOfLines={1}>
              {formatStepperValue(value)}
            </Text>
          )}
          <Text style={[styles.unitText, { fontSize: ds.fontSize(13) }]} numberOfLines={1}>
            {unitLabel || ' '}
          </Text>
        </View>

        <StepperRoundButton
          icon="add"
          accessibilityLabel="Increase quantity"
          disabled={disabled}
          onPress={() => bump(1)}
          size={ds.spacing(40)}
          radius={ds.radius(20)}
          iconSize={ds.icon(20)}
          accent
        />
      </View>

      <View style={[styles.chipRow, { gap: ds.spacing(8) }]}>
        {QUICK_INCREMENTS.map((amount) => (
          <Pressable
            key={amount}
            accessibilityRole="button"
            accessibilityLabel={`Add ${amount}`}
            disabled={disabled}
            onPress={() => bump(amount)}
            style={({ pressed }) => [
              styles.chip,
              {
                borderRadius: ds.radius(999),
                paddingHorizontal: ds.spacing(14),
                paddingVertical: ds.spacing(8),
                opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[styles.chipText, { fontSize: ds.fontSize(13) }]}>{`+${amount}`}</Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: typing }}
          accessibilityLabel="Type an exact quantity"
          disabled={disabled}
          onPress={() => {
            void triggerSelectionHaptic();
            setTyping((current) => {
              if (current) {
                commitTyped();
                return false;
              }
              return true;
            });
          }}
          style={({ pressed }) => [
            styles.chip,
            {
              borderRadius: ds.radius(999),
              paddingHorizontal: ds.spacing(14),
              paddingVertical: ds.spacing(8),
              backgroundColor: typing ? colors.primaryLight : colors.glassCircle,
              opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
            },
          ]}
        >
          <Text
            style={[
              styles.chipText,
              { fontSize: ds.fontSize(13), color: typing ? colors.primary : colors.textSecondary },
            ]}
          >
            Type
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

type StepperRoundButtonProps = {
  icon: keyof typeof Ionicons.glyphMap;
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
  size: number;
  radius: number;
  iconSize: number;
  accent?: boolean;
};

function StepperRoundButton({ icon, accessibilityLabel, disabled, onPress, size, radius, iconSize, accent = false }: StepperRoundButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.roundButton,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: accent ? colors.primaryLight : colors.glassCircle,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={iconSize} color={colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  valueColumn: {
    flex: 1,
    alignItems: 'center',
  },
  valueText: {
    color: colors.textPrimary,
    fontWeight: '800',
    letterSpacing: 0,
  },
  valueInput: {
    color: colors.textPrimary,
    fontWeight: '800',
    letterSpacing: 0,
    textAlign: 'center',
    padding: 0,
  },
  unitText: {
    marginTop: 2,
    color: colors.textSecondary,
    fontWeight: '700',
    letterSpacing: 0,
  },
  chipRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  chip: {
    backgroundColor: colors.glassCircle,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
  },
  chipText: {
    color: colors.textSecondary,
    fontWeight: '800',
    letterSpacing: 0,
  },
  roundButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
  },
});
