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
import { triggerImpactHaptic } from '@/lib/haptics';
import { glassHairlineWidth, radii, tipsTheme } from '@/theme/design';
import { formatQuantity, type SelectionLine } from '../checklistSelection';

/**
 * Review order sheet: compact one-line rows (item name left, "qty unit"
 * right), the note card when a note exists, and "Send N items". The subtitle
 * flips between manager-review and direct-send wording per the user's send
 * mode. Quantities are adjusted on the list or quantity card, not here.
 */

interface ConfirmOrderSheetProps {
  visible: boolean;
  /** 'review' routes to manager review; 'direct' continues to the per-supplier send queue. */
  mode: 'review' | 'direct';
  lines: SelectionLine[];
  unmatchedNames: string[];
  note: string;
  onEditNote: () => void;
  isSending: boolean;
  sendError: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmOrderSheet({
  visible,
  mode,
  lines,
  unmatchedNames,
  note,
  onEditNote,
  isSending,
  sendError,
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
  const trimmedNote = note.trim();

  return (
    <BottomSheetShell
      visible={visible}
      onClose={handleClose}
      bottomPadding={Math.max(insets.bottom, ds.spacing(14))}
    >
      <Text style={{ fontSize: ds.fontSize(20), fontWeight: '700', color: tipsTheme.ink }}>
        Review order
      </Text>
      <Text
        style={{ fontSize: ds.fontSize(13), color: tipsTheme.ink2, marginBottom: ds.spacing(12) }}
      >
        {sendableCount === 1 ? '1 item' : `${sendableCount} items`} ·{' '}
        {mode === 'direct' ? 'sends straight to your suppliers' : 'goes to manager review'}
      </Text>

      <View
        style={{
          backgroundColor: tipsTheme.card,
          borderWidth: glassHairlineWidth,
          borderColor: tipsTheme.hairline,
          borderRadius: 18,
          paddingHorizontal: ds.spacing(16),
          marginBottom: ds.spacing(12),
        }}
      >
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
                gap: ds.spacing(10),
                minHeight: 40,
                borderBottomWidth: index === lines.length - 1 ? 0 : glassHairlineWidth,
                borderBottomColor: 'rgba(0, 0, 0, 0.05)',
              }}
            >
              <Text
                numberOfLines={1}
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: ds.fontSize(14),
                  fontWeight: '600',
                  color: tipsTheme.ink,
                }}
              >
                {line.itemName}
              </Text>
              <Text
                style={{
                  fontSize: ds.fontSize(13),
                  fontWeight: '600',
                  color: tipsTheme.ink2,
                }}
                numberOfLines={1}
              >
                {formatQuantity(line.quantity)} {line.unit}
              </Text>
            </View>
          ))}

          {lines.length === 0 ? (
            <Text
              style={{
                paddingVertical: ds.spacing(16),
                fontSize: ds.fontSize(14),
                color: tipsTheme.ink2,
                textAlign: 'center',
              }}
            >
              No items left to send.
            </Text>
          ) : null}
        </ScrollView>
      </View>

      {trimmedNote ? (
        <TouchableOpacity
          onPress={onEditNote}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Edit the order note"
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: ds.spacing(9),
            backgroundColor: tipsTheme.card,
            borderWidth: glassHairlineWidth,
            borderColor: tipsTheme.hairline,
            borderRadius: 18,
            paddingHorizontal: ds.spacing(16),
            paddingVertical: ds.spacing(12),
            marginBottom: ds.spacing(12),
          }}
        >
          <Ionicons name="create-outline" size={ds.icon(16)} color={tipsTheme.accent} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={{
                fontSize: ds.fontSize(11),
                fontWeight: '700',
                letterSpacing: 0.5,
                color: tipsTheme.ink2,
                marginBottom: 1,
              }}
            >
              NOTE
            </Text>
            <Text style={{ fontSize: ds.fontSize(13), color: tipsTheme.ink }} numberOfLines={4}>
              {trimmedNote}
            </Text>
          </View>
        </TouchableOpacity>
      ) : null}

      {unmatchedNames.length > 0 ? (
        <View
          style={{
            backgroundColor: tipsTheme.tint,
            borderRadius: 12,
            paddingHorizontal: ds.spacing(12),
            paddingVertical: ds.spacing(9),
            marginBottom: ds.spacing(12),
          }}
        >
          <Text style={{ fontSize: ds.fontSize(12), color: tipsTheme.alert }}>
            Not in inventory, will be skipped: {unmatchedNames.join(', ')}
          </Text>
        </View>
      ) : null}

      {sendError ? (
        <View
          style={{
            backgroundColor: tipsTheme.tint,
            borderRadius: 12,
            paddingHorizontal: ds.spacing(12),
            paddingVertical: ds.spacing(9),
            marginBottom: ds.spacing(12),
          }}
        >
          <Text style={{ fontSize: ds.fontSize(13), color: tipsTheme.alert }}>{sendError}</Text>
        </View>
      ) : null}

      <TouchableOpacity
        onPress={handleConfirm}
        disabled={isSending || sendableCount === 0}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Confirm and send order"
        style={{
          minHeight: Math.max(52, ds.buttonH),
          borderRadius: radii.pill,
          backgroundColor:
            isSending || sendableCount === 0 ? tipsTheme.disabled : tipsTheme.accent,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {isSending ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={{ fontSize: ds.fontSize(15), fontWeight: '700', color: '#FFFFFF' }}>
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
