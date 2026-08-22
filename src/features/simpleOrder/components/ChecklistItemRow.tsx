import React, { memo, useCallback, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { triggerImpactHaptic, triggerSelectionHaptic } from '@/lib/haptics';
import {
  colors,
  glassColors,
  glassHairlineWidth,
  glassRadii,
} from '@/theme/design';
import type { SimpleOrderDensity } from '@/types/settings';
import { formatQuantity, type SelectionLine } from '../checklistSelection';

interface ChecklistItemRowProps {
  line: SelectionLine;
  isLast: boolean;
  density: SimpleOrderDensity;
  onToggle: (key: string) => void;
  onAdjustQuantity: (key: string, delta: number) => void;
  onSetQuantity: (key: string, quantity: number) => void;
}

interface DensityMetrics {
  rowMinHeight: number;
  checkboxSize: number;
  stepperSize: number;
  nameFontSize: number;
  quantityFontSize: number;
  verticalPadding: number;
  showSubtitle: boolean;
}

const DENSITY_METRICS: Record<SimpleOrderDensity, DensityMetrics> = {
  comfort: {
    rowMinHeight: 56,
    checkboxSize: 28,
    stepperSize: 40,
    nameFontSize: 16,
    quantityFontSize: 16,
    verticalPadding: 8,
    showSubtitle: true,
  },
  dense: {
    rowMinHeight: 44,
    checkboxSize: 22,
    stepperSize: 32,
    nameFontSize: 14,
    quantityFontSize: 14,
    verticalPadding: 4,
    showSubtitle: false,
  },
};

function parseQuantityInput(raw: string): number | null {
  const cleaned = raw.replace(',', '.').trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export const ChecklistItemRow = memo(function ChecklistItemRow({
  line,
  isLast,
  density,
  onToggle,
  onAdjustQuantity,
  onSetQuantity,
}: ChecklistItemRowProps) {
  const ds = useScaledStyles();
  const [draftQuantity, setDraftQuantity] = useState<string | null>(null);
  const metrics = DENSITY_METRICS[density];

  const handleToggle = useCallback(() => {
    void triggerSelectionHaptic();
    onToggle(line.key);
  }, [line.key, onToggle]);

  const handleDecrement = useCallback(() => {
    void triggerImpactHaptic();
    onAdjustQuantity(line.key, -1);
  }, [line.key, onAdjustQuantity]);

  const handleIncrement = useCallback(() => {
    void triggerImpactHaptic();
    onAdjustQuantity(line.key, 1);
  }, [line.key, onAdjustQuantity]);

  const handleQuantityCommit = useCallback(() => {
    if (draftQuantity !== null) {
      const parsed = parseQuantityInput(draftQuantity);
      if (parsed !== null) {
        onSetQuantity(line.key, parsed);
      }
    }
    setDraftQuantity(null);
  }, [draftQuantity, line.key, onSetQuantity]);

  const checkboxSize = Math.max(metrics.checkboxSize, ds.icon(metrics.checkboxSize));
  const stepperSize = Math.max(metrics.stepperSize, ds.icon(metrics.stepperSize));

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: Math.max(metrics.rowMinHeight, density === 'dense' ? 0 : ds.rowH),
        paddingVertical: ds.spacing(metrics.verticalPadding),
        borderBottomWidth: isLast ? 0 : glassHairlineWidth,
        borderBottomColor: glassColors.divider,
      }}
    >
      <TouchableOpacity
        onPress={handleToggle}
        activeOpacity={0.6}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: line.checked }}
        accessibilityLabel={`${line.itemName}, ${line.checked ? 'selected' : 'not selected'}`}
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: metrics.rowMinHeight,
          paddingRight: ds.spacing(8),
        }}
      >
        <Ionicons
          name={line.checked ? 'checkmark-circle' : 'ellipse-outline'}
          size={checkboxSize}
          color={line.checked ? glassColors.accent : glassColors.textMuted}
          style={{ marginRight: ds.spacing(density === 'dense' ? 8 : 12) }}
        />
        <View style={{ flex: 1 }}>
          <Text
            numberOfLines={density === 'dense' ? 1 : 2}
            style={{
              fontSize: ds.fontSize(metrics.nameFontSize),
              fontWeight: '600',
              color: line.checked ? glassColors.textPrimary : glassColors.textSecondary,
            }}
          >
            {line.itemName}
          </Text>
          {metrics.showSubtitle ? (
            <Text
              style={{
                marginTop: 1,
                fontSize: ds.fontSize(12),
                color: glassColors.textMuted,
              }}
            >
              {line.unit}
              {line.recommendedQty !== null
                ? ` · usually ${formatQuantity(line.recommendedQty)}`
                : ''}
            </Text>
          ) : null}
        </View>
      </TouchableOpacity>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.glassCircle,
          borderWidth: glassHairlineWidth,
          borderColor: glassColors.controlBorder,
          borderRadius: glassRadii.stepper,
          opacity: line.checked ? 1 : 0.45,
        }}
      >
        <TouchableOpacity
          onPress={handleDecrement}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${line.itemName} quantity`}
          style={{
            width: stepperSize,
            height: stepperSize,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons
            name="remove"
            size={ds.icon(density === 'dense' ? 16 : 20)}
            color={glassColors.textPrimary}
          />
        </TouchableOpacity>
        <TextInput
          value={draftQuantity ?? formatQuantity(line.quantity)}
          onChangeText={setDraftQuantity}
          onFocus={() => setDraftQuantity(formatQuantity(line.quantity))}
          onBlur={handleQuantityCommit}
          onSubmitEditing={handleQuantityCommit}
          keyboardType="decimal-pad"
          returnKeyType="done"
          selectTextOnFocus
          accessibilityLabel={`${line.itemName} quantity in ${line.unit}`}
          style={{
            minWidth: ds.spacing(density === 'dense' ? 32 : 40),
            textAlign: 'center',
            paddingHorizontal: ds.spacing(4),
            paddingVertical: 0,
            fontSize: ds.fontSize(metrics.quantityFontSize),
            fontWeight: '700',
            color: glassColors.textPrimary,
          }}
        />
        {density === 'dense' ? (
          <Text
            numberOfLines={1}
            style={{
              maxWidth: ds.spacing(52),
              fontSize: ds.fontSize(11),
              color: glassColors.textMuted,
              marginRight: ds.spacing(2),
            }}
          >
            {line.unit}
          </Text>
        ) : null}
        <TouchableOpacity
          onPress={handleIncrement}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel={`Increase ${line.itemName} quantity`}
          style={{
            width: stepperSize,
            height: stepperSize,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons
            name="add"
            size={ds.icon(density === 'dense' ? 16 : 20)}
            color={glassColors.accent}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
});
