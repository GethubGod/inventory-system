import { useEffect, useState, useCallback, useMemo } from 'react';
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
import { useInventoryStore, useAuthStore, useStockStore } from '@/store';
import {
  InventoryItem,
  ItemCategory,
  SupplierCategory,
  Location,
  StorageAreaWithStatus,
  AreaItemWithDetails,
  CheckFrequency,
} from '@/types';
import { CATEGORY_LABELS, SUPPLIER_CATEGORY_LABELS, categoryColors, colors } from '@/constants';
import { SpinningFish } from '@/components';
import { supabase } from '@/lib/supabase';
import { getCheckStatus, getStockLevel } from '@/store/stock.store';
import { useStockNetworkStatus } from '@/hooks';

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

const supplierCategories: SupplierCategory[] = [
  'fish_supplier',
  'main_distributor',
  'asian_market',
];

const CATEGORY_EMOJI: Record<ItemCategory, string> = {
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

const CHECK_FREQUENCY_LABELS: Record<CheckFrequency, string> = {
  daily: 'Daily check required',
  every_2_days: 'Every 2 days',
  every_3_days: 'Every 3 days',
  weekly: 'Weekly check required',
};

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

// Bulk item format: "name, category, supplier, baseUnit, packUnit, packSize"
interface ParsedBulkItem {
  name: string;
  category: ItemCategory;
  supplier_category: SupplierCategory;
  base_unit: string;
  pack_unit: string;
  pack_size: number;
  isValid: boolean;
  error?: string;
}

interface StockAreaWithLocation extends StorageAreaWithStatus {
  location: Location;
}

interface StockItemWithArea extends AreaItemWithDetails {
  area: StockAreaWithLocation;
  location: Location;
}

const getRelativeTime = (timestamp: string | null) => {
  if (!timestamp) return 'Never checked';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Never checked';
  const diffMs = Date.now() - date.getTime();
  const hours = Math.round(diffMs / (1000 * 60 * 60));
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

export default function ManagerInventoryScreen() {
  const { user, locations } = useAuthStore();
  const isOnline = useStockStore((state) => state.isOnline);
  useStockNetworkStatus();
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
  const [showBulkAddModal, setShowBulkAddModal] = useState(false);
  const [form, setForm] = useState<NewItemForm>(initialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bulkInput, setBulkInput] = useState('');
  const [bulkCategory, setBulkCategory] = useState<ItemCategory>('produce');
  const [bulkSupplier, setBulkSupplier] = useState<SupplierCategory>('main_distributor');
  const [bulkBaseUnit, setBulkBaseUnit] = useState('lb');
  const [bulkPackUnit, setBulkPackUnit] = useState('case');
  const [bulkPackSize, setBulkPackSize] = useState('1');

  const [stockLocationFilter, setStockLocationFilter] = useState<string>('all');
  const [showStockLocationModal, setShowStockLocationModal] = useState(false);
  const [stockAreas, setStockAreas] = useState<StockAreaWithLocation[]>([]);
  const [stockItems, setStockItems] = useState<StockItemWithArea[]>([]);
  const [isStockLoading, setIsStockLoading] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  const [showLowSection, setShowLowSection] = useState(false);
  const [showOkSection, setShowOkSection] = useState(false);

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

  const fetchStockLevels = useCallback(async () => {
    setIsStockLoading(true);
    setStockError(null);
    try {
      let query = supabase
        .from('storage_areas')
        .select(
          `
            *,
            location:locations(*),
            area_items(
              *,
              inventory_item:inventory_items(*)
            )
          `
        )
        .eq('active', true)
        .order('sort_order', { ascending: true });

      if (stockLocationFilter !== 'all') {
        query = query.eq('location_id', stockLocationFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      const rawAreas = (data || []) as any[];
      const nextAreas: StockAreaWithLocation[] = [];
      const nextItems: StockItemWithArea[] = [];

      rawAreas.forEach((area) => {
        const location = area.location as Location;
        const areaItems = (area.area_items || []) as AreaItemWithDetails[];
        const withStatus: StockAreaWithLocation = {
          ...area,
          location,
          item_count: areaItems.length,
          check_status: getCheckStatus(area),
        };
        nextAreas.push(withStatus);

        areaItems.forEach((item: any) => {
          nextItems.push({
            ...item,
            inventory_item: item.inventory_item,
            stock_level: getStockLevel(item),
            area: withStatus,
            location,
          });
        });
      });

      setStockAreas(nextAreas);
      setStockItems(nextItems);
    } catch (err: any) {
      setStockError(err?.message ?? 'Failed to load stock levels.');
    } finally {
      setIsStockLoading(false);
    }
  }, [stockLocationFilter]);

  useEffect(() => {
    fetchStockLevels();
  }, [fetchStockLevels]);

  const filteredItems = getFilteredItems();

  const criticalItems = useMemo(
    () => stockItems.filter((item) => item.current_quantity < item.min_quantity),
    [stockItems]
  );

  const lowItems = useMemo(
    () =>
      stockItems.filter(
        (item) =>
          item.current_quantity >= item.min_quantity &&
          item.current_quantity < item.min_quantity * 1.5
      ),
    [stockItems]
  );

  const okItems = useMemo(
    () => stockItems.filter((item) => item.current_quantity >= item.min_quantity * 1.5),
    [stockItems]
  );

  const overdueStations = useMemo(
    () => stockAreas.filter((area) => area.check_status === 'overdue'),
    [stockAreas]
  );

  const sortedCritical = useMemo(() => {
    return [...criticalItems].sort((a, b) => {
      const urgencyA = a.current_quantity <= 0 ? 0 : 1;
      const urgencyB = b.current_quantity <= 0 ? 0 : 1;
      if (urgencyA !== urgencyB) return urgencyA - urgencyB;
      const belowA = a.min_quantity > 0 ? (a.min_quantity - a.current_quantity) / a.min_quantity : 0;
      const belowB = b.min_quantity > 0 ? (b.min_quantity - b.current_quantity) / b.min_quantity : 0;
      return belowB - belowA;
    });
  }, [criticalItems]);

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
        created_by: user?.id,
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
  }, [form, addItem, user]);

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

  // Parse bulk input into items (one item name per line)
  const parseBulkInput = useCallback((): string[] => {
    return bulkInput
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }, [bulkInput]);

  const handleBulkAdd = useCallback(async () => {
    const itemNames = parseBulkInput();

    if (itemNames.length === 0) {
      Alert.alert('Error', 'Please enter at least one item name');
      return;
    }

    if (!bulkBaseUnit.trim() || !bulkPackUnit.trim()) {
      Alert.alert('Error', 'Please enter base unit and pack unit');
      return;
    }

    const packSize = parseInt(bulkPackSize, 10);
    if (isNaN(packSize) || packSize < 1) {
      Alert.alert('Error', 'Please enter a valid pack size');
      return;
    }

    setIsSubmitting(true);
    let successCount = 0;
    const errors: string[] = [];

    try {
      for (const name of itemNames) {
        try {
          await addItem({
            name: name,
            category: bulkCategory,
            supplier_category: bulkSupplier,
            base_unit: bulkBaseUnit.trim(),
            pack_unit: bulkPackUnit.trim(),
            pack_size: packSize,
            created_by: user?.id,
          });
          successCount++;
        } catch (error: any) {
          errors.push(`${name}: ${error.message || 'Failed'}`);
        }
      }

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      setShowBulkAddModal(false);
      setBulkInput('');

      if (errors.length > 0) {
        Alert.alert(
          'Partial Success',
          `Added ${successCount} item${successCount !== 1 ? 's' : ''}.\n\nErrors:\n${errors.join('\n')}`
        );
      } else {
        Alert.alert('Success', `Added ${successCount} item${successCount !== 1 ? 's' : ''} successfully`);
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to add items');
    } finally {
      setIsSubmitting(false);
    }
  }, [parseBulkInput, bulkCategory, bulkSupplier, bulkBaseUnit, bulkPackUnit, bulkPackSize, addItem, user]);

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

  const stockLocationLabel = useMemo(() => {
    if (stockLocationFilter === 'all') return 'All Locations';
    const match = locations.find((loc) => loc.id === stockLocationFilter);
    return match?.name ?? 'Select Location';
  }, [stockLocationFilter, locations]);

  const renderStockItem = (item: StockItemWithArea, tone: 'critical' | 'low') => {
    const reorderQuantity = Math.max(item.max_quantity - item.current_quantity, 0);
    const showLocation = stockLocationFilter === 'all';
    return (
      <View key={item.id} className="rounded-2xl bg-white px-4 py-3 mb-3 border border-gray-100">
        <View className="flex-row justify-between items-start">
          <View className="flex-1 pr-3">
            <View className="flex-row items-center">
              <Text className="text-lg mr-2">
                {CATEGORY_EMOJI[item.inventory_item.category] ?? '📦'}
              </Text>
              <Text className="text-sm font-semibold text-gray-900">
                {item.inventory_item.name}
              </Text>
            </View>
            <Text className="text-xs text-gray-500 mt-1">
              Current: {item.current_quantity} {item.unit_type} • Min: {item.min_quantity} {item.unit_type}
            </Text>
            <Text className="text-xs text-gray-400 mt-1">
              {item.area.name} {showLocation ? `• ${item.location.name}` : ''}
            </Text>
          </View>
          <View className="items-end">
            <Text className={`text-xs font-semibold ${tone === 'critical' ? 'text-red-600' : 'text-amber-600'}`}>
              Reorder {reorderQuantity}
            </Text>
            <Text className="text-xs text-gray-400 mt-1">
              {getRelativeTime(item.last_updated_at)}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  const renderStockItemsList = (items: StockItemWithArea[], tone: 'critical' | 'low') => {
    if (stockLocationFilter !== 'all') {
      return items.map((item) => renderStockItem(item, tone));
    }

    const grouped = items.reduce<Record<string, StockItemWithArea[]>>((acc, item) => {
      const key = item.location.name;
      acc[key] = acc[key] || [];
      acc[key].push(item);
      return acc;
    }, {});

    return Object.entries(grouped).map(([locationName, groupedItems]) => (
      <View key={locationName} className="mb-3">
        <Text className="text-xs font-semibold text-gray-500 mb-2">{locationName}</Text>
        {groupedItems.map((item) => renderStockItem(item, tone))}
      </View>
    ));
  };

  const renderInventoryHeader = () => (
    <>
      <View className="px-4 pt-4">
        <View className="flex-row items-center justify-between">
          <Text className="text-lg font-bold text-gray-900">Stock Levels</Text>
          <View className="flex-row items-center">
            <TouchableOpacity
              className="flex-row items-center bg-gray-100 rounded-full px-3 py-1 mr-2"
              onPress={() => setShowStockLocationModal(true)}
            >
              <Ionicons name="location-outline" size={14} color={colors.gray[600]} />
              <Text className="ml-1 text-xs font-semibold text-gray-600">{stockLocationLabel}</Text>
              <Ionicons name="chevron-down" size={12} color={colors.gray[500]} />
            </TouchableOpacity>
            <TouchableOpacity
              className="h-8 w-8 rounded-full bg-gray-100 items-center justify-center"
              onPress={fetchStockLevels}
            >
              <Ionicons name="refresh" size={16} color={colors.gray[600]} />
            </TouchableOpacity>
          </View>
        </View>

        {!isOnline && (
          <View className="mt-3 rounded-2xl bg-amber-100 px-4 py-3">
            <Text className="text-xs font-semibold text-amber-800">
              Offline mode - showing last synced stock data.
            </Text>
          </View>
        )}

        {stockError && (
          <View className="mt-3 rounded-2xl bg-red-50 px-4 py-3">
            <Text className="text-xs text-red-700">{stockError}</Text>
          </View>
        )}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingVertical: 12 }}
        >
          <View className="rounded-2xl bg-red-50 px-4 py-3 mr-3 min-w-[140px]">
            <Text className="text-xs text-red-600">🔴 Need Reorder</Text>
            <Text className="text-lg font-bold text-red-700 mt-1">{criticalItems.length}</Text>
          </View>
          <View className="rounded-2xl bg-amber-50 px-4 py-3 mr-3 min-w-[140px]">
            <Text className="text-xs text-amber-600">🟡 Running Low</Text>
            <Text className="text-lg font-bold text-amber-700 mt-1">{lowItems.length}</Text>
          </View>
          <View className="rounded-2xl bg-green-50 px-4 py-3 mr-3 min-w-[140px]">
            <Text className="text-xs text-green-600">🟢 Well Stocked</Text>
            <Text className="text-lg font-bold text-green-700 mt-1">{okItems.length}</Text>
          </View>
          <View className="rounded-2xl bg-blue-50 px-4 py-3 min-w-[140px]">
            <Text className="text-xs text-blue-600">📍 Stations Overdue</Text>
            <Text className="text-lg font-bold text-blue-700 mt-1">{overdueStations.length}</Text>
          </View>
        </ScrollView>

        <View className="mt-2">
          <Text className="text-xs font-semibold text-gray-500 mb-2">
            NEEDS REORDER ({criticalItems.length})
          </Text>
          {isStockLoading ? (
            <Text className="text-xs text-gray-400">Loading stock levels...</Text>
          ) : criticalItems.length === 0 ? (
            <View className="rounded-2xl bg-white px-4 py-4 border border-gray-100">
              <Text className="text-xs text-gray-500">All items are above minimum levels.</Text>
            </View>
          ) : (
            <>
              {renderStockItemsList(sortedCritical, 'critical')}
              <TouchableOpacity
                className="rounded-full border border-gray-200 py-3 items-center"
                onPress={() => Alert.alert('Order Draft', 'Order draft creation is coming soon.')}
              >
                <Text className="text-sm font-semibold text-gray-600">
                  Create Order from Suggestions
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <View className="mt-5">
          <TouchableOpacity
            className="flex-row items-center justify-between"
            onPress={() => setShowLowSection((prev) => !prev)}
          >
            <Text className="text-xs font-semibold text-gray-500">
              RUNNING LOW ({lowItems.length})
            </Text>
            <Ionicons
              name={showLowSection ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.gray[500]}
            />
          </TouchableOpacity>
          {showLowSection && (
            <View className="mt-3">
              {lowItems.length === 0 ? (
                <Text className="text-xs text-gray-400">No low stock items.</Text>
              ) : (
                renderStockItemsList(lowItems, 'low')
              )}
            </View>
          )}
        </View>

        <View className="mt-5">
          <TouchableOpacity
            className="flex-row items-center justify-between"
            onPress={() => setShowOkSection((prev) => !prev)}
          >
            <Text className="text-xs font-semibold text-gray-500">
              WELL STOCKED ({okItems.length})
            </Text>
            <Ionicons
              name={showOkSection ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.gray[500]}
            />
          </TouchableOpacity>
          {showOkSection && (
            <View className="mt-3">
              {okItems.length === 0 ? (
                <Text className="text-xs text-gray-400">No items are currently well stocked.</Text>
              ) : (
                okItems.map((item) => (
                  <View key={item.id} className="rounded-2xl bg-white px-4 py-3 mb-3 border border-gray-100">
                    <Text className="text-sm font-semibold text-gray-900">
                      {item.inventory_item.name}
                    </Text>
                    <Text className="text-xs text-gray-500 mt-1">
                      {item.current_quantity} {item.unit_type} • {CATEGORY_LABELS[item.inventory_item.category]}
                    </Text>
                  </View>
                ))
              )}
            </View>
          )}
        </View>

        <View className="mt-6">
          <Text className="text-xs font-semibold text-gray-500 mb-2">STATION STATUS</Text>
          {stockAreas.length === 0 ? (
            <View className="rounded-2xl bg-white px-4 py-4 border border-gray-100">
              <Text className="text-xs text-gray-500">No stations configured.</Text>
            </View>
          ) : (
            stockAreas.map((area) => (
              <View
                key={area.id}
                className={`rounded-2xl px-4 py-3 mb-3 border ${
                  area.check_status === 'overdue' ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-white'
                }`}
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center">
                    <Text className="mr-2 text-sm">
                      {area.check_status === 'overdue'
                        ? '🔴'
                        : area.check_status === 'due_soon'
                        ? '🟡'
                        : '🟢'}
                    </Text>
                    <Text className="text-lg mr-2">{area.icon || '📦'}</Text>
                    <View>
                      <Text className="text-sm font-semibold text-gray-900">{area.name}</Text>
                      <Text className="text-xs text-gray-500">
                        Last checked: {getRelativeTime(area.last_checked_at)}
                      </Text>
                      <Text className="text-xs text-gray-400">
                        {CHECK_FREQUENCY_LABELS[area.check_frequency]}
                      </Text>
                    </View>
                  </View>
                  <View className="items-end">
                    <Text className="text-xs text-gray-500">{area.location.name}</Text>
                    {area.check_status === 'overdue' && (
                      <Text className="text-xs font-semibold text-red-600">OVERDUE</Text>
                    )}
                  </View>
                </View>
              </View>
            ))
          )}
        </View>
      </View>

      {/* Search Bar */}
      <View className="px-4 py-3 bg-white border-b border-gray-200 mt-6">
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
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 12 }}
        >
          {[null, ...categories].map((category) => {
            const isSelected = selectedCategory === category;
            const color = category ? categoryColors[category] : '#F97316';
            return (
              <TouchableOpacity
                key={category || 'all'}
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
          })}
        </ScrollView>
      </View>

      {/* Item Count */}
      <View className="px-4 py-2 bg-gray-50">
        <Text className="text-gray-500 text-sm">
          {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}
        </Text>
      </View>
    </>
  );

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

  const bulkItemCount = parseBulkInput().length;

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      {/* Header */}
      <View className="bg-white px-4 py-3 border-b border-gray-100">
        <View className="flex-row items-center justify-between">
          <Text className="text-xl font-bold text-gray-900">Inventory</Text>
          <View className="flex-row items-center">
            <TouchableOpacity
              className="bg-gray-100 rounded-xl px-3 py-2 flex-row items-center mr-2"
              onPress={() => setShowBulkAddModal(true)}
            >
              <Ionicons name="layers-outline" size={18} color={colors.gray[700]} />
              <Text className="text-gray-700 font-medium ml-1">Bulk</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="bg-primary-500 rounded-xl px-4 py-2 flex-row items-center"
              onPress={() => setShowAddModal(true)}
            >
              <Ionicons name="add" size={20} color="white" />
              <Text className="text-white font-semibold ml-1">Add</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Inventory List */}
      <FlatList
        data={filteredItems}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingTop: 0 }}
        ListHeaderComponent={renderInventoryHeader}
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

      {/* Stock Location Modal */}
      <Modal
        visible={showStockLocationModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowStockLocationModal(false)}
      >
        <View className="flex-1 bg-black/40 justify-center px-6">
          <View className="bg-white rounded-2xl p-4">
            <Text className="text-base font-semibold text-gray-900 mb-3">Select Location</Text>
            <TouchableOpacity
              className="py-3"
              onPress={() => {
                setStockLocationFilter('all');
                setShowStockLocationModal(false);
              }}
            >
              <Text className="text-sm text-gray-700">All Locations</Text>
            </TouchableOpacity>
            {locations.map((loc) => (
              <TouchableOpacity
                key={loc.id}
                className="py-3"
                onPress={() => {
                  setStockLocationFilter(loc.id);
                  setShowStockLocationModal(false);
                }}
              >
                <Text className="text-sm text-gray-700">{loc.name}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              className="mt-2 py-3 items-center"
              onPress={() => setShowStockLocationModal(false)}
            >
              <Text className="text-sm font-semibold text-primary-500">Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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

      {/* Bulk Add Modal */}
      <Modal
        visible={showBulkAddModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowBulkAddModal(false)}
      >
        <SafeAreaView className="flex-1 bg-gray-50">
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            className="flex-1"
          >
            {/* Modal Header */}
            <View className="bg-white px-4 py-4 border-b border-gray-200 flex-row items-center justify-between">
              <TouchableOpacity onPress={() => setShowBulkAddModal(false)}>
                <Text className="text-primary-500 font-medium">Cancel</Text>
              </TouchableOpacity>
              <Text className="text-lg font-bold text-gray-900">Bulk Add Items</Text>
              <View style={{ width: 50 }} />
            </View>

            <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
              {/* Instructions */}
              <View className="bg-blue-50 rounded-xl p-4 mb-4 border border-blue-100">
                <View className="flex-row items-start">
                  <Ionicons name="information-circle" size={20} color="#3B82F6" />
                  <View className="flex-1 ml-2">
                    <Text className="text-blue-800 font-medium">How to use</Text>
                    <Text className="text-blue-700 text-sm mt-1">
                      Enter one item name per line. All items will share the same category, supplier, and units.
                    </Text>
                  </View>
                </View>
              </View>

              {/* Item Names Input */}
              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-2">
                  Item Names (one per line) *
                </Text>
                <TextInput
                  className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900"
                  placeholder={"Salmon\nTuna\nYellowtail\nMackerel"}
                  placeholderTextColor="#9CA3AF"
                  value={bulkInput}
                  onChangeText={setBulkInput}
                  multiline
                  numberOfLines={8}
                  style={{ height: 160, textAlignVertical: 'top' }}
                />
                {bulkItemCount > 0 && (
                  <Text className="text-sm text-primary-600 mt-2">
                    {bulkItemCount} item{bulkItemCount !== 1 ? 's' : ''} to add
                  </Text>
                )}
              </View>

              {/* Shared Settings */}
              <Text className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">
                Shared Settings
              </Text>

              {/* Category */}
              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-2">
                  Category
                </Text>
                <CategoryPicker
                  value={bulkCategory}
                  onChange={setBulkCategory}
                />
              </View>

              {/* Supplier Category */}
              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-2">
                  Supplier
                </Text>
                <SupplierPicker
                  value={bulkSupplier}
                  onChange={setBulkSupplier}
                />
              </View>

              {/* Units Row */}
              <View className="flex-row gap-3 mb-4">
                <View className="flex-1">
                  <Text className="text-sm font-medium text-gray-700 mb-2">
                    Base Unit
                  </Text>
                  <TextInput
                    className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900"
                    placeholder="e.g., lb"
                    placeholderTextColor="#9CA3AF"
                    value={bulkBaseUnit}
                    onChangeText={setBulkBaseUnit}
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-medium text-gray-700 mb-2">
                    Pack Unit
                  </Text>
                  <TextInput
                    className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900"
                    placeholder="e.g., case"
                    placeholderTextColor="#9CA3AF"
                    value={bulkPackUnit}
                    onChangeText={setBulkPackUnit}
                  />
                </View>
              </View>

              {/* Pack Size */}
              <View className="mb-6">
                <Text className="text-sm font-medium text-gray-700 mb-2">
                  Pack Size
                </Text>
                <View className="flex-row items-center">
                  <TextInput
                    className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900 w-24"
                    placeholder="1"
                    placeholderTextColor="#9CA3AF"
                    value={bulkPackSize}
                    onChangeText={setBulkPackSize}
                    keyboardType="number-pad"
                  />
                  <Text className="text-gray-500 ml-3">
                    {bulkBaseUnit || 'units'} per {bulkPackUnit || 'pack'}
                  </Text>
                </View>
              </View>

              {/* Preview */}
              {bulkItemCount > 0 && (
                <View className="bg-primary-50 rounded-xl p-4 mb-6">
                  <Text className="text-sm font-medium text-primary-700 mb-2">
                    Preview ({bulkItemCount} item{bulkItemCount !== 1 ? 's' : ''})
                  </Text>
                  {parseBulkInput().slice(0, 5).map((name, index) => (
                    <View key={index} className="flex-row items-center py-1">
                      <Text className="text-gray-400 w-6">{index + 1}.</Text>
                      <Text className="text-gray-900 font-medium">{name}</Text>
                    </View>
                  ))}
                  {bulkItemCount > 5 && (
                    <Text className="text-gray-500 text-sm mt-1 pl-6">
                      ...and {bulkItemCount - 5} more
                    </Text>
                  )}
                  <View className="border-t border-primary-100 mt-3 pt-3">
                    <Text className="text-gray-600 text-xs">
                      All items: {CATEGORY_LABELS[bulkCategory]} • {SUPPLIER_CATEGORY_LABELS[bulkSupplier]} • {bulkPackSize || '1'} {bulkBaseUnit || 'units'} per {bulkPackUnit || 'pack'}
                    </Text>
                  </View>
                </View>
              )}
            </ScrollView>

            {/* Submit Button */}
            <View className="bg-white border-t border-gray-200 px-4 py-4">
              <TouchableOpacity
                className={`rounded-xl py-4 items-center flex-row justify-center ${
                  isSubmitting || bulkItemCount === 0 ? 'bg-primary-300' : 'bg-primary-500'
                }`}
                onPress={handleBulkAdd}
                disabled={isSubmitting || bulkItemCount === 0}
              >
                {isSubmitting ? (
                  <SpinningFish size="small" />
                ) : (
                  <>
                    <Ionicons name="layers" size={20} color="white" />
                    <Text className="text-white font-bold text-lg ml-2">
                      Add {bulkItemCount} Item{bulkItemCount !== 1 ? 's' : ''}
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
