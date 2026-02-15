import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  ScrollView,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useShallow } from 'zustand/react/shallow';
import { useInventoryStore, useAuthStore, useOrderStore } from '@/store';
import { InventoryItem, ItemCategory, Location } from '@/types';
import { CATEGORY_LABELS, categoryColors, colors } from '@/constants';
import { BrandLogo } from '@/components';
import { InventoryItemCard } from '@/components/InventoryItemCard';
import { useScaledStyles } from '@/hooks/useScaledStyles';

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

const CATEGORY_ICON_THEMES: Record<ItemCategory, { background: string; icon: string }> = {
  fish: { background: '#DBEAFE', icon: '#2563EB' },
  protein: { background: '#FEE2E2', icon: '#DC2626' },
  produce: { background: '#DCFCE7', icon: '#16A34A' },
  dry: { background: '#FEF3C7', icon: '#D97706' },
  dairy_cold: { background: '#EDE9FE', icon: '#7C3AED' },
  frozen: { background: '#CFFAFE', icon: '#0891B2' },
  sauces: { background: '#FCE7F3', icon: '#DB2777' },
  alcohol: { background: '#E0E7FF', icon: '#4F46E5' },
  packaging: { background: '#E5E7EB', icon: '#4B5563' },
};

export default function ManagerBrowseScreen() {
  const ds = useScaledStyles();
  const { location, locations, setLocation, fetchLocations } = useAuthStore(useShallow((state) => ({
    location: state.location,
    locations: state.locations,
    setLocation: state.setLocation,
    fetchLocations: state.fetchLocations,
  })));
  const { items, fetchItems } = useInventoryStore(useShallow((state) => ({
    items: state.items,
    fetchItems: state.fetchItems,
  })));
  const totalCartCount = useOrderStore((state) => state.getTotalCartCount('manager'));
  const getLocationCartTotal = useOrderStore((state) => state.getLocationCartTotal);

  // Local state for category/search — independent from employee browse
  const [selectedCategory, setSelectedCategory] = useState<ItemCategory | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);

  const headerIconButtonSize = Math.max(44, ds.icon(40));
  const badgeSize = Math.max(18, ds.icon(20));

  useEffect(() => {
    fetchItems();
    fetchLocations();
  }, [fetchItems, fetchLocations]);

  useEffect(() => {
    if (locations.length > 0 && !location) {
      setLocation(locations[0]);
    }
  }, [locations, location, setLocation]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesCategory = !selectedCategory || item.category === selectedCategory;
      const matchesSearch =
        !searchQuery || item.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [items, selectedCategory, searchQuery]);

  const showCategoryGrid = !selectedCategory && !searchQuery.trim();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchItems({ force: true });
    setRefreshing(false);
  }, [fetchItems]);

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
  }, []);

  const handleBackToCategories = useCallback(() => {
    setSelectedCategory(null);
    setSearchQuery('');
  }, []);

  const renderItem = useCallback(({ item }: { item: InventoryItem }) => (
    <InventoryItemCard item={item} locationId={location?.id || ''} cartContext="manager" />
  ), [location?.id]);

  return (
    <SafeAreaView className="flex-1 bg-[#FAFAFA]" edges={['top', 'left', 'right']}>
      {/* Header — matches Manager Quick Order style */}
      <View className="bg-white border-b border-gray-200">
        <View
          className="flex-row items-center"
          style={{
            paddingHorizontal: ds.spacing(8),
            paddingVertical: ds.spacing(8),
          }}
        >
          {/* Back button → Dashboard */}
          <TouchableOpacity
            onPress={() => router.replace('/(manager)' as any)}
            style={{
              width: headerIconButtonSize,
              height: headerIconButtonSize,
              borderRadius: ds.radius(10),
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="arrow-back" size={ds.icon(22)} color={colors.gray[700]} />
          </TouchableOpacity>

          {/* Spacer */}
          <View className="flex-1" />

          {/* Location Pill */}
          <TouchableOpacity
            onPress={toggleLocationDropdown}
            className="flex-row items-center bg-gray-100 rounded-full"
            style={{
              paddingHorizontal: ds.spacing(12),
              minHeight: headerIconButtonSize,
              marginRight: ds.spacing(8),
              flexShrink: 1,
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="location" size={ds.icon(14)} color="#F97316" />
            <Text
              className="text-gray-800 font-bold"
              style={{
                fontSize: ds.fontSize(15),
                marginLeft: ds.spacing(8),
                marginRight: ds.spacing(6),
                maxWidth: ds.spacing(120),
              }}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {location?.name || 'Select'}
            </Text>
            <Ionicons
              name={showLocationDropdown ? 'chevron-up' : 'chevron-down'}
              size={ds.icon(14)}
              color={colors.gray[500]}
            />
          </TouchableOpacity>

          {/* Cart button */}
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
                <Text className="text-white font-bold" style={{ fontSize: ds.fontSize(11) }}>
                  {totalCartCount > 99 ? '99+' : totalCartCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Location Dropdown */}
        {showLocationDropdown && (
          <View className="border-t border-gray-100" style={{ paddingHorizontal: ds.spacing(12), paddingBottom: ds.spacing(8) }}>
            <View
              className="bg-white rounded-2xl border border-gray-100 overflow-hidden"
              style={{
                shadowColor: '#111827',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.06,
                shadowRadius: 10,
                elevation: 3,
              }}
            >
              {locations.map((loc, index) => {
                const isSelected = location?.id === loc.id;
                const cartCount = getLocationCartTotal(loc.id, 'manager');

                return (
                  <TouchableOpacity
                    key={loc.id}
                    onPress={() => handleSelectLocation(loc)}
                    activeOpacity={0.7}
                    className={`flex-row items-center justify-between ${index > 0 ? 'border-t border-gray-100' : ''}`}
                    style={{
                      minHeight: ds.rowH,
                      paddingHorizontal: ds.spacing(16),
                      paddingVertical: ds.spacing(12),
                    }}
                  >
                    <View className="flex-row items-center flex-1">
                      <View
                        className={`rounded-full items-center justify-center ${
                          isSelected ? 'bg-primary-500' : 'bg-gray-200'
                        }`}
                        style={{ width: ds.icon(32), height: ds.icon(32), marginRight: ds.spacing(12) }}
                      >
                        <BrandLogo variant="inline" size={16} colorMode={isSelected ? 'dark' : 'light'} />
                      </View>
                      <Text
                        className={isSelected ? 'font-semibold text-primary-700' : 'text-gray-900 font-medium'}
                        style={{ fontSize: ds.fontSize(15) }}
                      >
                        {loc.name}
                      </Text>
                    </View>
                    <View className="flex-row items-center">
                      {cartCount > 0 && (
                        <Text className="text-gray-500" style={{ fontSize: ds.fontSize(13), marginRight: ds.spacing(8) }}>
                          {cartCount} items
                        </Text>
                      )}
                      {isSelected && (
                        <Ionicons name="checkmark" size={ds.icon(18)} color={colors.primary[500]} />
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}
      </View>

      {/* Search Bar */}
      <View
        className="bg-[#FAFAFA]/90 border-b border-gray-100"
        style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12) }}
      >
        <View
          className="flex-row items-center bg-white border border-gray-100 rounded-2xl"
          style={{
            borderRadius: ds.radius(16),
            paddingHorizontal: ds.spacing(14),
            height: ds.buttonH,
            shadowColor: '#111827',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.06,
            shadowRadius: 10,
            elevation: 3,
          }}
        >
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
        </View>
      </View>

      {showCategoryGrid ? (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: ds.spacing(16), paddingBottom: 32 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F97316" />
          }
        >
          <Text className="text-gray-500 uppercase tracking-wide" style={{ fontSize: ds.fontSize(12), marginBottom: ds.spacing(12) }}>
            Browse by Category
          </Text>
          <View className="flex-row flex-wrap justify-between" style={{ gap: ds.spacing(12) }}>
            {categories.map((cat) => {
              const iconTheme = CATEGORY_ICON_THEMES[cat] || {
                background: '#E5E7EB',
                icon: '#4B5563',
              };
              return (
                <TouchableOpacity
                  key={cat}
                  onPress={() => handleSelectCategory(cat)}
                  className="bg-white border border-gray-100 rounded-3xl"
                  style={{
                    width: '48%',
                    paddingHorizontal: ds.spacing(14),
                    paddingVertical: ds.spacing(16),
                    borderRadius: Math.max(ds.radius(18), 24),
                    shadowColor: '#111827',
                    shadowOffset: { width: 0, height: 6 },
                    shadowOpacity: 0.06,
                    shadowRadius: 12,
                    elevation: 3,
                  }}
                  activeOpacity={0.85}
                >
                  <View
                    className="rounded-xl items-center justify-center"
                    style={{
                      width: ds.icon(42),
                      height: ds.icon(42),
                      backgroundColor: iconTheme.background,
                      marginBottom: ds.spacing(12),
                    }}
                  >
                    <Ionicons name={CATEGORY_ICONS[cat]} size={ds.icon(20)} color={iconTheme.icon} />
                  </View>
                  <Text className="font-bold text-gray-800" numberOfLines={1} style={{ fontSize: ds.fontSize(14) }}>
                    {CATEGORY_LABELS[cat]}
                  </Text>
                  <Text className="text-gray-500" style={{ fontSize: ds.fontSize(11), marginTop: ds.spacing(5) }}>
                    View Items
                  </Text>
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
              </View>
            )}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F97316" />
            }
            removeClippedSubviews={Platform.OS === 'android'}
            initialNumToRender={10}
            maxToRenderPerBatch={8}
            windowSize={8}
          />
        </>
      )}
    </SafeAreaView>
  );
}
