import { View, Text, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Order } from '@/types';
import { statusColors, ORDER_STATUS_LABELS } from '@/constants';

interface OrderCardProps {
  order: Order;
}

export function OrderCard({ order }: OrderCardProps) {
  const colors = statusColors[order.status];
  const statusLabel = ORDER_STATUS_LABELS[order.status];

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const getStatusIcon = () => {
    switch (order.status) {
      case 'draft':
        return 'create-outline';
      case 'submitted':
        return 'send-outline';
      case 'fulfilled':
        return 'checkmark-circle-outline';
      case 'cancelled':
        return 'close-circle-outline';
      default:
        return 'help-circle-outline';
    }
  };

  return (
    <TouchableOpacity
      className="bg-white rounded-card p-4 shadow-sm"
      onPress={() => router.push(`/orders/${order.id}`)}
      activeOpacity={0.7}
    >
      {/* Header */}
      <View className="flex-row justify-between items-start mb-3">
        <View>
          <Text className="text-gray-900 font-bold text-lg">
            Order #{order.order_number}
          </Text>
          <Text className="text-gray-500 text-sm mt-1">
            {formatDate(order.created_at)}
          </Text>
        </View>
        <View
          className="flex-row items-center px-3 py-1 rounded-full"
          style={{ backgroundColor: colors.bg }}
        >
          <Ionicons name={getStatusIcon()} size={14} color={colors.text} />
          <Text
            className="ml-1 font-medium text-sm"
            style={{ color: colors.text }}
          >
            {statusLabel}
          </Text>
        </View>
      </View>

      {/* Footer */}
      <View className="flex-row items-center justify-between pt-3 border-t border-gray-100">
        <View className="flex-row items-center">
          <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
          <Text className="text-gray-400 text-sm ml-1">View Details</Text>
        </View>
        {order.fulfilled_at && (
          <Text className="text-gray-400 text-xs">
            Fulfilled: {formatDate(order.fulfilled_at)}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}
