import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants';

type ChipTone = 'amber' | 'gray' | 'blue';

export interface ReviewItemChip {
  id: string;
  label: string;
  tone?: ChipTone;
}

interface ReviewItemRowProps {
  title: string;
  headerActions?: React.ReactNode;
  chips?: ReviewItemChip[];
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

export const ReviewItemRow = React.memo(function ReviewItemRow({
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
}: ReviewItemRowProps) {
  return (
    <View className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4 mb-3 last:mb-0">
      <View className="flex-row items-start justify-between">
        <Text className="flex-1 pr-3 text-base font-semibold text-gray-900" numberOfLines={1}>
          {title}
        </Text>
        {headerActions ? <View className="flex-row items-center">{headerActions}</View> : null}
      </View>

      {(chips.length > 0 || trailingChip) && (
        <View className="mt-3 flex-row items-start justify-between">
          {chips.length > 0 ? (
            <View className="flex-1 flex-row flex-wrap gap-1.5 pr-2">
              {chips.map((chip) => {
                const tone = CHIP_CLASS[chip.tone ?? 'gray'];
                return (
                  <View
                    key={chip.id}
                    className={`rounded-full px-2.5 py-1 ${tone.container}`}
                  >
                    <Text className={`text-[11px] font-semibold ${tone.text}`}>{chip.label}</Text>
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

      <View className="mt-3.5">
        <View className="flex-row items-center">
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
            className="mx-1.5 h-10 w-[60px] rounded-lg border border-gray-200 bg-white px-2 text-center text-sm font-semibold text-gray-900"
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
      </View>

      {detailsVisible && details ? (
        <View className="mt-3.5 border-t border-gray-200 pt-3">{details}</View>
      ) : null}

      {footer ? <View className="mt-2">{footer}</View> : null}
    </View>
  );
});
