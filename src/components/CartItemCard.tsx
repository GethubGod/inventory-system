import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { InventoryItem, UnitType } from '@/types';
import { useOrderStore } from '@/store';
import { categoryColors, CATEGORY_LABELS } from '@/constants';

interface CartItem {
  inventoryItemId: string;
  quantity: number;
  unitType: UnitType;
}

interface CartItemCardProps {
  cartItem: CartItem;
  inventoryItem?: InventoryItem;
  locationId: string;
}

export function CartItemCard({ cartItem, inventoryItem, locationId }: CartItemCardProps) {
  const { updateCartItem, removeFromCart } = useOrderStore();

  if (!inventoryItem) {
    return null;
  }

  const categoryColor = categoryColors[inventoryItem.category] || '#6B7280';

  const handleIncrement = () => {
    updateCartItem(
      locationId,
      cartItem.inventoryItemId,
      cartItem.quantity + 1,
      cartItem.unitType
    );
  };

  const handleDecrement = () => {
    if (cartItem.quantity > 1) {
      updateCartItem(
        locationId,
        cartItem.inventoryItemId,
        cartItem.quantity - 1,
        cartItem.unitType
      );
    } else {
      removeFromCart(locationId, cartItem.inventoryItemId);
    }
  };

  const handleRemove = () => {
    removeFromCart(locationId, cartItem.inventoryItemId);
  };

  const toggleUnit = () => {
    const newUnit = cartItem.unitType === 'base' ? 'pack' : 'base';
    updateCartItem(locationId, cartItem.inventoryItemId, cartItem.quantity, newUnit);
  };

  const unitLabel =
    cartItem.unitType === 'base'
      ? inventoryItem.base_unit
      : inventoryItem.pack_unit;

  return (
    <View className="bg-white rounded-card p-4 shadow-sm">
      {/* Header */}
      <View className="flex-row justify-between items-start mb-3">
        <View className="flex-1 mr-3">
          <Text className="text-gray-900 font-semibold text-base">
            {inventoryItem.name}
          </Text>
          <View className="flex-row items-center mt-1">
            <View
              style={{ backgroundColor: categoryColor + '20' }}
              className="px-2 py-1 rounded"
            >
              <Text style={{ color: categoryColor }} className="text-xs font-medium">
                {CATEGORY_LABELS[inventoryItem.category]}
              </Text>
            </View>
          </View>
        </View>
        <TouchableOpacity onPress={handleRemove} className="p-1">
          <Ionicons name="trash-outline" size={20} color="#EF4444" />
        </TouchableOpacity>
      </View>

      {/* Quantity Controls */}
      <View className="flex-row items-center justify-between">
        {/* Unit Toggle */}
        <TouchableOpacity
          className="flex-row items-center bg-gray-100 rounded-lg px-3 py-2"
          onPress={toggleUnit}
        >
          <Text className="text-gray-700 font-medium mr-1">{unitLabel}</Text>
          <Ionicons name="swap-horizontal" size={16} color="#6B7280" />
        </TouchableOpacity>

        {/* Quantity Controls */}
        <View className="flex-row items-center">
          <TouchableOpacity
            className="w-10 h-10 bg-gray-100 rounded-lg items-center justify-center"
            onPress={handleDecrement}
          >
            <Ionicons name="remove" size={20} color="#374151" />
          </TouchableOpacity>

          <View className="w-16 h-10 bg-primary-50 border border-primary-200 rounded-lg mx-2 items-center justify-center">
            <Text className="text-primary-700 font-bold">{cartItem.quantity}</Text>
          </View>

          <TouchableOpacity
            className="w-10 h-10 bg-gray-100 rounded-lg items-center justify-center"
            onPress={handleIncrement}
          >
            <Ionicons name="add" size={20} color="#374151" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Total Display */}
      <View className="mt-3 pt-3 border-t border-gray-100">
        <Text className="text-gray-600 text-sm">
          Total: {cartItem.quantity} {unitLabel}
          {cartItem.unitType === 'pack' && (
            <Text className="text-gray-400">
              {' '}
              ({cartItem.quantity * inventoryItem.pack_size}{' '}
              {inventoryItem.base_unit})
            </Text>
          )}
        </Text>
      </View>
    </View>
  );
}
