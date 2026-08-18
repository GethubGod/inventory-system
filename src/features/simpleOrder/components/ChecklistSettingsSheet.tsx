import React, { useCallback } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '@/components/BottomSheetShell';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { triggerSelectionHaptic } from '@/lib/haptics';
import {
  colors,
  glassColors,
  glassHairlineWidth,
  glassRadii,
} from '@/theme/design';
import type { SimpleOrderDensity } from '@/types/settings';

interface ChecklistSettingsSheetProps {
  visible: boolean;
  density: SimpleOrderDensity;
  onSelectDensity: (density: SimpleOrderDensity) => void;
  onClose: () => void;
}

const OPTIONS: {
  value: SimpleOrderDensity;
  label: string;
  detail: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}[] = [
  {
    value: 'comfort',
    label: 'Comfortable',
    detail: 'Bigger buttons, easier to tap',
    icon: 'resize-outline',
  },
  {
    value: 'dense',
    label: 'Compact',
    detail: 'Smaller rows, more items on screen',
    icon: 'reorder-four-outline',
  },
];

export function ChecklistSettingsSheet({
  visible,
  density,
  onSelectDensity,
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

  return (
    <BottomSheetShell
      visible={visible}
      onClose={onClose}
      bottomPadding={Math.max(insets.bottom, ds.spacing(12))}
    >
      <Text
        style={{
          fontSize: ds.fontSize(20),
          fontWeight: '700',
          color: glassColors.textPrimary,
          marginBottom: ds.spacing(2),
        }}
      >
        List settings
      </Text>
      <Text
        style={{
          fontSize: ds.fontSize(13),
          color: glassColors.textSecondary,
          marginBottom: ds.spacing(12),
        }}
      >
        Row size
      </Text>

      {OPTIONS.map((option, index) => {
        const selected = option.value === density;
        return (
          <TouchableOpacity
            key={option.value}
            onPress={() => handleSelect(option.value)}
            activeOpacity={0.7}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${option.label} rows`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              minHeight: 60,
              paddingVertical: ds.spacing(8),
              borderBottomWidth:
                index === OPTIONS.length - 1 ? 0 : glassHairlineWidth,
              borderBottomColor: glassColors.divider,
            }}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: glassRadii.iconTile,
                backgroundColor: selected ? colors.primaryLight : colors.glassCircle,
                borderWidth: glassHairlineWidth,
                borderColor: selected
                  ? glassColors.accentBorder
                  : glassColors.controlBorder,
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: ds.spacing(12),
              }}
            >
              <Ionicons
                name={option.icon}
                size={ds.icon(19)}
                color={selected ? glassColors.accent : glassColors.textPrimary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: ds.fontSize(16),
                  fontWeight: '600',
                  color: glassColors.textPrimary,
                }}
              >
                {option.label}
              </Text>
              <Text
                style={{
                  marginTop: 1,
                  fontSize: ds.fontSize(12),
                  color: glassColors.textMuted,
                }}
              >
                {option.detail}
              </Text>
            </View>
            {selected ? (
              <Ionicons
                name="checkmark-circle"
                size={ds.icon(24)}
                color={glassColors.accent}
              />
            ) : (
              <Ionicons
                name="ellipse-outline"
                size={ds.icon(24)}
                color={glassColors.textMuted}
              />
            )}
          </TouchableOpacity>
        );
      })}
    </BottomSheetShell>
  );
}
