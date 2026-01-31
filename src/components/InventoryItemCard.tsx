import { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { InventoryItem, UnitType } from '@/types';
import { useOrderStore } from '@/store';
import { categoryColors, CATEGORY_LABELS } from '@/constants';

interface InventoryItemCardProps {
  item: InventoryItem;
}

export function InventoryItemCard({ item }: InventoryItemCardProps) {
  const { addToCart, getCartItem, updateCartItem, removeFromCart } =
    useOrderStore();
  const cartItem = getCartItem(item.id);
  const [quantity, setQuantity] = useState(cartItem?.quantity?.toString() || '');
  const [unitType, setUnitType] = useState<UnitType>(cartItem?.unitType || 'base');

  const categoryColor = categoryColors[item.category] || '#6B7280';

  const handleAddToCart = () => {
    const qty = parseFloat(quantity);
    if (qty > 0) {
      addToCart(item.id, qty, unitType);
    }
  };

  const handleUpdateQuantity = (newQty: string) => {
    setQuantity(newQty);
    const qty = parseFloat(newQty);
    if (!isNaN(qty) && qty > 0 && cartItem) {
      updateCartItem(item.id, qty, unitType);
    }
  };

  const handleIncrement = () => {
    const current = parseFloat(quantity) || 0;
    const newQty = (current + 1).toString();
    setQuantity(newQty);
    if (cartItem) {
      updateCartItem(item.id, current + 1, unitType);
    }
  };

  const handleDecrement = () => {
    const current = parseFloat(quantity) || 0;
    if (current > 0) {
      const newQty = (current - 1).toString();
      setQuantity(newQty);
      if (cartItem) {
        if (current - 1 <= 0) {
          removeFromCart(item.id);
          setQuantity('');
        } else {
          updateCartItem(item.id, current - 1, unitType);
        }
      }
    }
  };

  const toggleUnit = () => {
    const newUnit = unitType === 'base' ? 'pack' : 'base';
    setUnitType(newUnit);
    if (cartItem) {
      updateCartItem(item.id, cartItem.quantity, newUnit);
    }
  };

  return (
    <View className="bg-white rounded-card p-4 shadow-sm">
      {/* Header */}
      <View className="flex-row justify-between items-start mb-3">
        <View className="flex-1 mr-3">
          <Text className="text-gray-900 font-semibold text-base">
            {item.name}
          </Text>
          <View className="flex-row items-center mt-1">
            <View
              style={{ backgroundColor: categoryColor + '20' }}
              className="px-2 py-1 rounded"
            >
              <Text style={{ color: categoryColor }} className="text-xs font-medium">
                {CATEGORY_LABELS[item.category]}
              </Text>
            </View>
          </View>
        </View>
        {cartItem && (
          <View className="bg-primary-500 w-6 h-6 rounded-full items-center justify-center">
            <Ionicons name="checkmark" size={16} color="white" />
          </View>
        )}
      </View>

      {/* Unit Info */}
      <View className="flex-row items-center mb-3">
        <Text className="text-gray-500 text-sm">
          {item.base_unit} / {item.pack_unit} ({item.pack_size} per pack)
        </Text>
      </View>

      {/* Quantity Controls */}
      <View className="flex-row items-center justify-between">
        {/* Unit Toggle */}
        <TouchableOpacity
          className="flex-row items-center bg-gray-100 rounded-lg px-3 py-2"
          onPress={toggleUnit}
        >
          <Text className="text-gray-700 font-medium mr-1">
            {unitType === 'base' ? item.base_unit : item.pack_unit}
          </Text>
          <Ionicons name="swap-horizontal" size={16} color="#6B7280" />
        </TouchableOpacity>

        {/* Quantity Input */}
        <View className="flex-row items-center">
          <TouchableOpacity
            className="w-10 h-10 bg-gray-100 rounded-lg items-center justify-center"
            onPress={handleDecrement}
          >
            <Ionicons name="remove" size={20} color="#374151" />
          </TouchableOpacity>

          <TextInput
            className="w-16 h-10 bg-gray-50 border border-gray-200 rounded-lg mx-2 text-center text-gray-900 font-medium"
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

        {/* Add Button */}
        {!cartItem && (
          <TouchableOpacity
            className={`bg-primary-500 px-4 py-2 rounded-lg ${
              !quantity || parseFloat(quantity) <= 0 ? 'opacity-50' : ''
            }`}
            onPress={handleAddToCart}
            disabled={!quantity || parseFloat(quantity) <= 0}
          >
            <Text className="text-white font-semibold">Add</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
