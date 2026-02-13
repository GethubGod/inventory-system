import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Keyboard,
  Platform,
  InputAccessoryView,
  LayoutAnimation,
  UIManager,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Sparkles } from 'lucide-react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuthStore, useInventoryStore, useOrderStore } from '@/store';
import { BrandLogo } from '@/components';
import type { OrderInputMode } from '@/store';
import { InventoryItem, UnitType, Location, ItemCategory, SupplierCategory } from '@/types';
import { colors, CATEGORY_LABELS } from '@/constants';
import { useScaledStyles } from '@/hooks/useScaledStyles';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Category emoji mapping
const CATEGORY_EMOJI: Record<string, string> = {
  fish: '🐟',
  protein: '🥩',
  produce: '🥬',
  dry: '🍚',
  dairy_cold: '🧊',
  frozen: '❄️',
  sauces: '🍶',
  alcohol: '🍺',
  packaging: '📦',
};

const QUICK_CREATE_CATEGORIES: ItemCategory[] = [
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

const QUICK_CREATE_SUPPLIERS: SupplierCategory[] = [
  'fish_supplier',
  'main_distributor',
  'asian_market',
];

type ScreenState = 'searching' | 'quantity';

const INPUT_ACCESSORY_ID = 'managerQuickOrderInput';

// Get short label for location (Sushi or Poki)
const getLocationLabel = (location: Location | null): string => {
  if (!location) return '';
  const name = location.name.toLowerCase();
  if (name.includes('sushi')) return 'Sushi';
  if (name.includes('poki') || name.includes('pho')) return 'Poki';
  return location.short_code;
};

export default function ManagerQuickOrderScreen() {
  const ds = useScaledStyles();
  const { location: defaultLocation, locations, user } = useAuthStore();
  const { items, fetchItems, addItem } = useInventoryStore();
  const { addToCart, getTotalCartCount, getLocationCartTotal } = useOrderStore();

  // Selected location for ordering
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(defaultLocation);
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);

  // Screen state
  const [screenState, setScreenState] = useState<ScreenState>('searching');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [remainingAmount, setRemainingAmount] = useState('0');
  const [inputMode, setInputMode] = useState<OrderInputMode>('quantity');
  const [selectedUnit, setSelectedUnit] = useState<UnitType>('pack');

  // Quick create state
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState<ItemCategory>('produce');
  const [newItemSupplier, setNewItemSupplier] = useState<SupplierCategory>('main_distributor');
  const [newItemBaseUnit, setNewItemBaseUnit] = useState('lb');
  const [newItemPackUnit, setNewItemPackUnit] = useState('case');
  const [newItemPackSize, setNewItemPackSize] = useState('1');
  const [isCreatingItem, setIsCreatingItem] = useState(false);

  // Keyboard state
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  // Refs
  const searchInputRef = useRef<TextInput>(null);
  const quantityInputRef = useRef<TextInput>(null);

  // Debounced search
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Set default location on mount
  useEffect(() => {
    if (defaultLocation && !selectedLocation) {
      setSelectedLocation(defaultLocation);
    }
  }, [defaultLocation, selectedLocation, setSelectedLocation]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 100);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch items on mount
  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // Focus search input immediately on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // Keyboard listeners
  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        setKeyboardHeight(e.endCoordinates.height);
        setIsKeyboardVisible(true);
      }
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardHeight(0);
        setIsKeyboardVisible(false);
      }
    );

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Total cart count
  const totalCartCount = getTotalCartCount('manager');
  const locationLabel = getLocationLabel(selectedLocation);
  const headerIconButtonSize = Math.max(44, ds.icon(40));
  const badgeSize = Math.max(18, ds.icon(20));
  const parsedQuantity = parseFloat(quantity);
  const parsedRemaining = parseFloat(remainingAmount);
  const canAddToCart =
    inputMode === 'quantity'
      ? Number.isFinite(parsedQuantity) && parsedQuantity > 0
      : Number.isFinite(parsedRemaining) && parsedRemaining >= 0;
  const addButtonText =
    inputMode === 'quantity'
      ? `Add Order Qty (${locationLabel})`
      : `Add Remaining (${locationLabel})`;
  const iosKeyboardOverlayInset =
    Platform.OS === 'ios' && isKeyboardVisible ? keyboardHeight : 0;
  const searchHelperBottomInset = Math.max(
    ds.spacing(24),
    iosKeyboardOverlayInset +
      (totalCartCount > 0 ? Math.max(ds.rowH - ds.spacing(12), 44) : 0) +
      ds.spacing(16)
  );

  // Filter items based on search query
  const filteredItems = useMemo(() => {
    if (!debouncedQuery.trim()) return [];
    const query = debouncedQuery.toLowerCase();
    return items
      .filter((item) => item.name.toLowerCase().includes(query))
      .slice(0, 6);
  }, [items, debouncedQuery]);

  // Get autocomplete suggestion (first match)
  const autocompleteSuggestion = useMemo(() => {
    if (!searchQuery.trim() || filteredItems.length === 0) return null;
    const firstMatch = filteredItems[0];
    const query = searchQuery.toLowerCase();
    const itemName = firstMatch.name.toLowerCase();

    if (itemName.startsWith(query)) {
      return firstMatch;
    }
    return filteredItems[0];
  }, [searchQuery, filteredItems]);

  // Get ghost text for autocomplete
  const ghostText = useMemo(() => {
    if (!autocompleteSuggestion || !searchQuery.trim()) return '';
    const itemName = autocompleteSuggestion.name;
    const query = searchQuery;

    if (itemName.toLowerCase().startsWith(query.toLowerCase())) {
      return itemName.slice(query.length);
    }
    return '';
  }, [autocompleteSuggestion, searchQuery]);

  const resetQuickCreateForm = useCallback(() => {
    const defaultName = searchQuery.trim();
    setNewItemName(defaultName);
    setNewItemCategory('produce');
    setNewItemSupplier('main_distributor');
    setNewItemBaseUnit('lb');
    setNewItemPackUnit('case');
    setNewItemPackSize('1');
  }, [searchQuery]);

  const handleOpenQuickCreate = useCallback(() => {
    resetQuickCreateForm();
    setShowQuickCreate(true);
  }, [resetQuickCreateForm]);

  const handleCreateItem = useCallback(async () => {
    if (!newItemName.trim()) {
      Alert.alert('Error', 'Please enter an item name');
      return;
    }
    if (!newItemBaseUnit.trim() || !newItemPackUnit.trim()) {
      Alert.alert('Error', 'Please enter base and pack units');
      return;
    }
    const packSize = parseFloat(newItemPackSize);
    if (isNaN(packSize) || packSize <= 0) {
      Alert.alert('Error', 'Please enter a valid pack size');
      return;
    }

    setIsCreatingItem(true);
    try {
      await addItem({
        name: newItemName.trim(),
        category: newItemCategory,
        supplier_category: newItemSupplier,
        base_unit: newItemBaseUnit.trim(),
        pack_unit: newItemPackUnit.trim(),
        pack_size: packSize,
        created_by: user?.id,
      });

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      setShowQuickCreate(false);
      setSearchQuery(newItemName.trim());
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to add item');
    } finally {
      setIsCreatingItem(false);
    }
  }, [
    newItemName,
    newItemCategory,
    newItemSupplier,
    newItemBaseUnit,
    newItemPackUnit,
    newItemPackSize,
    addItem,
    user,
    setSearchQuery,
  ]);

  // Toggle location dropdown
  const toggleLocationDropdown = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowLocationDropdown((prev) => !prev);
  }, []);

  // Handle location select
  const handleSelectLocation = useCallback((loc: Location) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setSelectedLocation(loc);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowLocationDropdown(false);
  }, []);

  // Handle item selection
  const handleSelectItem = useCallback((item: InventoryItem) => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setSelectedItem(item);
    setQuantity('1');
    setRemainingAmount('0');
    setInputMode('quantity');
    setSelectedUnit('pack');
    setScreenState('quantity');

    setTimeout(() => {
      quantityInputRef.current?.focus();
    }, 100);
  }, []);

  // Handle Enter key in search
  const handleSearchSubmit = useCallback(() => {
    if (autocompleteSuggestion) {
      handleSelectItem(autocompleteSuggestion);
    }
  }, [autocompleteSuggestion, handleSelectItem]);

  // Handle Add to Cart
  const handleAddToCart = useCallback(() => {
    if (!selectedItem || !selectedLocation) return;

    if (inputMode === 'quantity') {
      const qty = parseFloat(quantity);
      if (!Number.isFinite(qty) || qty <= 0) return;

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      addToCart(selectedLocation.id, selectedItem.id, qty, selectedUnit, {
        inputMode: 'quantity',
        quantityRequested: qty,
        context: 'manager',
      });
    } else {
      const remaining = parseFloat(remainingAmount);
      if (!Number.isFinite(remaining) || remaining < 0) return;

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      addToCart(selectedLocation.id, selectedItem.id, remaining, selectedUnit, {
        inputMode: 'remaining',
        remainingReported: remaining,
        context: 'manager',
      });
    }

    // Reset to search state
    setSearchQuery('');
    setSelectedItem(null);
    setInputMode('quantity');
    setRemainingAmount('0');
    setScreenState('searching');

    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 100);
  }, [selectedItem, selectedLocation, inputMode, quantity, remainingAmount, selectedUnit, addToCart]);

  // Handle back from quantity state
  const handleBackToSearch = useCallback(() => {
    setSelectedItem(null);
    setScreenState('searching');
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 100);
  }, []);

  // Render suggestion item
  const renderSuggestionItem = useCallback(({ item, index }: { item: InventoryItem; index: number }) => {
    const isFirst = index === 0;
    const emoji = CATEGORY_EMOJI[item.category] || '📦';
    const categoryLabel = CATEGORY_LABELS[item.category] || item.category;

    return (
      <TouchableOpacity
        onPress={() => handleSelectItem(item)}
        className={`flex-row items-center ${isFirst ? 'bg-primary-50' : ''}`}
        style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12), minHeight: ds.rowH }}
        activeOpacity={0.7}
      >
        <Text style={{ fontSize: ds.icon(32), marginRight: ds.spacing(12) }}>{emoji}</Text>
        <View className="flex-1">
          <Text style={{ fontSize: ds.fontSize(15) }} className="font-semibold text-gray-900" numberOfLines={1} ellipsizeMode="tail">{item.name}</Text>
          <Text style={{ fontSize: ds.fontSize(12) }} className="text-gray-500">
            {categoryLabel} • {item.pack_size} {item.base_unit}/{item.pack_unit}
          </Text>
        </View>
        {isFirst && (
          <View className="flex-row items-center">
            <Text style={{ fontSize: ds.fontSize(12), marginRight: ds.spacing(4) }} className="text-gray-400">Enter</Text>
            <Ionicons name="return-down-back" size={14} color={colors.gray[400]} />
          </View>
        )}
      </TouchableOpacity>
    );
  }, [handleSelectItem, ds]);

  // Input accessory view for iOS - shows above keyboard
  const renderInputAccessory = () => {
    if (Platform.OS !== 'ios') return null;

    return (
      <InputAccessoryView nativeID={INPUT_ACCESSORY_ID}>
        <View className="bg-white border-t border-gray-200">
          {/* Add to Cart button when in quantity mode */}
          {screenState === 'quantity' && selectedItem && (
            <TouchableOpacity
              onPress={handleAddToCart}
              className={`rounded-xl items-center flex-row justify-center ${
                canAddToCart ? 'bg-primary-500' : 'bg-primary-300'
              }`}
              style={{
                minHeight: ds.buttonH,
                paddingHorizontal: ds.spacing(16),
                marginHorizontal: ds.spacing(12),
                marginVertical: ds.spacing(8),
              }}
              activeOpacity={0.8}
              disabled={!canAddToCart}
            >
              <Ionicons name="cart" size={ds.icon(20)} color="white" />
              <Text style={{ fontSize: ds.buttonFont, marginLeft: ds.spacing(8) }} className="text-white font-bold">
                {addButtonText}
              </Text>
            </TouchableOpacity>
          )}

          {/* Cart indicator bar */}
          {totalCartCount > 0 && (
            <TouchableOpacity
              onPress={() => {
                Keyboard.dismiss();
                router.push('/(manager)/cart' as any);
              }}
              className="flex-row items-center justify-between bg-gray-50"
              style={{ minHeight: Math.max(ds.rowH - ds.spacing(12), 44), paddingHorizontal: ds.spacing(16) }}
            >
              <View className="flex-row items-center">
                <Ionicons name="cart" size={ds.icon(18)} color={colors.gray[600]} />
                <Text style={{ fontSize: ds.fontSize(13), marginLeft: ds.spacing(8) }} className="font-medium text-gray-700">
                  {totalCartCount} in cart
                </Text>
              </View>
              <View className="flex-row items-center">
                <Text style={{ fontSize: ds.fontSize(14), marginRight: ds.spacing(4) }} className="font-medium text-primary-600">View</Text>
                <Ionicons name="chevron-forward" size={ds.icon(16)} color={colors.primary[600]} />
              </View>
            </TouchableOpacity>
          )}
        </View>
      </InputAccessoryView>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      {/* Compact Header with Location Selector */}
      <View className="bg-white border-b border-gray-200">
        <View
          className="flex-row items-center"
          style={{ paddingHorizontal: ds.spacing(12), paddingVertical: ds.spacing(8) }}
        >
          {/* Back Button */}
          <TouchableOpacity
            onPress={() => router.replace('/(manager)')}
            style={{
              width: headerIconButtonSize,
              height: headerIconButtonSize,
              borderRadius: ds.radius(10),
              alignItems: 'center',
              justifyContent: 'center',
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={ds.icon(22)} color={colors.gray[700]} />
          </TouchableOpacity>

          {/* Location Dropdown */}
          <TouchableOpacity
            onPress={toggleLocationDropdown}
            className="flex-1 flex-row items-center justify-center"
            style={{ marginHorizontal: ds.spacing(6) }}
          >
            <View
              className="flex-row items-center bg-gray-100 rounded-full"
              style={{
                paddingHorizontal: ds.spacing(12),
                minHeight: headerIconButtonSize,
              }}
            >
              <Ionicons name="location" size={ds.icon(14)} color="#F97316" />
              <Text
                className="font-medium text-gray-900"
                style={{ fontSize: ds.fontSize(15), marginLeft: ds.spacing(8), marginRight: ds.spacing(6), flexShrink: 1 }}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {selectedLocation?.name || 'Select'}
              </Text>
              <Ionicons
                name={showLocationDropdown ? 'chevron-up' : 'chevron-down'}
                size={ds.icon(14)}
                color={colors.gray[500]}
              />
            </View>
          </TouchableOpacity>

          {/* Cart Button */}
          <TouchableOpacity
            onPress={() => router.push('/(manager)/cart' as any)}
            className="relative rounded-full bg-gray-100 items-center justify-center"
            style={{
              width: headerIconButtonSize,
              height: headerIconButtonSize,
            }}
          >
            <Ionicons name="cart-outline" size={ds.icon(20)} color={colors.gray[700]} />
            {totalCartCount > 0 && (
              <View
                className="absolute bg-primary-500 rounded-full items-center justify-center"
                style={{
                  top: -ds.spacing(2),
                  right: -ds.spacing(2),
                  minWidth: badgeSize,
                  height: badgeSize,
                  paddingHorizontal: ds.spacing(4),
                }}
              >
                <Text style={{ fontSize: ds.fontSize(11) }} className="text-white font-bold">
                  {totalCartCount > 99 ? '99+' : totalCartCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Location Dropdown Menu */}
        {showLocationDropdown && (
          <View className="border-t border-gray-100">
            {locations.map((loc) => {
              const isSelected = selectedLocation?.id === loc.id;
              const cartCount = getLocationCartTotal(loc.id, 'manager');

              return (
                <TouchableOpacity
                  key={loc.id}
                  onPress={() => handleSelectLocation(loc)}
                  className={`flex-row items-center justify-between ${
                    isSelected ? 'bg-primary-50' : ''
                  }`}
                  style={{
                    paddingHorizontal: ds.spacing(16),
                    paddingVertical: ds.spacing(12),
                    minHeight: ds.rowH,
                  }}
                >
                  <View className="flex-row items-center">
                    <View className={`rounded-full items-center justify-center ${
                      isSelected ? 'bg-primary-500' : 'bg-gray-200'
                    }`} style={{ width: ds.icon(32), height: ds.icon(32), marginRight: ds.spacing(12) }}>
                      <BrandLogo variant="inline" size={16} colorMode={isSelected ? 'dark' : 'light'} />
                    </View>
                    <Text style={{ fontSize: ds.fontSize(15) }} className={`${isSelected ? 'font-semibold text-primary-700' : 'text-gray-800'}`}>
                      {loc.name}
                    </Text>
                  </View>
                  <View className="flex-row items-center">
                    {cartCount > 0 && (
                      <Text style={{ fontSize: ds.fontSize(13), marginRight: ds.spacing(8) }} className="text-gray-500">{cartCount} items</Text>
                    )}
                    {isSelected && (
                      <Ionicons name="checkmark" size={ds.icon(18)} color={colors.primary[500]} />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      {/* Main Content */}
      <View
        className="flex-1"
        style={{ paddingHorizontal: ds.spacing(16), paddingTop: ds.spacing(12) }}
      >
        {screenState === 'searching' ? (
          <>
            {/* Search Input with Ghost Text */}
            <View className="relative">
              <View className="bg-white border border-gray-200 shadow-sm overflow-hidden" style={{ borderRadius: ds.radius(12) }}>
                <View
                  className="flex-row items-center"
                  style={{ height: ds.buttonH, paddingHorizontal: ds.spacing(14) }}
                >
                  <Ionicons name="search" size={ds.icon(20)} color={colors.gray[400]} />
                  <View className="flex-1 relative justify-center" style={{ height: ds.buttonH, marginLeft: ds.spacing(10) }}>
                    {ghostText && (
                      <View pointerEvents="none" className="absolute inset-0 flex-row items-center">
                        <Text style={{ fontSize: ds.fontSize(14) }} className="text-transparent">{searchQuery}</Text>
                        <Text style={{ fontSize: ds.fontSize(14) }} className="text-gray-300">{ghostText}</Text>
                      </View>
                    )}
                    <TextInput
                      ref={searchInputRef}
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                      onSubmitEditing={handleSearchSubmit}
                      placeholder="Type item name..."
                      placeholderTextColor={colors.gray[400]}
                      className="text-gray-900"
                      style={{ height: ds.buttonH, fontSize: ds.fontSize(14) }}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoFocus
                      returnKeyType="go"
                      inputAccessoryViewID={Platform.OS === 'ios' ? INPUT_ACCESSORY_ID : undefined}
                    />
                  </View>
                  {searchQuery.length > 0 && (
                    <TouchableOpacity
                      onPress={() => setSearchQuery('')}
                      style={{ paddingHorizontal: ds.spacing(4), minHeight: 44, justifyContent: 'center' }}
                    >
                      <Ionicons name="close-circle" size={ds.icon(20)} color={colors.gray[400]} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={handleOpenQuickCreate}
                    activeOpacity={0.8}
                    accessibilityLabel="Add item to inventory"
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

              {/* Suggestions Dropdown */}
              {filteredItems.length > 0 && searchQuery.trim() && (
                <View
                  className="absolute left-0 right-0 bg-white border border-gray-200 shadow-lg z-10 overflow-hidden"
                  style={{ top: ds.buttonH + ds.spacing(4), borderRadius: ds.radius(12) }}
                >
                  <FlatList
                    data={filteredItems}
                    keyExtractor={(item) => item.id}
                    renderItem={renderSuggestionItem}
                    keyboardShouldPersistTaps="always"
                    ItemSeparatorComponent={() => <View className="h-px bg-gray-100" />}
                  />
                </View>
              )}
            </View>

            {/* Empty State */}
            {!searchQuery.trim() && (
              <View className="flex-1 items-center justify-center" style={{ paddingBottom: searchHelperBottomInset }}>
                <Ionicons name="search-outline" size={ds.icon(56)} color={colors.gray[300]} />
                <Text style={{ fontSize: ds.fontSize(16), marginTop: ds.spacing(12) }} className="font-medium text-gray-500">Start typing to search</Text>
                <Text style={{ fontSize: ds.fontSize(14), marginTop: ds.spacing(4) }} className="text-gray-400">salmon, avocado, nori...</Text>
              </View>
            )}

            {/* No results state */}
            {searchQuery.trim() && filteredItems.length === 0 && debouncedQuery === searchQuery && (
              <View className="flex-1 items-center justify-center" style={{ paddingBottom: searchHelperBottomInset }}>
                <Ionicons name="alert-circle-outline" size={ds.icon(56)} color={colors.gray[300]} />
                <Text style={{ fontSize: ds.fontSize(16), marginTop: ds.spacing(12) }} className="font-medium text-gray-500">No items found</Text>
                <Text style={{ fontSize: ds.fontSize(14), marginTop: ds.spacing(4) }} className="text-gray-400">Try a different search term</Text>
                <TouchableOpacity
                  onPress={handleOpenQuickCreate}
                  className="bg-primary-500 rounded-full"
                  style={{
                    minHeight: ds.buttonH,
                    paddingHorizontal: ds.buttonPadH,
                    justifyContent: 'center',
                    marginTop: ds.spacing(16),
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={{ fontSize: ds.buttonFont }} className="text-white font-semibold">
                    Add {searchQuery.trim()} to Inventory?
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        ) : (
          /* Quantity Entry State - Compact */
          <View className="flex-1">
            {/* Back button */}
            <TouchableOpacity
              onPress={handleBackToSearch}
              className="flex-row items-center"
              style={{ marginBottom: ds.spacing(12), minHeight: 44 }}
            >
              <Ionicons name="arrow-back" size={ds.icon(18)} color={colors.gray[600]} />
              <Text style={{ fontSize: ds.fontSize(14), marginLeft: ds.spacing(4) }} className="text-gray-600">Back</Text>
            </TouchableOpacity>

            {/* Compact Item Card */}
            {selectedItem && (
              <View
                className="bg-white shadow-sm border border-gray-100"
                style={{ borderRadius: ds.radius(12), padding: ds.cardPad }}
              >
                {/* Item Info - Compact */}
                <View className="flex-row items-center" style={{ marginBottom: ds.spacing(16) }}>
                  <Text style={{ fontSize: ds.icon(30), marginRight: ds.spacing(12) }}>
                    {CATEGORY_EMOJI[selectedItem.category] || '📦'}
                  </Text>
                  <View className="flex-1">
                    <Text style={{ fontSize: ds.fontSize(18) }} className="font-semibold text-gray-900" numberOfLines={1} ellipsizeMode="tail">
                      {selectedItem.name}
                    </Text>
                    <Text style={{ fontSize: ds.fontSize(12) }} className="text-gray-500">
                      {selectedItem.pack_size} {selectedItem.base_unit}/{selectedItem.pack_unit}
                    </Text>
                  </View>
                </View>

                <View className="flex-row" style={{ marginBottom: ds.spacing(12) }}>
                  <TouchableOpacity
                    onPress={() => setInputMode('quantity')}
                    className={`flex-1 rounded-l-lg items-center justify-center ${
                      inputMode === 'quantity' ? 'bg-primary-500' : 'bg-gray-100'
                    }`}
                    style={{ minHeight: Math.max(44, ds.buttonH - ds.spacing(6)) }}
                  >
                    <Text style={{ fontSize: ds.fontSize(12) }} className={`font-semibold ${
                      inputMode === 'quantity' ? 'text-white' : 'text-gray-600'
                    }`}>
                      Order Qty
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setInputMode('remaining')}
                    className={`flex-1 rounded-r-lg items-center justify-center ${
                      inputMode === 'remaining' ? 'bg-primary-500' : 'bg-gray-100'
                    }`}
                    style={{ minHeight: Math.max(44, ds.buttonH - ds.spacing(6)) }}
                  >
                    <Text style={{ fontSize: ds.fontSize(12) }} className={`font-semibold ${
                      inputMode === 'remaining' ? 'text-white' : 'text-gray-600'
                    }`}>
                      Remaining
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Quantity/Remaining + Unit Row */}
                <View className="flex-row items-center">
                  {/* Value Controls */}
                  <View className="flex-row items-center flex-1">
                    <TouchableOpacity
                      onPress={() => {
                        if (inputMode === 'quantity') {
                          const q = Math.max(1, (parseFloat(quantity) || 1) - 1);
                          setQuantity(q.toString());
                        } else {
                          const r = Math.max(0, (parseFloat(remainingAmount) || 0) - 1);
                          setRemainingAmount(r.toString());
                        }
                        quantityInputRef.current?.focus();
                      }}
                      className="bg-gray-100 rounded-lg items-center justify-center"
                      style={{ width: Math.max(44, ds.icon(44)), height: Math.max(44, ds.icon(44)) }}
                    >
                      <Ionicons name="remove" size={ds.icon(20)} color={colors.gray[700]} />
                    </TouchableOpacity>

                    <TextInput
                      ref={quantityInputRef}
                      value={inputMode === 'quantity' ? quantity : remainingAmount}
                      onChangeText={inputMode === 'quantity' ? setQuantity : setRemainingAmount}
                      keyboardType="number-pad"
                      className="text-center font-bold text-gray-900"
                      style={{
                        width: ds.spacing(72),
                        height: Math.max(44, ds.buttonH),
                        fontSize: ds.fontSize(24),
                        marginHorizontal: ds.spacing(8),
                      }}
                      selectTextOnFocus
                      inputAccessoryViewID={Platform.OS === 'ios' ? INPUT_ACCESSORY_ID : undefined}
                    />

                    <TouchableOpacity
                      onPress={() => {
                        if (inputMode === 'quantity') {
                          const q = (parseFloat(quantity) || 0) + 1;
                          setQuantity(q.toString());
                        } else {
                          const r = (parseFloat(remainingAmount) || 0) + 1;
                          setRemainingAmount(r.toString());
                        }
                        quantityInputRef.current?.focus();
                      }}
                      className="bg-gray-100 rounded-lg items-center justify-center"
                      style={{ width: Math.max(44, ds.icon(44)), height: Math.max(44, ds.icon(44)) }}
                    >
                      <Ionicons name="add" size={ds.icon(20)} color={colors.gray[700]} />
                    </TouchableOpacity>
                  </View>

                  {/* Unit Toggle */}
                  <View className="flex-row" style={{ marginLeft: ds.spacing(12) }}>
                    <TouchableOpacity
                      onPress={() => {
                        setSelectedUnit('pack');
                        quantityInputRef.current?.focus();
                      }}
                      className={`rounded-l-lg justify-center ${
                        selectedUnit === 'pack' ? 'bg-primary-500' : 'bg-gray-100'
                      }`}
                      style={{
                        minHeight: 44,
                        paddingHorizontal: ds.spacing(12),
                      }}
                    >
                      <Text style={{ fontSize: ds.fontSize(14) }} className={`font-medium ${
                        selectedUnit === 'pack' ? 'text-white' : 'text-gray-600'
                      }`}>
                        {selectedItem.pack_unit}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        setSelectedUnit('base');
                        quantityInputRef.current?.focus();
                      }}
                      className={`rounded-r-lg justify-center ${
                        selectedUnit === 'base' ? 'bg-primary-500' : 'bg-gray-100'
                      }`}
                      style={{
                        minHeight: 44,
                        paddingHorizontal: ds.spacing(12),
                      }}
                    >
                      <Text style={{ fontSize: ds.fontSize(14) }} className={`font-medium ${
                        selectedUnit === 'base' ? 'text-white' : 'text-gray-600'
                      }`}>
                        {selectedItem.base_unit}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {inputMode === 'remaining' && (
                  <Text style={{ fontSize: ds.fontSize(12), marginTop: ds.spacing(12) }} className="text-gray-500">
                    Enter how many are left. A manager will decide how many to order.
                  </Text>
                )}
              </View>
            )}
          </View>
        )}
      </View>

      {/* Quick Create Modal */}
      <Modal
        visible={showQuickCreate}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowQuickCreate(false)}
      >
        <SafeAreaView className="flex-1 bg-gray-50">
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            className="flex-1"
          >
            <View
              className="bg-white border-b border-gray-200 flex-row items-center justify-between"
              style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(14) }}
            >
              <TouchableOpacity onPress={() => setShowQuickCreate(false)}>
                <Text style={{ fontSize: ds.fontSize(14) }} className="text-primary-500 font-medium">Cancel</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: ds.fontSize(18) }} className="font-bold text-gray-900">Add Item</Text>
              <View style={{ width: ds.spacing(64) }} />
            </View>

            <ScrollView className="flex-1" contentContainerStyle={{ padding: ds.spacing(16) }}>
              <View style={{ marginBottom: ds.spacing(16) }}>
                <Text style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8) }} className="font-medium text-gray-700">Item Name *</Text>
                <TextInput
                  className="bg-white border border-gray-200 text-gray-900"
                  style={{
                    borderRadius: ds.radius(12),
                    paddingHorizontal: ds.spacing(16),
                    minHeight: ds.buttonH,
                    fontSize: ds.fontSize(15),
                  }}
                  value={newItemName}
                  onChangeText={setNewItemName}
                  placeholder="e.g., Salmon (Sushi Grade)"
                  placeholderTextColor="#9CA3AF"
                  autoCapitalize="words"
                />
              </View>

              <View style={{ marginBottom: ds.spacing(16) }}>
                <Text style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8) }} className="font-medium text-gray-700">Category *</Text>
                <View className="flex-row flex-wrap" style={{ columnGap: ds.spacing(8), rowGap: ds.spacing(8) }}>
                  {QUICK_CREATE_CATEGORIES.map((cat) => {
                    const isSelected = newItemCategory === cat;
                    return (
                      <TouchableOpacity
                        key={cat}
                        className={`rounded-lg ${
                          isSelected ? 'bg-primary-500' : 'bg-gray-100'
                        }`}
                        style={{
                          minHeight: Math.max(40, ds.buttonH - ds.spacing(10)),
                          paddingHorizontal: ds.spacing(12),
                          justifyContent: 'center',
                        }}
                        onPress={() => setNewItemCategory(cat)}
                      >
                        <Text style={{ fontSize: ds.fontSize(14) }} className={`font-medium ${
                          isSelected ? 'text-white' : 'text-gray-700'
                        }`}>
                          {CATEGORY_LABELS[cat] || cat}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={{ marginBottom: ds.spacing(16) }}>
                <Text style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8) }} className="font-medium text-gray-700">Supplier *</Text>
                <View className="flex-row flex-wrap" style={{ columnGap: ds.spacing(8), rowGap: ds.spacing(8) }}>
                  {QUICK_CREATE_SUPPLIERS.map((sup) => {
                    const isSelected = newItemSupplier === sup;
                    return (
                      <TouchableOpacity
                        key={sup}
                        className={`rounded-lg ${
                          isSelected ? 'bg-primary-500' : 'bg-gray-100'
                        }`}
                        style={{
                          minHeight: Math.max(40, ds.buttonH - ds.spacing(10)),
                          paddingHorizontal: ds.spacing(12),
                          justifyContent: 'center',
                        }}
                        onPress={() => setNewItemSupplier(sup)}
                      >
                        <Text style={{ fontSize: ds.fontSize(14) }} className={`font-medium ${
                          isSelected ? 'text-white' : 'text-gray-700'
                        }`}>
                          {sup === 'fish_supplier' ? 'Fish Supplier' : sup === 'asian_market' ? 'Asian Market' : 'Main Distributor'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View className="flex-row" style={{ marginBottom: ds.spacing(16), columnGap: ds.spacing(12) }}>
                <View className="flex-1">
                  <Text style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8) }} className="font-medium text-gray-700">Base Unit *</Text>
                  <TextInput
                    className="bg-white border border-gray-200 text-gray-900"
                    style={{
                      borderRadius: ds.radius(12),
                      paddingHorizontal: ds.spacing(16),
                      minHeight: ds.buttonH,
                      fontSize: ds.fontSize(15),
                    }}
                    value={newItemBaseUnit}
                    onChangeText={setNewItemBaseUnit}
                    placeholder="e.g., lb"
                    placeholderTextColor="#9CA3AF"
                    autoCapitalize="none"
                  />
                </View>
                <View className="flex-1">
                  <Text style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8) }} className="font-medium text-gray-700">Pack Unit *</Text>
                  <TextInput
                    className="bg-white border border-gray-200 text-gray-900"
                    style={{
                      borderRadius: ds.radius(12),
                      paddingHorizontal: ds.spacing(16),
                      minHeight: ds.buttonH,
                      fontSize: ds.fontSize(15),
                    }}
                    value={newItemPackUnit}
                    onChangeText={setNewItemPackUnit}
                    placeholder="e.g., case"
                    placeholderTextColor="#9CA3AF"
                    autoCapitalize="none"
                  />
                </View>
              </View>

              <View style={{ marginBottom: ds.spacing(24) }}>
                <Text style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8) }} className="font-medium text-gray-700">Pack Size *</Text>
                <View className="flex-row items-center">
                  <TextInput
                    className="bg-white border border-gray-200 text-gray-900"
                    style={{
                      width: ds.spacing(96),
                      borderRadius: ds.radius(12),
                      paddingHorizontal: ds.spacing(16),
                      minHeight: ds.buttonH,
                      fontSize: ds.fontSize(15),
                    }}
                    value={newItemPackSize}
                    onChangeText={setNewItemPackSize}
                    placeholder="1"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="decimal-pad"
                  />
                  <Text style={{ fontSize: ds.fontSize(14), marginLeft: ds.spacing(12) }} className="text-gray-500">
                    {newItemBaseUnit || 'units'} per {newItemPackUnit || 'pack'}
                  </Text>
                </View>
              </View>
            </ScrollView>

            <View
              className="bg-white border-t border-gray-200"
              style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(14) }}
            >
              <TouchableOpacity
                className={`rounded-xl items-center flex-row justify-center ${
                  isCreatingItem ? 'bg-primary-300' : 'bg-primary-500'
                }`}
                style={{ minHeight: ds.buttonH }}
                onPress={handleCreateItem}
                disabled={isCreatingItem}
              >
                <Ionicons name="add-circle" size={ds.icon(20)} color="white" />
                <Text style={{ fontSize: ds.buttonFont, marginLeft: ds.spacing(8) }} className="text-white font-bold">
                  {isCreatingItem ? 'Adding...' : 'Add Item'}
                </Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* Android: Add to Cart button above keyboard */}
      {Platform.OS === 'android' && isKeyboardVisible && screenState === 'quantity' && selectedItem && (
        <View
          style={{
            position: 'absolute',
            bottom: keyboardHeight,
            left: 0,
            right: 0,
          }}
        >
          <View className="bg-white border-t border-gray-200" style={{ paddingHorizontal: ds.spacing(12), paddingVertical: ds.spacing(8) }}>
            <TouchableOpacity
              onPress={handleAddToCart}
              className={`rounded-xl items-center flex-row justify-center ${
                canAddToCart ? 'bg-primary-500' : 'bg-primary-300'
              }`}
              style={{ minHeight: ds.buttonH }}
              activeOpacity={0.8}
              disabled={!canAddToCart}
            >
              <Ionicons name="cart" size={ds.icon(20)} color="white" />
              <Text style={{ fontSize: ds.buttonFont, marginLeft: ds.spacing(8) }} className="text-white font-bold">
                {addButtonText}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* iOS Input Accessory View */}
      {renderInputAccessory()}
    </SafeAreaView>
  );
}
