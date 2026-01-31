import { View, Text, FlatList, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useOrderStore, useInventoryStore, useAuthStore } from '@/store';
import { CartItemCard } from '@/components/CartItemCard';

export default function CartScreen() {
  const { cart, clearCart, createOrder, isLoading } = useOrderStore();
  const { items } = useInventoryStore();
  const { user, location } = useAuthStore();

  const cartWithDetails = cart.map((cartItem) => {
    const inventoryItem = items.find(
      (item) => item.id === cartItem.inventoryItemId
    );
    return {
      ...cartItem,
      inventoryItem,
    };
  });

  const handleClearCart = () => {
    Alert.alert(
      'Clear Cart',
      'Are you sure you want to remove all items from your cart?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: clearCart },
      ]
    );
  };

  const handleSubmitOrder = async () => {
    if (!user || !location) {
      Alert.alert('Error', 'Please select a location first');
      return;
    }

    if (cart.length === 0) {
      Alert.alert('Error', 'Your cart is empty');
      return;
    }

    Alert.alert(
      'Submit Order',
      `Submit order for ${location.name} with ${cart.length} items?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit',
          onPress: async () => {
            try {
              const order = await createOrder(location.id, user.id);
              Alert.alert(
                'Order Created',
                `Order #${order.order_number} has been created as a draft.`,
                [
                  {
                    text: 'View Order',
                    onPress: () => router.push(`/orders/${order.id}`),
                  },
                ]
              );
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to create order');
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['left', 'right']}>
      {cart.length > 0 ? (
        <>
          {/* Cart Header */}
          <View className="flex-row justify-between items-center px-4 py-3 bg-white border-b border-gray-200">
            <Text className="text-gray-600">
              {cart.length} {cart.length === 1 ? 'item' : 'items'} in cart
            </Text>
            <TouchableOpacity onPress={handleClearCart}>
              <Text className="text-red-500 font-medium">Clear All</Text>
            </TouchableOpacity>
          </View>

          {/* Cart Items */}
          <FlatList
            data={cartWithDetails}
            renderItem={({ item }) => (
              <CartItemCard
                cartItem={item}
                inventoryItem={item.inventoryItem}
              />
            )}
            keyExtractor={(item) => item.inventoryItemId}
            contentContainerStyle={{ padding: 16 }}
            ItemSeparatorComponent={() => <View className="h-3" />}
          />

          {/* Submit Button */}
          <View className="p-4 bg-white border-t border-gray-200">
            <TouchableOpacity
              className={`bg-primary-500 rounded-lg py-4 items-center ${
                isLoading ? 'opacity-50' : ''
              }`}
              onPress={handleSubmitOrder}
              disabled={isLoading}
            >
              <Text className="text-white font-semibold text-lg">
                {isLoading ? 'Creating Order...' : 'Create Order'}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <View className="flex-1 items-center justify-center p-8">
          <Ionicons name="cart-outline" size={64} color="#9CA3AF" />
          <Text className="text-gray-500 text-lg mt-4 text-center">
            Your cart is empty
          </Text>
          <Text className="text-gray-400 text-center mt-2">
            Add items from the inventory to get started
          </Text>
          <TouchableOpacity
            className="bg-primary-500 rounded-lg px-6 py-3 mt-6"
            onPress={() => router.push('/(tabs)')}
          >
            <Text className="text-white font-semibold">Browse Inventory</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}
