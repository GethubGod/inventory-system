import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants';

type ChipTone = 'amber' | 'gray' | 'blue';

export interface FulfillmentConfirmItemChip {
  id: string;
  label: string;
  tone?: ChipTone;
}

interface FulfillmentConfirmItemRowProps {
  title: string;
  headerActions?: React.ReactNode;
  chips?: FulfillmentConfirmItemChip[];
  trailingChip?: React.ReactNode;
  quantityValue: string;
  onQuantityChangeText: (value: string) => void;
  onDecrement: () => void;
  onIncrement: () => void;
  quantityPlaceholder?: string;
  unitSelector: React.ReactNode;
  details?: React.ReactNode;
  detailsVisible?: boolean;
  footer?: React.ReactNode;
  disableControls?: boolean;
}

const CHIP_CLASS: Record<ChipTone, { container: string; text: string }> = {
  amber: {
    container: 'border border-amber-200 bg-amber-100',
    text: 'text-amber-800',
  },
  gray: {
    container: 'border border-gray-200 bg-gray-100',
    text: 'text-gray-700',
  },
  blue: {
    container: 'border border-blue-200 bg-blue-50',
    text: 'text-blue-700',
  },
};

export const FulfillmentConfirmItemRow = React.memo(function FulfillmentConfirmItemRow({
  title,
  headerActions,
  chips = [],
  trailingChip,
  quantityValue,
  onQuantityChangeText,
  onDecrement,
  onIncrement,
  quantityPlaceholder = 'Set qty',
  unitSelector,
  details,
  detailsVisible = false,
  footer,
  disableControls = false,
}: FulfillmentConfirmItemRowProps) {
  return (
    <View className="rounded-2xl border border-gray-200 bg-white px-3 py-2.5">
      <View className="flex-row items-start justify-between">
        <Text className="flex-1 pr-2 text-sm font-semibold text-gray-900" numberOfLines={1}>
          {title}
        </Text>
        {headerActions ? <View className="flex-row items-center">{headerActions}</View> : null}
      </View>

      {(chips.length > 0 || trailingChip) && (
        <View className="mt-2 flex-row items-start justify-between">
          {chips.length > 0 ? (
            <View className="flex-1 flex-row flex-wrap gap-1 pr-2">
              {chips.map((chip) => {
                const tone = CHIP_CLASS[chip.tone ?? 'gray'];
                return (
                  <View
                    key={chip.id}
                    className={`rounded-full px-2 py-0.5 ${tone.container}`}
                  >
                    <Text className={`text-[10px] font-semibold ${tone.text}`}>{chip.label}</Text>
                  </View>
                );
              })}
            </View>
          ) : (
            <View className="flex-1" />
          )}
          {trailingChip ? <View className="ml-2">{trailingChip}</View> : null}
        </View>
      )}

      <View className="mt-2 flex-row items-center">
        <TouchableOpacity
          onPress={onDecrement}
          disabled={disableControls}
          className={`h-10 w-10 rounded-lg border items-center justify-center ${
            disableControls ? 'bg-gray-100 border-gray-200' : 'bg-white border-gray-200'
          }`}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Ionicons name="remove" size={16} color={colors.gray[600]} />
        </TouchableOpacity>

        <TextInput
          value={quantityValue}
          onChangeText={onQuantityChangeText}
          editable={!disableControls}
          keyboardType="decimal-pad"
          placeholder={quantityPlaceholder}
          placeholderTextColor={colors.gray[400]}
          className="mx-1.5 h-10 w-[58px] rounded-lg border border-gray-200 bg-white px-2 text-center text-sm font-semibold text-gray-900"
        />

        <TouchableOpacity
          onPress={onIncrement}
          disabled={disableControls}
          className={`h-10 w-10 rounded-lg border items-center justify-center ${
            disableControls ? 'bg-gray-100 border-gray-200' : 'bg-white border-gray-200'
          }`}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Ionicons name="add" size={16} color={colors.gray[600]} />
        </TouchableOpacity>

        <View className="ml-1.5 flex-shrink">{unitSelector}</View>
      </View>

      {detailsVisible && details ? (
        <View className="mt-2.5 border-t border-gray-200 pt-2.5">{details}</View>
      ) : null}

      {footer ? <View className="mt-1.5">{footer}</View> : null}
    </View>
  );
});
