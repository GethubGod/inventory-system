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
import { useInventoryStore, useAuthStore } from '@/store';
import { InventoryItem, ItemCategory } from '@/types';
import { CATEGORY_LABELS, categoryColors } from '@/constants';
import { InventoryItemCard } from '@/components/InventoryItemCard';
import { CategoryFilter } from '@/components/CategoryFilter';

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

export default function OrderScreen() {
  const { location } = useAuthStore();
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

  const renderItem = ({ item }: { item: InventoryItem }) => (
    <InventoryItemCard item={item} />
  );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['left', 'right']}>
      {/* Location Header */}
      {location && (
        <View className="bg-primary-500 px-4 py-3">
          <Text className="text-white text-sm">Ordering for</Text>
          <Text className="text-white font-bold text-lg">{location.name}</Text>
        </View>
      )}

      {/* Search Bar */}
      <View className="px-4 py-3 bg-white border-b border-gray-200">
        <View className="flex-row items-center bg-gray-100 rounded-lg px-4 py-2">
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
      <CategoryFilter
        categories={categories}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
      />

      {/* Inventory List */}
      <FlatList
        data={filteredItems}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        ItemSeparatorComponent={() => <View className="h-3" />}
        ListEmptyComponent={() => (
          <View className="flex-1 items-center justify-center py-12">
            <Ionicons name="cube-outline" size={48} color="#9CA3AF" />
            <Text className="text-gray-500 mt-4 text-center">
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
