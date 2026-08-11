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
import { formatQuantity, type SelectionLine } from '../checklistSelection';

interface ChecklistItemRowProps {
  line: SelectionLine;
  isLast: boolean;
  onToggle: (key: string) => void;
  onAdjustQuantity: (key: string, delta: number) => void;
  onSetQuantity: (key: string, quantity: number) => void;
}

const STEPPER_SIZE = 40;
const CHECKBOX_TARGET = 56;

function parseQuantityInput(raw: string): number | null {
  const cleaned = raw.replace(',', '.').trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export const ChecklistItemRow = memo(function ChecklistItemRow({
  line,
  isLast,
  onToggle,
  onAdjustQuantity,
  onSetQuantity,
}: ChecklistItemRowProps) {
  const ds = useScaledStyles();
  const [draftQuantity, setDraftQuantity] = useState<string | null>(null);

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

  const checkboxSize = Math.max(28, ds.icon(28));
  const stepperSize = Math.max(STEPPER_SIZE, ds.icon(STEPPER_SIZE));

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: Math.max(CHECKBOX_TARGET, ds.rowH),
        paddingVertical: ds.spacing(8),
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
          minHeight: CHECKBOX_TARGET,
          paddingRight: ds.spacing(8),
        }}
      >
        <Ionicons
          name={line.checked ? 'checkmark-circle' : 'ellipse-outline'}
          size={checkboxSize}
          color={line.checked ? glassColors.accent : glassColors.textMuted}
          style={{ marginRight: ds.spacing(12) }}
        />
        <View style={{ flex: 1 }}>
          <Text
            numberOfLines={2}
            style={{
              fontSize: ds.fontSize(16),
              fontWeight: '600',
              color: line.checked ? glassColors.textPrimary : glassColors.textSecondary,
            }}
          >
            {line.itemName}
          </Text>
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
        </View>
      </TouchableOpacity>

      {line.checked ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: colors.glassCircle,
            borderWidth: glassHairlineWidth,
            borderColor: glassColors.controlBorder,
            borderRadius: glassRadii.stepper,
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
            <Ionicons name="remove" size={ds.icon(20)} color={glassColors.textPrimary} />
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
              minWidth: ds.spacing(40),
              textAlign: 'center',
              paddingHorizontal: ds.spacing(4),
              paddingVertical: 0,
              fontSize: ds.fontSize(16),
              fontWeight: '700',
              color: glassColors.textPrimary,
            }}
          />
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
            <Ionicons name="add" size={ds.icon(20)} color={glassColors.textPrimary} />
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
});
