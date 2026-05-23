import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { triggerSelectionHaptic } from '@/lib/haptics';
import { colors, grayScale, quickOrderAccent } from '@/theme/design';

export type ComposerSuggestionPill = {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Render as a filled accent (red) pill with white icon/label. */
  accent?: boolean;
};

type ComposerSuggestionPillsProps = {
  pills: ComposerSuggestionPill[];
  onPress: (id: string) => void;
  disabled?: boolean;
};

/**
 * Quick-action pills shown above the composer input (Usual / Recent / Last
 * week). Each is a self-contained rounded chip — icon beside its label — so the
 * row reads as a set of tappable buttons rather than plain text.
 *
 * The pill shape (row direction, padding, border, shadow) lives in a
 * `StyleSheet` base that the style function spreads into an array. This matters:
 * NativeWind's `cssInterop` jsx runtime (jsxImportSource) drops a `style`
 * function that returns a *bare object*, leaving the Pressable at React Native's
 * default `flexDirection: 'column'` — which silently turns each pill into a
 * stacked icon-over-label with no background. Returning an array with a
 * StyleSheet ref (as every other Pressable in the composer does) is applied
 * correctly. Kept free of animation / keyboard deps so it renders cleanly in
 * isolation (and in tests).
 */
function ComposerSuggestionPillsImpl({
  pills,
  onPress,
  disabled = false,
}: ComposerSuggestionPillsProps) {
  const ds = useScaledStyles();

  if (pills.length === 0) return null;

  const iconSize = Math.round(ds.fontSize(16));

  return (
    <View style={[styles.row, { gap: ds.spacing(10), paddingBottom: ds.spacing(10) }]}>
      {pills.map((pill) => {
        const foreground = pill.accent ? colors.textOnPrimary : colors.textPrimary;
        return (
          <Pressable
            key={pill.id}
            onPress={() => {
              if (disabled) return;
              void triggerSelectionHaptic();
              onPress(pill.id);
            }}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={pill.label}
            accessibilityState={{ disabled }}
            style={[
              styles.pill,
              {
                backgroundColor: pill.accent ? quickOrderAccent : colors.white,
                borderColor: pill.accent ? quickOrderAccent : grayScale[200],
                borderRadius: ds.radius(22),
                paddingHorizontal: ds.spacing(16),
                paddingVertical: ds.spacing(10),
                opacity: disabled ? 0.5 : 1,
              },
            ]}
          >
            <Ionicons
              name={pill.icon}
              size={iconSize}
              color={foreground}
              style={{ marginRight: ds.spacing(7) }}
            />
            <Text numberOfLines={1} style={[styles.label, { color: foreground, fontSize: ds.fontSize(15) }]}>
              {pill.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    alignSelf: 'flex-start',
    borderWidth: 1,
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 3,
  },
  label: {
    fontWeight: '700',
    letterSpacing: 0,
  },
});

export const ComposerSuggestionPills = React.memo(ComposerSuggestionPillsImpl);
