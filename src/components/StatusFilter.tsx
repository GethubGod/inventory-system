import { ScrollView, TouchableOpacity, Text } from 'react-native';
import { OrderStatus } from '@/types';
import { statusColors, ORDER_STATUS_LABELS } from '@/constants';

interface StatusFilterProps {
  statuses: (OrderStatus | null)[];
  selectedStatus: OrderStatus | null;
  onSelectStatus: (status: OrderStatus | null) => void;
}

export function StatusFilter({
  statuses,
  selectedStatus,
  onSelectStatus,
}: StatusFilterProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="bg-white border-b border-gray-200"
      contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 12 }}
    >
      {statuses.map((status) => {
        const isSelected = selectedStatus === status;
        const colors = status ? statusColors[status] : null;

        if (status === null) {
          return (
            <TouchableOpacity
              key="all"
              className={`px-4 py-2 rounded-full mr-2 ${
                isSelected ? 'bg-primary-500' : 'bg-gray-100'
              }`}
              onPress={() => onSelectStatus(null)}
            >
              <Text
                className={`font-medium ${
                  isSelected ? 'text-white' : 'text-gray-700'
                }`}
              >
                All
              </Text>
            </TouchableOpacity>
          );
        }

        return (
          <TouchableOpacity
            key={status}
            className="px-4 py-2 rounded-full mr-2"
            style={{
              backgroundColor: isSelected ? colors?.text : colors?.bg,
            }}
            onPress={() => onSelectStatus(isSelected ? null : status)}
          >
            <Text
              style={{ color: isSelected ? '#FFFFFF' : colors?.text }}
              className="font-medium"
            >
              {ORDER_STATUS_LABELS[status]}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}
