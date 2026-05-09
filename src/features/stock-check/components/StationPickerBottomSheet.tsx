import React, { memo, useCallback } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetShell } from '@/components/BottomSheetShell';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  colors,
  glassColors,
  glassHairlineWidth,
  glassRadii,
  grayScale,
} from '@/theme/design';
import type { StorageAreaFilterOption } from './StorageAreaFilterBar';

interface StationPickerBottomSheetProps {
  visible: boolean;
  options: StorageAreaFilterOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}

interface StationRowProps {
  option: StorageAreaFilterOption;
  isSelected: boolean;
  isLast: boolean;
  onSelect: (id: string) => void;
}

const StationRow = memo(function StationRow({
  option,
  isSelected,
  isLast,
  onSelect,
}: StationRowProps) {
  const ds = useScaledStyles();
  const handlePress = useCallback(() => onSelect(option.id), [onSelect, option.id]);

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={`${option.label}${
        option.badgeCount > 0 ? `, ${option.badgeCount} unchecked` : ''
      }`}
      activeOpacity={0.75}
      onPress={handlePress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: Math.max(56, ds.rowH),
        paddingHorizontal: ds.spacing(16),
        paddingVertical: ds.spacing(10),
        borderBottomWidth: isLast ? 0 : glassHairlineWidth,
        borderBottomColor: glassColors.divider,
        backgroundColor: isSelected ? 'rgba(232, 80, 58, 0.06)' : 'transparent',
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontSize: ds.fontSize(16),
            fontWeight: isSelected ? '700' : '600',
            color: glassColors.textPrimary,
          }}
          numberOfLines={1}
        >
          {option.label}
        </Text>
      </View>
      {option.badgeCount > 0 ? (
        <View
          style={{
            marginLeft: ds.spacing(8),
            minWidth: 24,
            height: 24,
            paddingHorizontal: 8,
            borderRadius: glassRadii.pill,
            backgroundColor: grayScale[200],
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontSize: ds.fontSize(12),
              fontWeight: '700',
              color: glassColors.textPrimary,
            }}
          >
            {option.badgeCount}
          </Text>
        </View>
      ) : null}
      {isSelected ? (
        <Ionicons
          name="checkmark"
          size={ds.icon(18)}
          color={glassColors.accent}
          style={{ marginLeft: ds.spacing(10) }}
        />
      ) : (
        <Ionicons
          name="chevron-forward"
          size={ds.icon(16)}
          color={glassColors.textMuted}
          style={{ marginLeft: ds.spacing(10) }}
        />
      )}
    </TouchableOpacity>
  );
});

export const StationPickerBottomSheet = memo(function StationPickerBottomSheet({
  visible,
  options,
  selectedId,
  onSelect,
  onClose,
}: StationPickerBottomSheetProps) {
  const ds = useScaledStyles();

  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id);
      onClose();
    },
    [onClose, onSelect],
  );

  return (
    <BottomSheetShell visible={visible} onClose={onClose}>
      <View style={{ paddingHorizontal: ds.spacing(6), paddingBottom: ds.spacing(8) }}>
        <Text
          style={{
            fontSize: ds.fontSize(18),
            fontWeight: '700',
            color: glassColors.textPrimary,
          }}
        >
          All stations
        </Text>
        <Text
          style={{
            fontSize: ds.fontSize(13),
            marginTop: ds.spacing(4),
            color: glassColors.textSecondary,
          }}
        >
          Pick a storage area to focus on. Numbers show items still unchecked.
        </Text>
      </View>

      <ScrollView
        style={{ maxHeight: ds.spacing(480) }}
        contentContainerStyle={{
          paddingHorizontal: ds.spacing(6),
          paddingBottom: ds.spacing(8),
        }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            borderRadius: glassRadii.surface,
            borderWidth: glassHairlineWidth,
            borderColor: glassColors.cardBorder,
            backgroundColor: colors.white,
            overflow: 'hidden',
          }}
        >
          {options.map((opt, index) => (
            <StationRow
              key={opt.id}
              option={opt}
              isSelected={opt.id === selectedId}
              isLast={index === options.length - 1}
              onSelect={handleSelect}
            />
          ))}
        </View>

        <TouchableOpacity
          onPress={onClose}
          style={{ paddingVertical: ds.spacing(16), marginTop: ds.spacing(4) }}
        >
          <Text
            style={{
              fontSize: ds.fontSize(15),
              fontWeight: '600',
              color: glassColors.textSecondary,
              textAlign: 'center',
            }}
          >
            Close
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </BottomSheetShell>
  );
});
