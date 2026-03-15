import { ScrollView, TouchableOpacity, Text } from 'react-native';
import { OrderStatus } from '@/types';
import { statusColors, ORDER_STATUS_LABELS } from '@/constants';
import { glassColors, glassHairlineWidth, glassRadii } from '@/design/tokens';

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
      style={{
        backgroundColor: glassColors.background,
        borderBottomWidth: glassHairlineWidth,
        borderBottomColor: glassColors.divider,
      }}
      contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 12 }}
    >
      {statuses.map((status) => {
        const isSelected = selectedStatus === status;
        const colors = status ? statusColors[status] : null;

        if (status === null) {
          return (
            <TouchableOpacity
              key="all"
              style={{
                paddingHorizontal: 16,
                paddingVertical: 8,
                borderRadius: glassRadii.pill,
                marginRight: 8,
                backgroundColor: isSelected ? glassColors.accent : glassColors.mediumFill,
              }}
              onPress={() => onSelectStatus(null)}
            >
              <Text
                style={{
                  fontWeight: '500',
                  color: isSelected ? glassColors.textOnPrimary : glassColors.textPrimary,
                }}
              >
                All
              </Text>
            </TouchableOpacity>
          );
        }

        return (
          <TouchableOpacity
            key={status}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: glassRadii.pill,
              marginRight: 8,
              backgroundColor: isSelected ? colors?.text : colors?.bg,
            }}
            onPress={() => onSelectStatus(isSelected ? null : status)}
          >
            <Text
              style={{
                color: isSelected ? glassColors.textOnPrimary : colors?.text,
                fontWeight: '500',
              }}
            >
              {ORDER_STATUS_LABELS[status]}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}
