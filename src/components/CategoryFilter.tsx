import { ScrollView, TouchableOpacity, Text } from 'react-native';
import { ItemCategory } from '@/types';
import { categoryColors, CATEGORY_LABELS } from '@/constants';

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
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="bg-white border-b border-gray-200"
      contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 12 }}
    >
      {/* All Categories */}
      <TouchableOpacity
        className={`px-4 py-2 rounded-full mr-2 ${
          selectedCategory === null
            ? 'bg-primary-500'
            : 'bg-gray-100'
        }`}
        onPress={() => onSelectCategory(null)}
      >
        <Text
          className={`font-medium ${
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

        return (
          <TouchableOpacity
            key={category}
            className="px-4 py-2 rounded-full mr-2"
            style={{
              backgroundColor: isSelected ? color : color + '20',
            }}
            onPress={() => onSelectCategory(isSelected ? null : category)}
          >
            <Text
              style={{ color: isSelected ? '#FFFFFF' : color }}
              className="font-medium"
            >
              {CATEGORY_LABELS[category]}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}
