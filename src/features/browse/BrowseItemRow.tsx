import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Alert,
  LayoutAnimation,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AddButton } from '@/components/AddButton';
import { GlassSurface } from '@/components/ui/GlassSurface';
import { CATEGORY_LABELS } from '@/constants';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
} from '@/theme/design';
import { segmentedControlColors } from '@/theme/segmentedControls';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { useOrderStore } from '@/store';
import type { CartItem, OrderInputMode } from '@/store/orderStore';
import type { InventoryItem, UnitType } from '@/types';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface BrowseItemRowProps {
  item: InventoryItem;
  locationId: string | null;
  isActiveEditor: boolean;
  onActivateEditor: (itemId: string) => void;
  onAddAndEdit: (item: InventoryItem) => void;
  onItemRemoved: (itemId: string) => void;
}

function sanitizeNumericInput(value: string): string {
  const filtered = value.replace(/[^0-9.]/g, '');
  if (!filtered) {
    return '';
  }

  if (filtered === '.') {
    return '0.';
  }

  const firstDot = filtered.indexOf('.');
  if (firstDot < 0) {
    return filtered;
  }

  const whole = filtered.slice(0, firstDot);
  const fractional = filtered.slice(firstDot + 1).replace(/\./g, '');
  return `${whole}.${fractional}`;
}

function formatNumericValue(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '0';
  }

  const rounded = Number(value.toFixed(2));
  return Number.isInteger(rounded) ? rounded.toString() : rounded.toString();
}

function animateLayout(reduceMotion: boolean) {
  if (reduceMotion) {
    return;
  }

  LayoutAnimation.configureNext({
    duration: 220,
    create: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
    },
    update: {
      type: LayoutAnimation.Types.spring,
      springDamping: 0.84,
    },
    delete: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
    },
  });
}

function getQuantityFromCart(cartItem: CartItem | undefined): string {
  return formatNumericValue(
    cartItem?.quantityRequested ?? cartItem?.quantity ?? 1,
  );
}

function getRemainingFromCart(cartItem: CartItem | undefined): string {
  return formatNumericValue(cartItem?.remainingReported ?? 0);
}

function getActiveValueText(
  inputMode: OrderInputMode,
  quantityText: string,
  remainingText: string,
) {
  return inputMode === 'quantity' ? quantityText : remainingText;
}

function getUnitLabel(item: InventoryItem, unitType: UnitType) {
  return unitType === 'pack' ? item.pack_unit : item.base_unit;
}

function getCompactSummary(item: InventoryItem, cartItem: CartItem) {
  if (cartItem.inputMode === 'remaining') {
    return `Remaining ${formatNumericValue(cartItem.remainingReported ?? 0)} ${getUnitLabel(item, cartItem.unitType)}`;
  }

  return `${formatNumericValue(cartItem.quantityRequested ?? cartItem.quantity ?? 0)} ${getUnitLabel(item, cartItem.unitType)} in cart`;
}

function ActionIconButton({
  icon,
  onPress,
  accessibilityLabel,
  tint = glassColors.textPrimary,
  backgroundColor = glassColors.mediumFill,
  borderColor = glassColors.controlBorder,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
  tint?: string;
  backgroundColor?: string;
  borderColor?: string;
}) {
  const ds = useScaledStyles();
  const size = Math.max(40, ds.icon(40));

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      activeOpacity={0.82}
      style={{
        width: size,
        height: size,
        borderRadius: glassRadii.stepper,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor,
        borderWidth: glassHairlineWidth,
        borderColor,
      }}
    >
      <Ionicons name={icon} size={ds.icon(18)} color={tint} />
    </TouchableOpacity>
  );
}

