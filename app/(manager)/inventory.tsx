import { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useInventoryStore } from '@/store';
import { InventoryItem, ItemCategory } from '@/types';
import { CATEGORY_LABELS, categoryColors } from '@/constants';

const categories: ItemCategory[] = [
  'fish',
  'protein',
  'produce',
  'dry',
  'dairy_cold',
  'frozen',
  'sauces',
  'packaging',
];

export default function ManagerInventoryScreen() {
  const {
    fetchItems,
    getFilteredItems,
    selectedCategory,
    setSelectedCategory,
    searchQuery,
    setSearchQuery,
    isLoading,
  } = useInventoryStore();

  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchItems();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchItems();
    setRefreshing(false);
  };

  const filteredItems = getFilteredItems();

  const renderItem = ({ item }: { item: InventoryItem }) => {
    const categoryColor = categoryColors[item.category] || '#6B7280';

    return (
      <View className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 mb-3">
        <View className="flex-row justify-between items-start">
          <View className="flex-1 mr-3">
            <Text className="text-gray-900 font-semibold text-base">
              {item.name}
            </Text>
            <View className="flex-row items-center mt-2">
              <View
                style={{ backgroundColor: categoryColor + '20' }}
                className="px-2 py-1 rounded"
              >
                <Text
                  style={{ color: categoryColor }}
                  className="text-xs font-medium"
                >
                  {CATEGORY_LABELS[item.category]}
                </Text>
              </View>
            </View>
          </View>
          <View className="items-end">
            <Text className="text-gray-500 text-sm">{item.base_unit}</Text>
            <Text className="text-gray-400 text-xs mt-1">
              {item.pack_size} per {item.pack_unit}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['left', 'right']}>
      {/* Search Bar */}
      <View className="px-4 py-3 bg-white border-b border-gray-200">
        <View className="flex-row items-center bg-gray-100 rounded-xl px-4 py-2">
          <Ionicons name="search-outline" size={20} color="#9CA3AF" />
          <TextInput
            className="flex-1 ml-2 text-gray-900"
            placeholder="Search inventory..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color="#9CA3AF" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Category Filter */}
      <View className="bg-white border-b border-gray-200">
        <FlatList
          horizontal
          data={[null, ...categories]}
          keyExtractor={(item) => item || 'all'}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 12 }}
          renderItem={({ item: category }) => {
            const isSelected = selectedCategory === category;
            const color = category ? categoryColors[category] : '#F97316';

            return (
              <TouchableOpacity
                className="px-4 py-2 rounded-full mr-2"
                style={{
                  backgroundColor: isSelected ? color : color + '20',
                }}
                onPress={() => setSelectedCategory(category)}
              >
                <Text
                  style={{ color: isSelected ? '#FFFFFF' : color }}
                  className="font-medium"
                >
                  {category ? CATEGORY_LABELS[category] : 'All'}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {/* Item Count */}
      <View className="px-4 py-2 bg-gray-50">
        <Text className="text-gray-500 text-sm">
          {filteredItems.length} items
        </Text>
      </View>

      {/* Inventory List */}
      <FlatList
        data={filteredItems}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={() => (
          <View className="flex-1 items-center justify-center py-16">
            <Ionicons name="cube-outline" size={48} color="#D1D5DB" />
            <Text className="text-gray-400 mt-4 text-center">
              {searchQuery || selectedCategory
                ? 'No items match your search'
                : 'No inventory items found'}
            </Text>
          </View>
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#F97316"
          />
        }
      />
    </SafeAreaView>
  );
}
