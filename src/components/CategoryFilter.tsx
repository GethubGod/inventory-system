import { ScrollView, TouchableOpacity, Text, View } from 'react-native';
import { ItemCategory } from '@/types';
import { CATEGORY_LABELS } from '@/constants';
import { categoryGlassTints, glassColors, glassHairlineWidth, glassRadii } from '@/design/tokens';

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
    <View
      style={{
        backgroundColor: glassColors.background,
        borderBottomWidth: glassHairlineWidth,
        borderBottomColor: glassColors.divider,
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 12 }}
      >
        {/* All Categories */}
        <TouchableOpacity
          style={{
            minWidth: 50,
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderRadius: glassRadii.pill,
            marginRight: 8,
            backgroundColor:
              selectedCategory === null ? glassColors.accent : glassColors.mediumFill,
          }}
          onPress={() => onSelectCategory(null)}
        >
          <Text
            style={{
              fontWeight: '600',
              fontSize: 14,
              textAlign: 'center',
              color:
                selectedCategory === null
                  ? glassColors.textOnPrimary
                  : glassColors.textPrimary,
            }}
          >
            All
          </Text>
        </TouchableOpacity>

        {/* Category Filters */}
        {categories.map((category) => {
          const isSelected = selectedCategory === category;
          const tint = categoryGlassTints[category];
          const label = SHORT_LABELS[category] || CATEGORY_LABELS[category];

          return (
            <TouchableOpacity
              key={category}
              style={{
                paddingHorizontal: 16,
                paddingVertical: 10,
                borderRadius: glassRadii.pill,
                marginRight: 8,
                backgroundColor: isSelected ? tint.icon : tint.background,
                minWidth: 70,
              }}
              onPress={() => onSelectCategory(isSelected ? null : category)}
            >
              <Text
                style={{
                  color: isSelected ? glassColors.textOnPrimary : tint.icon,
                  fontWeight: '600',
                  fontSize: 14,
                  textAlign: 'center',
                }}
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
