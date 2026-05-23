import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { triggerSelectionHaptic } from '@/lib/haptics';
import { colors, quickOrderAccent, quickOrderAccentPale } from '@/theme/design';

type QuantityStepperProps = {
  value: number;
  /** Pluralized unit label shown beneath the big number (e.g. "cases", "lb"). */
  unitLabel: string;
  onChange: (next: number) => void;
  /** Smallest value the stepper will go down to. Defaults to 0. */
  min?: number;
  disabled?: boolean;
};

const QUICK_INCREMENTS = [1, 5, 10] as const;
const NEUTRAL_PILL = '#F1EADF';

function formatStepperValue(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

/**
 * Apple-style quantity picker matching the mockup:
 *
 * - White rounded card
 * - Large circular minus button (beige bg, dark −)
 * - Very large bold centered quantity number
 * - Smaller gray unit label below the number
 * - Large circular plus button (pink bg, red +)
 * - Row of pill chips: +1 / +5 / +10 / Type
 *
 * All styles are inline to avoid NativeWind / StyleSheet.create conflicts.
 */
export function QuantityStepper({ value, unitLabel, onChange, min = 0, disabled = false }: QuantityStepperProps) {
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

  const roundSize = 58;
  const roundIconSize = 24;

  return (
    <View
      style={{
        width: '100%',
        alignSelf: 'stretch',
        backgroundColor: colors.white,
        borderRadius: 20,
        paddingVertical: 20,
        paddingHorizontal: 20,
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
        elevation: 3,
      }}
    >
      {/* Quantity value row: [−]  number  [+] */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 18,
        }}
      >
        {/* Minus button */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Decrease quantity"
          accessibilityState={{ disabled: !canDecrement }}
          disabled={!canDecrement}
          onPress={() => bump(-1)}
          hitSlop={12}
          style={{
            width: roundSize,
            height: roundSize,
            borderRadius: roundSize / 2,
            backgroundColor: NEUTRAL_PILL,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: !canDecrement ? 0.35 : 1,
          }}
        >
          <Ionicons name="remove" size={roundIconSize} color={colors.textPrimary} />
        </Pressable>

        {/* Center: number + unit label */}
        <View style={{ flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 }}>
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
              allowFontScaling={false}
              style={{
                fontSize: 44,
                fontWeight: '800',
                color: colors.textPrimary,
                letterSpacing: 0,
                textAlign: 'center',
                padding: 0,
                width: '100%',
                maxWidth: 130,
              }}
            />
          ) : (
            <Text
              numberOfLines={1}
              allowFontScaling={false}
              adjustsFontSizeToFit
              minimumFontScale={0.55}
              style={{
                fontSize: 44,
                fontWeight: '800',
                color: colors.textPrimary,
                letterSpacing: 0,
                maxWidth: 130,
              }}
            >
              {formatStepperValue(value)}
            </Text>
          )}
          <Text
            numberOfLines={1}
            allowFontScaling={false}
            style={{
              fontSize: 15,
              fontWeight: '500',
              color: colors.textSecondary,
              marginTop: 4,
              letterSpacing: 0,
            }}
          >
            {unitLabel || ' '}
          </Text>
        </View>

        {/* Plus button */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Increase quantity"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => bump(1)}
          hitSlop={12}
          style={{
            width: roundSize,
            height: roundSize,
            borderRadius: roundSize / 2,
            backgroundColor: quickOrderAccentPale,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: disabled ? 0.35 : 1,
          }}
        >
          <Ionicons name="add" size={roundIconSize} color={quickOrderAccent} />
        </Pressable>
      </View>

      {/* Quick increment pills: +1 / +5 / +10 / Type */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        {QUICK_INCREMENTS.map((amount) => (
          <Pressable
            key={amount}
            accessibilityRole="button"
            accessibilityLabel={`+${amount}`}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => bump(amount)}
            style={{
              flex: 1,
              minWidth: 0,
              borderRadius: 999,
              minHeight: 36,
              paddingVertical: 8,
              paddingHorizontal: 6,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: NEUTRAL_PILL,
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <Text
              allowFontScaling={false}
              style={{
                fontSize: 14,
                fontWeight: '800',
                color: '#5D5D63',
                letterSpacing: 0,
              }}
            >
              {`+${amount}`}
            </Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Type"
          accessibilityState={{ disabled, selected: typing }}
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
          style={{
            flex: 1,
            minWidth: 0,
            borderRadius: 999,
            minHeight: 36,
            paddingVertical: 8,
            paddingHorizontal: 6,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: typing ? quickOrderAccentPale : NEUTRAL_PILL,
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <Text
            allowFontScaling={false}
            style={{
              fontSize: 14,
              fontWeight: '800',
              color: typing ? quickOrderAccent : '#5D5D63',
              letterSpacing: 0,
            }}
          >
            Type
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
