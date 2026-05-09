import React, { memo, useMemo } from 'react';
import { Text, View } from 'react-native';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { colors, glassColors, glassRadii, grayScale } from '@/theme/design';

interface StockCheckProgressBarProps {
  totalItems: number;
  checkedItems: number;
  itemsToOrder: number;
  labelMode?: 'totalChecked' | 'uncheckedRemaining';
}

export const StockCheckProgressBar = memo(function StockCheckProgressBar({
  totalItems,
  checkedItems,
  itemsToOrder,
  labelMode = 'totalChecked',
}: StockCheckProgressBarProps) {
  const ds = useScaledStyles();
  const ratio = useMemo(() => {
    if (totalItems <= 0) return 0;
    return Math.max(0, Math.min(1, checkedItems / totalItems));
  }, [checkedItems, totalItems]);
  const uncheckedItems = Math.max(0, totalItems - checkedItems);
  const leftLabel =
    labelMode === 'uncheckedRemaining'
      ? `${checkedItems} checked`
      : `${checkedItems} of ${totalItems} checked`;
  const rightLabel =
    labelMode === 'uncheckedRemaining'
      ? `${uncheckedItems} unchecked`
      : `${itemsToOrder} to order`;

  return (
    <View
      style={{
        backgroundColor: colors.white,
        borderRadius: glassRadii.surface,
        paddingHorizontal: ds.spacing(16),
        paddingVertical: ds.spacing(14),
        marginBottom: ds.spacing(14),
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: ds.spacing(10),
        }}
      >
        <Text
          style={{
            fontSize: ds.fontSize(15),
            fontWeight: '700',
            color: glassColors.textPrimary,
          }}
        >
          {leftLabel}
        </Text>
        <Text
          style={{
            fontSize: ds.fontSize(13),
            fontWeight: '700',
            color: glassColors.accent,
          }}
        >
          {rightLabel}
        </Text>
      </View>

      <View
        style={{
          height: 6,
          borderRadius: glassRadii.pill,
          backgroundColor: grayScale[200],
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${ratio * 100}%`,
            height: '100%',
            backgroundColor: glassColors.accent,
            borderRadius: glassRadii.pill,
          }}
        />
      </View>
    </View>
  );
});
