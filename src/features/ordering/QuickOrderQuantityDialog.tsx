import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  KeyboardEvent,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { triggerSelectionHaptic } from '@/lib/haptics';
import { colors, glassColors, glassHairlineWidth } from '@/theme/design';
import {
  getParsedItemDisplayName,
  type ParsedQuickOrderItem,
  type QuickOrderInventoryItem,
} from './quickOrderItems';

export type QuickOrderQuantityResult = {
  quantity: number;
  unit: string;
};

type QuickOrderQuantityDialogProps = {
  visible: boolean;
  /** Item being resolved; null when the dialog is closed. */
  item: ParsedQuickOrderItem | null;
  /** Inventory row backing the item, when known — used to seed unit presets. */
  inventoryItem: QuickOrderInventoryItem | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (result: QuickOrderQuantityResult) => void;
};

const COMMON_UNITS = ['lb', 'case', 'pack', 'each'];

/**
 * Focused, keyboard-safe popup for filling in a missing quantity (and a unit,
 * when the item doesn't have one yet or supports more than one). Deliberately
 * narrower than {@link QuickOrderItemEditModal} — no inventory picker, no
 * remove action — so the common "you typed an item with no quantity" fix is one
 * tap and one number away.
 */
export function QuickOrderQuantityDialog(props: QuickOrderQuantityDialogProps) {
  const { visible, item } = props;
  return (
    <Modal
      visible={visible && Boolean(item)}
      transparent
      animationType="slide"
      onRequestClose={props.onClose}
    >
      {item ? <DialogBody key={bodyKey(item)} {...props} item={item} /> : null}
    </Modal>
  );
}

function bodyKey(item: ParsedQuickOrderItem): string {
  return item.item_id ?? item.raw_token ?? getParsedItemDisplayName(item);
}

type DialogBodyProps = Omit<QuickOrderQuantityDialogProps, 'visible' | 'item'> & {
  item: ParsedQuickOrderItem;
};

