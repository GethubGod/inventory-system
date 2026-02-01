import { ScrollView, TouchableOpacity, Text, View } from 'react-native';
import { ItemCategory } from '@/types';
import { categoryColors, CATEGORY_LABELS } from '@/constants';

// Shorter labels for compact display
const SHORT_LABELS: Record<string, string> = {
  fish: 'Fish',
  protein: 'Protein',
  produce: 'Produce',
  dry: 'Dry',
  dairy_cold: 'Dairy',
  frozen: 'Frozen',
  sauces: 'Sauces',
  packaging: 'Packaging',
};

interface CategoryFilterProps {
  categories: ItemCategory[];
  selectedCategory: ItemCategory | null;
  onSelectCategory: (category: ItemCategory | null) => void;
}

export function CategoryFilter({
  categories,
  selectedCategory,
  onSelectCategory,
}: CategoryFilterProps) {
  return (
    <View className="bg-white border-b border-gray-200">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 12 }}
      >
        {/* All Categories */}
        <TouchableOpacity
          className={`px-4 py-2.5 rounded-full mr-2 ${
            selectedCategory === null
              ? 'bg-primary-500'
              : 'bg-gray-100'
          }`}
          style={{ minWidth: 50 }}
          onPress={() => onSelectCategory(null)}
        >
          <Text
            className={`font-semibold text-sm text-center ${
              selectedCategory === null ? 'text-white' : 'text-gray-700'
            }`}
          >
            All
          </Text>
        </TouchableOpacity>

        {/* Category Filters */}
        {categories.map((category) => {
          const isSelected = selectedCategory === category;
          const color = categoryColors[category] || '#6B7280';
          const label = SHORT_LABELS[category] || CATEGORY_LABELS[category];

          return (
            <TouchableOpacity
              key={category}
              className="px-4 py-2.5 rounded-full mr-2"
              style={{
                backgroundColor: isSelected ? color : color + '20',
                minWidth: 70,
              }}
              onPress={() => onSelectCategory(isSelected ? null : category)}
            >
              <Text
                style={{ color: isSelected ? '#FFFFFF' : color }}
                className="font-semibold text-sm text-center"
                numberOfLines={1}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}
