import { ScrollView, TouchableOpacity, Text, View } from 'react-native';
import type { ItemCategory } from '@/types';
import { getCategoryLabel } from '@/constants';
import { getCategoryTint, glassColors, glassHairlineWidth, glassRadii } from '@/theme/design';
import { getCategoryShortLabel } from '@/features/browse/config';

interface CategoryFilterProps {
  categories: string[];
  selectedCategory: string | null;
  onSelectCategory: (category: string | null) => void;
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
          const tint = getCategoryTint(category);
          const label = getCategoryShortLabel(category);

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