function DialogBody({ item, inventoryItem, isSaving, onClose, onSave }: DialogBodyProps) {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (event: KeyboardEvent) =>
      setKeyboardHeight(event.endCoordinates.height),
    );
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const name = getParsedItemDisplayName(item);
  const initialUnit = (item.unit ?? inventoryItem?.pack_unit ?? inventoryItem?.base_unit ?? '').trim();
  const hasBothUnits = Boolean(inventoryItem?.base_unit && inventoryItem?.pack_unit);
  const showUnitPicker = !item.unit?.trim() || hasBothUnits;

  const [quantity, setQuantity] = useState(
    item.quantity != null && Number.isFinite(item.quantity) && item.quantity > 0
      ? String(item.quantity)
      : '',
  );
  const [unit, setUnit] = useState(initialUnit);
  const [error, setError] = useState<string | null>(null);

  const unitPresets = useMemo(() => {
    const presets = new Set<string>();
    if (inventoryItem?.base_unit) presets.add(inventoryItem.base_unit.trim());
    if (inventoryItem?.pack_unit) presets.add(inventoryItem.pack_unit.trim());
    if (initialUnit) presets.add(initialUnit);
    COMMON_UNITS.forEach((value) => presets.add(value));
    return Array.from(presets).filter(Boolean).slice(0, 6);
  }, [inventoryItem, initialUnit]);

  const handleSave = () => {
    const numericQty = Number(quantity);
    if (!Number.isFinite(numericQty) || numericQty <= 0) {
      setError('Enter a quantity greater than zero.');
      return;
    }
    const trimmedUnit = unit.trim();
    if (showUnitPicker && !trimmedUnit) {
      setError('Pick a unit (lb, case, pack…).');
      return;
    }
    onSave({ quantity: numericQty, unit: trimmedUnit || initialUnit });
  };

  const sheetMaxHeight = Math.max(
    windowHeight - insets.top - keyboardHeight - ds.spacing(20),
    ds.spacing(220),
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.flex}
    >
      <Pressable accessibilityLabel="Dismiss quantity editor" style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          {
            maxHeight: sheetMaxHeight,
            borderTopLeftRadius: ds.radius(26),
            borderTopRightRadius: ds.radius(26),
            paddingHorizontal: ds.spacing(20),
            paddingTop: ds.spacing(10),
            paddingBottom: Math.max(insets.bottom, ds.spacing(12)),
          },
        ]}
      >
        <View style={styles.grabberRow}>
          <View style={[styles.grabber, { backgroundColor: colors.textMuted }]} />
        </View>

        <View style={styles.headerRow}>
          <View style={styles.flexShrink}>
            <Text style={[styles.title, { fontSize: ds.fontSize(20) }]} numberOfLines={1}>
              Add quantity
            </Text>
            <Text style={[styles.subtitle, { fontSize: ds.fontSize(13) }]} numberOfLines={1}>
              {item.raw_token?.trim() ? `You typed “${item.raw_token.trim()}” — ${name}` : name}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={8}
            onPress={onClose}
            style={({ pressed }) => [styles.closeButton, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Ionicons name="close" size={ds.icon(22)} color={colors.textPrimary} />
          </Pressable>
        </View>

        <Text style={[styles.label, { fontSize: ds.fontSize(12), marginTop: ds.spacing(16) }]}>
          Quantity
        </Text>
        <TextInput
          value={quantity}
          onChangeText={(value) => {
            setQuantity(value.replace(/[^0-9.]/g, ''));
            setError(null);
          }}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={colors.textMuted}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={handleSave}
          style={[
            styles.input,
            { fontSize: ds.fontSize(18), minHeight: ds.spacing(50), borderRadius: ds.radius(14) },
          ]}
        />

        {showUnitPicker ? (
          <>
            <Text style={[styles.label, { fontSize: ds.fontSize(12), marginTop: ds.spacing(16) }]}>
              Unit
            </Text>
            <View style={styles.presetRow}>
              {unitPresets.map((preset) => {
                const active = preset.toLowerCase() === unit.trim().toLowerCase();
                return (
                  <Pressable
                    key={preset}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Use unit ${preset}`}
                    onPress={() => {
                      void triggerSelectionHaptic();
                      setUnit(preset);
                      setError(null);
                    }}
                    style={({ pressed }) => [
                      styles.presetChip,
                      {
                        borderRadius: ds.radius(999),
                        paddingHorizontal: ds.spacing(14),
                        paddingVertical: ds.spacing(8),
                        backgroundColor: active ? colors.primaryLight : colors.glassCircle,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.presetText,
                        {
                          fontSize: ds.fontSize(14),
                          color: active ? colors.primary : colors.textSecondary,
                        },
                      ]}
                    >
                      {preset}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {error ? (
          <Text style={[styles.errorText, { fontSize: ds.fontSize(13), marginTop: ds.spacing(12) }]}>
            {error}
          </Text>
        ) : null}

        <View
          style={[
            styles.footer,
            { gap: ds.spacing(10), marginTop: ds.spacing(20), paddingTop: ds.spacing(12), borderTopColor: colors.divider },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            onPress={onClose}
            disabled={isSaving}
            style={({ pressed }) => [
              styles.secondaryButton,
              { borderRadius: ds.radius(999), minHeight: ds.spacing(50), opacity: isSaving ? 0.6 : pressed ? 0.82 : 1 },
            ]}
          >
            <Text style={[styles.secondaryText, { fontSize: ds.fontSize(16) }]}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save quantity"
            onPress={handleSave}
            disabled={isSaving}
            style={({ pressed }) => [
              styles.primaryButton,
              { borderRadius: ds.radius(999), minHeight: ds.spacing(50), opacity: isSaving ? 0.7 : pressed ? 0.86 : 1 },
            ]}
          >
            {isSaving ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={[styles.primaryText, { fontSize: ds.fontSize(16) }]}>Save</Text>
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  flexShrink: {
    flex: 1,
    minWidth: 0,
  },
  backdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
  },
  sheet: {
    backgroundColor: colors.white,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
    shadowColor: '#111111',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 12,
  },
  grabberRow: {
    alignItems: 'center',
    paddingBottom: 10,
  },
  grabber: {
    width: 42,
    height: 4,
    borderRadius: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  title: {
    color: colors.textPrimary,
    fontWeight: '800',
    letterSpacing: 0,
  },
  subtitle: {
    color: colors.textSecondary,
    fontWeight: '600',
    marginTop: 3,
    letterSpacing: 0,
  },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  label: {
    color: colors.textSecondary,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  input: {
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
    backgroundColor: colors.glassCircle,
    color: colors.textPrimary,
    paddingHorizontal: 14,
    fontWeight: '700',
    letterSpacing: 0,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetChip: {
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
  },
  presetText: {
    fontWeight: '800',
    letterSpacing: 0,
  },
  errorText: {
    color: colors.statusRed,
    fontWeight: '700',
    letterSpacing: 0,
  },
  footer: {
    flexDirection: 'row',
    borderTopWidth: glassHairlineWidth,
  },
  secondaryButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glassCircle,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
  },
  secondaryText: {
    color: colors.textPrimary,
    fontWeight: '800',
    letterSpacing: 0,
  },
  primaryButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  primaryText: {
    color: colors.textOnPrimary,
    fontWeight: '800',
    letterSpacing: 0,
  },
});
