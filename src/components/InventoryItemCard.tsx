import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { InventoryItem, UnitType } from '@/types';
import { useOrderStore } from '@/store';
import type { OrderInputMode, CartContext } from '@/store/orderStore';
import { categoryColors, CATEGORY_LABELS } from '@/constants';
import { GlassView } from '@/components/ui';
import {
  categoryGlassTints,
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassStatusStyles,
} from '@/design/tokens';
import { useScaledStyles } from '@/hooks/useScaledStyles';

interface InventoryItemCardProps {
  item: InventoryItem;
  locationId: string;
  cartContext?: CartContext;
  hideCategory?: boolean;
}

function sanitizeNumericInput(value: string): string {
  const filtered = value.replace(/[^0-9.]/g, '');
  if (!filtered) return '';
  if (filtered === '.') return '0.';

  const firstDot = filtered.indexOf('.');
  if (firstDot < 0) return filtered;

  const whole = filtered.slice(0, firstDot);
  const fractional = filtered.slice(firstDot + 1).replace(/\./g, '');
  return `${whole}.${fractional}`;
}

// Memoized to prevent re-renders in list virtualization
function InventoryItemCardInner({ item, locationId, cartContext, hideCategory }: InventoryItemCardProps) {
  const addToCart = useOrderStore((state) => state.addToCart);
  const updateCartItem = useOrderStore((state) => state.updateCartItem);
  const removeFromCart = useOrderStore((state) => state.removeFromCart);
  const cartItem = useOrderStore(
    useCallback((state) => state.getCartItem(locationId, item.id, cartContext), [locationId, item.id, cartContext])
  );
  const ds = useScaledStyles();
  const [isExpanded, setIsExpanded] = useState(false);
  const [inputMode, setInputMode] = useState<OrderInputMode>(cartItem?.inputMode ?? 'quantity');
  const [quantity, setQuantity] = useState(
    cartItem?.quantityRequested?.toString() || cartItem?.quantity?.toString() || '1'
  );
  const [remaining, setRemaining] = useState(
    cartItem?.remainingReported?.toString() || '0'
  );
  const [unitType, setUnitType] = useState<UnitType>(cartItem?.unitType || 'pack');

  useEffect(() => {
    if (!cartItem) return;
    setInputMode(cartItem.inputMode);
    setUnitType(cartItem.unitType);

    if (cartItem.inputMode === 'quantity') {
      setQuantity((cartItem.quantityRequested ?? cartItem.quantity ?? 1).toString());
    } else {
      setRemaining((cartItem.remainingReported ?? 0).toString());
    }
  }, [cartItem]);

  const categoryColor = categoryColors[item.category] || glassColors.textTertiary;
  const categoryTint = categoryGlassTints[item.category];
  const showControls = isExpanded || Boolean(cartItem);

  const baseFontSize = ds.fontSize(16);
  const tinyFontSize = ds.fontSize(12);
  const modeToggleHeight = Math.max(44, ds.buttonH - ds.spacing(6));
  const controlButtonSize = Math.max(40, ds.icon(40));

  const parsedQuantity = Number.parseFloat(quantity);
  const parsedRemaining = Number.parseFloat(remaining);
  const isQuantityValid = Number.isFinite(parsedQuantity) && parsedQuantity > 0;
  const isRemainingValid = Number.isFinite(parsedRemaining) && parsedRemaining >= 0;

  const handleAddToCart = () => {
    if (inputMode === 'quantity') {
      const qty = Number.parseFloat(quantity);
      if (qty > 0) {
        addToCart(locationId, item.id, qty, unitType, {
          inputMode: 'quantity',
          quantityRequested: qty,
          context: cartContext,
        });
        setIsExpanded(false);
      }
      return;
    }

    const rem = Number.parseFloat(remaining);
    if (rem >= 0) {
      addToCart(locationId, item.id, rem, unitType, {
        inputMode: 'remaining',
        remainingReported: rem,
        context: cartContext,
      });
      setIsExpanded(false);
    }
  };

  const handleCancelExpand = () => {
    if (cartItem) return;
    setIsExpanded(false);
    setInputMode('quantity');
    setQuantity('1');
    setRemaining('0');
    setUnitType('pack');
  };

  const handleUpdateQuantity = (newQty: string) => {
    const sanitized = sanitizeNumericInput(newQty);
    setQuantity(sanitized);

    const qty = Number.parseFloat(sanitized);
    if (!sanitized || !Number.isFinite(qty) || qty <= 0 || !cartItem) {
      return;
    }

    updateCartItem(locationId, item.id, qty, unitType, {
      cartItemId: cartItem.id,
      inputMode: 'quantity',
      quantityRequested: qty,
      context: cartContext,
    });
  };

  const handleUpdateRemaining = (newRemaining: string) => {
    const sanitized = sanitizeNumericInput(newRemaining);
    setRemaining(sanitized);
    const rem = Number.parseFloat(sanitized);

    if (!sanitized || !Number.isFinite(rem) || rem < 0 || !cartItem) {
      return;
    }

    updateCartItem(locationId, item.id, rem, unitType, {
      cartItemId: cartItem.id,
      inputMode: 'remaining',
      remainingReported: rem,
      context: cartContext,
    });
  };

  const handleIncrement = () => {
    if (inputMode === 'quantity') {
      const current = Number.parseFloat(quantity) || 0;
      const next = current + 1;
      const nextText = next.toString();
      setQuantity(nextText);

      if (cartItem) {
        updateCartItem(locationId, item.id, next, unitType, {
          cartItemId: cartItem.id,
          inputMode: 'quantity',
          quantityRequested: next,
          context: cartContext,
        });
      }
      return;
    }

    const current = Number.parseFloat(remaining) || 0;
    const next = current + 1;
    const nextText = next.toString();
    setRemaining(nextText);

    if (cartItem) {
      updateCartItem(locationId, item.id, next, unitType, {
        cartItemId: cartItem.id,
        inputMode: 'remaining',
        remainingReported: next,
        context: cartContext,
      });
    }
  };

  const handleDecrement = () => {
    if (inputMode === 'quantity') {
      const current = Number.parseFloat(quantity) || 0;
      const next = Math.max(0, current - 1);
      setQuantity(next.toString());

      if (cartItem) {
        if (next <= 0) {
          removeFromCart(locationId, item.id, cartItem.id, cartContext);
          setQuantity('1');
          setIsExpanded(false);
        } else {
          updateCartItem(locationId, item.id, next, unitType, {
            cartItemId: cartItem.id,
            inputMode: 'quantity',
            quantityRequested: next,
            context: cartContext,
          });
        }
      }
      return;
    }

    const current = Number.parseFloat(remaining) || 0;
    const next = Math.max(0, current - 1);
    setRemaining(next.toString());

    if (cartItem) {
      updateCartItem(locationId, item.id, next, unitType, {
        cartItemId: cartItem.id,
        inputMode: 'remaining',
        remainingReported: next,
        context: cartContext,
      });
    }
  };

  const toggleUnit = () => {
    const newUnit = unitType === 'base' ? 'pack' : 'base';
    setUnitType(newUnit);

    if (!cartItem) return;

    if (inputMode === 'quantity') {
      const qty = Number.parseFloat(quantity);
      if (!Number.isFinite(qty) || qty <= 0) return;

      updateCartItem(locationId, item.id, qty, newUnit, {
        cartItemId: cartItem.id,
        inputMode: 'quantity',
        quantityRequested: qty,
        context: cartContext,
      });
      return;
    }

    const rem = Number.parseFloat(remaining);
    if (!Number.isFinite(rem) || rem < 0) return;

    updateCartItem(locationId, item.id, rem, newUnit, {
      cartItemId: cartItem.id,
      inputMode: 'remaining',
      remainingReported: rem,
      context: cartContext,
    });
  };

  const handleModeChange = (mode: OrderInputMode) => {
    setInputMode(mode);

    if (!cartItem) return;

    if (mode === 'quantity') {
      const qty = Math.max(1, Number.parseFloat(quantity) || 1);
      setQuantity(qty.toString());
      updateCartItem(locationId, item.id, qty, unitType, {
        cartItemId: cartItem.id,
        inputMode: 'quantity',
        quantityRequested: qty,
        context: cartContext,
      });
      return;
    }

    const rem = Math.max(0, Number.parseFloat(remaining) || 0);
    setRemaining(rem.toString());
    updateCartItem(locationId, item.id, rem, unitType, {
      cartItemId: cartItem.id,
      inputMode: 'remaining',
      remainingReported: rem,
      context: cartContext,
    });
  };

  const handleExpandToAdd = () => {
    setInputMode('quantity');
    setQuantity('1');
    setRemaining('0');
    setIsExpanded(true);
  };

  const value = inputMode === 'quantity' ? quantity : remaining;
  const onValueChange = inputMode === 'quantity' ? handleUpdateQuantity : handleUpdateRemaining;
  const isInputValid = inputMode === 'quantity' ? isQuantityValid : isRemainingValid;

  return (
    <GlassView
      variant="card"
      style={{
        padding: ds.cardPad,
        borderRadius: glassRadii.surface,
      }}
    >
      {/* Top row: Name and Add button / Controls */}
      <View className="flex-row items-center justify-between">
        {/* Left: Item info */}
        <View className="flex-1 mr-3">
          <View className="flex-row items-center">
            <Text
              style={{
                fontSize: ds.fontSize(18),
                color: glassColors.textPrimary,
                fontWeight: '600',
                flexShrink: 1,
              }}
              numberOfLines={1}
            >
              {item.name}
            </Text>
            {cartItem && (
              <View
                className="items-center justify-center ml-2"
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: glassRadii.round,
                  backgroundColor: 'rgba(34, 197, 94, 0.18)',
                  borderWidth: 2,
                  borderColor: 'rgba(34, 197, 94, 0.5)',
                }}
              >
                <Ionicons
                  name="checkmark"
                  size={16}
                  color={glassStatusStyles.success.text}
                />
              </View>
            )}
          </View>
          <View className="flex-row items-center mt-2">
            {!hideCategory && (
              <View
                style={{
                  backgroundColor: categoryTint?.background ?? `${categoryColor}14`,
                  paddingHorizontal: ds.spacing(10),
                  paddingVertical: ds.spacing(4),
                  borderRadius: glassRadii.tag,
                  marginRight: ds.spacing(10),
                }}
              >
                <Text style={{ color: categoryColor, fontSize: tinyFontSize, fontWeight: '500' }}>
                  {CATEGORY_LABELS[item.category]}
                </Text>
              </View>
            )}
            <Text
              style={{ fontSize: ds.fontSize(13), color: glassColors.textSecondary }}
            >
              {item.pack_size} {item.base_unit}/{item.pack_unit}
            </Text>
            {cartItem?.inputMode === 'remaining' && (
              <View
                style={{
                  marginLeft: ds.spacing(8),
                  borderRadius: glassRadii.tag,
                  backgroundColor: glassStatusStyles.warning.background,
                  paddingHorizontal: ds.spacing(8),
                  paddingVertical: ds.spacing(2),
                }}
              >
                <Text
                  style={{
                    fontSize: ds.fontSize(9),
                    color: glassStatusStyles.warning.text,
                    fontWeight: '500',
                  }}
                >
                  Remaining
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Right: Add button */}
        {!showControls && (
          <TouchableOpacity
            style={{
              minWidth: 76,
              height: Math.max(40, ds.buttonH - ds.spacing(4)),
              paddingHorizontal: ds.spacing(20),
              borderRadius: glassRadii.button,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: glassColors.accent,
            }}
            onPress={handleExpandToAdd}
          >
            <Text
              style={{
                fontSize: ds.fontSize(16),
                color: glassColors.textOnPrimary,
                fontWeight: '600',
              }}
            >
              Add
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Quantity/Remaining Controls */}
      {showControls && (
        <View
          style={{
            marginTop: ds.spacing(12),
            paddingTop: ds.spacing(12),
            borderTopWidth: glassHairlineWidth,
            borderTopColor: glassColors.divider,
          }}
        >
          <View className="flex-row mb-3">
            <View
              style={{
                flex: 1,
                flexDirection: 'row',
                borderRadius: glassRadii.button,
                borderWidth: 1.5,
                borderColor: 'rgba(0,0,0,0.12)',
                backgroundColor: '#F2F2F2',
                overflow: 'hidden',
              }}
            >
              <TouchableOpacity
                style={{
                  flex: 1,
                  minHeight: modeToggleHeight,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor:
                    inputMode === 'quantity'
                      ? glassColors.accent
                      : 'transparent',
                }}
                onPress={() => handleModeChange('quantity')}
              >
                <Text
                  style={{
                    fontSize: ds.fontSize(14),
                    fontWeight: '600',
                    color:
                      inputMode === 'quantity'
                        ? glassColors.textOnPrimary
                        : glassColors.textSecondary,
                  }}
                >
                  Order qty
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{
                  flex: 1,
                  minHeight: modeToggleHeight,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor:
                    inputMode === 'remaining'
                      ? glassColors.accent
                      : 'transparent',
                }}
                onPress={() => handleModeChange('remaining')}
              >
                <Text
                  style={{
                    fontSize: ds.fontSize(14),
                    fontWeight: '600',
                    color:
                      inputMode === 'remaining'
                        ? glassColors.textOnPrimary
                        : glassColors.textSecondary,
                  }}
                >
                  Remaining
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View className="flex-row items-center justify-between">
            {/* Unit Toggle */}
            <TouchableOpacity
              onPress={toggleUnit}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: ds.spacing(12),
                paddingVertical: ds.spacing(8),
                borderRadius: glassRadii.stepper,
                backgroundColor: '#F0F0F0',
                borderWidth: 1,
                borderColor: 'rgba(0,0,0,0.1)',
              }}
            >
              <Text style={{ fontSize: ds.fontSize(15), fontWeight: "600", color: glassColors.textPrimary }}>
                {unitType === 'base' ? item.base_unit : item.pack_unit}
              </Text>
              <Ionicons
                name="chevron-down"
                size={16}
                color={glassColors.textSecondary}
                style={{ marginLeft: 4 }}
              />
            </TouchableOpacity>

            {/* Value Controls */}
            <View className="flex-row items-center">
              <TouchableOpacity
                style={{
                  width: controlButtonSize,
                  height: controlButtonSize,
                  borderRadius: glassRadii.stepper,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#EEEEEE',
                  borderWidth: 1,
                  borderColor: 'rgba(0,0,0,0.1)',
                }}
                onPress={handleDecrement}
              >
                <Ionicons name="remove" size={ds.icon(20)} color={glassColors.textPrimary} />
              </TouchableOpacity>

              <TextInput
                style={{
                  width: ds.spacing(56),
                  height: controlButtonSize,
                  marginHorizontal: ds.spacing(8),
                  borderRadius: glassRadii.button,
                  textAlign: 'center',
                  color: glassColors.textPrimary,
                  fontWeight: '600',
                  fontSize: ds.fontSize(17),
                  backgroundColor: '#F5F5F5',
                  borderWidth: 1,
                  borderColor: 'rgba(0,0,0,0.08)',
                }}
                value={value}
                onChangeText={onValueChange}
                keyboardType="decimal-pad"
                placeholder={inputMode === 'quantity' ? '0' : '0'}
                placeholderTextColor={glassColors.textSecondary}
              />

              <TouchableOpacity
                style={{
                  width: controlButtonSize,
                  height: controlButtonSize,
                  borderRadius: glassRadii.stepper,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#EEEEEE',
                  borderWidth: 1,
                  borderColor: 'rgba(0,0,0,0.1)',
                }}
                onPress={handleIncrement}
              >
                <Ionicons name="add" size={ds.icon(20)} color={glassColors.textPrimary} />
              </TouchableOpacity>
            </View>

            {/* Cancel/Confirm actions when expanded but not in cart */}
            {isExpanded && !cartItem && (
              <View className="flex-row items-center">
                <TouchableOpacity
                  style={{
                    width: controlButtonSize,
                    height: controlButtonSize,
                    borderRadius: glassRadii.stepper,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(239, 68, 68, 0.08)',
                    borderWidth: 1,
                    borderColor: 'rgba(239, 68, 68, 0.15)',
                  }}
                  onPress={handleCancelExpand}
                  accessibilityLabel="Cancel add item"
                >
                  <Ionicons name="close" size={ds.icon(20)} color="#DC2626" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={{
                    width: controlButtonSize,
                    height: controlButtonSize,
                    marginLeft: ds.spacing(8),
                    borderRadius: glassRadii.stepper,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: glassColors.accent,
                    opacity: !isInputValid ? 0.5 : 1,
                  }}
                  onPress={handleAddToCart}
                  disabled={!isInputValid}
                  accessibilityLabel="Confirm add item"
                >
                  <Ionicons
                    name="checkmark"
                    size={ds.icon(22)}
                    color={glassColors.textOnPrimary}
                  />
                </TouchableOpacity>
              </View>
            )}

            {/* Remove button when item is already in cart */}
            {cartItem && (
              <View className="flex-row items-center">
                <TouchableOpacity
                  style={{
                    width: controlButtonSize,
                    height: controlButtonSize,
                    marginLeft: ds.spacing(8),
                    borderRadius: glassRadii.stepper,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(239, 68, 68, 0.08)',
                    borderWidth: 1,
                    borderColor: 'rgba(239, 68, 68, 0.15)',
                  }}
                  onPress={() => {
                    Alert.alert(
                      'Remove from cart?',
                      `Remove ${item.name} from your order?`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Remove',
                          style: 'destructive',
                          onPress: () => {
                            removeFromCart(locationId, item.id, cartItem.id, cartContext);
                            setIsExpanded(false);
                            setQuantity('1');
                            setRemaining('0');
                            setInputMode('quantity');
                          },
                        },
                      ],
                    );
                  }}
                  accessibilityLabel="Remove from cart"
                >
                  <Ionicons name="close" size={ds.icon(20)} color="#DC2626" />
                </TouchableOpacity>
              </View>
            )}
          </View>

          {inputMode === 'remaining' && (
            <Text style={{ fontSize: ds.fontSize(10), color: glassColors.textSecondary, marginTop: ds.spacing(8) }}>
              Enter what is left on hand. A manager will decide order quantity.
            </Text>
          )}
        </View>
      )}
    </GlassView>
  );
}

export const InventoryItemCard = React.memo(InventoryItemCardInner);
