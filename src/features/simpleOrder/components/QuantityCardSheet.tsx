import React, { useCallback, useEffect, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '@/components/BottomSheetShell';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { triggerImpactHaptic, triggerSelectionHaptic } from '@/lib/haptics';
import { glassHairlineWidth, radii, tipsTheme } from '@/theme/design';
import { formatQuantity, type SelectionLine } from '../checklistSelection';

/**
 * Quantity card (bottom sheet): opened by tapping a row's quantity. Unit
 * segmented control (the item's unit plus common alternates), big −/+
 * circles, an editable center number, quick chips, and a "Set N unit" CTA.
 * The unit choice is a per-line override on the order line — it never
 * mutates the inventory item's configured units.
 */

interface QuantityCardSheetProps {
  visible: boolean;
  line: SelectionLine | null;
  unitOptions: string[];
  onSetUnit: (key: string, unit: string) => void;
  /** Commits quantity (checks the line) and closes. */
  onCommit: (key: string, quantity: number) => void;
  onClose: () => void;
}

function parseQuantity(raw: string): number | null {
  const cleaned = raw.replace(',', '.').trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function QuantityCardSheet({
  visible,
  line,
  unitOptions,
  onSetUnit,
  onCommit,
  onClose,
}: QuantityCardSheetProps) {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (visible && line) {
      setDraft(formatQuantity(line.quantity));
    }
  }, [visible, line?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const quantity = parseQuantity(draft) ?? line?.quantity ?? 1;

  const adjust = useCallback(
    (delta: number) => {
      void triggerImpactHaptic();
      const current = parseQuantity(draft) ?? line?.quantity ?? 1;
      const stepped =
        delta > 0 ? Math.floor(current) + delta : Math.ceil(current) + delta;
      setDraft(formatQuantity(Math.max(0.5, stepped)));
    },
    [draft, line?.quantity],
  );

  const addChip = useCallback(
    (amount: number) => {
      void triggerSelectionHaptic();
      const current = parseQuantity(draft) ?? line?.quantity ?? 1;
      setDraft(formatQuantity(current + amount));
    },
    [draft, line?.quantity],
  );

  const handleUsual = useCallback(() => {
    if (!line) return;
    void triggerSelectionHaptic();
    const usual =
      line.recommendedQty !== null && line.recommendedQty > 0 ? line.recommendedQty : 1;
    setDraft(formatQuantity(usual));
  }, [line]);

  const handleCommit = useCallback(() => {
    if (!line) return;
    void triggerImpactHaptic();
    onCommit(line.key, quantity);
  }, [line, onCommit, quantity]);

  if (!line) {
    return (
      <BottomSheetShell visible={false} onClose={onClose}>
        <View />
      </BottomSheetShell>
    );
  }

  return (
    <BottomSheetShell
      visible={visible}
      onClose={onClose}
      bottomPadding={Math.max(insets.bottom, ds.spacing(14))}
    >
      <Text style={{ fontSize: ds.fontSize(20), fontWeight: '700', color: tipsTheme.ink }}>
        {line.itemName}
      </Text>
      <Text
        style={{ fontSize: ds.fontSize(13), color: tipsTheme.ink2, marginBottom: ds.spacing(12) }}
      >
        {line.recommendedQty !== null
          ? `Usually ${formatQuantity(line.recommendedQty)} ${line.unit}`
          : `Counted in ${line.unit}`}
      </Text>

      <View
        style={{
          flexDirection: 'row',
          backgroundColor: tipsTheme.card,
          borderWidth: glassHairlineWidth,
          borderColor: tipsTheme.hairline,
          borderRadius: radii.pill,
          padding: 4,
          marginBottom: ds.spacing(16),
        }}
      >
        {unitOptions.map((unit) => {
          const selected = unit.toLowerCase() === line.unit.toLowerCase();
          return (
            <TouchableOpacity
              key={unit}
              onPress={() => {
                void triggerSelectionHaptic();
                onSetUnit(line.key, unit);
              }}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`Use ${unit}`}
              style={{
                flex: 1,
                paddingVertical: ds.spacing(9),
                borderRadius: radii.pill,
                backgroundColor: selected ? tipsTheme.accent : 'transparent',
                alignItems: 'center',
              }}
            >
              <Text
                numberOfLines={1}
                style={{
                  fontSize: ds.fontSize(13),
                  fontWeight: selected ? '700' : '600',
                  color: selected ? '#FFFFFF' : tipsTheme.ink2,
                }}
              >
                {unit}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: ds.spacing(14),
        }}
      >
        <TouchableOpacity
          onPress={() => adjust(-1)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Decrease quantity"
          style={{
            width: 52,
            height: 52,
            borderRadius: radii.circle,
            backgroundColor: tipsTheme.card,
            borderWidth: glassHairlineWidth,
            borderColor: tipsTheme.hairline,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="remove" size={ds.icon(22)} color={tipsTheme.ink} />
        </TouchableOpacity>

        <View style={{ alignItems: 'center' }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            keyboardType="decimal-pad"
            returnKeyType="done"
            selectTextOnFocus
            accessibilityLabel={`Quantity in ${line.unit}`}
            style={{
              minWidth: ds.spacing(120),
              textAlign: 'center',
              fontSize: ds.fontSize(44),
              fontWeight: '700',
              color: tipsTheme.ink,
              paddingVertical: 0,
            }}
          />
          <Text style={{ fontSize: ds.fontSize(13), color: tipsTheme.ink2 }}>{line.unit}</Text>
        </View>

        <TouchableOpacity
          onPress={() => adjust(1)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Increase quantity"
          style={{
            width: 52,
            height: 52,
            borderRadius: radii.circle,
            backgroundColor: tipsTheme.tint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="add" size={ds.icon(22)} color={tipsTheme.accent} />
        </TouchableOpacity>
      </View>

      <View style={{ flexDirection: 'row', gap: ds.spacing(7), marginBottom: ds.spacing(16) }}>
        {[1, 5, 10].map((amount) => (
          <TouchableOpacity
            key={amount}
            onPress={() => addChip(amount)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`Add ${amount}`}
            style={{
              flex: 1,
              paddingVertical: ds.spacing(9),
              borderRadius: radii.pill,
              backgroundColor: tipsTheme.card,
              borderWidth: glassHairlineWidth,
              borderColor: tipsTheme.hairline,
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: ds.fontSize(12.5), fontWeight: '600', color: tipsTheme.ink2 }}>
              +{amount}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          onPress={handleUsual}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Use the usual amount"
          style={{
            flex: 1,
            paddingVertical: ds.spacing(9),
            borderRadius: radii.pill,
            backgroundColor: tipsTheme.card,
            borderWidth: glassHairlineWidth,
            borderColor: tipsTheme.hairline,
            alignItems: 'center',
          }}
        >
          <Text style={{ fontSize: ds.fontSize(12.5), fontWeight: '600', color: tipsTheme.ink2 }}>
            Usual
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        onPress={handleCommit}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`Set ${formatQuantity(quantity)} ${line.unit}`}
        style={{
          minHeight: 52,
          borderRadius: radii.pill,
          backgroundColor: tipsTheme.accent,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: ds.fontSize(15), fontWeight: '700', color: '#FFFFFF' }}>
          Set {formatQuantity(quantity)} {line.unit}
        </Text>
      </TouchableOpacity>
    </BottomSheetShell>
  );
}
