import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
 * Horizontal scroll row of one-tap order shortcuts shown just above the
 * composer on the empty Quick Order screen. Each chip submits the same text the
 * user could type ("reorder recent", "last week", …) so it flows through the
 * normal parser path.
 */
export function QuickOrderShortcutChips({ onSelect, disabled = false }: QuickOrderShortcutChipsProps) {
  const ds = useScaledStyles();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.content, { gap: ds.spacing(10), paddingHorizontal: ds.spacing(4) }]}
    >
      {QUICK_ORDER_SHORTCUTS.map((shortcut) => (
        <ShortcutChip
          key={shortcut.intent}
          icon={shortcut.icon}
          label={shortcut.label}
          primary={shortcut.intent === 'get suggestions'}
          disabled={disabled}
          onPress={() => {
            void triggerSelectionHaptic();
            onSelect(shortcut.intent);
          }}
        />
      ))}
      <View style={{ width: ds.spacing(4) }} />
    </ScrollView>
  );
}

type ShortcutChipProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  primary: boolean;
  disabled: boolean;
  onPress: () => void;
};

function ShortcutChip({ icon, label, primary, disabled, onPress }: ShortcutChipProps) {
  const ds = useScaledStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        primary ? styles.primaryChip : styles.secondaryChip,
        {
          borderRadius: ds.radius(999),
          paddingHorizontal: ds.spacing(14),
          paddingVertical: ds.spacing(9),
          gap: ds.spacing(6),
          opacity: disabled ? 0.5 : pressed ? 0.72 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={ds.icon(15)} color={primary ? colors.textOnPrimary : colors.primary} />
      <Text
        style={[
          styles.chipText,
          {
            fontSize: ds.fontSize(13),
            color: primary ? colors.textOnPrimary : colors.textPrimary,
          },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: glassHairlineWidth,
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  primaryChip: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  secondaryChip: {
    backgroundColor: colors.white,
    borderColor: glassColors.cardBorder,
  },
  chipText: {
    fontWeight: '800',
    letterSpacing: 0,
  },
});
