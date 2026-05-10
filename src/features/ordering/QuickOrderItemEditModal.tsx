import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  KeyboardEvent,
  Modal,
  Platform,
  Pressable,
  ScrollView,
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
  getParsedItemIssue,
  type ParsedItemIssueKind,
  type ParsedQuickOrderItem,
  type QuickOrderInventoryItem,
} from './quickOrderItems';

export type QuickOrderItemEditResult = {
  itemId: string | null;
  itemName: string;
  /** Selected inventory row when the user picked one, else null. */
  inventoryItem: QuickOrderInventoryItem | null;
  quantity: number;
  unit: string;
};

type QuickOrderItemEditModalProps = {
  visible: boolean;
  /** Item being edited; null when the modal is closed. */
  item: ParsedQuickOrderItem | null;
  /** Active inventory rows used for the item picker. */
  inventoryItems: QuickOrderInventoryItem[];
  isSaving: boolean;
  canRemove: boolean;
  onClose: () => void;
  onSave: (result: QuickOrderItemEditResult) => void;
  onRemove: () => void;
};

/**
 * Keyboard-safe popup for fixing a single parsed Quick Order item.
 *
 * Renders inside a transparent `Modal` (so it floats above the tab bar, the
 * Order List card and the composer). Layout:
 *   KeyboardAvoidingView (padding on iOS)
 *     → backdrop (tap to dismiss)
 *     → bottom sheet, `maxHeight` = available window height − keyboard − top inset
 *         → ScrollView (keyboardShouldPersistTaps="handled") — inputs
 *         → fixed footer — Cancel / Save (always visible above the keyboard)
 *
 * The editable inputs are controlled local state, re-initialised from `item`
 * whenever a different item is opened (the body is keyed on the item).
 */
export function QuickOrderItemEditModal(props: QuickOrderItemEditModalProps) {
  const { visible, item } = props;

  return (
    <Modal visible={visible && Boolean(item)} transparent animationType="slide" onRequestClose={props.onClose}>
      {item ? <EditModalBody key={keyForItem(item)} {...props} item={item} /> : null}
    </Modal>
  );
}

function keyForItem(item: ParsedQuickOrderItem): string {
  return item.item_id ?? item.raw_token ?? getParsedItemDisplayName(item);
}

type EditModalBodyProps = Omit<QuickOrderItemEditModalProps, 'visible' | 'item'> & {
  item: ParsedQuickOrderItem;
};

