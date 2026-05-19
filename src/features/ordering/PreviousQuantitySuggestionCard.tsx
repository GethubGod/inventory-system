import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { triggerSelectionHaptic } from '@/lib/haptics';
import type { PreviousQuantitySuggestion } from './quickOrderHistorySuggestions';
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

/**
 * "LAST SUNDAY / 2 cases / [Use this]" — the prior-order shortcut card.
 *
 * White rounded card with:
 * - Left: uppercase gray day label + bold quantity text
 * - Right: red rounded "Use this" button with white text
 *
 * All styles are inline to avoid NativeWind / StyleSheet.create conflicts.
 */
export function PreviousQuantitySuggestionCard({ suggestion, onUse, disabled = false }: PreviousQuantitySuggestionCardProps) {
  const ds = useScaledStyles();
  const heading = formatSuggestionHeading(suggestion);
  const value = formatSuggestionValue(suggestion);

  const cardRadius = Math.max(ds.radius(22), 20);

  return (
    <View
      style={{
        width: '100%',
        alignSelf: 'stretch',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#FFFFFF',
        borderRadius: cardRadius,
        minHeight: 92,
        paddingVertical: 18,
        paddingLeft: 22,
        paddingRight: 20,
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 6,
        elevation: 2,
      }}
    >
      {/* Left: day label + quantity */}
      <View style={{ flex: 1, minWidth: 0, marginRight: 16 }}>
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          style={{
            fontSize: 13,
            fontWeight: '700',
            color: '#77777E',
            letterSpacing: 1.6,
            textTransform: 'uppercase',
          }}
        >
          {heading}
        </Text>
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          style={{
            fontSize: 24,
            fontWeight: '800',
            color: '#1C1C1E',
            marginTop: 6,
            letterSpacing: 0,
          }}
        >
          {value}
        </Text>
      </View>

      {/* Right: "Use this" button */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Use ${value}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => {
          void triggerSelectionHaptic();
          onUse();
        }}
        hitSlop={8}
        style={{
          backgroundColor: '#EF4B3D',
          borderRadius: 999,
          paddingHorizontal: 24,
          paddingVertical: 14,
          minWidth: 116,
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: 'center',
          flexShrink: 0,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <Text
          allowFontScaling={false}
          style={{
            fontSize: 17,
            fontWeight: '800',
            color: '#FFFFFF',
            letterSpacing: 0,
          }}
        >
          Use this
        </Text>
      </Pressable>
    </View>
  );
}
