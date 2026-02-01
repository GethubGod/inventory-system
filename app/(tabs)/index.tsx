import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  Modal,
  Pressable,
  Alert,
  ScrollView,
  LayoutAnimation,
  Platform,
  UIManager,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useInventoryStore, useAuthStore, useOrderStore } from '@/store';
import { InventoryItem, ItemCategory, Location, SupplierCategory } from '@/types';
import { CATEGORY_LABELS, categoryColors, colors } from '@/constants';
import { InventoryItemCard } from '@/components/InventoryItemCard';
import { CategoryFilter } from '@/components/CategoryFilter';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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

const SUPPLIER_CATEGORIES: { value: SupplierCategory; label: string }[] = [
  { value: 'fish_supplier', label: 'Fish Supplier' },
  { value: 'main_distributor', label: 'Main Distributor' },
  { value: 'asian_market', label: 'Asian Market' },
];

export default function OrderScreen() {
  const { location, locations, setLocation, fetchLocations, user } = useAuthStore();
  const {
    fetchItems,
    getFilteredItems,
    selectedCategory,
    setSelectedCategory,
    searchQuery,
    setSearchQuery,
    addItem,
    isLoading: inventoryLoading,
  } = useInventoryStore();
  const { getLocationCartTotal } = useOrderStore();

  const [refreshing, setRefreshing] = useState(false);
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  const [showAddItemModal, setShowAddItemModal] = useState(false);

  // New item form state
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState<ItemCategory>('dry');
  const [newItemSupplierCategory, setNewItemSupplierCategory] = useState<SupplierCategory>('main_distributor');
  const [newItemBaseUnit, setNewItemBaseUnit] = useState('');
  const [newItemPackUnit, setNewItemPackUnit] = useState('');
  const [newItemPackSize, setNewItemPackSize] = useState('');
  const [isSubmittingItem, setIsSubmittingItem] = useState(false);

  useEffect(() => {
    fetchItems();
    fetchLocations();
  }, []);

  // Auto-select first location if none selected
  useEffect(() => {
    if (locations.length > 0 && !location) {
      setLocation(locations[0]);
    }
  }, [locations, location]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchItems();
    setRefreshing(false);
  };

  const toggleLocationDropdown = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowLocationDropdown((prev) => !prev);
  }, []);

  const handleSelectLocation = useCallback((selectedLocation: Location) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setLocation(selectedLocation);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowLocationDropdown(false);
  }, [setLocation]);

  const filteredItems = getFilteredItems();

  const resetNewItemForm = () => {
    setNewItemName(searchQuery); // Pre-fill with search query
    setNewItemCategory('dry');
    setNewItemSupplierCategory('main_distributor');
    setNewItemBaseUnit('');
    setNewItemPackUnit('');
    setNewItemPackSize('');
  };

  const handleOpenAddItemModal = () => {
    resetNewItemForm();
    setShowAddItemModal(true);
  };

  const handleAddNewItem = async () => {
    if (!newItemName.trim()) {
      Alert.alert('Error', 'Please enter an item name');
      return;
    }
    if (!newItemBaseUnit.trim()) {
      Alert.alert('Error', 'Please enter a base unit (e.g., lb, oz, each)');
      return;
    }
    if (!newItemPackUnit.trim()) {
      Alert.alert('Error', 'Please enter a pack unit (e.g., case, bag, box)');
      return;
    }
    if (!newItemPackSize.trim() || isNaN(parseFloat(newItemPackSize))) {
      Alert.alert('Error', 'Please enter a valid pack size number');
      return;
    }

    setIsSubmittingItem(true);
    try {
      await addItem({
        name: newItemName.trim(),
        category: newItemCategory,
        supplier_category: newItemSupplierCategory,
        base_unit: newItemBaseUnit.trim(),
        pack_unit: newItemPackUnit.trim(),
        pack_size: parseFloat(newItemPackSize),
        created_by: user?.id,
      });

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      setShowAddItemModal(false);
      setSearchQuery(newItemName.trim()); // Search for the new item
      Alert.alert('Success', `"${newItemName}" has been added to the inventory`);
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to add item');
    } finally {
      setIsSubmittingItem(false);
    }
  };

  const renderItem = ({ item }: { item: InventoryItem }) => (
    <InventoryItemCard item={item} locationId={location?.id || ''} />
  );

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      {/* Header with Location Dropdown */}
      <View className="bg-white border-b border-gray-200">
        <TouchableOpacity
          onPress={toggleLocationDropdown}
          className="flex-row items-center justify-center px-4 py-3"
        >
          <View className="flex-row items-center bg-gray-100 px-4 py-2.5 rounded-xl">
            <Ionicons name="location" size={18} color={colors.primary[500]} />
            <Text className="text-base font-semibold text-gray-900 mx-2">
              {location?.name || 'Select Location'}
            </Text>
            <Ionicons
              name={showLocationDropdown ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={colors.gray[500]}
            />
          </View>
        </TouchableOpacity>

        {/* Location Dropdown Menu */}
        {showLocationDropdown && (
          <View className="border-t border-gray-100 pb-2">
            {locations.map((loc) => {
              const isSelected = location?.id === loc.id;
              const cartCount = getLocationCartTotal(loc.id);

              return (
                <TouchableOpacity
                  key={loc.id}
                  onPress={() => handleSelectLocation(loc)}
                  className={`flex-row items-center justify-between px-4 py-3 mx-2 rounded-lg ${
                    isSelected ? 'bg-primary-50' : ''
                  }`}
                >
                  <View className="flex-row items-center">
                    <View className={`w-9 h-9 rounded-full items-center justify-center mr-3 ${
                      isSelected ? 'bg-primary-500' : 'bg-gray-200'
                    }`}>
                      <Text className={`text-xs font-bold ${isSelected ? 'text-white' : 'text-gray-600'}`}>
                        {loc.short_code}
                      </Text>
                    </View>
                    <Text className={`text-base ${isSelected ? 'font-semibold text-primary-700' : 'text-gray-800'}`}>
                      {loc.name}
                    </Text>
                  </View>
                  <View className="flex-row items-center">
                    {cartCount > 0 && (
                      <Text className="text-sm text-gray-500 mr-2">{cartCount} items</Text>
                    )}
                    {isSelected && (
                      <Ionicons name="checkmark" size={20} color={colors.primary[500]} />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

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
            {(searchQuery || selectedCategory) && (
              <TouchableOpacity
                onPress={handleOpenAddItemModal}
                className="mt-4 flex-row items-center bg-primary-500 px-5 py-3 rounded-xl"
              >
                <Ionicons name="add-circle-outline" size={20} color="white" />
                <Text className="text-white font-semibold ml-2">Add Missing Item</Text>
              </TouchableOpacity>
            )}
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

      {/* Add Item Modal */}
      <Modal
        visible={showAddItemModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddItemModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          className="flex-1"
        >
          <Pressable
            className="flex-1 bg-black/50 justify-end"
            onPress={() => setShowAddItemModal(false)}
          >
            <Pressable
              className="bg-white rounded-t-3xl max-h-[90%]"
              onPress={(e) => e.stopPropagation()}
            >
              {/* Handle bar */}
              <View className="items-center pt-3 pb-2">
                <View className="w-10 h-1 bg-gray-300 rounded-full" />
              </View>

              <ScrollView className="px-6 pb-8" showsVerticalScrollIndicator={false}>
                <Text className="text-2xl font-bold text-gray-900 mb-1">
                  Add Missing Item
                </Text>
                <Text className="text-gray-500 mb-6">
                  This item will be added to the inventory
                </Text>

                {/* Item Name */}
                <View className="mb-4">
                  <Text className="text-sm font-medium text-gray-700 mb-2">Item Name *</Text>
                  <TextInput
                    className="bg-gray-100 rounded-xl px-4 py-3 text-gray-900 text-base"
                    placeholder="e.g., Salmon Fillet"
                    value={newItemName}
                    onChangeText={setNewItemName}
                    autoCapitalize="words"
                  />
                </View>

                {/* Category */}
                <View className="mb-4">
                  <Text className="text-sm font-medium text-gray-700 mb-2">Category *</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View className="flex-row">
                      {categories.map((cat) => {
                        const isSelected = newItemCategory === cat;
                        const catColor = categoryColors[cat] || '#6B7280';
                        return (
                          <TouchableOpacity
                            key={cat}
                            onPress={() => setNewItemCategory(cat)}
                            className={`mr-2 px-4 py-2 rounded-lg border-2 ${
                              isSelected ? 'border-primary-500' : 'border-transparent'
                            }`}
                            style={{ backgroundColor: isSelected ? catColor + '30' : catColor + '15' }}
                          >
                            <Text style={{ color: catColor }} className="font-medium text-sm">
                              {CATEGORY_LABELS[cat]}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </ScrollView>
                </View>

                {/* Supplier Category */}
                <View className="mb-4">
                  <Text className="text-sm font-medium text-gray-700 mb-2">Supplier *</Text>
                  <View className="flex-row flex-wrap">
                    {SUPPLIER_CATEGORIES.map((sup) => {
                      const isSelected = newItemSupplierCategory === sup.value;
                      return (
                        <TouchableOpacity
                          key={sup.value}
                          onPress={() => setNewItemSupplierCategory(sup.value)}
                          className={`mr-2 mb-2 px-4 py-2 rounded-lg ${
                            isSelected ? 'bg-primary-500' : 'bg-gray-100'
                          }`}
                        >
                          <Text className={`font-medium text-sm ${
                            isSelected ? 'text-white' : 'text-gray-700'
                          }`}>
                            {sup.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* Units Row */}
                <View className="flex-row mb-4">
                  <View className="flex-1 mr-2">
                    <Text className="text-sm font-medium text-gray-700 mb-2">Base Unit *</Text>
                    <TextInput
                      className="bg-gray-100 rounded-xl px-4 py-3 text-gray-900 text-base"
                      placeholder="e.g., lb, oz, each"
                      value={newItemBaseUnit}
                      onChangeText={setNewItemBaseUnit}
                      autoCapitalize="none"
                    />
                  </View>
                  <View className="flex-1 ml-2">
                    <Text className="text-sm font-medium text-gray-700 mb-2">Pack Unit *</Text>
                    <TextInput
                      className="bg-gray-100 rounded-xl px-4 py-3 text-gray-900 text-base"
                      placeholder="e.g., case, bag"
                      value={newItemPackUnit}
                      onChangeText={setNewItemPackUnit}
                      autoCapitalize="none"
                    />
                  </View>
                </View>

                {/* Pack Size */}
                <View className="mb-6">
                  <Text className="text-sm font-medium text-gray-700 mb-2">Pack Size *</Text>
                  <TextInput
                    className="bg-gray-100 rounded-xl px-4 py-3 text-gray-900 text-base"
                    placeholder="Number of base units per pack"
                    value={newItemPackSize}
                    onChangeText={setNewItemPackSize}
                    keyboardType="decimal-pad"
                  />
                  <Text className="text-xs text-gray-400 mt-1">
                    How many {newItemBaseUnit || 'base units'} per {newItemPackUnit || 'pack'}?
                  </Text>
                </View>

                {/* Employee Note */}
                <View className="bg-blue-50 rounded-xl p-4 mb-6">
                  <View className="flex-row items-center mb-1">
                    <Ionicons name="information-circle" size={18} color="#3B82F6" />
                    <Text className="text-blue-700 font-medium ml-2">Employee-Added Item</Text>
                  </View>
                  <Text className="text-blue-600 text-sm">
                    This item will be marked as added by you ({user?.name || 'Employee'}) and may be reviewed by a manager.
                  </Text>
                </View>

                {/* Action Buttons */}
                <View className="flex-row mb-8">
                  <TouchableOpacity
                    onPress={() => setShowAddItemModal(false)}
                    className="flex-1 mr-2 py-4 rounded-xl bg-gray-200"
                  >
                    <Text className="text-gray-700 font-semibold text-center">Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleAddNewItem}
                    disabled={isSubmittingItem}
                    className={`flex-1 ml-2 py-4 rounded-xl bg-primary-500 ${
                      isSubmittingItem ? 'opacity-70' : ''
                    }`}
                  >
                    <Text className="text-white font-semibold text-center">
                      {isSubmittingItem ? 'Adding...' : 'Add Item'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
