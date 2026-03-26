import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getCategoryLabel } from '@/constants';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
} from '@/theme/design';
import { GlassSurface } from '@/components/ui';

function CategoryPill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const ds = useScaledStyles();

  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingHorizontal: ds.spacing(14),
        paddingVertical: ds.spacing(9),
        borderRadius: glassRadii.pill,
        borderWidth: glassHairlineWidth,
        borderColor: active ? glassColors.accent : glassColors.cardBorder,
        backgroundColor: active ? glassColors.accent : glassColors.background,
      }}
      activeOpacity={0.8}
    >
      <Text
        style={{
          fontSize: ds.fontSize(13),
          fontWeight: '600',
          color: active ? glassColors.textOnPrimary : glassColors.textPrimary,
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

interface BrowseCategoryScrollerProps {
  categories: string[];
  selectedCategory: string | null;
  onSelectCategory: (category: string | null) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}

export function BrowseCategoryScroller({
  categories,
  selectedCategory,
  onSelectCategory,
  expanded,
  onToggleExpanded,
}: BrowseCategoryScrollerProps) {
  const ds = useScaledStyles();
  const hasMoreCategories = categories.length > 3;
  const showMoreLabel = expanded ? 'Show less' : 'Show all';

  const categoryPills = (
    <>
      <CategoryPill
        label="All"
        active={selectedCategory === null}
        onPress={() => onSelectCategory(null)}
      />
      {categories.map((category) => (
        <CategoryPill
          key={category}
          label={getCategoryLabel(category)}
          active={selectedCategory === category}
          onPress={() =>
            onSelectCategory(selectedCategory === category ? null : category)
          }
        />
      ))}
    </>
  );

  return (
    <GlassSurface
      intensity="medium"
      style={{
        borderRadius: glassRadii.surface,
        paddingHorizontal: ds.spacing(14),
        paddingVertical: ds.spacing(14),
      }}
    >
      <View className="flex-row items-center justify-between">
        <Text
          style={{
            fontSize: ds.fontSize(12),
            fontWeight: '600',
            letterSpacing: 1.2,
            textTransform: 'uppercase',
            color: glassColors.textSecondary,
          }}
        >
          Categories
        </Text>
        {hasMoreCategories ? (
          <TouchableOpacity
            onPress={onToggleExpanded}
            className="flex-row items-center"
            hitSlop={8}
          >
            <Text
              style={{
                fontSize: ds.fontSize(12),
                fontWeight: '600',
                color: glassColors.textSecondary,
              }}
            >
              {showMoreLabel}
            </Text>
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={ds.icon(14)}
              color={glassColors.textSecondary}
              style={{ marginLeft: ds.spacing(4) }}
            />
          </TouchableOpacity>
        ) : null}
      </View>

      {expanded ? (
        <View
          style={{
            marginTop: ds.spacing(12),
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: ds.spacing(8),
          }}
        >
          {categoryPills}
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            marginTop: ds.spacing(12),
            gap: ds.spacing(8),
            paddingRight: ds.spacing(8),
          }}
        >
          {categoryPills}
        </ScrollView>
      )}
    </GlassSurface>
  );
}
