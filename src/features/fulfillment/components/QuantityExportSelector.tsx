import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { triggerImpactHaptic, ImpactFeedbackStyle } from '@/lib/haptics';
import { colors } from '@/constants';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { glassColors, glassRadii, glassHairlineWidth } from '@/theme/design';

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
  const handlePress = () => {
    if (!canSwitchUnit) return;
    triggerImpactHaptic(ImpactFeedbackStyle.Light);
    onUnitChange(exportUnitType === 'base' ? 'pack' : 'base');
  };
  const label = exportUnitType === 'base' ? baseUnitLabel : packUnitLabel;
  const isPack = exportUnitType === 'pack';

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={!canSwitchUnit}
      style={{
        height: ds.spacing(38),
        maxWidth: ds.spacing(112),
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: glassRadii.button,
        paddingHorizontal: ds.spacing(10),
        borderWidth: glassHairlineWidth,
        backgroundColor: isPack ? glassColors.accent : glassColors.subtleFill,
        borderColor: isPack ? glassColors.accentBorder : glassColors.cardBorder,
        opacity: canSwitchUnit ? 1 : 0.45,
      }}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text
        style={{
          maxWidth: ds.spacing(82),
          fontSize: ds.fontSize(14),
          fontWeight: '600',
          color: isPack ? glassColors.textOnPrimary : glassColors.textPrimary,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Ionicons
        name="swap-horizontal"
        size={ds.icon(14)}
        color={isPack ? colors.white : glassColors.textSecondary}
        style={{ marginLeft: ds.spacing(4) }}
      />
    </TouchableOpacity>
  );
}

export function QuantityExportSelector(props: QuantityExportSelectorProps) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <UnitPillToggle {...props} />
    </View>
  );
}