function BrowseItemRowInner({
  item,
  locationId,
  isActiveEditor,
  onActivateEditor,
  onAddAndEdit,
  onItemRemoved,
}: BrowseItemRowProps) {
  const ds = useScaledStyles();
  const updateCartItem = useOrderStore((state) => state.updateCartItem);
  const removeFromCart = useOrderStore((state) => state.removeFromCart);
  const setCartItemNote = useOrderStore((state) => state.setCartItemNote);
  const cartItem = useOrderStore(
    useCallback(
      (state) =>
        locationId
          ? state.getCartItem(locationId, item.id, 'employee')
          : undefined,
      [item.id, locationId],
    ),
  );
  const [inputMode, setInputMode] = useState<OrderInputMode>('quantity');
  const [unitType, setUnitType] = useState<UnitType>('pack');
  const [quantityText, setQuantityText] = useState('1');
  const [remainingText, setRemainingText] = useState('0');
  const [noteDraft, setNoteDraft] = useState('');
  const [showNoteEditor, setShowNoteEditor] = useState(false);

  useEffect(() => {
    if (!cartItem) {
      setInputMode('quantity');
      setUnitType('pack');
      setQuantityText('1');
      setRemainingText('0');
      setNoteDraft('');
      setShowNoteEditor(false);
      return;
    }

    setInputMode(cartItem.inputMode);
    setUnitType(cartItem.unitType);
    setQuantityText(getQuantityFromCart(cartItem));
    setRemainingText(getRemainingFromCart(cartItem));
    setNoteDraft(cartItem.note ?? '');
  }, [cartItem]);

  useEffect(() => {
    if (!isActiveEditor) {
      setShowNoteEditor(Boolean(cartItem?.note));
    }
  }, [cartItem?.note, isActiveEditor]);

  const isInCart = Boolean(cartItem);
  const isExpanded = isInCart && isActiveEditor;
  const compactSummary = useMemo(
    () => (cartItem ? getCompactSummary(item, cartItem) : ''),
    [cartItem, item],
  );
  const activeValueText = getActiveValueText(
    inputMode,
    quantityText,
    remainingText,
  );
  const subtitle = `${CATEGORY_LABELS[item.category]} · per ${item.pack_unit}`;

  const commitQuantity = useCallback(
    (nextQuantity: number, nextUnitType: UnitType = unitType) => {
      if (!locationId || !cartItem) {
        return;
      }

      updateCartItem(locationId, item.id, nextQuantity, nextUnitType, {
        cartItemId: cartItem.id,
        inputMode: 'quantity',
        quantityRequested: nextQuantity,
        context: 'employee',
      });
    },
    [cartItem, item.id, locationId, unitType, updateCartItem],
  );

  const commitRemaining = useCallback(
    (nextRemaining: number, nextUnitType: UnitType = unitType) => {
      if (!locationId || !cartItem) {
        return;
      }

      updateCartItem(locationId, item.id, nextRemaining, nextUnitType, {
        cartItemId: cartItem.id,
        inputMode: 'remaining',
        remainingReported: nextRemaining,
        context: 'employee',
      });
    },
    [cartItem, item.id, locationId, unitType, updateCartItem],
  );

  const handleActivateEditor = useCallback(() => {
    animateLayout(ds.reduceMotion);
    onActivateEditor(item.id);
  }, [ds.reduceMotion, item.id, onActivateEditor]);

  const handleAddPress = useCallback(() => {
    animateLayout(ds.reduceMotion);
    onAddAndEdit(item);
  }, [ds.reduceMotion, item, onAddAndEdit]);

  const handleQuantityChange = useCallback(
    (nextValue: string) => {
      const sanitized = sanitizeNumericInput(nextValue);
      setQuantityText(sanitized);

      const parsed = Number.parseFloat(sanitized);
      if (!sanitized || !Number.isFinite(parsed) || parsed <= 0) {
        return;
      }

      commitQuantity(parsed);
    },
    [commitQuantity],
  );

  const handleRemainingChange = useCallback(
    (nextValue: string) => {
      const sanitized = sanitizeNumericInput(nextValue);
      setRemainingText(sanitized);

      const parsed = Number.parseFloat(sanitized);
      if (!sanitized || !Number.isFinite(parsed) || parsed < 0) {
        return;
      }

      commitRemaining(parsed);
    },
    [commitRemaining],
  );

  const handleValueBlur = useCallback(() => {
    if (inputMode === 'quantity') {
      const parsed = Number.parseFloat(quantityText);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setQuantityText(getQuantityFromCart(cartItem));
      }
      return;
    }

    const parsed = Number.parseFloat(remainingText);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setRemainingText(getRemainingFromCart(cartItem));
    }
  }, [cartItem, inputMode, quantityText, remainingText]);

  const handleIncrement = useCallback(() => {
    if (inputMode === 'quantity') {
      const nextValue = (Number.parseFloat(quantityText) || 0) + 1;
      const nextText = formatNumericValue(nextValue);
      setQuantityText(nextText);
      commitQuantity(nextValue);
      return;
    }

    const nextValue = (Number.parseFloat(remainingText) || 0) + 1;
    const nextText = formatNumericValue(nextValue);
    setRemainingText(nextText);
    commitRemaining(nextValue);
  }, [commitQuantity, commitRemaining, inputMode, quantityText, remainingText]);

  const handleRemove = useCallback(() => {
    if (!locationId || !cartItem) {
      return;
    }

    Alert.alert(
      'Remove from cart?',
      `Remove ${item.name} from your order?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            animateLayout(ds.reduceMotion);
            removeFromCart(locationId, item.id, cartItem.id, 'employee');
            onItemRemoved(item.id);
          },
        },
      ],
    );
  }, [
    cartItem,
    ds.reduceMotion,
    item.id,
    item.name,
    locationId,
    onItemRemoved,
    removeFromCart,
  ]);

  const handleDecrement = useCallback(() => {
    if (inputMode === 'quantity') {
      const nextValue = Math.max(0, (Number.parseFloat(quantityText) || 0) - 1);
      if (nextValue <= 0) {
        handleRemove();
        return;
      }

      const nextText = formatNumericValue(nextValue);
      setQuantityText(nextText);
      commitQuantity(nextValue);
      return;
    }

    const nextValue = Math.max(0, (Number.parseFloat(remainingText) || 0) - 1);
    const nextText = formatNumericValue(nextValue);
    setRemainingText(nextText);
    commitRemaining(nextValue);
  }, [
    commitQuantity,
    commitRemaining,
    handleRemove,
    inputMode,
    quantityText,
    remainingText,
  ]);

  const handleModeChange = useCallback(
    (nextMode: OrderInputMode) => {
      if (nextMode === inputMode) {
        return;
      }

      setInputMode(nextMode);
      if (nextMode === 'quantity') {
        const nextQuantity = Math.max(
          1,
          Number.parseFloat(quantityText || getQuantityFromCart(cartItem)) || 1,
        );
        setQuantityText(formatNumericValue(nextQuantity));
        commitQuantity(nextQuantity);
        return;
      }

      const nextRemaining = Math.max(
        0,
        Number.parseFloat(remainingText || getRemainingFromCart(cartItem)) || 0,
      );
      setRemainingText(formatNumericValue(nextRemaining));
      commitRemaining(nextRemaining);
    },
    [
      cartItem,
      commitQuantity,
      commitRemaining,
      inputMode,
      quantityText,
      remainingText,
    ],
  );

  const handleUnitChange = useCallback(
    (nextUnitType: UnitType) => {
      if (nextUnitType === unitType) {
        return;
      }

      setUnitType(nextUnitType);
      if (inputMode === 'quantity') {
        const nextQuantity = Math.max(
          1,
          Number.parseFloat(quantityText || getQuantityFromCart(cartItem)) || 1,
        );
        commitQuantity(nextQuantity, nextUnitType);
        return;
      }

      const nextRemaining = Math.max(
        0,
        Number.parseFloat(remainingText || getRemainingFromCart(cartItem)) || 0,
      );
      commitRemaining(nextRemaining, nextUnitType);
    },
    [
      cartItem,
      commitQuantity,
      commitRemaining,
      inputMode,
      quantityText,
      remainingText,
      unitType,
    ],
  );

  const handleToggleNoteEditor = useCallback(() => {
    animateLayout(ds.reduceMotion);
    setShowNoteEditor((current) => !current);
  }, [ds.reduceMotion]);

  const handleNoteChange = useCallback(
    (nextNote: string) => {
      setNoteDraft(nextNote);
      if (!locationId || !cartItem) {
        return;
      }

      setCartItemNote(locationId, cartItem.id, nextNote, 'employee');
    },
    [cartItem, locationId, setCartItemNote],
  );

  return (
    <GlassSurface
      intensity="subtle"
      style={{
        borderRadius: glassRadii.surface,
      }}
    >
      <View
        style={{
          paddingHorizontal: ds.spacing(14),
          paddingVertical: ds.spacing(12),
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <View style={{ flex: 1, paddingRight: ds.spacing(12) }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              <Text
                style={{
                  flexShrink: 1,
                  fontSize: ds.fontSize(15),
                  fontWeight: '600',
                  color: glassColors.textPrimary,
                }}
                numberOfLines={2}
              >
                {item.name}
              </Text>
              {isInCart ? (
                <View
                  style={{
                    marginLeft: ds.spacing(8),
                    width: ds.icon(20),
                    height: ds.icon(20),
                    borderRadius: glassRadii.round,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: glassColors.successSoft,
                  }}
                >
                  <Ionicons
                    name="checkmark"
                    size={ds.icon(12)}
                    color={glassColors.successText}
                  />
                </View>
              ) : null}
            </View>
            <Text
              style={{
                marginTop: ds.spacing(3),
                fontSize: ds.fontSize(12),
                color: glassColors.textSecondary,
              }}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
            {isExpanded ? (
              <Text
                style={{
                  marginTop: ds.spacing(3),
                  fontSize: ds.fontSize(11),
                  color: glassColors.textMuted,
                }}
              >
                1 {item.pack_unit} = {formatNumericValue(item.pack_size)} {item.base_unit}
              </Text>
            ) : null}
          </View>

          {!isInCart ? (
            <AddButton
              onPress={handleAddPress}
              style={{
                minWidth: ds.spacing(72),
                borderRadius: glassRadii.button,
                backgroundColor: glassColors.accent,
                paddingHorizontal: ds.spacing(14),
                paddingVertical: ds.spacing(8),
                alignItems: 'center',
              }}
              textStyle={{
                fontSize: ds.fontSize(13),
              }}
            />
          ) : isExpanded ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              <ActionIconButton
                icon="ellipsis-horizontal"
                onPress={handleToggleNoteEditor}
                accessibilityLabel="Show more options"
              />
              <View style={{ marginLeft: ds.spacing(8) }}>
                <ActionIconButton
                  icon="trash-outline"
                  onPress={handleRemove}
                  accessibilityLabel="Remove item from cart"
                  tint={glassColors.dangerText}
                  backgroundColor={glassColors.dangerSoft}
                  borderColor="rgba(239, 68, 68, 0.16)"
                />
              </View>
            </View>
          ) : (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Edit ${item.name}`}
                onPress={handleActivateEditor}
                activeOpacity={0.82}
                style={{
                  maxWidth: ds.spacing(132),
                  paddingHorizontal: ds.spacing(12),
                  paddingVertical: ds.spacing(8),
                  borderRadius: glassRadii.pill,
                  backgroundColor: glassColors.successSoft,
                  borderWidth: glassHairlineWidth,
                  borderColor: 'rgba(46, 125, 50, 0.18)',
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    fontSize: ds.fontSize(12),
                    fontWeight: '600',
                    color: glassColors.successText,
                  }}
                >
                  {compactSummary}
                </Text>
              </TouchableOpacity>
              <View style={{ marginLeft: ds.spacing(8) }}>
                <ActionIconButton
                  icon="chevron-down"
                  onPress={handleActivateEditor}
                  accessibilityLabel={`Expand ${item.name} editor`}
                />
              </View>
            </View>
          )}
        </View>

        {isExpanded ? (
          <View
            style={{
              marginTop: ds.spacing(12),
              paddingTop: ds.spacing(12),
              borderTopWidth: glassHairlineWidth,
              borderTopColor: glassColors.divider,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                borderRadius: glassRadii.button,
                borderWidth: glassHairlineWidth,
                borderColor: glassColors.controlBorder,
                backgroundColor: segmentedControlColors.inactiveBackground,
                overflow: 'hidden',
              }}
            >
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Switch to order quantity mode"
                onPress={() => handleModeChange('quantity')}
                style={{
                  flex: 1,
                  minHeight: Math.max(42, ds.buttonH - ds.spacing(6)),
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor:
                    inputMode === 'quantity'
                      ? segmentedControlColors.activeBackground
                      : 'transparent',
                }}
              >
                <Text
                  style={{
                    fontSize: ds.fontSize(13),
                    fontWeight: '600',
                    color:
                      inputMode === 'quantity'
                        ? segmentedControlColors.activeText
                        : segmentedControlColors.inactiveText,
                  }}
                >
                  Order Qty
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Switch to remaining mode"
                onPress={() => handleModeChange('remaining')}
                style={{
                  flex: 1,
                  minHeight: Math.max(42, ds.buttonH - ds.spacing(6)),
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor:
                    inputMode === 'remaining'
                      ? segmentedControlColors.activeBackground
                      : 'transparent',
                }}
              >
                <Text
                  style={{
                    fontSize: ds.fontSize(13),
                    fontWeight: '600',
                    color:
                      inputMode === 'remaining'
                        ? segmentedControlColors.activeText
                        : segmentedControlColors.inactiveText,
                  }}
                >
                  Remaining
                </Text>
              </TouchableOpacity>
            </View>

            <View
              style={{
                marginTop: ds.spacing(12),
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              <View
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
              >
                <ActionIconButton
                  icon="remove"
                  onPress={handleDecrement}
                  accessibilityLabel={`Decrease ${item.name}`}
                  backgroundColor="rgba(0, 0, 0, 0.06)"
                  borderColor="rgba(0, 0, 0, 0.10)"
                />
                <TextInput
                  value={activeValueText}
                  onChangeText={
                    inputMode === 'quantity'
                      ? handleQuantityChange
                      : handleRemainingChange
                  }
                  onBlur={handleValueBlur}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={glassColors.textMuted}
                  style={{
                    flex: 1,
                    minWidth: ds.spacing(58),
                    height: Math.max(40, ds.buttonH - ds.spacing(6)),
                    marginHorizontal: ds.spacing(8),
                    paddingHorizontal: ds.spacing(10),
                    borderRadius: glassRadii.button,
                    borderWidth: glassHairlineWidth,
                    borderColor: glassColors.controlBorder,
                    backgroundColor: glassColors.mediumFill,
                    textAlign: 'center',
                    fontSize: ds.fontSize(18),
                    fontWeight: '600',
                    color: glassColors.textPrimary,
                  }}
                />
                <ActionIconButton
                  icon="add"
                  onPress={handleIncrement}
                  accessibilityLabel={`Increase ${item.name}`}
                  backgroundColor="rgba(0, 0, 0, 0.06)"
                  borderColor="rgba(0, 0, 0, 0.10)"
                />
              </View>

              <View
                style={{
                  width: ds.spacing(136),
                  marginLeft: ds.spacing(10),
                  flexDirection: 'row',
                  borderRadius: glassRadii.button,
                  borderWidth: glassHairlineWidth,
                  borderColor: glassColors.controlBorder,
                  backgroundColor: segmentedControlColors.inactiveBackground,
                  overflow: 'hidden',
                }}
              >
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${item.pack_unit} units`}
                  onPress={() => handleUnitChange('pack')}
                  style={{
                    flex: 1,
                    minHeight: Math.max(40, ds.buttonH - ds.spacing(6)),
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor:
                      unitType === 'pack'
                        ? segmentedControlColors.activeBackground
                        : 'transparent',
                  }}
                >
                  <Text
                    numberOfLines={1}
                    style={{
                      fontSize: ds.fontSize(12),
                      fontWeight: '600',
                      color:
                        unitType === 'pack'
                          ? segmentedControlColors.activeText
                          : segmentedControlColors.inactiveText,
                    }}
                  >
                    {item.pack_unit}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${item.base_unit} units`}
                  onPress={() => handleUnitChange('base')}
                  style={{
                    flex: 1,
                    minHeight: Math.max(40, ds.buttonH - ds.spacing(6)),
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor:
                      unitType === 'base'
                        ? segmentedControlColors.activeBackground
                        : 'transparent',
                  }}
                >
                  <Text
                    numberOfLines={1}
                    style={{
                      fontSize: ds.fontSize(12),
                      fontWeight: '600',
                      color:
                        unitType === 'base'
                          ? segmentedControlColors.activeText
                          : segmentedControlColors.inactiveText,
                    }}
                  >
                    {item.base_unit}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {showNoteEditor ? (
              <View style={{ marginTop: ds.spacing(12) }}>
                <Text
                  style={{
                    marginBottom: ds.spacing(6),
                    fontSize: ds.fontSize(11),
                    fontWeight: '600',
                    color: glassColors.textSecondary,
                    textTransform: 'uppercase',
                    letterSpacing: 0.4,
                  }}
                >
                  Note
                </Text>
                <TextInput
                  value={noteDraft}
                  onChangeText={handleNoteChange}
                  placeholder="Add note for this item"
                  placeholderTextColor={glassColors.textMuted}
                  style={{
                    minHeight: Math.max(42, ds.buttonH - ds.spacing(6)),
                    paddingHorizontal: ds.spacing(12),
                    paddingVertical: ds.spacing(10),
                    borderRadius: glassRadii.button,
                    borderWidth: glassHairlineWidth,
                    borderColor: glassColors.controlBorder,
                    backgroundColor: glassColors.mediumFill,
                    fontSize: ds.fontSize(14),
                    color: glassColors.textPrimary,
                  }}
                />
              </View>
            ) : null}

            {inputMode === 'remaining' ? (
              <Text
                style={{
                  marginTop: ds.spacing(10),
                  fontSize: ds.fontSize(11),
                  color: glassColors.textSecondary,
                }}
              >
                Remaining records what is left on hand. Final order quantity can
                be decided later.
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </GlassSurface>
  );
}

export const BrowseItemRow = memo(BrowseItemRowInner);
