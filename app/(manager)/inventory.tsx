import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  Modal,
  ScrollView,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useInventoryStore } from '@/store';
import { InventoryItem, ItemCategory, SupplierCategory } from '@/types';
import { CATEGORY_LABELS, SUPPLIER_CATEGORY_LABELS, categoryColors, colors } from '@/constants';
import { SpinningFish } from '@/components';

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

const supplierCategories: SupplierCategory[] = [
  'fish_supplier',
  'main_distributor',
  'asian_market',
];

interface NewItemForm {
  name: string;
  category: ItemCategory;
  supplier_category: SupplierCategory;
  base_unit: string;
  pack_unit: string;
  pack_size: string;
}

const initialForm: NewItemForm = {
  name: '',
  category: 'produce',
  supplier_category: 'main_distributor',
  base_unit: '',
  pack_unit: '',
  pack_size: '1',
};

export default function ManagerInventoryScreen() {
  const {
    fetchItems,
    getFilteredItems,
    addItem,
    deleteItem,
    selectedCategory,
    setSelectedCategory,
    searchQuery,
    setSearchQuery,
    isLoading,
  } = useInventoryStore();

  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState<NewItemForm>(initialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    // Force refresh on mount
    useInventoryStore.setState({ lastFetched: null });
    fetchItems();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    useInventoryStore.setState({ lastFetched: null });
    await fetchItems();
    setRefreshing(false);
  };

  const filteredItems = getFilteredItems();

  const handleAddItem = useCallback(async () => {
    // Validation
    if (!form.name.trim()) {
      Alert.alert('Error', 'Please enter an item name');
      return;
    }
    if (!form.base_unit.trim()) {
      Alert.alert('Error', 'Please enter a base unit');
      return;
    }
    if (!form.pack_unit.trim()) {
      Alert.alert('Error', 'Please enter a pack unit');
      return;
    }

    const packSize = parseInt(form.pack_size, 10);
    if (isNaN(packSize) || packSize < 1) {
      Alert.alert('Error', 'Please enter a valid pack size');
      return;
    }

    setIsSubmitting(true);
    try {
      await addItem({
        name: form.name.trim(),
        category: form.category,
        supplier_category: form.supplier_category,
        base_unit: form.base_unit.trim(),
        pack_unit: form.pack_unit.trim(),
        pack_size: packSize,
      });

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      setShowAddModal(false);
      setForm(initialForm);
      Alert.alert('Success', 'Item added successfully');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to add item');
    } finally {
      setIsSubmitting(false);
    }
  }, [form, addItem]);

  const handleDeleteItem = useCallback((item: InventoryItem) => {
    Alert.alert(
      'Delete Item',
      `Are you sure you want to delete "${item.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteItem(item.id);
              if (Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              }
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to delete item');
            }
          },
        },
      ]
    );
  }, [deleteItem]);

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
              <Text className="text-gray-400 text-xs ml-2">
                {SUPPLIER_CATEGORY_LABELS[item.supplier_category]}
              </Text>
            </View>
          </View>
          <View className="items-end">
            <Text className="text-gray-500 text-sm">{item.base_unit}</Text>
            <Text className="text-gray-400 text-xs mt-1">
              {item.pack_size} per {item.pack_unit}
            </Text>
          </View>
          <TouchableOpacity
            className="ml-2 p-2"
            onPress={() => handleDeleteItem(item)}
          >
            <Ionicons name="trash-outline" size={18} color={colors.gray[400]} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const CategoryPicker = ({ value, onChange }: { value: ItemCategory; onChange: (v: ItemCategory) => void }) => (
    <View className="flex-row flex-wrap gap-2">
      {categories.map((cat) => {
        const isSelected = value === cat;
        const color = categoryColors[cat];
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
      {supplierCategories.map((sup) => {
        const isSelected = value === sup;
        return (
          <TouchableOpacity
            key={sup}
            className={`px-3 py-2 rounded-lg ${isSelected ? 'bg-primary-500' : 'bg-gray-100'}`}
            onPress={() => onChange(sup)}
          >
            <Text className={`text-sm font-medium ${isSelected ? 'text-white' : 'text-gray-700'}`}>
              {SUPPLIER_CATEGORY_LABELS[sup]}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      {/* Header */}
      <View className="bg-white px-4 py-3 border-b border-gray-100 flex-row items-center justify-between">
        <Text className="text-xl font-bold text-gray-900">Inventory</Text>
        <TouchableOpacity
          className="bg-primary-500 rounded-xl px-4 py-2 flex-row items-center"
          onPress={() => setShowAddModal(true)}
        >
          <Ionicons name="add" size={20} color="white" />
          <Text className="text-white font-semibold ml-1">Add Item</Text>
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View className="px-4 py-3 bg-white border-b border-gray-200">
        <View className="flex-row items-center bg-gray-100 rounded-xl px-4 py-2">
          <Ionicons name="search-outline" size={20} color="#9CA3AF" />
          <TextInput
            className="flex-1 ml-2 text-gray-900"
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
            <TouchableOpacity
              className="mt-4 bg-primary-500 rounded-xl px-5 py-3 flex-row items-center"
              onPress={() => setShowAddModal(true)}
            >
              <Ionicons name="add" size={20} color="white" />
              <Text className="text-white font-semibold ml-2">Add First Item</Text>
            </TouchableOpacity>
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
        visible={showAddModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowAddModal(false)}
      >
        <SafeAreaView className="flex-1 bg-gray-50">
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            className="flex-1"
          >
            {/* Modal Header */}
            <View className="bg-white px-4 py-4 border-b border-gray-200 flex-row items-center justify-between">
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
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
                  value={form.name}
                  onChangeText={(text) => setForm({ ...form, name: text })}
                />
              </View>

              {/* Category */}
              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-2">
                  Category *
                </Text>
                <CategoryPicker
                  value={form.category}
                  onChange={(cat) => setForm({ ...form, category: cat })}
                />
              </View>

              {/* Supplier Category */}
              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-2">
                  Supplier *
                </Text>
                <SupplierPicker
                  value={form.supplier_category}
                  onChange={(sup) => setForm({ ...form, supplier_category: sup })}
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
                    value={form.base_unit}
                    onChangeText={(text) => setForm({ ...form, base_unit: text })}
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
                    value={form.pack_unit}
                    onChangeText={(text) => setForm({ ...form, pack_unit: text })}
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
                    value={form.pack_size}
                    onChangeText={(text) => setForm({ ...form, pack_size: text })}
                    keyboardType="number-pad"
                  />
                  <Text className="text-gray-500 ml-3">
                    {form.base_unit || 'units'} per {form.pack_unit || 'pack'}
                  </Text>
                </View>
              </View>

              {/* Preview */}
              {form.name && (
                <View className="bg-primary-50 rounded-xl p-4 mb-6">
                  <Text className="text-sm font-medium text-primary-700 mb-2">
                    Preview
                  </Text>
                  <Text className="text-gray-900 font-semibold">{form.name}</Text>
                  <Text className="text-gray-600 text-sm mt-1">
                    {CATEGORY_LABELS[form.category]} • {SUPPLIER_CATEGORY_LABELS[form.supplier_category]}
                  </Text>
                  <Text className="text-gray-500 text-sm mt-1">
                    {form.pack_size || '1'} {form.base_unit || 'units'} per {form.pack_unit || 'pack'}
                  </Text>
                </View>
              )}
            </ScrollView>

            {/* Submit Button */}
            <View className="bg-white border-t border-gray-200 px-4 py-4">
              <TouchableOpacity
                className={`rounded-xl py-4 items-center flex-row justify-center ${
                  isSubmitting ? 'bg-primary-300' : 'bg-primary-500'
                }`}
                onPress={handleAddItem}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <SpinningFish size="small" />
                ) : (
                  <>
                    <Ionicons name="add-circle" size={20} color="white" />
                    <Text className="text-white font-bold text-lg ml-2">
                      Add Item
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
