import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
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
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuthStore, useInventoryStore, useOrderStore, useSettingsStore } from '@/store';
import {
  ItemCategory,
  SupplierCategory,
} from '@/types';
import { CATEGORY_LABELS, SUPPLIER_CATEGORY_LABELS, categoryColors, colors } from '@/constants';
import { SpinningFish } from '@/components';
import { getInventoryWithStock, InventoryWithStock } from '@/lib/api/stock';
import { supabase } from '@/lib/supabase';
import { getCheckStatus } from '@/store/stock.store';
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

const COUNT_UNITS = ['portion', 'each', 'lb', 'case', 'bag', 'bottle', 'jar', 'pack'] as const;
const ORDER_UNITS = ['lb', 'case', 'each', 'bag', 'bottle', 'jar', 'pack'] as const;

const REORDER_BAR_HEIGHT = 72;

const STATUS_COLORS = {
  critical: '#EF4444',
  low: '#F59E0B',
  good: '#10B981',
} as const;

type InventoryStatus = 'critical' | 'low' | 'good';

type InventoryStockItem = InventoryWithStock & {
  status: InventoryStatus;
  overdue: boolean;
  fillPercent: number;
  areaLabel: string;
};

interface AreaItemEdit {
  id: string;
  area_id: string;
  unit_type: string;
  min_quantity: number;
  max_quantity: number;
  par_level: number | null;
  order_unit: string | null;
  conversion_factor: number | null;
  active: boolean;
  area: {
    id: string;
    name: string;
    location_id: string;
  };
}

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

