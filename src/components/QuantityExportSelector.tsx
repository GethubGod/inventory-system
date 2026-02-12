import React from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

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
  const handlePress = () => {
    if (!canSwitchUnit) return;
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onUnitChange(exportUnitType === 'base' ? 'pack' : 'base');
  };
  const label = exportUnitType === 'base' ? baseUnitLabel : packUnitLabel;
  const isPack = exportUnitType === 'pack';

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={!canSwitchUnit}
      className={`h-10 max-w-[112px] flex-row items-center rounded-lg px-2.5 border ${
        isPack ? 'bg-primary-500 border-primary-600' : 'bg-gray-100 border-gray-200'
      } ${
        !canSwitchUnit ? 'opacity-45' : ''
      }`}
      activeOpacity={0.7}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
    >
      <Text
        className={`max-w-[82px] text-sm font-medium ${isPack ? 'text-white' : 'text-gray-700'}`}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Ionicons
        name="swap-horizontal"
        size={14}
        color={isPack ? '#FFFFFF' : '#6B7280'}
        style={{ marginLeft: 3 }}
      />
    </TouchableOpacity>
  );
}

export function QuantityExportSelector({
  exportUnitType,
  baseUnitLabel,
  packUnitLabel,
  canSwitchUnit,
  onUnitChange,
}: QuantityExportSelectorProps) {
  return (
    <View className="flex-row items-center">
      <UnitPillToggle
        exportUnitType={exportUnitType}
        baseUnitLabel={baseUnitLabel}
        packUnitLabel={packUnitLabel}
        canSwitchUnit={canSwitchUnit}
        onUnitChange={onUnitChange}
      />
    </View>
  );
}
