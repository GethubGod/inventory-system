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
import { Sparkles } from 'lucide-react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useShallow } from 'zustand/react/shallow';
import { useInventoryStore, useAuthStore, useOrderStore } from '@/store';
import { InventoryItem, ItemCategory, Location, SupplierCategory } from '@/types';
import { CATEGORY_LABELS, categoryColors, colors } from '@/constants';
import { BrandLogo } from '@/components';
import { InventoryItemCard } from '@/components/InventoryItemCard';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { supabase } from '@/lib/supabase';
import { triggerPendingReminderLocalNotification } from '@/services/notificationService';

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
  const ds = useScaledStyles();
  const { location, locations, setLocation, fetchLocations, user } = useAuthStore(useShallow((state) => ({
    location: state.location,
    locations: state.locations,
    setLocation: state.setLocation,
    fetchLocations: state.fetchLocations,
    user: state.user,
  })));
  const {
    fetchItems,
    getFilteredItems,
    selectedCategory,
    setSelectedCategory,
    searchQuery,
    setSearchQuery,
    addItem,
  } = useInventoryStore(useShallow((state) => ({
    fetchItems: state.fetchItems,
    getFilteredItems: state.getFilteredItems,
    selectedCategory: state.selectedCategory,
    setSelectedCategory: state.setSelectedCategory,
    searchQuery: state.searchQuery,
    setSearchQuery: state.setSearchQuery,
    addItem: state.addItem,
  })));
  const { getLocationCartTotal, getTotalCartCount } = useOrderStore(useShallow((state) => ({
    getLocationCartTotal: state.getLocationCartTotal,
    getTotalCartCount: state.getTotalCartCount,
  })));

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
  const [unreadReminderCount, setUnreadReminderCount] = useState(0);
  const [latestReminderMessage, setLatestReminderMessage] = useState<string | null>(null);
  const totalCartCount = getTotalCartCount();
  const headerActionButtonSize = Math.max(44, ds.buttonH - ds.spacing(2));
  const modalInputHeight = Math.max(48, ds.buttonH);
  const modalBodyBottomPadding = ds.spacing(40);

  useEffect(() => {
    fetchItems();
    fetchLocations();
  }, [fetchItems, fetchLocations]);

  // Auto-select first location if none selected
  useEffect(() => {
    if (locations.length > 0 && !location) {
      setLocation(locations[0]);
    }
  }, [locations, location, setLocation]);

  const loadUnreadReminderNotifications = useCallback(async () => {
    if (!user?.id) {
      setUnreadReminderCount(0);
      setLatestReminderMessage(null);
      return;
    }

    const db = supabase as any;
    const { data, error } = await db
      .from('notifications')
      .select('id, title, body, created_at')
      .eq('user_id', user.id)
      .eq('notification_type', 'employee_reminder')
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('Unable to load unread reminders', error);
      return;
    }

    const rows = data ?? [];
    setUnreadReminderCount(rows.length);
    setLatestReminderMessage(rows[0]?.body ?? null);

    // Trigger a local notification so employees see it even if they backgrounded the app
    if (rows.length > 0) {
      triggerPendingReminderLocalNotification(rows[0]?.body).catch(() => {});
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadUnreadReminderNotifications();
    }, [loadUnreadReminderNotifications])
  );

  // Realtime: reload reminder banner when notifications table changes for this user
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`employee-reminder-notifs-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => { loadUnreadReminderNotifications(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id, loadUnreadReminderNotifications]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchItems({ force: true });
    await loadUnreadReminderNotifications();
    setRefreshing(false);
  };

  const handleMarkReminderNotificationsRead = useCallback(async () => {
    if (!user?.id || unreadReminderCount === 0) return;

    const db = supabase as any;
    const { error } = await db
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('notification_type', 'employee_reminder')
      .is('read_at', null);

    if (error) {
      Alert.alert('Unable to mark reminders as read', error.message || 'Please try again.');
      return;
    }

    setUnreadReminderCount(0);
    setLatestReminderMessage(null);
  }, [unreadReminderCount, user?.id]);

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
    <View className="flex-row flex-wrap" style={{ columnGap: ds.spacing(8), rowGap: ds.spacing(8) }}>
      {categories.map((cat) => {
        const isSelected = value === cat;
        const color = categoryColors[cat] || '#6B7280';
        return (
          <TouchableOpacity
            key={cat}
            className="rounded-lg items-center justify-center"
            style={{
              backgroundColor: isSelected ? color : color + '20',
              minHeight: Math.max(40, ds.buttonH - ds.spacing(8)),
              paddingHorizontal: ds.spacing(12),
              paddingVertical: ds.spacing(6),
            }}
            onPress={() => onChange(cat)}
          >
            <Text
              style={{ color: isSelected ? '#FFFFFF' : color, fontSize: ds.fontSize(14) }}
              className="font-medium"
            >
              {CATEGORY_LABELS[cat]}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const SupplierPicker = ({ value, onChange }: { value: SupplierCategory; onChange: (v: SupplierCategory) => void }) => (
    <View className="flex-row flex-wrap" style={{ columnGap: ds.spacing(8), rowGap: ds.spacing(8) }}>
      {SUPPLIER_CATEGORIES.map((sup) => {
        const isSelected = value === sup.value;
        return (
          <TouchableOpacity
            key={sup.value}
            className={`rounded-lg items-center justify-center ${isSelected ? 'bg-primary-500' : 'bg-gray-100'}`}
            style={{
              minHeight: Math.max(40, ds.buttonH - ds.spacing(8)),
              paddingHorizontal: ds.spacing(12),
              paddingVertical: ds.spacing(6),
            }}
            onPress={() => onChange(sup.value)}
          >
            <Text
              className={`font-medium ${isSelected ? 'text-white' : 'text-gray-700'}`}
              style={{ fontSize: ds.fontSize(14) }}
            >
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
            className="flex-row items-center bg-gray-100 rounded-full flex-1 mr-3"
            style={{ paddingHorizontal: ds.spacing(12), minHeight: headerActionButtonSize }}
          >
            <Ionicons name="location" size={ds.icon(14)} color="#F97316" />
            <Text className="font-medium text-gray-900 flex-1" numberOfLines={1} style={{ fontSize: ds.fontSize(15), marginLeft: ds.spacing(8) }}>
              {location?.name || 'Select Location'}
            </Text>
            <Ionicons
              name={showLocationDropdown ? 'chevron-up' : 'chevron-down'}
              size={ds.icon(14)}
              color={colors.gray[500]}
            />
          </TouchableOpacity>

          <View className="flex-row items-center">
            <TouchableOpacity
              onPress={handleOpenAddItemModal}
              className="rounded-full bg-gray-100 items-center justify-center mr-2"
              style={{ width: headerActionButtonSize, height: headerActionButtonSize }}
            >
              <Ionicons name="add" size={ds.icon(20)} color={colors.gray[700]} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push('/cart' as any)}
              className="rounded-full bg-gray-100 items-center justify-center relative"
              style={{ width: headerActionButtonSize, height: headerActionButtonSize }}
            >
              <Ionicons name="cart-outline" size={ds.icon(20)} color={colors.gray[700]} />
              {totalCartCount > 0 && (
                <View
                  className="absolute bg-primary-500 rounded-full items-center justify-center px-1"
                  style={{
                    top: -ds.spacing(2),
                    right: -ds.spacing(2),
                    minWidth: Math.max(20, ds.icon(20)),
                    height: Math.max(20, ds.icon(20)),
                  }}
                >
                  <Text className="text-white font-bold" style={{ fontSize: ds.fontSize(10) }}>
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
                      <BrandLogo variant="inline" size={18} colorMode={isSelected ? 'dark' : 'light'} />
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

      {unreadReminderCount > 0 && (
        <View className="bg-white border-b border-gray-100" style={{ paddingHorizontal: ds.spacing(16), paddingBottom: ds.spacing(10) }}>
          <View
            style={{
              borderRadius: ds.radius(12),
              backgroundColor: '#FFF7ED',
              borderWidth: 1,
              borderColor: '#FED7AA',
              paddingHorizontal: ds.spacing(12),
              paddingVertical: ds.spacing(10),
            }}
          >
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-2">
                <Text className="text-orange-700 font-semibold" style={{ fontSize: ds.fontSize(13) }}>
                  Reminder waiting ({unreadReminderCount})
                </Text>
                <Text className="text-orange-800" style={{ fontSize: ds.fontSize(12), marginTop: ds.spacing(2) }}>
                  {latestReminderMessage || 'A manager reminded you to place an order.'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={handleMarkReminderNotificationsRead}
                className="bg-orange-100 rounded-full"
                style={{ paddingHorizontal: ds.spacing(10), paddingVertical: ds.spacing(6) }}
              >
                <Text className="text-orange-700 font-semibold" style={{ fontSize: ds.fontSize(11) }}>
                  Mark Read
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Search Bar */}
      <View className="bg-white border-b border-gray-100" style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12) }}>
        <View className="flex-row items-center bg-gray-100" style={{ borderRadius: ds.radius(12), paddingHorizontal: ds.spacing(16), height: ds.buttonH }}>
          <Ionicons name="search-outline" size={ds.icon(20)} color="#9CA3AF" />
          <TextInput
            className="flex-1 ml-2 text-gray-900"
            style={{ fontSize: ds.fontSize(14) }}
            placeholder="Search inventory..."
            placeholderTextColor="#9CA3AF"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close-circle" size={ds.icon(20)} color="#9CA3AF" />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => router.navigate('/(tabs)/voice')}
            activeOpacity={0.8}
            accessibilityLabel="Voice order"
            accessibilityRole="button"
            style={{
              width: Math.max(44, ds.icon(32)),
              height: Math.max(44, ds.icon(32)),
              borderRadius: ds.icon(16),
              backgroundColor: '#F97316',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: ds.spacing(8),
              shadowColor: '#F97316',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.3,
              shadowRadius: 8,
              elevation: 4,
            }}
          >
            <Sparkles size={ds.icon(16)} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      {showCategoryGrid ? (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: ds.spacing(16), paddingBottom: 32 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#F97316"
            />
          }
        >
          <Text className="text-gray-500 uppercase tracking-wide" style={{ fontSize: ds.fontSize(12), marginBottom: ds.spacing(12) }}>
            Browse by Category
          </Text>
          <View className="flex-row flex-wrap justify-between" style={{ gap: ds.spacing(10) }}>
            {categories.map((cat) => {
              const catColor = categoryColors[cat] || '#6B7280';
              return (
                <TouchableOpacity
                  key={cat}
                  onPress={() => handleSelectCategory(cat)}
                  className="bg-white border border-gray-100"
                  style={{
                    width: '48%',
                    padding: ds.cardPad,
                    borderRadius: ds.radius(14),
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: 0.05,
                    shadowRadius: 4,
                    elevation: 2,
                  }}
                >
                  <View
                    className="rounded-xl items-center justify-center"
                    style={{ width: ds.icon(40), height: ds.icon(40), backgroundColor: catColor + '20', marginBottom: ds.spacing(12) }}
                  >
                    <Ionicons name={CATEGORY_ICONS[cat]} size={ds.icon(20)} color={catColor} />
                  </View>
                  <Text className="font-semibold text-gray-900" numberOfLines={1} style={{ fontSize: ds.fontSize(13) }}>
                    {CATEGORY_LABELS[cat]}
                  </Text>
                  <Text className="text-gray-400" style={{ fontSize: ds.fontSize(11), marginTop: ds.spacing(4) }}>View items</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      ) : (
        <>
          <View className="bg-white border-b border-gray-100 flex-row items-center justify-between" style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(8) }}>
            <TouchableOpacity onPress={handleBackToCategories} className="flex-row items-center" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="arrow-back" size={ds.icon(18)} color={colors.gray[600]} />
              <Text className="text-gray-600 ml-1" style={{ fontSize: ds.fontSize(14) }}>Categories</Text>
            </TouchableOpacity>
            {selectedCategory ? (
              <Text className="font-semibold text-gray-900" style={{ fontSize: ds.fontSize(15) }}>
                {CATEGORY_LABELS[selectedCategory]}
              </Text>
            ) : (
              <Text className="text-gray-500" style={{ fontSize: ds.fontSize(14) }}>Search Results</Text>
            )}
          </View>

          {/* Inventory List */}
          <FlatList
            data={filteredItems}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: ds.spacing(16) }}
            ItemSeparatorComponent={() => <View style={{ height: ds.spacing(12) }} />}
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
            <View
              className="bg-white border-b border-gray-200 flex-row items-center justify-between"
              style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(14) }}
            >
              <TouchableOpacity onPress={() => setShowAddItemModal(false)} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text className="text-primary-500 font-medium" style={{ fontSize: ds.fontSize(14) }}>Cancel</Text>
              </TouchableOpacity>
              <Text className="font-bold text-gray-900" style={{ fontSize: ds.fontSize(24) }}>Add New Item</Text>
              <View style={{ width: ds.spacing(56) }} />
            </View>

            <ScrollView
              className="flex-1"
              contentContainerStyle={{ padding: ds.spacing(16), paddingBottom: modalBodyBottomPadding }}
              showsVerticalScrollIndicator
              keyboardShouldPersistTaps="handled"
            >
              {/* Name */}
              <View style={{ marginBottom: ds.spacing(16) }}>
                <Text className="font-medium text-gray-700" style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8) }}>
                  Item Name *
                </Text>
                <TextInput
                  className="bg-white border border-gray-200 text-gray-900"
                  style={{
                    borderRadius: ds.radius(12),
                    minHeight: modalInputHeight,
                    paddingHorizontal: ds.spacing(14),
                    fontSize: ds.fontSize(15),
                  }}
                  placeholder="e.g., Salmon (Sushi Grade)"
                  placeholderTextColor="#9CA3AF"
                  value={newItemName}
                  onChangeText={setNewItemName}
                />
              </View>

              {/* Category */}
              <View style={{ marginBottom: ds.spacing(16) }}>
                <Text className="font-medium text-gray-700" style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8) }}>
                  Category *
                </Text>
                <CategoryPicker
                  value={newItemCategory}
                  onChange={setNewItemCategory}
                />
              </View>

              {/* Supplier Category */}
              <View style={{ marginBottom: ds.spacing(16) }}>
                <Text className="font-medium text-gray-700" style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8) }}>
                  Supplier *
                </Text>
                <SupplierPicker
                  value={newItemSupplierCategory}
                  onChange={setNewItemSupplierCategory}
                />
              </View>

              {/* Units Row */}
              <View className="flex-row" style={{ columnGap: ds.spacing(12), marginBottom: ds.spacing(16) }}>
                <View className="flex-1">
                  <Text className="font-medium text-gray-700" style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8) }}>
                    Base Unit *
                  </Text>
                  <TextInput
                    className="bg-white border border-gray-200 text-gray-900"
                    style={{
                      borderRadius: ds.radius(12),
                      minHeight: modalInputHeight,
                      paddingHorizontal: ds.spacing(14),
                      fontSize: ds.fontSize(15),
                    }}
                    placeholder="e.g., lb"
                    placeholderTextColor="#9CA3AF"
                    value={newItemBaseUnit}
                    onChangeText={setNewItemBaseUnit}
                  />
                </View>
                <View className="flex-1">
                  <Text className="font-medium text-gray-700" style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8) }}>
                    Pack Unit *
                  </Text>
                  <TextInput
                    className="bg-white border border-gray-200 text-gray-900"
                    style={{
                      borderRadius: ds.radius(12),
                      minHeight: modalInputHeight,
                      paddingHorizontal: ds.spacing(14),
                      fontSize: ds.fontSize(15),
                    }}
                    placeholder="e.g., case"
                    placeholderTextColor="#9CA3AF"
                    value={newItemPackUnit}
                    onChangeText={setNewItemPackUnit}
                  />
                </View>
              </View>

              {/* Pack Size */}
              <View style={{ marginBottom: ds.spacing(24) }}>
                <Text className="font-medium text-gray-700" style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8) }}>
                  Pack Size *
                </Text>
                <View className="flex-row items-center">
                  <TextInput
                    className="bg-white border border-gray-200 text-gray-900"
                    style={{
                      width: ds.spacing(104),
                      borderRadius: ds.radius(12),
                      minHeight: modalInputHeight,
                      paddingHorizontal: ds.spacing(14),
                      fontSize: ds.fontSize(15),
                    }}
                    placeholder="10"
                    placeholderTextColor="#9CA3AF"
                    value={newItemPackSize}
                    onChangeText={setNewItemPackSize}
                    keyboardType="number-pad"
                  />
                  <Text className="text-gray-500" style={{ marginLeft: ds.spacing(12), fontSize: ds.fontSize(14) }}>
                    {newItemBaseUnit || 'units'} per {newItemPackUnit || 'pack'}
                  </Text>
                </View>
              </View>

              {/* Preview */}
              {newItemName && (
                <View className="bg-primary-50 rounded-xl" style={{ padding: ds.spacing(16), marginBottom: ds.spacing(24), borderRadius: ds.radius(12) }}>
                  <Text className="font-medium text-primary-700" style={{ fontSize: ds.fontSize(13), marginBottom: ds.spacing(8) }}>
                    Preview
                  </Text>
                  <Text className="text-gray-900 font-semibold" style={{ fontSize: ds.fontSize(15) }}>{newItemName}</Text>
                  <Text className="text-gray-600 mt-1" style={{ fontSize: ds.fontSize(13) }}>
                    {CATEGORY_LABELS[newItemCategory]} • {SUPPLIER_CATEGORIES.find((s) => s.value === newItemSupplierCategory)?.label}
                  </Text>
                  <Text className="text-gray-500 mt-1" style={{ fontSize: ds.fontSize(13) }}>
                    {newItemPackSize || '1'} {newItemBaseUnit || 'units'} per {newItemPackUnit || 'pack'}
                  </Text>
                </View>
              )}
            </ScrollView>

            {/* Submit Button */}
            <View className="bg-white border-t border-gray-200" style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(14) }}>
              <TouchableOpacity
                className={`rounded-xl items-center flex-row justify-center ${
                  isSubmittingItem ? 'bg-primary-300' : 'bg-primary-500'
                }`}
                style={{ minHeight: modalInputHeight, borderRadius: ds.radius(12) }}
                onPress={handleAddNewItem}
                disabled={isSubmittingItem}
              >
                <Ionicons name="add-circle" size={ds.icon(20)} color="white" />
                <Text className="text-white font-bold ml-2" style={{ fontSize: ds.buttonFont }}>
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
