import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform, Text, View } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { triggerSelectionHaptic } from '@/lib/haptics';
import { glassColors } from '@/theme/design';

export interface WheelPickerOption<T = string> {
  key: string;
  label: string;
  value: T;
}

export interface WheelPickerProps<T = string> {
  options: WheelPickerOption<T>[];
  selectedIndex: number;
  onIndexChange: (nextIndex: number) => void;
  itemHeight?: number;
  visibleRange?: number;
  accessibilityLabel?: string;
}

const DEFAULT_ITEM_HEIGHT = 44;
const DEFAULT_VISIBLE_RANGE = 2;

function clampIndex(index: number, optionCount: number): number {
  if (optionCount <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(optionCount - 1, Math.trunc(index)));
}

function WheelPickerImpl<T>({
  options,
  selectedIndex,
  onIndexChange,
  itemHeight = DEFAULT_ITEM_HEIGHT,
  visibleRange = DEFAULT_VISIBLE_RANGE,
  accessibilityLabel,
}: WheelPickerProps<T>) {
  const optionCount = options.length;
  const safeIndex = useMemo(
    () => clampIndex(selectedIndex, optionCount),
    [optionCount, selectedIndex],
  );
  const selectedKey = options[safeIndex]?.key ?? '';
  const lastEmittedIndex = useRef(safeIndex);

  useEffect(() => {
    lastEmittedIndex.current = safeIndex;
  }, [safeIndex]);

  const keyToIndex = useMemo(() => {
    const map = new Map<string, number>();
    options.forEach((option, index) => {
      map.set(option.key, index);
    });
    return map;
  }, [options]);

  const handleValueChange = useCallback(
    (nextKey: string) => {
      const nextIndex = keyToIndex.get(nextKey);
      if (nextIndex === undefined) return;
      if (nextIndex === lastEmittedIndex.current) return;
      lastEmittedIndex.current = nextIndex;
      void triggerSelectionHaptic();
      onIndexChange(nextIndex);
    },
    [keyToIndex, onIndexChange],
  );

  const pickerHeight = (visibleRange * 2 + 1) * itemHeight;

  if (optionCount <= 1) {
    return (
      <View
        accessibilityLabel={accessibilityLabel}
        style={{
          height: pickerHeight,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontSize: 22,
            fontWeight: '700',
            color: glassColors.textPrimary,
          }}
          numberOfLines={1}
        >
          {options[0]?.label ?? ''}
        </Text>
      </View>
    );
  }

  return (
    <Picker
      accessibilityLabel={accessibilityLabel}
      selectedValue={selectedKey}
      onValueChange={handleValueChange}
      mode="dialog"
      style={{
        height: pickerHeight,
        width: '100%',
        backgroundColor: 'transparent',
      }}
      itemStyle={{
        height: itemHeight,
        fontSize: 22,
        fontWeight: Platform.OS === 'ios' ? '700' : 'normal',
        color: glassColors.textPrimary,
      }}
    >
      {options.map((option) => (
        <Picker.Item
          key={option.key}
          label={option.label}
          value={option.key}
          color={glassColors.textPrimary}
        />
      ))}
    </Picker>
  );
}

export const WheelPicker = memo(WheelPickerImpl) as <T>(
  props: WheelPickerProps<T>,
) => React.ReactElement;
