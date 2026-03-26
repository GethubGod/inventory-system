import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { triggerImpactHaptic, ImpactFeedbackStyle } from '@/lib/haptics';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { glassColors, glassHairlineWidth } from '@/theme/design';
import { segmentedControlColors } from '@/theme/segmentedControls';

type UnitType = 'base' | 'pack';

interface QuantityExportSelectorProps {
  exportUnitType: UnitType;
  baseUnitLabel: string;
  packUnitLabel: string;
  canSwitchUnit: boolean;
  onUnitChange: (unit: UnitType) => void;
}

function UnitPillToggle({
  exportUnitType,
  baseUnitLabel,
  packUnitLabel,
  canSwitchUnit,
  onUnitChange,
}: QuantityExportSelectorProps) {
  const ds = useScaledStyles();
  const handlePress = (nextUnit: UnitType) => {
    if (!canSwitchUnit || nextUnit === exportUnitType) return;
    triggerImpactHaptic(ImpactFeedbackStyle.Light);
    onUnitChange(nextUnit);
  };

  if (!canSwitchUnit) {
    const label = exportUnitType === 'base' ? baseUnitLabel : packUnitLabel;

    return (
      <View
        style={{
          minHeight: 42,
          borderRadius: 13,
          borderWidth: glassHairlineWidth,
          borderColor: glassColors.cardBorder,
          backgroundColor: segmentedControlColors.inactiveBackground,
          paddingHorizontal: ds.spacing(14),
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 0.7,
        }}
      >
        <Text
          style={{
            fontSize: ds.fontSize(14),
            fontWeight: '700',
            color: glassColors.textSecondary,
          }}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={{
        minHeight: 42,
        flexDirection: 'row',
        alignItems: 'stretch',
        borderRadius: 13,
        backgroundColor: segmentedControlColors.inactiveBackground,
        overflow: 'hidden',
        borderWidth: glassHairlineWidth,
        borderColor: glassColors.cardBorder,
      }}
    >
      {([
        { key: 'pack' as const, label: packUnitLabel },
        { key: 'base' as const, label: baseUnitLabel },
      ]).map((option) => {
        const isActive = option.key === exportUnitType;

        return (
          <TouchableOpacity
            key={option.key}
            onPress={() => handlePress(option.key)}
            style={{
              minHeight: 42,
              paddingHorizontal: ds.spacing(14),
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: isActive
                ? segmentedControlColors.activeBackground
                : 'transparent',
            }}
            activeOpacity={0.75}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text
              style={{
                fontSize: ds.fontSize(14),
                fontWeight: '700',
                color: isActive
                  ? segmentedControlColors.activeText
                  : segmentedControlColors.inactiveText,
              }}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function QuantityExportSelector(props: QuantityExportSelectorProps) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <UnitPillToggle {...props} />
    </View>
  );
}
