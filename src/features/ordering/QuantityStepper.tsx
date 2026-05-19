import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { triggerSelectionHaptic } from '@/lib/haptics';

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

// Hardcoded so the contrast can never collapse against the cream sheet bg
// (the design-system grayScale[100] is too close to background for the chips
// to read as filled pills).
const PILL_BG = '#F0ECE3';
const PILL_BG_PRESSED = '#E2DDD2';
const PILL_BORDER = '#E2DDD2';
const PRIMARY = '#E8503A';
const PRIMARY_TINT = '#FBE5E1';
const PRIMARY_TINT_PRESSED = '#F5D0C8';
const ROUND_BG = '#F0ECE3';
const ROUND_BG_PRESSED = '#E2DDD2';
const TEXT_PRIMARY = '#1C1C1E';
const TEXT_SECONDARY = '#8E8E93';
const TEXT_MUTED = '#AEAEB2';

function formatStepperValue(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

/**
 * Apple-style quantity picker that matches the mockup: rounded white card with
 * a big bold number flanked by circular −/+ buttons (gray / pink), and a row
 * of pill chips for +1/+5/+10 + a "Type" toggle that swaps the number for a
 * numeric input.
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
  const roundSize = ds.spacing(76);

  return (
    <View
      style={[
        styles.card,
        {
          borderRadius: ds.radius(24),
          paddingVertical: ds.spacing(22),
          paddingHorizontal: ds.spacing(22),
        },
      ]}
    >
      <View style={[styles.valueRow, { marginBottom: ds.spacing(18) }]}>
        <RoundButton
          icon="remove"
          accessibilityLabel="Decrease quantity"
          disabled={!canDecrement}
          onPress={() => bump(-1)}
          size={roundSize}
          iconSize={ds.icon(28)}
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
              placeholderTextColor={TEXT_MUTED}
              style={[styles.valueInput, { fontSize: ds.fontSize(56), minWidth: ds.spacing(80) }]}
            />
          ) : (
            <Text style={[styles.valueText, { fontSize: ds.fontSize(56) }]} numberOfLines={1}>
              {formatStepperValue(value)}
            </Text>
          )}
          <Text style={[styles.unitText, { fontSize: ds.fontSize(15), marginTop: ds.spacing(2) }]} numberOfLines={1}>
            {unitLabel || ' '}
          </Text>
        </View>

        <RoundButton
          icon="add"
          accessibilityLabel="Increase quantity"
          disabled={disabled}
          onPress={() => bump(1)}
          size={roundSize}
          iconSize={ds.icon(28)}
          accent
        />
      </View>

      <View style={[styles.chipRow, { gap: ds.spacing(10) }]}>
        {QUICK_INCREMENTS.map((amount) => (
          <PillChip
            key={amount}
            label={`+${amount}`}
            disabled={disabled}
            onPress={() => bump(amount)}
            ds={ds}
          />
        ))}
        <PillChip
          label="Type"
          disabled={disabled}
          selected={typing}
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
          ds={ds}
        />
      </View>
    </View>
  );
}

type PillChipProps = {
  label: string;
  disabled: boolean;
  onPress: () => void;
  selected?: boolean;
  ds: ReturnType<typeof useScaledStyles>;
};

function PillChip({ label, disabled, onPress, selected = false, ds }: PillChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 0,
        borderRadius: 999,
        paddingVertical: ds.spacing(14),
        paddingHorizontal: ds.spacing(10),
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: selected
          ? pressed
            ? PRIMARY_TINT_PRESSED
            : PRIMARY_TINT
          : pressed
            ? PILL_BG_PRESSED
            : PILL_BG,
        borderWidth: 1,
        borderColor: selected ? PRIMARY_TINT : PILL_BORDER,
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <Text
        style={{
          fontSize: ds.fontSize(16),
          fontWeight: '800',
          color: selected ? PRIMARY : TEXT_PRIMARY,
          letterSpacing: 0,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

type RoundButtonProps = {
  icon: keyof typeof Ionicons.glyphMap;
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
  size: number;
  iconSize: number;
  accent?: boolean;
};

function RoundButton({ icon, accessibilityLabel, disabled, onPress, size, iconSize, accent = false }: RoundButtonProps) {
  const bg = accent ? PRIMARY_TINT : PILL_BG;
  const iconColor = accent ? PRIMARY : TEXT_PRIMARY;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: pressed ? (accent ? '#F5D0C8' : PILL_BG_PRESSED) : bg,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.35 : 1,
      })}
    >
      <Ionicons name={icon} size={iconSize} color={iconColor} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  valueColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueText: {
    color: TEXT_PRIMARY,
    fontWeight: '800',
    letterSpacing: -1.5,
  },
  valueInput: {
    color: TEXT_PRIMARY,
    fontWeight: '800',
    letterSpacing: -1.5,
    textAlign: 'center',
    padding: 0,
  },
  unitText: {
    color: TEXT_SECONDARY,
    fontWeight: '500',
    letterSpacing: 0,
  },
  chipRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
