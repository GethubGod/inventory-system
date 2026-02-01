import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Keyboard,
  Animated,
  Platform,
  InputAccessoryView,
  LayoutAnimation,
  UIManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuthStore, useInventoryStore, useOrderStore } from '@/store';
import { InventoryItem, UnitType, Location } from '@/types';
import { colors, CATEGORY_LABELS } from '@/constants';

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
  packaging: '📦',
};

type ScreenState = 'searching' | 'quantity';

const INPUT_ACCESSORY_ID = 'quickOrderInput';

// Get short label for location (Sushi or Poki)
const getLocationLabel = (location: Location | null): string => {
  if (!location) return '';
  const name = location.name.toLowerCase();
  if (name.includes('sushi')) return 'Sushi';
  if (name.includes('poki') || name.includes('pho')) return 'Poki';
  return location.short_code;
};

export default function QuickOrderScreen() {
  const { location: defaultLocation, locations } = useAuthStore();
  const { items, fetchItems } = useInventoryStore();
  const { addToCart, getTotalCartCount, getLocationCartTotal } = useOrderStore();

  // Selected location for ordering
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(defaultLocation);
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);

  // Screen state
  const [screenState, setScreenState] = useState<ScreenState>('searching');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [selectedUnit, setSelectedUnit] = useState<UnitType>('pack');
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  // Keyboard state
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  // Refs
  const searchInputRef = useRef<TextInput>(null);
  const quantityInputRef = useRef<TextInput>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;

  // Debounced search
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Set default location on mount
  useEffect(() => {
    if (defaultLocation && !selectedLocation) {
      setSelectedLocation(defaultLocation);
    }
  }, [defaultLocation]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 100);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch items on mount
  useEffect(() => {
    fetchItems();
  }, []);

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
  const totalCartCount = getTotalCartCount();
  const locationLabel = getLocationLabel(selectedLocation);

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

  // Show toast notification
  const showSuccessToast = useCallback((message: string) => {
    setToastMessage(message);
    setShowToast(true);
    Animated.sequence([
      Animated.timing(toastOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.delay(1200),
      Animated.timing(toastOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => setShowToast(false));
  }, []);

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

    const qty = parseFloat(quantity) || 1;
    if (qty <= 0) return;

    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    addToCart(selectedLocation.id, selectedItem.id, qty, selectedUnit);

    const unitLabel = selectedUnit === 'pack' ? selectedItem.pack_unit : selectedItem.base_unit;
    showSuccessToast(`✓ ${selectedItem.name} (${qty} ${unitLabel})`);

    // Reset to search state
    setSearchQuery('');
    setSelectedItem(null);
    setScreenState('searching');

    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 100);
  }, [selectedItem, selectedLocation, quantity, selectedUnit, addToCart, showSuccessToast]);

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
        className={`flex-row items-center px-4 py-3 ${isFirst ? 'bg-primary-50' : ''}`}
        activeOpacity={0.7}
      >
        <Text className="text-2xl mr-3">{emoji}</Text>
        <View className="flex-1">
          <Text className="text-base font-semibold text-gray-900">{item.name}</Text>
          <Text className="text-sm text-gray-500">
            {categoryLabel} • {item.pack_size} {item.base_unit}/{item.pack_unit}
          </Text>
        </View>
        {isFirst && (
          <View className="flex-row items-center">
            <Text className="text-xs text-gray-400 mr-1">Enter</Text>
            <Ionicons name="return-down-back" size={14} color={colors.gray[400]} />
          </View>
        )}
      </TouchableOpacity>
    );
  }, [handleSelectItem]);

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
              className="bg-primary-500 mx-3 my-2 py-4 rounded-xl items-center flex-row justify-center"
              activeOpacity={0.8}
            >
              <Ionicons name="cart" size={22} color="white" />
              <Text className="text-white font-bold text-lg ml-2">
                Add to Cart ({locationLabel})
              </Text>
            </TouchableOpacity>
          )}

          {/* Cart indicator bar */}
          {totalCartCount > 0 && (
            <TouchableOpacity
              onPress={() => {
                Keyboard.dismiss();
                router.push('/cart' as any);
              }}
              className="flex-row items-center justify-between px-4 py-2 bg-gray-50"
            >
              <View className="flex-row items-center">
                <Ionicons name="cart" size={18} color={colors.gray[600]} />
                <Text className="text-sm font-medium text-gray-700 ml-2">
                  {totalCartCount} in cart
                </Text>
              </View>
              <View className="flex-row items-center">
                <Text className="text-sm font-medium text-primary-600 mr-1">View</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.primary[600]} />
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
        <View className="flex-row items-center px-3 py-2">
          {/* Back Button */}
          <TouchableOpacity
            onPress={() => router.back()}
            className="p-2"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={22} color={colors.gray[700]} />
          </TouchableOpacity>

          {/* Location Dropdown */}
          <TouchableOpacity
            onPress={toggleLocationDropdown}
            className="flex-1 flex-row items-center justify-center mx-2"
          >
            <View className="flex-row items-center bg-gray-100 px-3 py-2 rounded-lg">
              <Ionicons name="location" size={16} color={colors.primary[500]} />
              <Text className="text-base font-semibold text-gray-900 mx-2">
                {selectedLocation?.name || 'Select'}
              </Text>
              <Ionicons
                name={showLocationDropdown ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.gray[500]}
              />
            </View>
          </TouchableOpacity>

          {/* Cart Button */}
          <TouchableOpacity
            onPress={() => router.push('/cart' as any)}
            className="p-2 relative"
          >
            <Ionicons name="cart-outline" size={22} color={colors.gray[700]} />
            {totalCartCount > 0 && (
              <View className="absolute -top-1 -right-1 bg-primary-500 w-5 h-5 rounded-full items-center justify-center">
                <Text className="text-white text-xs font-bold">{totalCartCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Location Dropdown Menu */}
        {showLocationDropdown && (
          <View className="border-t border-gray-100">
            {locations.map((loc) => {
              const isSelected = selectedLocation?.id === loc.id;
              const cartCount = getLocationCartTotal(loc.id);

              return (
                <TouchableOpacity
                  key={loc.id}
                  onPress={() => handleSelectLocation(loc)}
                  className={`flex-row items-center justify-between px-4 py-3 ${
                    isSelected ? 'bg-primary-50' : ''
                  }`}
                >
                  <View className="flex-row items-center">
                    <View className={`w-8 h-8 rounded-full items-center justify-center mr-3 ${
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
                      <Ionicons name="checkmark" size={18} color={colors.primary[500]} />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      {/* Main Content */}
      <View className="flex-1 px-4 pt-3">
        {screenState === 'searching' ? (
          <>
            {/* Search Input with Ghost Text */}
            <View className="relative">
              <View className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <View className="flex-row items-center px-4" style={{ height: 52 }}>
                  <Ionicons name="search" size={20} color={colors.gray[400]} />
                  <View className="flex-1 ml-3 relative justify-center" style={{ height: 52 }}>
                    {ghostText && (
                      <View pointerEvents="none" className="absolute inset-0 flex-row items-center">
                        <Text className="text-lg text-transparent">{searchQuery}</Text>
                        <Text className="text-lg text-gray-300">{ghostText}</Text>
                      </View>
                    )}
                    <TextInput
                      ref={searchInputRef}
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                      onSubmitEditing={handleSearchSubmit}
                      placeholder="Type item name..."
                      placeholderTextColor={colors.gray[400]}
                      className="text-lg text-gray-900"
                      style={{ height: 52 }}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoFocus
                      returnKeyType="go"
                      inputAccessoryViewID={Platform.OS === 'ios' ? INPUT_ACCESSORY_ID : undefined}
                    />
                  </View>
                  {searchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => setSearchQuery('')} className="p-1">
                      <Ionicons name="close-circle" size={20} color={colors.gray[400]} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {/* Suggestions Dropdown */}
              {filteredItems.length > 0 && searchQuery.trim() && (
                <View className="absolute top-14 left-0 right-0 bg-white rounded-xl border border-gray-200 shadow-lg z-10 overflow-hidden">
                  <FlatList
                    data={filteredItems}
                    keyExtractor={(item) => item.id}
                    renderItem={renderSuggestionItem}
                    keyboardShouldPersistTaps="handled"
                    ItemSeparatorComponent={() => <View className="h-px bg-gray-100" />}
                  />
                </View>
              )}
            </View>

            {/* Empty State */}
            {!searchQuery.trim() && (
              <View className="flex-1 items-center justify-center -mt-16">
                <Ionicons name="search-outline" size={56} color={colors.gray[300]} />
                <Text className="text-base font-medium text-gray-500 mt-3">Start typing to search</Text>
                <Text className="text-sm text-gray-400 mt-1">salmon, avocado, nori...</Text>
              </View>
            )}

            {/* No results state */}
            {searchQuery.trim() && filteredItems.length === 0 && debouncedQuery === searchQuery && (
              <View className="flex-1 items-center justify-center -mt-16">
                <Ionicons name="alert-circle-outline" size={56} color={colors.gray[300]} />
                <Text className="text-base font-medium text-gray-500 mt-3">No items found</Text>
              </View>
            )}
          </>
        ) : (
          /* Quantity Entry State - Compact */
          <View className="flex-1">
            {/* Back button */}
            <TouchableOpacity onPress={handleBackToSearch} className="flex-row items-center mb-3">
              <Ionicons name="arrow-back" size={18} color={colors.gray[600]} />
              <Text className="text-gray-600 ml-1 text-sm">Back</Text>
            </TouchableOpacity>

            {/* Compact Item Card */}
            {selectedItem && (
              <View className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                {/* Item Info - Compact */}
                <View className="flex-row items-center mb-4">
                  <Text className="text-2xl mr-3">
                    {CATEGORY_EMOJI[selectedItem.category] || '📦'}
                  </Text>
                  <View className="flex-1">
                    <Text className="text-lg font-semibold text-gray-900">
                      {selectedItem.name}
                    </Text>
                    <Text className="text-xs text-gray-500">
                      {selectedItem.pack_size} {selectedItem.base_unit}/{selectedItem.pack_unit}
                    </Text>
                  </View>
                </View>

                {/* Quantity & Unit Row - Compact */}
                <View className="flex-row items-center">
                  {/* Quantity Controls */}
                  <View className="flex-row items-center flex-1">
                    <TouchableOpacity
                      onPress={() => {
                        const q = Math.max(1, (parseFloat(quantity) || 1) - 1);
                        setQuantity(q.toString());
                      }}
                      className="w-11 h-11 bg-gray-100 rounded-lg items-center justify-center"
                    >
                      <Ionicons name="remove" size={22} color={colors.gray[700]} />
                    </TouchableOpacity>

                    <TextInput
                      ref={quantityInputRef}
                      value={quantity}
                      onChangeText={setQuantity}
                      keyboardType="number-pad"
                      className="w-16 mx-2 text-center text-2xl font-bold text-gray-900"
                      style={{ height: 44 }}
                      selectTextOnFocus
                      inputAccessoryViewID={Platform.OS === 'ios' ? INPUT_ACCESSORY_ID : undefined}
                    />

                    <TouchableOpacity
                      onPress={() => {
                        const q = (parseFloat(quantity) || 0) + 1;
                        setQuantity(q.toString());
                      }}
                      className="w-11 h-11 bg-gray-100 rounded-lg items-center justify-center"
                    >
                      <Ionicons name="add" size={22} color={colors.gray[700]} />
                    </TouchableOpacity>
                  </View>

                  {/* Unit Toggle - Compact */}
                  <View className="flex-row ml-3">
                    <TouchableOpacity
                      onPress={() => setSelectedUnit('pack')}
                      className={`px-4 py-2 rounded-l-lg ${
                        selectedUnit === 'pack' ? 'bg-primary-500' : 'bg-gray-100'
                      }`}
                    >
                      <Text className={`font-medium text-sm ${
                        selectedUnit === 'pack' ? 'text-white' : 'text-gray-600'
                      }`}>
                        {selectedItem.pack_unit}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setSelectedUnit('base')}
                      className={`px-4 py-2 rounded-r-lg ${
                        selectedUnit === 'base' ? 'bg-primary-500' : 'bg-gray-100'
                      }`}
                    >
                      <Text className={`font-medium text-sm ${
                        selectedUnit === 'base' ? 'text-white' : 'text-gray-600'
                      }`}>
                        {selectedItem.base_unit}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
          </View>
        )}
      </View>

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
          <View className="bg-white border-t border-gray-200 px-3 py-2">
            <TouchableOpacity
              onPress={handleAddToCart}
              className="bg-primary-500 py-4 rounded-xl items-center flex-row justify-center"
              activeOpacity={0.8}
            >
              <Ionicons name="cart" size={22} color="white" />
              <Text className="text-white font-bold text-lg ml-2">
                Add to Cart ({locationLabel})
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* iOS Input Accessory View */}
      {renderInputAccessory()}

      {/* Success Toast */}
      {showToast && (
        <Animated.View
          style={{
            opacity: toastOpacity,
            position: 'absolute',
            top: 80,
            left: 20,
            right: 20,
          }}
        >
          <View className="bg-gray-900 rounded-xl px-4 py-3 shadow-lg">
            <Text className="text-white text-center font-medium">{toastMessage}</Text>
          </View>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}