function EditModalBody({
  item,
  inventoryItems,
  isSaving,
  canRemove,
  onClose,
  onSave,
  onRemove,
}: EditModalBodyProps) {
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

  const originalName = getParsedItemDisplayName(item);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(item.item_id ?? null);
  const [search, setSearch] = useState(originalName);
  const [quantity, setQuantity] = useState(item.quantity != null ? String(item.quantity) : '');
  const [unit, setUnit] = useState(item.unit ?? '');
  const [error, setError] = useState<string | null>(null);

  const inventoryById = useMemo(() => {
    const map = new Map<string, QuickOrderInventoryItem>();
    inventoryItems.forEach((row) => map.set(row.id, row));
    return map;
  }, [inventoryItems]);

  const selectedInventory = selectedItemId ? inventoryById.get(selectedItemId) ?? null : null;
  const needsItemPick = !item.item_id || item.unresolved;

  const matches = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized || normalized === selectedInventory?.name.trim().toLowerCase()) return [];
    return inventoryItems.filter((row) => row.name.toLowerCase().includes(normalized)).slice(0, 8);
  }, [inventoryItems, search, selectedInventory]);

  const issue = getParsedItemIssue(item);

  const handlePickInventory = (row: QuickOrderInventoryItem) => {
    void triggerSelectionHaptic();
    Keyboard.dismiss();
    setSelectedItemId(row.id);
    setSearch(row.name);
    setUnit((current) => (current.trim() ? current : row.base_unit ?? row.pack_unit ?? ''));
    setError(null);
  };

  const handleSave = () => {
    const numericQty = Number(quantity);
    if (!Number.isFinite(numericQty) || numericQty <= 0) {
      setError('Enter a quantity greater than zero.');
      return;
    }
    if (needsItemPick && !selectedInventory) {
      setError('Pick an inventory item from the list.');
      return;
    }
    const trimmedUnit = unit.trim();
    const resolvedName = selectedInventory?.name ?? originalName;
    onSave({
      itemId: selectedInventory?.id ?? item.item_id ?? null,
      itemName: resolvedName,
      inventoryItem: selectedInventory,
      quantity: numericQty,
      unit: trimmedUnit,
    });
  };

  const handleRemove = () => {
    void triggerSelectionHaptic();
    onRemove();
  };

  // Available height for the sheet: full window minus the status-bar inset and
  // (when open) the keyboard. The KeyboardAvoidingView still nudges content up;
  // this cap stops the sheet from ever overflowing the top of the screen.
  const sheetMaxHeight = Math.max(
    windowHeight - insets.top - keyboardHeight - ds.spacing(20),
    ds.spacing(240),
  );

  const unitPresets = useMemo(() => {
    const presets = new Set<string>();
    if (selectedInventory?.base_unit) presets.add(selectedInventory.base_unit);
    if (selectedInventory?.pack_unit) presets.add(selectedInventory.pack_unit);
    ['lb', 'case', 'pack', 'each'].forEach((value) => presets.add(value));
    return Array.from(presets).filter(Boolean).slice(0, 6);
  }, [selectedInventory]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.flex}
    >
      <Pressable accessibilityLabel="Dismiss editor" style={styles.backdrop} onPress={onClose} />
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
              {originalName}
            </Text>
            <Text style={[styles.subtitle, { fontSize: ds.fontSize(12) }]} numberOfLines={1}>
              {item.raw_token?.trim() ? `You typed “${item.raw_token.trim()}”` : 'Edit this order item'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close editor"
            hitSlop={8}
            onPress={onClose}
            style={({ pressed }) => [styles.closeButton, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Ionicons name="close" size={ds.icon(22)} color={colors.textPrimary} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={{ paddingBottom: ds.spacing(8) }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {issue ? (
            <View style={[styles.issueBanner, { borderRadius: ds.radius(14), padding: ds.spacing(12), marginTop: ds.spacing(12) }]}>
              <Ionicons name="alert-circle" size={ds.icon(18)} color={colors.statusAmber} />
              <Text style={[styles.issueText, { fontSize: ds.fontSize(14), marginLeft: ds.spacing(8) }]}>
                {issueLabelFull(issue.kind)}
              </Text>
            </View>
          ) : null}

          <Text style={[styles.label, { fontSize: ds.fontSize(12), marginTop: ds.spacing(16) }]}>Item</Text>
          <TextInput
            value={search}
            onChangeText={(value) => {
              setSearch(value);
              if (value.trim() !== selectedInventory?.name.trim()) setSelectedItemId(null);
              setError(null);
            }}
            placeholder="Search inventory item"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { fontSize: ds.fontSize(16), minHeight: ds.spacing(48), borderRadius: ds.radius(14) }]}
          />
          {matches.length > 0 ? (
            <View style={{ marginTop: ds.spacing(8), gap: ds.spacing(6) }}>
              {matches.map((row) => (
                <Pressable
                  key={row.id}
                  onPress={() => handlePickInventory(row)}
                  style={({ pressed }) => [
                    styles.matchRow,
                    { borderRadius: ds.radius(10), minHeight: ds.spacing(42), paddingHorizontal: ds.spacing(12), backgroundColor: pressed ? colors.primaryPale : colors.glassCircle },
                  ]}
                >
                  <Text style={[styles.matchText, { fontSize: ds.fontSize(15) }]}>{row.name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <Text style={[styles.selectedHint, { fontSize: ds.fontSize(12), marginTop: ds.spacing(8) }]}>
            {selectedInventory ? `Selected: ${selectedInventory.name}` : needsItemPick ? 'No inventory item selected yet.' : `Keeping: ${originalName}`}
          </Text>

          <View style={{ flexDirection: 'row', gap: ds.spacing(12), marginTop: ds.spacing(16) }}>
            <View style={{ flex: 0.85 }}>
              <Text style={[styles.label, { fontSize: ds.fontSize(12) }]}>Quantity</Text>
              <TextInput
                value={quantity}
                onChangeText={(value) => {
                  setQuantity(value.replace(/[^0-9.]/g, ''));
                  setError(null);
                }}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, { fontSize: ds.fontSize(16), minHeight: ds.spacing(48), borderRadius: ds.radius(14) }]}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { fontSize: ds.fontSize(12) }]}>Unit</Text>
              <TextInput
                value={unit}
                onChangeText={(value) => {
                  setUnit(value);
                  setError(null);
                }}
                autoCapitalize="none"
                placeholder="lb, case, pack"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, { fontSize: ds.fontSize(16), minHeight: ds.spacing(48), borderRadius: ds.radius(14) }]}
              />
            </View>
          </View>
          {unitPresets.length > 0 ? (
            <View style={[styles.presetRow, { marginTop: ds.spacing(10) }]}>
              {unitPresets.map((preset) => {
                const active = preset.trim().toLowerCase() === unit.trim().toLowerCase();
                return (
                  <Pressable
                    key={preset}
                    onPress={() => {
                      void triggerSelectionHaptic();
                      setUnit(preset);
                      setError(null);
                    }}
                    style={({ pressed }) => [
                      styles.presetChip,
                      {
                        borderRadius: ds.radius(999),
                        paddingHorizontal: ds.spacing(12),
                        paddingVertical: ds.spacing(6),
                        backgroundColor: active ? colors.primaryLight : colors.glassCircle,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.presetText,
                        { fontSize: ds.fontSize(13), color: active ? colors.primary : colors.textSecondary },
                      ]}
                    >
                      {preset}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {error ? (
            <Text style={[styles.errorText, { fontSize: ds.fontSize(13), marginTop: ds.spacing(12) }]}>{error}</Text>
          ) : null}

          {canRemove ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove item from order"
              onPress={handleRemove}
              disabled={isSaving}
              style={({ pressed }) => [
                styles.removeButton,
                { borderRadius: ds.radius(14), minHeight: ds.spacing(46), marginTop: ds.spacing(18), opacity: isSaving ? 0.5 : pressed ? 0.7 : 1 },
              ]}
            >
              <Ionicons name="trash-outline" size={ds.icon(16)} color={colors.statusRed} />
              <Text style={[styles.removeText, { fontSize: ds.fontSize(15), marginLeft: ds.spacing(6) }]}>
                Remove from order
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>

        <View style={[styles.footer, { gap: ds.spacing(10), paddingTop: ds.spacing(12), borderTopColor: colors.divider }]}>
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
            accessibilityLabel="Save changes"
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

function issueLabelFull(kind: ParsedItemIssueKind): string {
  switch (kind) {
    case 'choose-item':
      return 'This text didn’t match an inventory item — pick one below.';
    case 'pick-quantity':
      return 'This item needs a quantity before the order can be sent.';
    case 'pick-unit':
      return 'This item needs a unit (lb, case, pack…).';
    case 'needs-clarification':
      return 'The parser flagged this item for review — double-check it.';
    default:
      return 'Review this item.';
  }
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
  issueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.statusAmberBg,
  },
  issueText: {
    flex: 1,
    color: colors.statusAmber,
    fontWeight: '700',
    letterSpacing: 0,
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
    paddingHorizontal: 12,
    fontWeight: '700',
    letterSpacing: 0,
  },
  matchRow: {
    justifyContent: 'center',
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
  },
  matchText: {
    color: colors.textPrimary,
    fontWeight: '700',
    letterSpacing: 0,
  },
  selectedHint: {
    color: colors.textSecondary,
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
  removeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.statusRedBg,
  },
  removeText: {
    color: colors.statusRed,
    fontWeight: '800',
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
