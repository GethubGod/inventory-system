import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { triggerSelectionHaptic } from '@/lib/haptics';
import { colors, glassColors, glassHairlineWidth } from '@/theme/design';
import { QUICK_ORDER_SHORTCUTS } from './quickOrderShortcuts';

type QuickOrderShortcutChipsProps = {
  onSelect: (intentText: string) => void;
  disabled?: boolean;
};

/**
 * Row of one-tap order shortcut cards shown just above the composer on the
 * empty Quick Order screen. Each card submits the same text the user could
 * type ("reorder recent", "last week", …) so it flows through the normal
 * parser path.
 */
export function QuickOrderShortcutChips({ onSelect, disabled = false }: QuickOrderShortcutChipsProps) {
  const ds = useScaledStyles();

  return (
    <View style={[styles.row, { gap: ds.spacing(8) }]}>
      {QUICK_ORDER_SHORTCUTS.map((shortcut) => (
        <ShortcutCard
          key={shortcut.intent}
          icon={shortcut.icon}
          label={shortcut.label}
          disabled={disabled}
          onPress={() => {
            void triggerSelectionHaptic();
            onSelect(shortcut.intent);
          }}
        />
      ))}
    </View>
  );
}

type ShortcutCardProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  disabled: boolean;
  onPress: () => void;
};

function ShortcutCard({ icon, label, disabled, onPress }: ShortcutCardProps) {
  const ds = useScaledStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          borderRadius: ds.radius(14),
          paddingHorizontal: ds.spacing(10),
          paddingVertical: ds.spacing(10),
          gap: ds.spacing(6),
          opacity: disabled ? 0.5 : pressed ? 0.78 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={ds.icon(16)} color={colors.primary} />
      <Text
        style={[styles.label, { fontSize: ds.fontSize(13) }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  card: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 1,
  },
  label: {
    color: colors.textPrimary,
    fontWeight: '700',
    letterSpacing: 0,
  },
});
