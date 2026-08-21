import React, { useCallback } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '@/components/BottomSheetShell';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { triggerSelectionHaptic } from '@/lib/haptics';
import { glassHairlineWidth, radii, tipsTheme } from '@/theme/design';
import type { SimpleOrderDensity } from '@/types/settings';

/**
 * Checklist display sheet: Comfortable/Compact density cards plus the
 * "Show categories" toggle. Reached from the quick-actions sheet and from
 * Settings → Checklist display; both preferences persist per user.
 */

interface ChecklistSettingsSheetProps {
  visible: boolean;
  density: SimpleOrderDensity;
  showCategories: boolean;
  onSelectDensity: (density: SimpleOrderDensity) => void;
  onToggleCategories: (show: boolean) => void;
  onClose: () => void;
}

const OPTIONS: {
  value: SimpleOrderDensity;
  label: string;
  detail: string;
}[] = [
  {
    value: 'comfort',
    label: 'Comfortable',
    detail: 'Bigger rows with the usual amounts shown',
  },
  {
    value: 'dense',
    label: 'Compact',
    detail: 'Tight rows, see the whole list at once',
  },
];

export function ChecklistSettingsSheet({
  visible,
  density,
  showCategories,
  onSelectDensity,
  onToggleCategories,
  onClose,
}: ChecklistSettingsSheetProps) {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();

  const handleSelect = useCallback(
    (value: SimpleOrderDensity) => {
      void triggerSelectionHaptic();
      onSelectDensity(value);
    },
    [onSelectDensity],
  );

  const handleToggle = useCallback(() => {
    void triggerSelectionHaptic();
    onToggleCategories(!showCategories);
  }, [onToggleCategories, showCategories]);

  return (
    <BottomSheetShell
      visible={visible}
      onClose={onClose}
      bottomPadding={Math.max(insets.bottom, ds.spacing(14))}
    >
      <Text style={{ fontSize: ds.fontSize(20), fontWeight: '700', color: tipsTheme.ink }}>
        Checklist display
      </Text>
      <Text
        style={{ fontSize: ds.fontSize(13), color: tipsTheme.ink2, marginBottom: ds.spacing(12) }}
      >
        How your list is shown.
      </Text>

      {OPTIONS.map((option) => {
        const selected = option.value === density;
        return (
          <TouchableOpacity
            key={option.value}
            onPress={() => handleSelect(option.value)}
            activeOpacity={0.8}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${option.label} rows`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: ds.spacing(11),
              backgroundColor: tipsTheme.card,
              borderWidth: selected ? 1 : glassHairlineWidth,
              borderColor: selected ? tipsTheme.accent : tipsTheme.hairline,
              borderRadius: 18,
              paddingHorizontal: ds.spacing(16),
              paddingVertical: ds.spacing(14),
              marginBottom: ds.spacing(8),
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: ds.fontSize(14.5), fontWeight: '600', color: tipsTheme.ink }}>
                {option.label}
              </Text>
              <Text style={{ fontSize: ds.fontSize(12), color: tipsTheme.ink2, marginTop: 1 }}>
                {option.detail}
              </Text>
            </View>
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: radii.circle,
                borderWidth: selected ? 0 : 1.5,
                borderColor: tipsTheme.disabled,
                backgroundColor: selected ? tipsTheme.accent : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {selected ? <Ionicons name="checkmark" size={13} color="#FFFFFF" /> : null}
            </View>
          </TouchableOpacity>
        );
      })}

      <TouchableOpacity
        onPress={handleToggle}
        activeOpacity={0.8}
        accessibilityRole="switch"
        accessibilityState={{ checked: showCategories }}
        accessibilityLabel="Show categories"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: ds.spacing(11),
          backgroundColor: tipsTheme.card,
          borderWidth: glassHairlineWidth,
          borderColor: tipsTheme.hairline,
          borderRadius: 18,
          paddingHorizontal: ds.spacing(16),
          paddingVertical: ds.spacing(13),
          marginTop: ds.spacing(4),
        }}
      >
        <Ionicons name="list-outline" size={ds.icon(20)} color={tipsTheme.ink} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: ds.fontSize(14.5), fontWeight: '600', color: tipsTheme.ink }}>
            Show categories
          </Text>
          <Text style={{ fontSize: ds.fontSize(11.5), color: tipsTheme.ink3, marginTop: 1 }}>
            Group items under Fish, Protein, Dry goods
          </Text>
        </View>
        <View
          style={{
            width: 44,
            height: 26,
            borderRadius: radii.pill,
            backgroundColor: showCategories ? tipsTheme.accent : '#D6D3CE',
            justifyContent: 'center',
            paddingHorizontal: 2,
          }}
        >
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: radii.circle,
              backgroundColor: '#FFFFFF',
              alignSelf: showCategories ? 'flex-end' : 'flex-start',
            }}
          />
        </View>
      </TouchableOpacity>
    </BottomSheetShell>
  );
}
