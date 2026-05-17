import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { triggerSelectionHaptic } from '@/lib/haptics';
import type { PreviousQuantitySuggestion } from './quickOrderHistorySuggestions';

const PRIMARY = '#E8503A';
const TEXT_PRIMARY = '#1C1C1E';
const TEXT_SECONDARY = '#8E8E93';
const WHITE = '#FFFFFF';
import { formatQuantityWithUnit } from './quickOrderQuantityFlow';

type PreviousQuantitySuggestionCardProps = {
  suggestion: PreviousQuantitySuggestion;
  /** Applies the suggested quantity + unit to the picker (does not commit the order). */
  onUse: () => void;
  disabled?: boolean;
};

function formatSuggestionValue(suggestion: PreviousQuantitySuggestion): string {
  return formatQuantityWithUnit(suggestion.quantity, suggestion.unit);
}

export function formatPreviousQuantitySuggestionSentence(suggestion: PreviousQuantitySuggestion): {
  prefix: string;
  value: string;
} {
  return {
    prefix: formatSuggestionHeading(suggestion),
    value: formatSuggestionValue(suggestion),
  };
}

function formatSuggestionHeading(suggestion: PreviousQuantitySuggestion): string {
  // Mockup uses caps ("LAST SUNDAY"), so we normalise the raw label here.
  return suggestion.label.replace(/\s+/g, ' ').trim().toUpperCase();
}

/** "LAST SUNDAY / 2 cases / [Use this]" — the prior-order shortcut in the quantity sheet. */
export function PreviousQuantitySuggestionCard({ suggestion, onUse, disabled = false }: PreviousQuantitySuggestionCardProps) {
  const ds = useScaledStyles();
  const heading = formatSuggestionHeading(suggestion);
  const value = formatSuggestionValue(suggestion);

  return (
    <View
      style={[
        styles.card,
        {
          borderRadius: ds.radius(20),
          paddingVertical: ds.spacing(14),
          paddingLeft: ds.spacing(18),
          paddingRight: ds.spacing(12),
          gap: ds.spacing(12),
        },
      ]}
    >
      <View style={styles.textColumn}>
        <Text style={[styles.heading, { fontSize: ds.fontSize(12), color: TEXT_SECONDARY }]} numberOfLines={1}>
          {heading}
        </Text>
        <Text style={[styles.value, { fontSize: ds.fontSize(18), marginTop: ds.spacing(2) }]} numberOfLines={1}>
          {value}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Use ${value}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => {
          void triggerSelectionHaptic();
          onUse();
        }}
        style={({ pressed }) => [
          styles.useButton,
          {
            borderRadius: ds.radius(999),
            paddingHorizontal: ds.spacing(20),
            paddingVertical: ds.spacing(11),
            opacity: disabled ? 0.6 : pressed ? 0.85 : 1,
          },
        ]}
      >
        <Text style={[styles.useButtonText, { fontSize: ds.fontSize(14) }]}>Use this</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: WHITE,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
  },
  heading: {
    color: TEXT_PRIMARY,
    letterSpacing: 0.6,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  value: {
    color: TEXT_PRIMARY,
    fontWeight: '800',
    letterSpacing: 0,
  },
  useButton: {
    backgroundColor: PRIMARY,
    flexShrink: 0,
    alignSelf: 'center',
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  useButtonText: {
    color: WHITE,
    fontWeight: '800',
    letterSpacing: 0,
  },
});
