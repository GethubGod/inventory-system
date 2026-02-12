import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { InventoryItem, UnitType } from '@/types';
import { useOrderStore } from '@/store';
import type { OrderInputMode } from '@/store';
import { categoryColors, CATEGORY_LABELS } from '@/constants';
import { useScaledStyles } from '@/hooks/useScaledStyles';

interface InventoryItemCardProps {
  item: InventoryItem;
  locationId: string;
}

// Memoized to prevent re-renders in list virtualization
function InventoryItemCardInner({ item, locationId }: InventoryItemCardProps) {
  const { addToCart, getCartItem, updateCartItem, removeFromCart } =
    useOrderStore();
  const ds = useScaledStyles();
  const cartItem = getCartItem(locationId, item.id);
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

  const categoryColor = categoryColors[item.category] || '#6B7280';
  const showControls = isExpanded || Boolean(cartItem);

  const baseFontSize = ds.fontSize(16);
  const smallFontSize = ds.fontSize(13);
  const tinyFontSize = ds.fontSize(11);
  const modeToggleHeight = Math.max(42, ds.buttonH - ds.spacing(8));
  const modeToggleFontSize = ds.fontSize(14);
  const actionButtonSize = Math.max(44, ds.icon(40));

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
    setQuantity(newQty);
    const qty = Number.parseFloat(newQty);
    if (!Number.isFinite(qty) || qty <= 0 || !cartItem) {
      return;
    }

    updateCartItem(locationId, item.id, qty, unitType, {
      cartItemId: cartItem.id,
      inputMode: 'quantity',
      quantityRequested: qty,
    });
  };

  const handleUpdateRemaining = (newRemaining: string) => {
    setRemaining(newRemaining);
    const rem = Number.parseFloat(newRemaining);

    if (!Number.isFinite(rem) || rem < 0 || !cartItem) {
      return;
    }

    updateCartItem(locationId, item.id, rem, unitType, {
      cartItemId: cartItem.id,
      inputMode: 'remaining',
      remainingReported: rem,
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
          removeFromCart(locationId, item.id, cartItem.id);
          setQuantity('1');
          setIsExpanded(false);
        } else {
          updateCartItem(locationId, item.id, next, unitType, {
            cartItemId: cartItem.id,
            inputMode: 'quantity',
            quantityRequested: next,
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
      });
      return;
    }

    const rem = Number.parseFloat(remaining);
    if (!Number.isFinite(rem) || rem < 0) return;

    updateCartItem(locationId, item.id, rem, newUnit, {
      cartItemId: cartItem.id,
      inputMode: 'remaining',
      remainingReported: rem,
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
      });
      return;
    }

    const rem = Math.max(0, Number.parseFloat(remaining) || 0);
    setRemaining(rem.toString());
    updateCartItem(locationId, item.id, rem, unitType, {
      cartItemId: cartItem.id,
      inputMode: 'remaining',
      remainingReported: rem,
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
    <View className="bg-white rounded-xl shadow-sm" style={{ padding: ds.cardPad, borderRadius: ds.radius(12) }}>
      {/* Top row: Name and Add button / Controls */}
      <View className="flex-row items-center justify-between">
        {/* Left: Item info */}
        <View className="flex-1 mr-3">
          <View className="flex-row items-center">
            <Text
              className="text-gray-900 font-semibold flex-shrink"
              style={{ fontSize: baseFontSize }}
              numberOfLines={1}
            >
              {item.name}
            </Text>
            {cartItem && (
              <View className="bg-primary-500 w-5 h-5 rounded-full items-center justify-center ml-2">
                <Ionicons name="checkmark" size={12} color="white" />
              </View>
            )}
          </View>
          <View className="flex-row items-center mt-1">
            <View
              style={{ backgroundColor: categoryColor + '20' }}
              className="px-2 py-1 rounded mr-2"
            >
              <Text style={{ color: categoryColor, fontSize: tinyFontSize }} className="font-medium">
                {CATEGORY_LABELS[item.category]}
              </Text>
            </View>
            <Text style={{ fontSize: tinyFontSize }} className="text-gray-400">
              {item.pack_size} {item.base_unit}/{item.pack_unit}
            </Text>
            {cartItem?.inputMode === 'remaining' && (
              <View
                className="ml-2 rounded-full bg-amber-100"
                style={{ paddingHorizontal: ds.spacing(8), paddingVertical: ds.spacing(3) }}
              >
                <Text style={{ fontSize: ds.fontSize(12) }} className="font-semibold text-amber-700">Remaining</Text>
              </View>
            )}
          </View>
        </View>

        {/* Right: Add button */}
        {!showControls && (
          <TouchableOpacity
            className="bg-primary-500 items-center justify-center"
            style={{ height: ds.buttonH, paddingHorizontal: ds.buttonPadH, borderRadius: ds.radius(12), minWidth: 44 }}
            onPress={handleExpandToAdd}
          >
            <Text className="text-white font-semibold" style={{ fontSize: ds.buttonFont }}>Add</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Quantity/Remaining Controls */}
      {showControls && (
        <View className="mt-3 pt-3 border-t border-gray-100">
          <View className="flex-row mb-3">
            <TouchableOpacity
              className={`flex-1 rounded-l-lg items-center justify-center ${
                inputMode === 'quantity' ? 'bg-primary-500' : 'bg-gray-100'
              }`}
              style={{ minHeight: modeToggleHeight }}
              onPress={() => handleModeChange('quantity')}
            >
              <Text
                className={`font-semibold ${inputMode === 'quantity' ? 'text-white' : 'text-gray-600'}`}
                style={{ fontSize: modeToggleFontSize }}
              >
                Order Qty
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              className={`flex-1 rounded-r-lg items-center justify-center ${
                inputMode === 'remaining' ? 'bg-primary-500' : 'bg-gray-100'
              }`}
              style={{ minHeight: modeToggleHeight }}
              onPress={() => handleModeChange('remaining')}
            >
              <Text
                className={`font-semibold ${inputMode === 'remaining' ? 'text-white' : 'text-gray-600'}`}
                style={{ fontSize: modeToggleFontSize }}
              >
                Remaining
              </Text>
            </TouchableOpacity>
          </View>

          <View className="flex-row items-center justify-between">
            {/* Unit Toggle */}
            <TouchableOpacity
              className="flex-row items-center bg-gray-100 rounded-lg px-3 py-2"
              onPress={toggleUnit}
            >
              <Text className="text-gray-700 font-medium" style={{ fontSize: smallFontSize }}>
                {unitType === 'base' ? item.base_unit : item.pack_unit}
              </Text>
              <Ionicons name="swap-horizontal" size={16} color="#6B7280" style={{ marginLeft: 4 }} />
            </TouchableOpacity>

            {/* Value Controls */}
            <View className="flex-row items-center">
              <TouchableOpacity
                className="bg-gray-100 rounded-lg items-center justify-center"
                style={{ width: Math.max(44, ds.icon(40)), height: Math.max(44, ds.icon(40)) }}
                onPress={handleDecrement}
              >
                <Ionicons name="remove" size={ds.icon(20)} color="#374151" />
              </TouchableOpacity>

              <TextInput
                className="bg-gray-50 border border-gray-200 rounded-lg mx-2 text-center text-gray-900 font-semibold"
                style={{ width: ds.spacing(64), height: Math.max(44, ds.icon(40)), fontSize: baseFontSize }}
                value={value}
                onChangeText={onValueChange}
                keyboardType="decimal-pad"
                placeholder={inputMode === 'quantity' ? '0' : '0'}
              />

              <TouchableOpacity
                className="bg-gray-100 rounded-lg items-center justify-center"
                style={{ width: Math.max(44, ds.icon(40)), height: Math.max(44, ds.icon(40)) }}
                onPress={handleIncrement}
              >
                <Ionicons name="add" size={ds.icon(20)} color="#374151" />
              </TouchableOpacity>
            </View>

            {/* Cancel/Confirm actions when expanded but not in cart */}
            {isExpanded && !cartItem && (
              <View className="flex-row items-center">
                <TouchableOpacity
                  className="bg-gray-100 rounded-lg items-center justify-center"
                  style={{ width: actionButtonSize, height: actionButtonSize }}
                  onPress={handleCancelExpand}
                  accessibilityLabel="Cancel add item"
                >
                  <Ionicons name="close" size={ds.icon(20)} color="#6B7280" />
                </TouchableOpacity>
                <TouchableOpacity
                  className={`bg-primary-500 rounded-lg items-center justify-center ml-2 ${
                    !isInputValid ? 'opacity-50' : ''
                  }`}
                  style={{ width: actionButtonSize, height: actionButtonSize }}
                  onPress={handleAddToCart}
                  disabled={!isInputValid}
                  accessibilityLabel="Confirm add item"
                >
                  <Ionicons name="checkmark" size={ds.icon(20)} color="white" />
                </TouchableOpacity>
              </View>
            )}
          </View>

          {inputMode === 'remaining' && (
            <Text className="text-gray-500 mt-2" style={{ fontSize: ds.fontSize(13) }}>
              Enter what is left on hand. A manager will decide order quantity.
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

export const InventoryItemCard = React.memo(InventoryItemCardInner);
