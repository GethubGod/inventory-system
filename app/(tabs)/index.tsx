import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  Modal,
  Alert,
  ScrollView,
  LayoutAnimation,
  Platform,
  UIManager,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useInventoryStore, useAuthStore, useOrderStore } from '@/store';
import { InventoryItem, ItemCategory, Location, SupplierCategory } from '@/types';
import { CATEGORY_LABELS, categoryColors, colors } from '@/constants';
import { BrandLogo } from '@/components';
import { InventoryItemCard } from '@/components/InventoryItemCard';

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
  'alcohol',
  'packaging',
];

const CATEGORY_ICONS: Record<ItemCategory, keyof typeof Ionicons.glyphMap> = {
  fish: 'fish-outline',
  protein: 'restaurant-outline',
  produce: 'leaf-outline',
  dry: 'cube-outline',
  dairy_cold: 'thermometer-outline',
  frozen: 'snow-outline',
  sauces: 'water-outline',
  alcohol: 'wine-outline',
  packaging: 'archive-outline',
};

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
  const { getLocationCartTotal, getTotalCartCount, addToCart } = useOrderStore();

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
  const totalCartCount = getTotalCartCount();

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

  const handleSelectCategory = useCallback((category: ItemCategory) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setSelectedCategory(category);
    setSearchQuery('');
  }, [setSelectedCategory, setSearchQuery]);

  const handleBackToCategories = useCallback(() => {
    setSelectedCategory(null);
    setSearchQuery('');
  }, [setSelectedCategory, setSearchQuery]);

  const filteredItems = getFilteredItems();
  const showCategoryGrid = !selectedCategory && !searchQuery.trim();

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

  const CategoryPicker = ({ value, onChange }: { value: ItemCategory; onChange: (v: ItemCategory) => void }) => (
    <View className="flex-row flex-wrap gap-2">
      {categories.map((cat) => {
        const isSelected = value === cat;
        const color = categoryColors[cat] || '#6B7280';
        return (
          <TouchableOpacity
            key={cat}
            className="px-3 py-2 rounded-lg"
            style={{ backgroundColor: isSelected ? color : color + '20' }}
            onPress={() => onChange(cat)}
          >
            <Text
              style={{ color: isSelected ? '#FFFFFF' : color }}
              className="text-sm font-medium"
            >
              {CATEGORY_LABELS[cat]}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const SupplierPicker = ({ value, onChange }: { value: SupplierCategory; onChange: (v: SupplierCategory) => void }) => (
    <View className="flex-row flex-wrap gap-2">
      {SUPPLIER_CATEGORIES.map((sup) => {
        const isSelected = value === sup.value;
        return (
          <TouchableOpacity
            key={sup.value}
            className={`px-3 py-2 rounded-lg ${isSelected ? 'bg-primary-500' : 'bg-gray-100'}`}
            onPress={() => onChange(sup.value)}
          >
            <Text className={`text-sm font-medium ${isSelected ? 'text-white' : 'text-gray-700'}`}>
              {sup.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      {/* Header */}
      <View className="bg-white border-b border-gray-200">
        <View className="flex-row items-center justify-between px-4 py-3">
          <TouchableOpacity
            onPress={toggleLocationDropdown}
            className="flex-row items-center bg-gray-100 px-3 py-2 rounded-xl flex-1 mr-3"
          >
            <BrandLogo variant="header" size={26} style={{ marginRight: 8 }} />
            <Text className="text-base font-semibold text-gray-900 flex-1" numberOfLines={1}>
              {location?.name || 'Select Location'}
            </Text>
            <Ionicons
              name={showLocationDropdown ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={colors.gray[500]}
            />
          </TouchableOpacity>

          <View className="flex-row items-center">
            <TouchableOpacity
              onPress={handleOpenAddItemModal}
              className="w-9 h-9 rounded-full bg-gray-100 items-center justify-center mr-2"
            >
              <Ionicons name="add" size={20} color={colors.gray[700]} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push('/cart' as any)}
              className="w-9 h-9 rounded-full bg-gray-100 items-center justify-center relative"
            >
              <Ionicons name="cart-outline" size={20} color={colors.gray[700]} />
              {totalCartCount > 0 && (
                <View
                  className="absolute -top-1 -right-1 bg-primary-500 h-5 rounded-full items-center justify-center px-1"
                  style={{ minWidth: 20 }}
                >
                  <Text className="text-white font-bold" style={{ fontSize: 10 }}>
                    {totalCartCount > 99 ? '99+' : totalCartCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

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

      {showCategoryGrid ? (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#F97316"
            />
          }
        >
          <Text className="text-xs text-gray-500 uppercase tracking-wide mb-3">
            Browse by Category
          </Text>
          <View className="flex-row flex-wrap justify-between">
            {categories.map((cat) => {
              const catColor = categoryColors[cat] || '#6B7280';
              return (
                <TouchableOpacity
                  key={cat}
                  onPress={() => handleSelectCategory(cat)}
                  className="bg-white rounded-2xl p-4 mb-4 border border-gray-100"
                  style={{
                    width: '48%',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: 0.05,
                    shadowRadius: 4,
                    elevation: 2,
                  }}
                >
                  <View
                    className="w-10 h-10 rounded-xl items-center justify-center mb-3"
                    style={{ backgroundColor: catColor + '20' }}
                  >
                    <Ionicons name={CATEGORY_ICONS[cat]} size={20} color={catColor} />
                  </View>
                  <Text className="text-base font-semibold text-gray-900">
                    {CATEGORY_LABELS[cat]}
                  </Text>
                  <Text className="text-xs text-gray-400 mt-1">View items</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      ) : (
        <>
          <View className="px-4 py-2 bg-white border-b border-gray-100 flex-row items-center justify-between">
            <TouchableOpacity onPress={handleBackToCategories} className="flex-row items-center">
              <Ionicons name="arrow-back" size={18} color={colors.gray[600]} />
              <Text className="text-sm text-gray-600 ml-1">Categories</Text>
            </TouchableOpacity>
            {selectedCategory ? (
              <Text className="text-sm font-semibold text-gray-900">
                {CATEGORY_LABELS[selectedCategory]}
              </Text>
            ) : (
              <Text className="text-sm text-gray-500">Search Results</Text>
            )}
          </View>

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
        </>
      )}

      {/* Add Item Modal */}
      <Modal
        visible={showAddItemModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowAddItemModal(false)}
      >
        <SafeAreaView className="flex-1 bg-gray-50">
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            className="flex-1"
          >
            {/* Modal Header */}
            <View className="bg-white px-4 py-4 border-b border-gray-200 flex-row items-center justify-between">
              <TouchableOpacity onPress={() => setShowAddItemModal(false)}>
                <Text className="text-primary-500 font-medium">Cancel</Text>
              </TouchableOpacity>
              <Text className="text-lg font-bold text-gray-900">Add New Item</Text>
              <View style={{ width: 50 }} />
            </View>

            <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
              {/* Name */}
              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-2">
                  Item Name *
                </Text>
                <TextInput
                  className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900"
                  placeholder="e.g., Salmon (Sushi Grade)"
                  placeholderTextColor="#9CA3AF"
                  value={newItemName}
                  onChangeText={setNewItemName}
                />
              </View>

              {/* Category */}
              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-2">
                  Category *
                </Text>
                <CategoryPicker
                  value={newItemCategory}
                  onChange={setNewItemCategory}
                />
              </View>

              {/* Supplier Category */}
              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-2">
                  Supplier *
                </Text>
                <SupplierPicker
                  value={newItemSupplierCategory}
                  onChange={setNewItemSupplierCategory}
                />
              </View>

              {/* Units Row */}
              <View className="flex-row gap-3 mb-4">
                <View className="flex-1">
                  <Text className="text-sm font-medium text-gray-700 mb-2">
                    Base Unit *
                  </Text>
                  <TextInput
                    className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900"
                    placeholder="e.g., lb"
                    placeholderTextColor="#9CA3AF"
                    value={newItemBaseUnit}
                    onChangeText={setNewItemBaseUnit}
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-medium text-gray-700 mb-2">
                    Pack Unit *
                  </Text>
                  <TextInput
                    className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900"
                    placeholder="e.g., case"
                    placeholderTextColor="#9CA3AF"
                    value={newItemPackUnit}
                    onChangeText={setNewItemPackUnit}
                  />
                </View>
              </View>

              {/* Pack Size */}
              <View className="mb-6">
                <Text className="text-sm font-medium text-gray-700 mb-2">
                  Pack Size *
                </Text>
                <View className="flex-row items-center">
                  <TextInput
                    className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900 w-24"
                    placeholder="10"
                    placeholderTextColor="#9CA3AF"
                    value={newItemPackSize}
                    onChangeText={setNewItemPackSize}
                    keyboardType="number-pad"
                  />
                  <Text className="text-gray-500 ml-3">
                    {newItemBaseUnit || 'units'} per {newItemPackUnit || 'pack'}
                  </Text>
                </View>
              </View>

              {/* Preview */}
              {newItemName && (
                <View className="bg-primary-50 rounded-xl p-4 mb-6">
                  <Text className="text-sm font-medium text-primary-700 mb-2">
                    Preview
                  </Text>
                  <Text className="text-gray-900 font-semibold">{newItemName}</Text>
                  <Text className="text-gray-600 text-sm mt-1">
                    {CATEGORY_LABELS[newItemCategory]} • {SUPPLIER_CATEGORIES.find((s) => s.value === newItemSupplierCategory)?.label}
                  </Text>
                  <Text className="text-gray-500 text-sm mt-1">
                    {newItemPackSize || '1'} {newItemBaseUnit || 'units'} per {newItemPackUnit || 'pack'}
                  </Text>
                </View>
              )}
            </ScrollView>

            {/* Submit Button */}
            <View className="bg-white border-t border-gray-200 px-4 py-4">
              <TouchableOpacity
                className={`rounded-xl py-4 items-center flex-row justify-center ${
                  isSubmittingItem ? 'bg-primary-300' : 'bg-primary-500'
                }`}
                onPress={handleAddNewItem}
                disabled={isSubmittingItem}
              >
                <Ionicons name="add-circle" size={20} color="white" />
                <Text className="text-white font-bold text-lg ml-2">
                  {isSubmittingItem ? 'Adding...' : 'Add Item'}
                </Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
