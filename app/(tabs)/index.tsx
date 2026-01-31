import { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useInventoryStore, useAuthStore } from '@/store';
import { InventoryItem, ItemCategory, Location } from '@/types';
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
  const { location, locations, setLocation, fetchLocations } = useAuthStore();
  const {
    fetchItems,
    getFilteredItems,
    selectedCategory,
    setSelectedCategory,
    searchQuery,
    setSearchQuery,
  } = useInventoryStore();

  const [refreshing, setRefreshing] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);

  useEffect(() => {
    fetchItems();
    fetchLocations();
  }, []);

  // Show location picker if no location is selected
  useEffect(() => {
    if (locations.length > 0 && !location) {
      setShowLocationPicker(true);
    }
  }, [locations, location]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchItems();
    setRefreshing(false);
  };

  const handleSelectLocation = (selectedLocation: Location) => {
    setLocation(selectedLocation);
    setShowLocationPicker(false);
  };

  const filteredItems = getFilteredItems();

  const renderItem = ({ item }: { item: InventoryItem }) => (
    <InventoryItemCard item={item} />
  );

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['left', 'right']}>
      {/* Location Selector Header */}
      <TouchableOpacity
        className="bg-white px-4 py-3 flex-row items-center justify-between border-b border-gray-100"
        onPress={() => setShowLocationPicker(true)}
        activeOpacity={0.7}
      >
        <View className="flex-row items-center flex-1">
          <View className="w-10 h-10 bg-primary-100 rounded-full items-center justify-center">
            <Ionicons name="location" size={20} color="#F97316" />
          </View>
          <View className="ml-3 flex-1">
            <Text className="text-xs text-gray-500 uppercase tracking-wide">
              Ordering for
            </Text>
            <Text className="text-base font-bold text-gray-900" numberOfLines={1}>
              {location?.name || 'Select Location'}
            </Text>
          </View>
        </View>
        <View className="flex-row items-center">
          <Text className="text-primary-500 font-medium mr-1">Change</Text>
          <Ionicons name="chevron-down" size={16} color="#F97316" />
        </View>
      </TouchableOpacity>

      {/* Search Bar */}
      <View className="px-4 py-3 bg-white border-b border-gray-100">
        <View className="flex-row items-center bg-gray-100 rounded-xl px-4 py-2.5">
          <Ionicons name="search-outline" size={20} color="#9CA3AF" />
          <TextInput
            className="flex-1 ml-2 text-gray-900 text-base"
            placeholder="Search inventory..."
            placeholderTextColor="#9CA3AF"
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

      {/* Location Picker Modal */}
      <Modal
        visible={showLocationPicker}
        transparent
        animationType="slide"
        onRequestClose={() => location && setShowLocationPicker(false)}
      >
        <Pressable
          className="flex-1 bg-black/50 justify-end"
          onPress={() => location && setShowLocationPicker(false)}
        >
          <Pressable
            className="bg-white rounded-t-3xl"
            onPress={(e) => e.stopPropagation()}
          >
            {/* Handle bar */}
            <View className="items-center pt-3 pb-2">
              <View className="w-10 h-1 bg-gray-300 rounded-full" />
            </View>

            <View className="px-6 pb-8">
              <Text className="text-2xl font-bold text-gray-900 mb-2">
                Select Location
              </Text>
              <Text className="text-gray-500 mb-6">
                Choose which restaurant you're ordering for
              </Text>

              {locations.map((loc) => {
                const isSelected = location?.id === loc.id;
                return (
                  <TouchableOpacity
                    key={loc.id}
                    className={`flex-row items-center p-4 rounded-2xl mb-3 border-2 ${
                      isSelected
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-gray-200 bg-white'
                    }`}
                    onPress={() => handleSelectLocation(loc)}
                    activeOpacity={0.7}
                  >
                    <View
                      className={`w-12 h-12 rounded-full items-center justify-center ${
                        isSelected ? 'bg-primary-500' : 'bg-gray-100'
                      }`}
                    >
                      <Ionicons
                        name="restaurant"
                        size={24}
                        color={isSelected ? 'white' : '#6B7280'}
                      />
                    </View>
                    <View className="flex-1 ml-4">
                      <Text
                        className={`font-bold text-lg ${
                          isSelected ? 'text-primary-700' : 'text-gray-900'
                        }`}
                      >
                        {loc.name}
                      </Text>
                      <Text
                        className={`text-sm ${
                          isSelected ? 'text-primary-600' : 'text-gray-500'
                        }`}
                      >
                        {loc.short_code}
                      </Text>
                    </View>
                    {isSelected && (
                      <Ionicons
                        name="checkmark-circle"
                        size={24}
                        color="#F97316"
                      />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