const getRelativeTime = (timestamp: string | null) => {
  if (!timestamp) return 'Never updated';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Never updated';
  const diffMs = Date.now() - date.getTime();
  const hours = Math.round(diffMs / (1000 * 60 * 60));
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

const getStatus = (item: InventoryWithStock): InventoryStatus => {
  if (item.current_quantity <= 0) return 'critical';
  if (item.current_quantity < item.min_quantity) return 'critical';
  if (item.current_quantity < item.min_quantity * 1.5) return 'low';
  return 'good';
};

export default function ManagerInventoryScreen() {
  const { user, locations } = useAuthStore();
  const { addItem, fetchItems } = useInventoryStore();
  const { addToCart, getTotalCartCount } = useOrderStore();
  const { inventoryView, setInventoryView } = useSettingsStore();
  useStockNetworkStatus();
  const cartCount = getTotalCartCount();

  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBulkAddModal, setShowBulkAddModal] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [form, setForm] = useState<NewItemForm>(initialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bulkInput, setBulkInput] = useState('');
  const [bulkCategory, setBulkCategory] = useState<ItemCategory>('produce');
  const [bulkSupplier, setBulkSupplier] = useState<SupplierCategory>('main_distributor');
  const [bulkBaseUnit, setBulkBaseUnit] = useState('lb');
  const [bulkPackUnit, setBulkPackUnit] = useState('case');
  const [bulkPackSize, setBulkPackSize] = useState('1');

  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [selectedStat, setSelectedStat] = useState<'all' | 'reorder' | 'low' | 'good' | 'overdue'>('all');
  const [categoryFilter, setCategoryFilter] = useState<ItemCategory | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const [stockItems, setStockItems] = useState<InventoryWithStock[]>([]);
  const [isStockLoading, setIsStockLoading] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);

  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [addedKeys, setAddedKeys] = useState<Record<string, boolean>>({});
  const toastOpacity = useRef(new Animated.Value(0)).current;

  const [showEditModal, setShowEditModal] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryStockItem | null>(null);
  const [editAreas, setEditAreas] = useState<AreaItemEdit[]>([]);
  const [areaOptions, setAreaOptions] = useState<{ id: string; name: string }[]>([]);
  const [selectedAreaItemId, setSelectedAreaItemId] = useState<string | null>(null);
  const [showAreaPicker, setShowAreaPicker] = useState(false);
  const [showCountUnitPicker, setShowCountUnitPicker] = useState(false);
  const [showOrderUnitPicker, setShowOrderUnitPicker] = useState(false);
  const [editForm, setEditForm] = useState({
    unit_type: 'each',
    min: '',
    par: '',
    max: '',
    order_unit: 'case',
    conversion: '',
  });
  const [isEditSaving, setIsEditSaving] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 150);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchInventoryStock = useCallback(async () => {
    setIsStockLoading(true);
    setStockError(null);
    try {
      const data = await getInventoryWithStock(locationFilter === 'all' ? undefined : locationFilter);
      setStockItems(data);
    } catch (err: any) {
      setStockError(err?.message ?? 'Failed to load inventory stock.');
    } finally {
      setIsStockLoading(false);
    }
  }, [locationFilter]);

  useEffect(() => {
    fetchInventoryStock();
  }, [fetchInventoryStock]);

  useEffect(() => {
    fetchItems();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchInventoryStock();
    await fetchItems();
    setRefreshing(false);
  };

  const stockWithStatus: InventoryStockItem[] = useMemo(() => {
    return stockItems.map((item) => {
      const status = getStatus(item);
      const overdue = item.areas.some((area) => getCheckStatus(area) === 'overdue');
      const fillPercent = item.max_quantity > 0
        ? Math.min(item.current_quantity / item.max_quantity, 1) * 100
        : 0;
      const areaLabel = item.area_names.length > 1 ? 'Multiple stations' : (item.area_names[0] ?? 'Unassigned');
      return {
        ...item,
        status,
        overdue,
        fillPercent,
        areaLabel,
      };
    });
  }, [stockItems]);

  const stats = useMemo(() => {
    return {
      reorder: stockWithStatus.filter((item) => item.status === 'critical').length,
      low: stockWithStatus.filter((item) => item.status === 'low').length,
      good: stockWithStatus.filter((item) => item.status === 'good').length,
      overdue: stockWithStatus.filter((item) => item.overdue).length,
    };
  }, [stockWithStatus]);

  const filteredItems = useMemo(() => {
    let items = stockWithStatus;
    if (selectedStat === 'reorder') {
      items = items.filter((item) => item.status === 'critical');
    } else if (selectedStat === 'low') {
      items = items.filter((item) => item.status === 'low');
    } else if (selectedStat === 'good') {
      items = items.filter((item) => item.status === 'good');
    } else if (selectedStat === 'overdue') {
      items = items.filter((item) => item.overdue);
    }

    if (categoryFilter) {
      items = items.filter((item) => item.inventory_item.category === categoryFilter);
    }

    if (debouncedQuery.length > 0) {
      const query = debouncedQuery.toLowerCase();
      items = items.filter((item) => item.inventory_item.name.toLowerCase().includes(query));
    }

    return items;
  }, [stockWithStatus, selectedStat, categoryFilter, debouncedQuery]);

  const sortedItems = useMemo(() => {
    const order = { critical: 0, low: 1, good: 2 } as const;
    return [...filteredItems].sort((a, b) => {
      const statusDiff = order[a.status] - order[b.status];
      if (statusDiff !== 0) return statusDiff;
      return a.inventory_item.name.localeCompare(b.inventory_item.name);
    });
  }, [filteredItems]);

  const showToastMessage = useCallback((message: string) => {
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
  }, [toastOpacity]);

  const handleAddToReorder = useCallback((item: InventoryStockItem) => {
    const quantity = Math.max(item.max_quantity - item.current_quantity, 0);
    if (quantity <= 0) return;

    addToCart(item.location.id, item.inventory_item.id, quantity, 'base');

    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    const key = `${item.inventory_item.id}-${item.location.id}`;
    setAddedKeys((prev) => ({ ...prev, [key]: true }));
    setTimeout(() => {
      setAddedKeys((prev) => ({ ...prev, [key]: false }));
    }, 1500);

    showToastMessage(`✓ Added ${item.inventory_item.name} (${quantity} ${item.unit_type})`);
  }, [addToCart, showToastMessage]);

  const handleCreateOrderFromReorder = useCallback(() => {
    const reorderItems = stockWithStatus.filter((item) => item.status === 'critical');
    if (reorderItems.length === 0) return;

    reorderItems.forEach((item) => {
      const quantity = Math.max(item.max_quantity - item.current_quantity, 0);
      if (quantity > 0) {
        addToCart(item.location.id, item.inventory_item.id, quantity, 'base');
      }
    });

    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    showToastMessage(`✓ Added ${reorderItems.length} items to cart`);
    router.push('/(manager)/cart');
  }, [addToCart, showToastMessage, stockWithStatus]);

  const applyAreaItemToForm = useCallback((areaItem: AreaItemEdit) => {
    setSelectedAreaItemId(areaItem.id);
    setEditForm({
      unit_type: areaItem.unit_type || 'each',
      min: String(areaItem.min_quantity ?? ''),
      par: areaItem.par_level != null ? String(areaItem.par_level) : '',
      max: String(areaItem.max_quantity ?? ''),
      order_unit: areaItem.order_unit || areaItem.unit_type || 'case',
      conversion: areaItem.conversion_factor != null ? String(areaItem.conversion_factor) : '',
    });
  }, []);

  const openEditModal = useCallback(async (item: InventoryStockItem) => {
    setEditingItem(item);
    setShowEditModal(true);
    try {
      const { data, error } = await supabase
        .from('area_items')
        .select(
          `
          id,
          area_id,
          unit_type,
          min_quantity,
          max_quantity,
          par_level,
          order_unit,
          conversion_factor,
          active,
          area:storage_areas(
            id,
            name,
            location_id
          )
        `
        )
        .eq('inventory_item_id', item.inventory_item.id)
        .eq('active', true);

      if (error) throw error;

      const areaItems = (data || [])
        .map((row: any) => ({
          ...row,
          area: row.area,
        }))
        .filter((row: any) => row.area?.location_id === item.location.id) as AreaItemEdit[];

      setEditAreas(areaItems);

      const { data: areas } = await supabase
        .from('storage_areas')
        .select('id,name')
        .eq('location_id', item.location.id)
        .eq('active', true)
        .order('sort_order', { ascending: true });

      setAreaOptions((areas || []) as { id: string; name: string }[]);

      if (areaItems.length > 0) {
        applyAreaItemToForm(areaItems[0]);
      } else {
        setSelectedAreaItemId(null);
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to load item settings.');
    }
  }, [applyAreaItemToForm]);

  const selectedAreaItem = useMemo(() => {
    return editAreas.find((area) => area.id === selectedAreaItemId) ?? null;
  }, [editAreas, selectedAreaItemId]);

  const handleChangeUnitType = useCallback(
    (nextUnit: string) => {
      if (nextUnit === editForm.unit_type) {
        setShowCountUnitPicker(false);
        return;
      }

      const hasValues = Number(editForm.min) > 0 || Number(editForm.par) > 0 || Number(editForm.max) > 0;
      if (!hasValues) {
        setEditForm((prev) => ({ ...prev, unit_type: nextUnit }));
        setShowCountUnitPicker(false);
        return;
      }

      Alert.alert(
        'Update Stock Levels?',
        'Changing the counting unit may require updating min/max values. Update now?',
        [
          {
            text: 'Keep Values',
            style: 'cancel',
            onPress: () => {
              setEditForm((prev) => ({ ...prev, unit_type: nextUnit }));
              setShowCountUnitPicker(false);
            },
          },
          {
            text: 'Reset Values',
            onPress: () => {
              setEditForm((prev) => ({
                ...prev,
                unit_type: nextUnit,
                min: '',
                par: '',
                max: '',
              }));
              setShowCountUnitPicker(false);
            },
          },
        ]
      );
    },
    [editForm]
  );

  const handleSaveEdit = useCallback(async () => {
    if (!selectedAreaItem || !editingItem) return;

    const min = Number(editForm.min);
    const max = Number(editForm.max);
    const par = editForm.par ? Number(editForm.par) : null;

    if (Number.isNaN(min) || Number.isNaN(max) || min < 0 || max < 0) {
      Alert.alert('Invalid Values', 'Please enter valid minimum and maximum values.');
      return;
    }

    if (min >= max) {
      Alert.alert('Invalid Range', 'Minimum must be less than maximum.');
      return;
    }

    if (par !== null && (par <= min || par >= max)) {
      Alert.alert('Invalid Par Level', 'Par level must be between min and max.');
      return;
    }

    const conversion = editForm.conversion ? Number(editForm.conversion) : null;
    if (editForm.conversion && (Number.isNaN(conversion) || conversion <= 0)) {
      Alert.alert('Invalid Conversion', 'Conversion factor must be a positive number.');
      return;
    }

    setIsEditSaving(true);
    try {
      const { error } = await supabase
        .from('area_items')
        .update({
          unit_type: editForm.unit_type,
          min_quantity: min,
          max_quantity: max,
          par_level: par,
          order_unit: editForm.order_unit,
          conversion_factor: conversion,
        })
        .eq('id', selectedAreaItem.id);

      if (error) throw error;

      showToastMessage('✓ Stock settings updated');
      setShowEditModal(false);
      fetchInventoryStock();
    } catch (err: any) {
      Alert.alert('Save Failed', err?.message ?? 'Unable to save changes.');
    } finally {
      setIsEditSaving(false);
    }
  }, [selectedAreaItem, editingItem, editForm, fetchInventoryStock, showToastMessage]);

  const handleMoveArea = useCallback(async (areaId: string) => {
    if (!selectedAreaItem) return;
    setShowAreaPicker(false);
    try {
      const { error } = await supabase
        .from('area_items')
        .update({ area_id: areaId })
        .eq('id', selectedAreaItem.id);

      if (error) throw error;

      showToastMessage('✓ Item moved to new area');
      setShowEditModal(false);
      fetchInventoryStock();
    } catch (err: any) {
      Alert.alert('Move Failed', err?.message ?? 'Unable to move item.');
    }
  }, [selectedAreaItem, fetchInventoryStock, showToastMessage]);

  const handleDeactivateAreaItem = useCallback(() => {
    if (!selectedAreaItem || !editingItem) return;

    Alert.alert(
      'Deactivate Item',
      `Remove ${editingItem.inventory_item.name} from ${selectedAreaItem.area.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deactivate',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('area_items')
                .update({ active: false })
                .eq('id', selectedAreaItem.id);

              if (error) throw error;

              showToastMessage('✓ Item deactivated');
              setShowEditModal(false);
              fetchInventoryStock();
            } catch (err: any) {
              Alert.alert('Deactivate Failed', err?.message ?? 'Unable to deactivate item.');
            }
          },
        },
      ]
    );
  }, [selectedAreaItem, editingItem, fetchInventoryStock, showToastMessage]);

  const handleAddItem = useCallback(async () => {
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
      fetchInventoryStock();
      Alert.alert('Success', 'Item added successfully');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to add item');
    } finally {
      setIsSubmitting(false);
    }
  }, [form, addItem, user, fetchInventoryStock]);

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
      fetchInventoryStock();

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
  }, [parseBulkInput, bulkCategory, bulkSupplier, bulkBaseUnit, bulkPackUnit, bulkPackSize, addItem, user, fetchInventoryStock]);

  const locationLabel = useMemo(() => {
    if (locationFilter === 'all') return 'All Locations';
    const match = locations.find((loc) => loc.id === locationFilter);
    return match?.name ?? 'Select Location';
  }, [locationFilter, locations]);

  const renderListItem = ({ item }: { item: InventoryStockItem }) => {
    const statusColor = STATUS_COLORS[item.status];
    const reorderQty = Math.max(item.max_quantity - item.current_quantity, 0);
    const key = `${item.inventory_item.id}-${item.location.id}`;
    const added = addedKeys[key];

    return (
      <TouchableOpacity activeOpacity={0.9} className="mb-4" onPress={() => openEditModal(item)}>
        <View className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <View className="flex-row items-start justify-between">
            <View className="flex-row items-center flex-1 pr-2">
              <Text className="text-lg mr-2">{CATEGORY_EMOJI[item.inventory_item.category] ?? '📦'}</Text>
              <Text className="text-base font-semibold text-gray-900">{item.inventory_item.name}</Text>
            </View>
            <View className="h-3 w-3 rounded-full" style={{ backgroundColor: statusColor }} />
          </View>

          <Text className="text-xs text-gray-500 mt-1">
            {item.areaLabel} • {item.location.name}
          </Text>

          <View className="mt-3">
            <View className="h-2 rounded-full bg-gray-200 overflow-hidden">
              <View
                className="h-full rounded-full"
                style={{ width: `${Math.round(item.fillPercent)}%`, backgroundColor: statusColor }}
              />
            </View>
            <View className="flex-row justify-between mt-2">
              <Text className="text-xs text-gray-600">
                {item.current_quantity} {item.unit_type}
              </Text>
              <Text className="text-xs text-gray-500">
                Min {item.min_quantity} • Max {item.max_quantity}
              </Text>
            </View>
          </View>

          <View className="mt-3 flex-row items-center justify-between">
            <Text className="text-xs text-gray-400">Updated {getRelativeTime(item.last_updated_at)}</Text>
            {item.status === 'critical' && reorderQty > 0 ? (
              <TouchableOpacity
                className={`px-3 py-1.5 rounded-full border ${added ? 'border-green-500' : 'border-orange-500'}`}
                onPress={(event) => {
                  event.stopPropagation?.();
                  handleAddToReorder(item);
                }}
              >
                <Text className={`text-xs font-semibold ${added ? 'text-green-600' : 'text-orange-600'}`}>
                  {added ? '✓ Added' : `Reorder ${reorderQty}`}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderCompactItem = ({ item }: { item: InventoryStockItem }) => {
    const statusColor = STATUS_COLORS[item.status];
    const reorderQty = Math.max(item.max_quantity - item.current_quantity, 0);
    const key = `${item.inventory_item.id}-${item.location.id}`;
    const added = addedKeys[key];

    return (
      <TouchableOpacity
        activeOpacity={0.9}
        className="bg-white border border-gray-100 rounded-2xl mb-2 overflow-hidden"
        onPress={() => openEditModal(item)}
      >
        <View className="flex-row items-center px-4 py-3">
          <Text className="text-lg mr-2">{CATEGORY_EMOJI[item.inventory_item.category] ?? '📦'}</Text>
          <View className="flex-1">
            <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>
              {item.inventory_item.name}
            </Text>
            <Text className="text-xs text-gray-500">{item.current_quantity} / {item.max_quantity} {item.unit_type}</Text>
          </View>
          <View className="flex-row items-center">
            <View className="h-3 w-3 rounded-full mr-2" style={{ backgroundColor: statusColor }} />
            {item.status === 'critical' && reorderQty > 0 ? (
              <TouchableOpacity
                className={`h-8 w-8 rounded-full items-center justify-center border ${added ? 'border-green-500' : 'border-orange-500'}`}
                onPress={(event) => {
                  event.stopPropagation?.();
                  handleAddToReorder(item);
                }}
              >
                <Ionicons name={added ? 'checkmark' : 'add'} size={16} color={added ? '#16A34A' : '#F97316'} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmptyState = () => {
    let icon = '🎉';
    let title = 'All items are well stocked!';
    let subtitle = 'No items need reordering at this time.';

    if (debouncedQuery.length > 0) {
      icon = '🔍';
      title = `No items match "${debouncedQuery}"`;
      subtitle = 'Try a different search.';
    } else if (categoryFilter) {
      icon = '📦';
      title = 'No items in this category';
      subtitle = 'Try a different category.';
    } else if (selectedStat !== 'all') {
      icon = '🎉';
      title = 'No items match this filter';
      subtitle = 'Try a different filter.';
    }

    return (
      <View className="items-center justify-center py-16">
        <Text className="text-4xl">{icon}</Text>
        <Text className="text-gray-700 mt-4 text-center font-semibold">{title}</Text>
        <Text className="text-gray-400 mt-2 text-center">{subtitle}</Text>
      </View>
    );
  };

  const bulkItemCount = parseBulkInput().length;

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'bottom', 'left', 'right']}>
      <View className="flex-1">
        <View className="px-4 pt-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-2xl font-bold text-gray-900">Inventory</Text>
            <View className="flex-row items-center">
              <TouchableOpacity
                className="h-9 w-9 rounded-full bg-gray-100 items-center justify-center mr-2"
                onPress={() => router.push('/(manager)/cart')}
              >
                <Ionicons name="cart-outline" size={18} color={colors.gray[700]} />
                {cartCount > 0 && (
                  <View className="absolute -top-1 -right-1 bg-orange-500 rounded-full min-w-[18px] h-[18px] px-1 items-center justify-center">
                    <Text className="text-white text-[10px] font-bold">{cartCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-row items-center bg-gray-100 rounded-full px-3 py-2"
                onPress={() => setShowLocationModal(true)}
              >
                <Ionicons name="location-outline" size={14} color={colors.gray[600]} />
                <Text className="ml-1 text-xs font-semibold text-gray-700">{locationLabel}</Text>
                <Ionicons name="chevron-down" size={12} color={colors.gray[500]} />
              </TouchableOpacity>
              <TouchableOpacity
                className="ml-2 h-9 w-9 rounded-full bg-gray-100 items-center justify-center"
                onPress={() => setShowActionMenu(true)}
              >
                <Ionicons name="ellipsis-horizontal" size={18} color={colors.gray[600]} />
              </TouchableOpacity>
            </View>
          </View>

          {stockError && (
            <View className="mt-3 rounded-2xl bg-red-50 px-4 py-3">
              <Text className="text-xs text-red-700">{stockError}</Text>
            </View>
          )}

          <View className="mt-4 bg-white border border-gray-200 rounded-xl px-4 py-2 flex-row items-center">
            <Ionicons name="search-outline" size={18} color={colors.gray[400]} />
            <TextInput
              className="flex-1 ml-2 text-gray-900"
              placeholder="Search items..."
              placeholderTextColor={colors.gray[400]}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={18} color={colors.gray[400]} />
              </TouchableOpacity>
            )}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingVertical: 12 }}
          >
            {([
              { key: 'reorder', label: 'Reorder', count: stats.reorder, color: '#EF4444', emoji: '🔴' },
              { key: 'low', label: 'Low', count: stats.low, color: '#F59E0B', emoji: '🟡' },
              { key: 'good', label: 'Good', count: stats.good, color: '#10B981', emoji: '🟢' },
              { key: 'overdue', label: 'Overdue', count: stats.overdue, color: '#F97316', emoji: '📍' },
            ] as const).map((pill) => {
              const isSelected = selectedStat === pill.key;
              const isDimmed = selectedStat !== 'all' && !isSelected;
              return (
                <TouchableOpacity
                  key={pill.key}
                  className="rounded-2xl border px-4 py-3 mr-3 min-w-[96px]"
                  style={{
                    borderColor: isSelected ? colors.primary[500] : '#E5E7EB',
                    backgroundColor: isSelected ? '#FFF7ED' : '#FFFFFF',
                    opacity: isDimmed ? 0.5 : 1,
                  }}
                  onPress={() =>
                    setSelectedStat((prev) => (prev === pill.key ? 'all' : pill.key))
                  }
                >
                  <Text className="text-xs text-gray-500">
                    {pill.emoji} {pill.label}
                  </Text>
                  <Text className="text-lg font-bold" style={{ color: pill.color }}>
                    {pill.count}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 8 }}
          >
            {[null, ...categories].map((category) => {
              const isSelected = categoryFilter === category;
              const color = category ? categoryColors[category] : colors.primary[500];
              return (
                <TouchableOpacity
                  key={category || 'all'}
                  className="px-4 py-2 rounded-full mr-2"
                  style={{
                    backgroundColor: isSelected ? colors.primary[500] : '#F3F4F6',
                  }}
                  onPress={() => setCategoryFilter(category)}
                >
                  <Text className={`text-sm font-semibold ${isSelected ? 'text-white' : 'text-gray-700'}`}>
                    {category ? CATEGORY_LABELS[category] : 'All'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View className="flex-row items-center justify-between py-3">
            <Text className="text-sm text-gray-500">
              {sortedItems.length} item{sortedItems.length !== 1 ? 's' : ''}
            </Text>
            <View className="flex-row items-center">
              <TouchableOpacity
                className={`h-8 w-8 rounded-full items-center justify-center mr-2 ${inventoryView === 'list' ? 'bg-orange-100' : 'bg-gray-100'}`}
                onPress={() => setInventoryView('list')}
              >
                <Ionicons name="list" size={16} color={inventoryView === 'list' ? colors.primary[600] : colors.gray[500]} />
              </TouchableOpacity>
              <TouchableOpacity
                className={`h-8 w-8 rounded-full items-center justify-center ${inventoryView === 'compact' ? 'bg-orange-100' : 'bg-gray-100'}`}
                onPress={() => setInventoryView('compact')}
              >
                <Ionicons name="grid-outline" size={16} color={inventoryView === 'compact' ? colors.primary[600] : colors.gray[500]} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <FlatList
          data={sortedItems}
          renderItem={inventoryView === 'list' ? renderListItem : renderCompactItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: stats.reorder > 0 ? REORDER_BAR_HEIGHT + 16 : 24,
          }}
          ListEmptyComponent={() => (isStockLoading ? (
            <View className="items-center justify-center py-16">
              <Text className="text-gray-400">Loading inventory...</Text>
            </View>
          ) : renderEmptyState())}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary[500]}
            />
          }
        />

        {stats.reorder > 0 && (
          <View
            className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4"
            style={{ paddingTop: 12, paddingBottom: 12, bottom: 0 }}
          >
            <TouchableOpacity
              className="rounded-2xl bg-orange-500 py-4 items-center"
              onPress={handleCreateOrderFromReorder}
            >
              <Text className="text-base font-semibold text-white">
                Create Order from {stats.reorder} Items Needing Reorder
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {showToast && (
        <Animated.View
          style={{
            opacity: toastOpacity,
            position: 'absolute',
            top: 90,
            left: 20,
            right: 20,
          }}
        >
          <View className="bg-gray-900 rounded-xl px-4 py-3 shadow-lg">
            <Text className="text-white text-center font-medium">{toastMessage}</Text>
          </View>
        </Animated.View>
      )}

      {/* Edit Item Modal */}
      <Modal
        visible={showEditModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowEditModal(false)}
      >
        <SafeAreaView className="flex-1 bg-gray-50">
          <View className="bg-white px-4 py-4 border-b border-gray-200 flex-row items-center justify-between">
            <Text className="text-lg font-bold text-gray-900">Edit Stock Settings</Text>
            <TouchableOpacity onPress={() => setShowEditModal(false)}>
              <Ionicons name="close" size={20} color={colors.gray[500]} />
            </TouchableOpacity>
          </View>

          <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
            {editingItem && selectedAreaItem ? (
              <>
                <View className="bg-white rounded-2xl p-4 border border-gray-100">
                  <View className="flex-row items-center">
                    <Text className="text-2xl mr-3">
                      {CATEGORY_EMOJI[editingItem.inventory_item.category] ?? '📦'}
                    </Text>
                    <View className="flex-1">
                      <Text className="text-base font-semibold text-gray-900">
                        {editingItem.inventory_item.name}
                      </Text>
                      <Text className="text-xs text-gray-500 mt-1">
                        {selectedAreaItem.area.name} • {editingItem.location.name}
                      </Text>
                    </View>
                  </View>
                </View>

                <View className="mt-5 bg-white rounded-2xl p-4 border border-gray-100">
                  <Text className="text-xs font-semibold text-gray-500 mb-3">COUNTING UNIT</Text>
                  <TouchableOpacity
                    className="border border-gray-200 rounded-xl px-4 py-3 flex-row items-center justify-between"
                    onPress={() => setShowCountUnitPicker(true)}
                  >
                    <Text className="text-sm font-medium text-gray-900">
                      {editForm.unit_type}
                    </Text>
                    <Ionicons name="chevron-down" size={16} color={colors.gray[400]} />
                  </TouchableOpacity>

                  <Text className="text-xs font-semibold text-gray-500 mt-5 mb-3">
                    STOCK LEVELS (in {editForm.unit_type})
                  </Text>
                  <View>
                    <View className="mb-4">
                      <Text className="text-xs text-gray-500 mb-2">Minimum • Reorder when below</Text>
                      <TextInput
                        className="border border-gray-200 rounded-xl px-4 py-3 text-gray-900"
                        keyboardType="number-pad"
                        value={editForm.min}
                        onChangeText={(value) => setEditForm((prev) => ({ ...prev, min: value }))}
                      />
                    </View>
                    <View className="mb-4">
                      <Text className="text-xs text-gray-500 mb-2">Par Level • Ideal amount</Text>
                      <TextInput
                        className="border border-gray-200 rounded-xl px-4 py-3 text-gray-900"
                        keyboardType="number-pad"
                        value={editForm.par}
                        onChangeText={(value) => setEditForm((prev) => ({ ...prev, par: value }))}
                      />
                    </View>
                    <View>
                      <Text className="text-xs text-gray-500 mb-2">Maximum • Order up to</Text>
                      <TextInput
                        className="border border-gray-200 rounded-xl px-4 py-3 text-gray-900"
                        keyboardType="number-pad"
                        value={editForm.max}
                        onChangeText={(value) => setEditForm((prev) => ({ ...prev, max: value }))}
                      />
                    </View>
                  </View>
                </View>

                <View className="mt-5 bg-white rounded-2xl p-4 border border-gray-100">
                  <Text className="text-xs font-semibold text-gray-500 mb-3">REORDER SETTINGS</Text>
                  <Text className="text-xs text-gray-500 mb-2">Order in</Text>
                  <TouchableOpacity
                    className="border border-gray-200 rounded-xl px-4 py-3 flex-row items-center justify-between"
                    onPress={() => setShowOrderUnitPicker(true)}
                  >
                    <Text className="text-sm font-medium text-gray-900">
                      {editForm.order_unit}
                    </Text>
                    <Ionicons name="chevron-down" size={16} color={colors.gray[400]} />
                  </TouchableOpacity>

                  <Text className="text-xs text-gray-500 mt-4 mb-2">Conversion • {editForm.unit_type} per {editForm.order_unit}</Text>
                  <TextInput
                    className="border border-gray-200 rounded-xl px-4 py-3 text-gray-900"
                    keyboardType="number-pad"
                    value={editForm.conversion}
                    onChangeText={(value) => setEditForm((prev) => ({ ...prev, conversion: value }))}
                  />
                  {editForm.conversion ? (
                    <Text className="text-xs text-gray-400 mt-2">
                      {editForm.conversion} {editForm.unit_type} = 1 {editForm.order_unit}
                    </Text>
                  ) : null}
                </View>

                <View className="mt-5 bg-white rounded-2xl p-4 border border-gray-100">
                  <TouchableOpacity
                    className="py-3"
                    onPress={() => setShowAreaPicker(true)}
                  >
                    <Text className="text-sm font-semibold text-gray-900">Move to Different Area</Text>
                  </TouchableOpacity>
                  <TouchableOpacity className="py-3" onPress={handleDeactivateAreaItem}>
                    <Text className="text-sm font-semibold text-red-600">Deactivate Item</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <View className="items-center justify-center py-20">
                <Text className="text-gray-500">No editable settings found.</Text>
              </View>
            )}
          </ScrollView>

          <View className="bg-white border-t border-gray-200 px-4 py-4">
            <TouchableOpacity
              className={`rounded-xl py-4 items-center ${isEditSaving ? 'bg-primary-300' : 'bg-primary-500'}`}
              onPress={handleSaveEdit}
              disabled={isEditSaving || !selectedAreaItem}
            >
              <Text className="text-white font-semibold">
                {isEditSaving ? 'Saving...' : 'Save Changes'}
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Count Unit Picker */}
      <Modal
        visible={showCountUnitPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCountUnitPicker(false)}
      >
        <View className="flex-1 bg-black/40 justify-end">
          <View className="bg-white rounded-t-2xl p-4">
            <Text className="text-base font-semibold text-gray-900 mb-2">Select Counting Unit</Text>
            {COUNT_UNITS.map((unit) => (
              <TouchableOpacity
                key={unit}
                className="py-3"
                onPress={() => handleChangeUnitType(unit)}
              >
                <Text className="text-sm text-gray-700">{unit}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity className="py-3 items-center" onPress={() => setShowCountUnitPicker(false)}>
              <Text className="text-sm font-semibold text-primary-500">Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Order Unit Picker */}
      <Modal
        visible={showOrderUnitPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowOrderUnitPicker(false)}
      >
        <View className="flex-1 bg-black/40 justify-end">
          <View className="bg-white rounded-t-2xl p-4">
            <Text className="text-base font-semibold text-gray-900 mb-2">Select Order Unit</Text>
            {ORDER_UNITS.map((unit) => (
              <TouchableOpacity
                key={unit}
                className="py-3"
                onPress={() => {
                  setEditForm((prev) => ({ ...prev, order_unit: unit }));
                  setShowOrderUnitPicker(false);
                }}
              >
                <Text className="text-sm text-gray-700">{unit}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity className="py-3 items-center" onPress={() => setShowOrderUnitPicker(false)}>
              <Text className="text-sm font-semibold text-primary-500">Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Move Area Modal */}
      <Modal
        visible={showAreaPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAreaPicker(false)}
      >
        <View className="flex-1 bg-black/40 justify-end">
          <View className="bg-white rounded-t-2xl p-4">
            <Text className="text-base font-semibold text-gray-900 mb-2">Move to Area</Text>
            {areaOptions.map((area) => (
              <TouchableOpacity
                key={area.id}
                className="py-3"
                onPress={() => handleMoveArea(area.id)}
              >
                <Text className="text-sm text-gray-700">{area.name}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity className="py-3 items-center" onPress={() => setShowAreaPicker(false)}>
              <Text className="text-sm font-semibold text-primary-500">Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Location Modal */}
      <Modal
        visible={showLocationModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLocationModal(false)}
      >
        <View className="flex-1 bg-black/40 justify-center px-6">
          <View className="bg-white rounded-2xl p-4">
            <Text className="text-base font-semibold text-gray-900 mb-3">Select Location</Text>
            <TouchableOpacity
              className="py-3"
              onPress={() => {
                setLocationFilter('all');
                setShowLocationModal(false);
              }}
            >
              <Text className="text-sm text-gray-700">All Locations</Text>
            </TouchableOpacity>
            {locations.map((loc) => (
              <TouchableOpacity
                key={loc.id}
                className="py-3"
                onPress={() => {
                  setLocationFilter(loc.id);
                  setShowLocationModal(false);
                }}
              >
                <Text className="text-sm text-gray-700">{loc.name}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              className="mt-2 py-3 items-center"
              onPress={() => setShowLocationModal(false)}
            >
              <Text className="text-sm font-semibold text-primary-500">Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Action Menu */}
      <Modal
        visible={showActionMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowActionMenu(false)}
      >
        <View className="flex-1 bg-black/40 justify-end">
          <View className="bg-white rounded-t-2xl p-4">
            <TouchableOpacity
              className="py-3"
              onPress={() => {
                setShowActionMenu(false);
                setShowAddModal(true);
              }}
            >
              <Text className="text-base text-gray-900">Add Item</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="py-3"
              onPress={() => {
                setShowActionMenu(false);
                setShowBulkAddModal(true);
              }}
            >
              <Text className="text-base text-gray-900">Bulk Add Items</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="py-3 items-center"
              onPress={() => setShowActionMenu(false)}
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
            <View className="bg-white px-4 py-4 border-b border-gray-200 flex-row items-center justify-between">
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <Text className="text-primary-500 font-medium">Cancel</Text>
              </TouchableOpacity>
              <Text className="text-lg font-bold text-gray-900">Add New Item</Text>
              <View style={{ width: 50 }} />
            </View>

            <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-2">Item Name *</Text>
                <TextInput
                  className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900"
                  placeholder="e.g., Salmon (Sushi Grade)"
                  placeholderTextColor="#9CA3AF"
                  value={form.name}
                  onChangeText={(text) => setForm({ ...form, name: text })}
                />
              </View>

              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-2">Category *</Text>
                <View className="flex-row flex-wrap gap-2">
                  {categories.map((cat) => {
                    const isSelected = form.category === cat;
                    const color = categoryColors[cat];
                    return (
                      <TouchableOpacity
                        key={cat}
                        className="px-3 py-2 rounded-lg"
                        style={{ backgroundColor: isSelected ? color : color + '20' }}
                        onPress={() => setForm({ ...form, category: cat })}
                      >
                        <Text style={{ color: isSelected ? '#FFFFFF' : color }} className="text-sm font-medium">
                          {CATEGORY_LABELS[cat]}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-2">Supplier *</Text>
                <View className="flex-row flex-wrap gap-2">
                  {supplierCategories.map((sup) => {
                    const isSelected = form.supplier_category === sup;
                    return (
                      <TouchableOpacity
                        key={sup}
                        className={`px-3 py-2 rounded-lg ${isSelected ? 'bg-primary-500' : 'bg-gray-100'}`}
                        onPress={() => setForm({ ...form, supplier_category: sup })}
                      >
                        <Text className={`text-sm font-medium ${isSelected ? 'text-white' : 'text-gray-700'}`}>
                          {SUPPLIER_CATEGORY_LABELS[sup]}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View className="flex-row gap-3 mb-4">
                <View className="flex-1">
                  <Text className="text-sm font-medium text-gray-700 mb-2">Base Unit *</Text>
                  <TextInput
                    className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900"
                    placeholder="e.g., lb"
                    placeholderTextColor="#9CA3AF"
                    value={form.base_unit}
                    onChangeText={(text) => setForm({ ...form, base_unit: text })}
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-medium text-gray-700 mb-2">Pack Unit *</Text>
                  <TextInput
                    className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900"
                    placeholder="e.g., case"
                    placeholderTextColor="#9CA3AF"
                    value={form.pack_unit}
                    onChangeText={(text) => setForm({ ...form, pack_unit: text })}
                  />
                </View>
              </View>

              <View className="mb-6">
                <Text className="text-sm font-medium text-gray-700 mb-2">Pack Size *</Text>
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

              {form.name && (
                <View className="bg-primary-50 rounded-xl p-4 mb-6">
                  <Text className="text-sm font-medium text-primary-700 mb-2">Preview</Text>
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
                    <Text className="text-white font-bold text-lg ml-2">Add Item</Text>
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
            <View className="bg-white px-4 py-4 border-b border-gray-200 flex-row items-center justify-between">
              <TouchableOpacity onPress={() => setShowBulkAddModal(false)}>
                <Text className="text-primary-500 font-medium">Cancel</Text>
              </TouchableOpacity>
              <Text className="text-lg font-bold text-gray-900">Bulk Add Items</Text>
              <View style={{ width: 50 }} />
            </View>

            <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
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

              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-2">Item Names (one per line) *</Text>
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

              <Text className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Shared Settings</Text>

              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-2">Category</Text>
                <View className="flex-row flex-wrap gap-2">
                  {categories.map((cat) => {
                    const isSelected = bulkCategory === cat;
                    const color = categoryColors[cat];
                    return (
                      <TouchableOpacity
                        key={cat}
                        className="px-3 py-2 rounded-lg"
                        style={{ backgroundColor: isSelected ? color : color + '20' }}
                        onPress={() => setBulkCategory(cat)}
                      >
                        <Text style={{ color: isSelected ? '#FFFFFF' : color }} className="text-sm font-medium">
                          {CATEGORY_LABELS[cat]}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-2">Supplier</Text>
                <View className="flex-row flex-wrap gap-2">
                  {supplierCategories.map((sup) => {
                    const isSelected = bulkSupplier === sup;
                    return (
                      <TouchableOpacity
                        key={sup}
                        className={`px-3 py-2 rounded-lg ${isSelected ? 'bg-primary-500' : 'bg-gray-100'}`}
                        onPress={() => setBulkSupplier(sup)}
                      >
                        <Text className={`text-sm font-medium ${isSelected ? 'text-white' : 'text-gray-700'}`}>
                          {SUPPLIER_CATEGORY_LABELS[sup]}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View className="flex-row gap-3 mb-4">
                <View className="flex-1">
                  <Text className="text-sm font-medium text-gray-700 mb-2">Base Unit</Text>
                  <TextInput
                    className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900"
                    placeholder="e.g., lb"
                    placeholderTextColor="#9CA3AF"
                    value={bulkBaseUnit}
                    onChangeText={setBulkBaseUnit}
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-medium text-gray-700 mb-2">Pack Unit</Text>
                  <TextInput
                    className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900"
                    placeholder="e.g., case"
                    placeholderTextColor="#9CA3AF"
                    value={bulkPackUnit}
                    onChangeText={setBulkPackUnit}
                  />
                </View>
              </View>

              <View className="mb-6">
                <Text className="text-sm font-medium text-gray-700 mb-2">Pack Size</Text>
                <TextInput
                  className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900"
                  placeholder="10"
                  placeholderTextColor="#9CA3AF"
                  value={bulkPackSize}
                  onChangeText={setBulkPackSize}
                  keyboardType="number-pad"
                />
              </View>
            </ScrollView>

            <View className="bg-white border-t border-gray-200 px-4 py-4">
              <TouchableOpacity
                className={`rounded-xl py-4 items-center flex-row justify-center ${
                  isSubmitting ? 'bg-primary-300' : 'bg-primary-500'
                }`}
                onPress={handleBulkAdd}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <SpinningFish size="small" />
                ) : (
                  <>
                    <Ionicons name="add-circle" size={20} color="white" />
                    <Text className="text-white font-bold text-lg ml-2">Add Items</Text>
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
