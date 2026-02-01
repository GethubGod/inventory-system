import { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { InventoryItem, UnitType } from '@/types';
import { useOrderStore, useSettingsStore } from '@/store';
import { categoryColors, CATEGORY_LABELS } from '@/constants';

interface InventoryItemCardProps {
  item: InventoryItem;
  locationId: string;
}

export function InventoryItemCard({ item, locationId }: InventoryItemCardProps) {
  const { addToCart, getCartItem, updateCartItem, removeFromCart } =
    useOrderStore();
  const { fontSize } = useSettingsStore();
  const cartItem = getCartItem(locationId, item.id);
  const [isExpanded, setIsExpanded] = useState(false);
  const [quantity, setQuantity] = useState(cartItem?.quantity?.toString() || '1');
  const [unitType, setUnitType] = useState<UnitType>(cartItem?.unitType || 'pack');

  const categoryColor = categoryColors[item.category] || '#6B7280';
  const showControls = isExpanded || cartItem;

  // Font size multipliers
  const fontSizeMultiplier = fontSize === 'large' ? 1.2 : fontSize === 'xlarge' ? 1.4 : 1;
  const baseFontSize = 16 * fontSizeMultiplier;
  const smallFontSize = 13 * fontSizeMultiplier;
  const tinyFontSize = 11 * fontSizeMultiplier;

  const handleAddToCart = () => {
    const qty = parseFloat(quantity);
    if (qty > 0) {
      addToCart(locationId, item.id, qty, unitType);
      setIsExpanded(false);
    }
  };

  const handleUpdateQuantity = (newQty: string) => {
    setQuantity(newQty);
    const qty = parseFloat(newQty);
    if (!isNaN(qty) && qty > 0 && cartItem) {
      updateCartItem(locationId, item.id, qty, unitType);
    }
  };

  const handleIncrement = () => {
    const current = parseFloat(quantity) || 0;
    const newQty = current + 1;
    setQuantity(newQty.toString());
    if (cartItem) {
      updateCartItem(locationId, item.id, newQty, unitType);
    }
  };

  const handleDecrement = () => {
    const current = parseFloat(quantity) || 0;
    if (current > 0) {
      const newQty = current - 1;
      setQuantity(newQty.toString());
      if (cartItem) {
        if (newQty <= 0) {
          removeFromCart(locationId, item.id);
          setQuantity('1');
          setIsExpanded(false);
        } else {
          updateCartItem(locationId, item.id, newQty, unitType);
        }
      }
    }
  };

  const toggleUnit = () => {
    const newUnit = unitType === 'base' ? 'pack' : 'base';
    setUnitType(newUnit);
    if (cartItem) {
      updateCartItem(locationId, item.id, cartItem.quantity, newUnit);
    }
  };

  const handleExpandToAdd = () => {
    setQuantity('1');
    setIsExpanded(true);
  };

  return (
    <View className="bg-white rounded-xl px-4 py-3.5 shadow-sm">
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
          </View>
        </View>

        {/* Right: Add button */}
        {!showControls && (
          <TouchableOpacity
            className="bg-primary-500 px-5 py-2.5 rounded-xl"
            onPress={handleExpandToAdd}
          >
            <Text className="text-white font-semibold" style={{ fontSize: smallFontSize }}>Add</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Quantity Controls - shown when expanded or in cart */}
      {showControls && (
        <View className="flex-row items-center justify-between mt-3 pt-3 border-t border-gray-100">
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

          {/* Quantity Controls */}
          <View className="flex-row items-center">
            <TouchableOpacity
              className="w-10 h-10 bg-gray-100 rounded-lg items-center justify-center"
              onPress={handleDecrement}
            >
              <Ionicons name="remove" size={20} color="#374151" />
            </TouchableOpacity>

            <TextInput
              className="w-14 h-10 bg-gray-50 border border-gray-200 rounded-lg mx-2 text-center text-gray-900 font-semibold"
              style={{ fontSize: baseFontSize }}
              value={quantity}
              onChangeText={handleUpdateQuantity}
              keyboardType="decimal-pad"
              placeholder="0"
            />

            <TouchableOpacity
              className="w-10 h-10 bg-gray-100 rounded-lg items-center justify-center"
              onPress={handleIncrement}
            >
              <Ionicons name="add" size={20} color="#374151" />
            </TouchableOpacity>
          </View>

          {/* Confirm/Add button when expanded but not in cart */}
          {isExpanded && !cartItem && (
            <TouchableOpacity
              className={`bg-primary-500 w-10 h-10 rounded-lg items-center justify-center ${
                !quantity || parseFloat(quantity) <= 0 ? 'opacity-50' : ''
              }`}
              onPress={handleAddToCart}
              disabled={!quantity || parseFloat(quantity) <= 0}
            >
              <Ionicons name="checkmark" size={20} color="white" />
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}
