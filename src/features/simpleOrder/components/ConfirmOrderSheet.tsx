import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '@/components/BottomSheetShell';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { triggerImpactHaptic, triggerSelectionHaptic } from '@/lib/haptics';
import {
  colors,
  glassColors,
  glassHairlineWidth,
  glassRadii,
} from '@/theme/design';
import { formatQuantity, type SelectionLine } from '../checklistSelection';

interface ConfirmOrderSheetProps {
  visible: boolean;
  /** 'review' routes to manager review; 'direct' continues to the per-supplier send queue. */
  mode: 'review' | 'direct';
  lines: SelectionLine[];
  unmatchedNames: string[];
  isSending: boolean;
  sendError: string | null;
  onAdjustQuantity: (key: string, delta: number) => void;
  onRemoveLine: (key: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

const STEPPER_SIZE = 36;

export function ConfirmOrderSheet({
  visible,
  mode,
  lines,
  unmatchedNames,
  isSending,
  sendError,
  onAdjustQuantity,
  onRemoveLine,
  onConfirm,
  onClose,
}: ConfirmOrderSheetProps) {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();

  const handleClose = useCallback(() => {
    if (isSending) return;
    onClose();
  }, [isSending, onClose]);

  const handleConfirm = useCallback(() => {
    void triggerImpactHaptic();
    onConfirm();
  }, [onConfirm]);

  const sendableCount = lines.length;

  return (
    <BottomSheetShell
      visible={visible}
      onClose={handleClose}
      bottomPadding={Math.max(insets.bottom, ds.spacing(12))}
    >
      <Text
        style={{
          fontSize: ds.fontSize(20),
          fontWeight: '700',
          color: glassColors.textPrimary,
          marginBottom: ds.spacing(2),
        }}
      >
        Review order
      </Text>
      <Text
        style={{
          fontSize: ds.fontSize(13),
          color: glassColors.textSecondary,
          marginBottom: ds.spacing(10),
        }}
      >
        {sendableCount === 1 ? '1 item' : `${sendableCount} items`} —{' '}
        {mode === 'direct'
          ? 'sends straight to your suppliers'
          : 'goes to manager review'}
      </Text>

      <ScrollView
        style={{ maxHeight: ds.spacing(300) }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {lines.map((line, index) => (
          <View
            key={line.key}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              minHeight: 52,
              paddingVertical: ds.spacing(6),
              borderBottomWidth:
                index === lines.length - 1 ? 0 : glassHairlineWidth,
              borderBottomColor: glassColors.divider,
            }}
          >
            <View style={{ flex: 1, paddingRight: ds.spacing(8) }}>
              <Text
                numberOfLines={1}
                style={{
                  fontSize: ds.fontSize(15),
                  fontWeight: '600',
                  color: glassColors.textPrimary,
                }}
              >
                {line.itemName}
              </Text>
              <Text
                style={{ fontSize: ds.fontSize(12), color: glassColors.textMuted }}
              >
                {formatQuantity(line.quantity)} {line.unit}
              </Text>
            </View>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: colors.glassCircle,
                borderWidth: glassHairlineWidth,
                borderColor: glassColors.controlBorder,
                borderRadius: glassRadii.stepper,
                marginRight: ds.spacing(8),
              }}
            >
              <TouchableOpacity
                onPress={() => {
                  void triggerSelectionHaptic();
                  onAdjustQuantity(line.key, -1);
                }}
                disabled={isSending}
                accessibilityRole="button"
                accessibilityLabel={`Decrease ${line.itemName} quantity`}
                style={{
                  width: STEPPER_SIZE,
                  height: STEPPER_SIZE,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="remove" size={ds.icon(18)} color={glassColors.textPrimary} />
              </TouchableOpacity>
              <Text
                style={{
                  minWidth: ds.spacing(30),
                  textAlign: 'center',
                  fontSize: ds.fontSize(15),
                  fontWeight: '700',
                  color: glassColors.textPrimary,
                }}
              >
                {formatQuantity(line.quantity)}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  void triggerSelectionHaptic();
                  onAdjustQuantity(line.key, 1);
                }}
                disabled={isSending}
                accessibilityRole="button"
                accessibilityLabel={`Increase ${line.itemName} quantity`}
                style={{
                  width: STEPPER_SIZE,
                  height: STEPPER_SIZE,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="add" size={ds.icon(18)} color={glassColors.textPrimary} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={() => {
                void triggerSelectionHaptic();
                onRemoveLine(line.key);
              }}
              disabled={isSending}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${line.itemName} from order`}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              style={{
                width: STEPPER_SIZE,
                height: STEPPER_SIZE,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons
                name="trash-outline"
                size={ds.icon(18)}
                color={glassColors.dangerText}
              />
            </TouchableOpacity>
          </View>
        ))}

        {lines.length === 0 ? (
          <Text
            style={{
              paddingVertical: ds.spacing(16),
              fontSize: ds.fontSize(14),
              color: glassColors.textSecondary,
              textAlign: 'center',
            }}
          >
            No items left to send.
          </Text>
        ) : null}
      </ScrollView>

      {unmatchedNames.length > 0 ? (
        <View
          style={{
            backgroundColor: glassColors.warningSoft,
            borderRadius: glassRadii.tag,
            paddingHorizontal: ds.spacing(10),
            paddingVertical: ds.spacing(8),
            marginTop: ds.spacing(10),
          }}
        >
          <Text style={{ fontSize: ds.fontSize(12), color: glassColors.warningText }}>
            Not in inventory, will be skipped: {unmatchedNames.join(', ')}
          </Text>
        </View>
      ) : null}

      {sendError ? (
        <View
          style={{
            backgroundColor: glassColors.dangerSoft,
            borderRadius: glassRadii.tag,
            paddingHorizontal: ds.spacing(10),
            paddingVertical: ds.spacing(8),
            marginTop: ds.spacing(10),
          }}
        >
          <Text style={{ fontSize: ds.fontSize(13), color: glassColors.dangerText }}>
            {sendError}
          </Text>
        </View>
      ) : null}

      <TouchableOpacity
        onPress={handleConfirm}
        disabled={isSending || sendableCount === 0}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Confirm and send order"
        style={{
          marginTop: ds.spacing(14),
          minHeight: Math.max(52, ds.buttonH),
          borderRadius: glassRadii.submitButton,
          backgroundColor:
            isSending || sendableCount === 0 ? glassColors.textMuted : colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {isSending ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text
            style={{
              fontSize: ds.fontSize(17),
              fontWeight: '700',
              color: colors.white,
            }}
          >
            {mode === 'direct'
              ? 'Continue to send'
              : sendableCount === 1
                ? 'Send 1 item'
                : `Send ${sendableCount} items`}
          </Text>
        )}
      </TouchableOpacity>
    </BottomSheetShell>
  );
}
