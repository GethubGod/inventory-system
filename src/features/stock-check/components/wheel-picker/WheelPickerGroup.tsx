import React, { memo } from 'react';
import { Text, View } from 'react-native';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
  grayScale,
} from '@/theme/design';
import { WheelPicker, type WheelPickerOption } from './WheelPicker';
import type { UnitType } from '@/types';

/**
 * Three-column wheel picker assembly. The center selection band is rendered
 * once at the group level and absolutely positioned across all three
 * columns, which keeps the visual highlight perfectly aligned regardless of
 * each column's contents.
 *
 * Phase-6 perf rework:
 *   • Flat prop API (no inline-object wrappers). With a `memo()` shell,
 *     React.memo's shallow comparison can now correctly bail when only one
 *     wheel's value changed — preventing the other two columns from re-
 *     rendering. The previous `unit={{...}}` literal pattern broke memo by
 *     producing a fresh object identity on every parent render.
 *   • Tightened label-to-band spacing so the static "UNIT/AMOUNT/PIECES"
 *     labels sit closely above the highlight band.
 */
interface WheelPickerGroupProps {
  itemHeight?: number;
  visibleRange?: number;

  unitLabel: string;
  unitOptions: WheelPickerOption<UnitType>[];
  unitIndex: number;
  onUnitIndexChange: (next: number) => void;

  amountLabel: string;
  amountOptions: WheelPickerOption<number>[];
  amountIndex: number;
  onAmountIndexChange: (next: number) => void;

  piecesLabel: string;
  piecesOptions: WheelPickerOption<number>[];
  piecesIndex: number;
  onPiecesIndexChange: (next: number) => void;
}

const DEFAULT_ITEM_HEIGHT = 40;
const DEFAULT_VISIBLE_RANGE = 2;

function WheelPickerGroupImpl({
  itemHeight = DEFAULT_ITEM_HEIGHT,
  visibleRange = DEFAULT_VISIBLE_RANGE,
  unitLabel,
  unitOptions,
  unitIndex,
  onUnitIndexChange,
  amountLabel,
  amountOptions,
  amountIndex,
  onAmountIndexChange,
  piecesLabel,
  piecesOptions,
  piecesIndex,
  onPiecesIndexChange,
}: WheelPickerGroupProps) {
  const ds = useScaledStyles();
  const totalHeight = (visibleRange * 2 + 1) * itemHeight;
  const bandTop = visibleRange * itemHeight;

  return (
    <View>
      {/* Static labels — tightened spacing per Phase-6 spec. The 4pt gap
          below the labels keeps them visually attached to their wheel
          columns rather than floating in dead space. */}
      <View
        style={{
          flexDirection: 'row',
          paddingHorizontal: ds.spacing(8),
          marginBottom: ds.spacing(4),
        }}
      >
        {[unitLabel, amountLabel, piecesLabel].map((lbl) => (
          <View key={lbl} style={{ flex: 1, alignItems: 'center' }}>
            <Text
              style={{
                fontSize: ds.fontSize(10),
                fontWeight: '700',
                letterSpacing: 1.4,
                color: glassColors.textSecondary,
                textTransform: 'uppercase',
              }}
            >
              {lbl}
            </Text>
          </View>
        ))}
      </View>

      <View
        style={{
          height: totalHeight,
          flexDirection: 'row',
          alignItems: 'stretch',
        }}
      >
        {/* Selection band — absolutely positioned so it spans all three
            columns at the vertical center. */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: bandTop,
            height: itemHeight,
            backgroundColor: grayScale[100],
            borderTopWidth: glassHairlineWidth,
            borderBottomWidth: glassHairlineWidth,
            borderColor: glassColors.divider,
            borderRadius: glassRadii.tag,
          }}
        />

        <View style={{ flex: 1 }}>
          <WheelPicker
            options={unitOptions}
            selectedIndex={unitIndex}
            onIndexChange={onUnitIndexChange}
            itemHeight={itemHeight}
            visibleRange={visibleRange}
            accessibilityLabel="Select unit"
          />
        </View>
        <View style={{ flex: 1 }}>
          <WheelPicker
            options={amountOptions}
            selectedIndex={amountIndex}
            onIndexChange={onAmountIndexChange}
            itemHeight={itemHeight}
            visibleRange={visibleRange}
            accessibilityLabel="Select stock amount"
          />
        </View>
        <View style={{ flex: 1 }}>
          <WheelPicker
            options={piecesOptions}
            selectedIndex={piecesIndex}
            onIndexChange={onPiecesIndexChange}
            itemHeight={itemHeight}
            visibleRange={visibleRange}
            accessibilityLabel="Select loose pieces"
          />
        </View>
      </View>
    </View>
  );
}

export const WheelPickerGroup = memo(WheelPickerGroupImpl);
