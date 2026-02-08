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
  InventoryItem,
  SupplierCategory,
} from '@/types';
import { CATEGORY_LABELS, SUPPLIER_CATEGORY_LABELS, categoryColors, colors } from '@/constants';
import { SpinningFish } from '@/components';
import { BrandLogo } from '@/components/BrandLogo';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';
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
const BULK_BAR_HEIGHT = 88;

const ADD_EMOJIS = ['🐟', '🥩', '🥬', '🧊', '❄️', '🍶', '🍺', '📦', '🥗', '🍜'];

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
  const [addStep, setAddStep] = useState<'select' | 'create' | 'assign'>('select');
  const [addSearchQuery, setAddSearchQuery] = useState('');
  const [addSearchResults, setAddSearchResults] = useState<
    { item: InventoryItem; areaCount: number }[]
  >([]);
  const [isAddSearching, setIsAddSearching] = useState(false);
  const [selectedAddItem, setSelectedAddItem] = useState<InventoryItem | null>(null);
  const [newItemEmoji, setNewItemEmoji] = useState('');
  const [addLocationId, setAddLocationId] = useState<string | null>(null);
  const [addAreaOptions, setAddAreaOptions] = useState<{ id: string; name: string; icon?: string | null }[]>([]);
  const [addAreaSelections, setAddAreaSelections] = useState<
    Record<
      string,
      {
        selected: boolean;
        unit_type: string;
        min: string;
        max: string;
        order_unit: string;
        conversion: string;
      }
    >
  >({});
  const [addExistingAreaIds, setAddExistingAreaIds] = useState<string[]>([]);
  const [showAddUnitPicker, setShowAddUnitPicker] = useState(false);
  const [addUnitPickerTarget, setAddUnitPickerTarget] = useState<{ areaId: string; field: 'unit' | 'order' } | null>(null);
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
  const [areaOptions, setAreaOptions] = useState<{ id: string; name: string; icon?: string | null }[]>([]);
  const [selectedAreaItemId, setSelectedAreaItemId] = useState<string | null>(null);
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
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [moveTargetAreaId, setMoveTargetAreaId] = useState<string | null>(null);
  const [moveForm, setMoveForm] = useState({
    unit_type: 'each',
    min: '',
    max: '',
  });
  const [showMoveUnitPicker, setShowMoveUnitPicker] = useState(false);
  const [moveMode, setMoveMode] = useState<'replace' | 'duplicate'>('replace');
  const [isMoveSaving, setIsMoveSaving] = useState(false);
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Record<string, boolean>>({});
  const [showBulkMoveModal, setShowBulkMoveModal] = useState(false);
  const [bulkMoveAreaId, setBulkMoveAreaId] = useState<string | null>(null);
  const [bulkMoveSettings, setBulkMoveSettings] = useState({ unit_type: 'each', min: '', max: '' });
  const [bulkMoveAreas, setBulkMoveAreas] = useState<{ id: string; name: string; icon?: string | null }[]>([]);
  const [isBulkSaving, setIsBulkSaving] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 150);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const loadAreas = async () => {
      if (!showAddModal || !addLocationId) return;
      const { data } = await supabase
        .from('storage_areas')
        .select('id,name,icon')
        .eq('location_id', addLocationId)
        .eq('active', true)
        .order('sort_order', { ascending: true });
      setAddAreaOptions((data || []) as { id: string; name: string; icon?: string | null }[]);
    };
    loadAreas();
  }, [addLocationId, showAddModal]);

  useEffect(() => {
    if (!showAddModal) return;
    setAddAreaSelections({});
    setAddExistingAreaIds([]);
  }, [addLocationId, showAddModal]);

  useEffect(() => {
    setBulkMoveAreas([]);
  }, [locationFilter]);

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
        .select('id,name,icon')
        .eq('location_id', item.location.id)
        .eq('active', true)
        .order('sort_order', { ascending: true });

      setAreaOptions((areas || []) as { id: string; name: string; icon?: string | null }[]);

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

  const areaItemsByArea = useMemo(() => {
    const map = new Map<string, AreaItemEdit>();
    editAreas.forEach((area) => map.set(area.area_id, area));
    return map;
  }, [editAreas]);

  const moveTargetArea = useMemo(() => {
    return areaOptions.find((area) => area.id === moveTargetAreaId) ?? null;
  }, [areaOptions, moveTargetAreaId]);

  const moveTargetExisting = useMemo(() => {
    if (!moveTargetAreaId) return null;
    return areaItemsByArea.get(moveTargetAreaId) ?? null;
  }, [areaItemsByArea, moveTargetAreaId]);

  const openMoveModal = useCallback(() => {
    if (!selectedAreaItem) return;
    setMoveTargetAreaId(null);
    setMoveMode('replace');
    setMoveForm({
      unit_type: selectedAreaItem.unit_type || 'each',
      min: String(selectedAreaItem.min_quantity ?? ''),
      max: String(selectedAreaItem.max_quantity ?? ''),
    });
    setShowMoveModal(true);
  }, [selectedAreaItem]);

  const handleSelectMoveArea = useCallback(
    (areaId: string) => {
      if (!selectedAreaItem) return;
      if (areaId === selectedAreaItem.area_id) return;

      const existing = areaItemsByArea.get(areaId);
      setMoveTargetAreaId(areaId);
      setMoveMode('replace');

      if (existing) {
        setMoveForm({
          unit_type: existing.unit_type || 'each',
          min: String(existing.min_quantity ?? ''),
          max: String(existing.max_quantity ?? ''),
        });
      } else {
        setMoveForm({
          unit_type: selectedAreaItem.unit_type || 'each',
          min: String(selectedAreaItem.min_quantity ?? ''),
          max: String(selectedAreaItem.max_quantity ?? ''),
        });
      }
    },
    [areaItemsByArea, selectedAreaItem]
  );

  const handleMoveItem = useCallback(async () => {
    if (!selectedAreaItem || !editingItem || !moveTargetAreaId) return;

    const min = Number(moveForm.min);
    const max = Number(moveForm.max);
    if (Number.isNaN(min) || Number.isNaN(max) || min < 0 || max < 0) {
      Alert.alert('Invalid Values', 'Please enter valid min/max values.');
      return;
    }
    if (min >= max) {
      Alert.alert('Invalid Range', 'Minimum must be less than maximum.');
      return;
    }

    const existing = areaItemsByArea.get(moveTargetAreaId);
    setIsMoveSaving(true);
    try {
      if (existing) {
        if (moveMode === 'duplicate') {
          Alert.alert('Already Exists', 'This item already exists in the selected area.');
          setIsMoveSaving(false);
          return;
        }

        const { error: updateTargetError } = await supabase
          .from('area_items')
          .update({
            unit_type: moveForm.unit_type,
            min_quantity: min,
            max_quantity: max,
            current_quantity: 0,
            order_unit: selectedAreaItem.order_unit ?? moveForm.unit_type,
            conversion_factor: selectedAreaItem.conversion_factor ?? null,
          })
          .eq('id', existing.id);

        if (updateTargetError) throw updateTargetError;

        const { error: deactivateError } = await supabase
          .from('area_items')
          .update({ active: false })
          .eq('id', selectedAreaItem.id);

        if (deactivateError) throw deactivateError;
      } else if (moveMode === 'duplicate') {
        const { error: insertError } = await supabase
          .from('area_items')
          .insert({
            area_id: moveTargetAreaId,
            inventory_item_id: editingItem.inventory_item.id,
            min_quantity: min,
            max_quantity: max,
            par_level: null,
            current_quantity: 0,
            unit_type: moveForm.unit_type,
            order_unit: selectedAreaItem.order_unit ?? moveForm.unit_type,
            conversion_factor: selectedAreaItem.conversion_factor ?? null,
            active: true,
          });

        if (insertError) throw insertError;
      } else {
        const { error: updateError } = await supabase
          .from('area_items')
          .update({
            area_id: moveTargetAreaId,
            unit_type: moveForm.unit_type,
            min_quantity: min,
            max_quantity: max,
            current_quantity: 0,
            order_unit: selectedAreaItem.order_unit ?? moveForm.unit_type,
            conversion_factor: selectedAreaItem.conversion_factor ?? null,
          })
          .eq('id', selectedAreaItem.id);

        if (updateError) throw updateError;
      }

      showToastMessage('✓ Item moved');
      setShowMoveModal(false);
      setShowEditModal(false);
      fetchInventoryStock();
    } catch (err: any) {
      Alert.alert('Move Failed', err?.message ?? 'Unable to move item.');
    } finally {
      setIsMoveSaving(false);
    }
  }, [
    selectedAreaItem,
    editingItem,
    moveTargetAreaId,
    moveForm,
    areaItemsByArea,
    moveMode,
    showToastMessage,
    fetchInventoryStock,
  ]);

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

  const openAddFlow = useCallback(() => {
    const defaultLocation =
      locationFilter !== 'all'
        ? locationFilter
        : user?.default_location_id || locations[0]?.id || null;
    setAddLocationId(defaultLocation);
    setAddStep('select');
    setAddSearchQuery('');
    setAddSearchResults([]);
    setSelectedAddItem(null);
    setNewItemEmoji('');
    setAddAreaSelections({});
    setAddExistingAreaIds([]);
    setForm(initialForm);
    setShowAddModal(true);
  }, [locationFilter, user, locations]);

  const searchExistingItems = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setAddSearchResults([]);
      return;
    }

    setIsAddSearching(true);
    try {
      const { data, error } = await supabase
        .from('inventory_items')
        .select('id,name,category,supplier_category,base_unit,pack_unit,pack_size')
        .ilike('name', `%${trimmed}%`)
        .eq('active', true)
        .order('name', { ascending: true })
        .limit(25);

      if (error) throw error;

      const items = (data || []) as InventoryItem[];
      const ids = items.map((item) => item.id);
      let counts: Record<string, number> = {};
      if (ids.length > 0) {
        const { data: areaItems } = await supabase
          .from('area_items')
          .select('inventory_item_id')
          .in('inventory_item_id', ids)
          .eq('active', true);
        counts = (areaItems || []).reduce<Record<string, number>>((acc, row: any) => {
          acc[row.inventory_item_id] = (acc[row.inventory_item_id] || 0) + 1;
          return acc;
        }, {});
      }

      setAddSearchResults(
        items.map((item) => ({
          item,
          areaCount: counts[item.id] || 0,
        }))
      );
    } catch (err) {
      setAddSearchResults([]);
    } finally {
      setIsAddSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!showAddModal || addStep !== 'select') return;
    const timer = setTimeout(() => {
      searchExistingItems(addSearchQuery);
    }, 200);
    return () => clearTimeout(timer);
  }, [addSearchQuery, addStep, showAddModal, searchExistingItems]);

  const handleSelectExistingItem = useCallback(
    async (item: InventoryItem) => {
      setSelectedAddItem(item);
      setAddStep('assign');
      setAddExistingAreaIds([]);
      setAddAreaSelections({});

      if (addLocationId) {
        const { data } = await supabase
          .from('area_items')
          .select('area_id, area:storage_areas(location_id)')
          .eq('inventory_item_id', item.id)
          .eq('active', true);

        const ids = (data || [])
          .filter((row: any) => row.area?.location_id === addLocationId)
          .map((row: any) => row.area_id);
        setAddExistingAreaIds(ids);
      }
    },
    [addLocationId]
  );

  const handleStartCreateItem = useCallback(() => {
    setSelectedAddItem(null);
    setAddStep('create');
  }, []);

  const handleContinueToAreas = useCallback(() => {
    if (!form.name.trim()) {
      Alert.alert('Missing Name', 'Please enter an item name.');
      return;
    }
    setAddStep('assign');
    setAddExistingAreaIds([]);
    setAddAreaSelections({});
  }, [form.name]);

  const toggleAddAreaSelection = useCallback(
    (areaId: string) => {
      if (addExistingAreaIds.includes(areaId)) return;

      setAddAreaSelections((prev) => {
        const current = prev[areaId];
        const nextSelected = !current?.selected;
        if (!nextSelected) {
          return {
            ...prev,
            [areaId]: {
              ...current,
              selected: false,
            },
          };
        }

        const defaultUnit = selectedAddItem?.base_unit || 'each';
        const defaultOrder = selectedAddItem?.pack_unit || 'case';
        const defaultConversion = selectedAddItem?.pack_size ? String(selectedAddItem.pack_size) : '1';
        return {
          ...prev,
          [areaId]: {
            selected: true,
            unit_type: current?.unit_type || defaultUnit,
            min: current?.min || '2',
            max: current?.max || '6',
            order_unit: current?.order_unit || defaultOrder,
            conversion: current?.conversion || defaultConversion,
          },
        };
      });
    },
    [addExistingAreaIds, selectedAddItem]
  );

  const handleAddItemFlow = useCallback(async () => {
    const selectedAreaIds = Object.entries(addAreaSelections)
      .filter(([, settings]) => settings.selected)
      .map(([areaId]) => areaId);

    if (selectedAreaIds.length === 0) {
      Alert.alert('Select Areas', 'Choose at least one storage area.');
      return;
    }

    const firstSettings = addAreaSelections[selectedAreaIds[0]];
    if (!firstSettings) {
      Alert.alert('Missing Settings', 'Please provide stock settings for the selected areas.');
      return;
    }

    setIsSubmitting(true);
    try {
      let inventoryItem = selectedAddItem;

      if (!inventoryItem) {
        const name = newItemEmoji
          ? `${newItemEmoji} ${form.name.trim()}`.trim()
          : form.name.trim();
        const baseUnit = firstSettings.unit_type || 'each';
        const packUnit = firstSettings.order_unit || 'case';
        const packSize = Number(firstSettings.conversion) || 1;

        inventoryItem = await addItem({
          name,
          category: form.category,
          supplier_category: form.supplier_category,
          base_unit: baseUnit,
          pack_unit: packUnit,
          pack_size: packSize,
          created_by: user?.id,
        });
      }

      const payload = selectedAreaIds.map((areaId) => {
        const settings = addAreaSelections[areaId];
        const min = Number(settings.min) || 0;
        const max = Number(settings.max) || 0;
        if (min > 0 && max > 0 && min >= max) {
          throw new Error('Min must be less than Max for selected areas.');
        }
        return {
          area_id: areaId,
          inventory_item_id: inventoryItem!.id,
          min_quantity: min,
          max_quantity: max,
          par_level: null,
          current_quantity: 0,
          unit_type: settings.unit_type || 'each',
          order_unit: settings.order_unit || settings.unit_type || 'case',
          conversion_factor: settings.conversion ? Number(settings.conversion) : null,
          active: true,
        };
      });

      const { error } = await supabase
        .from('area_items')
        .upsert(payload, { onConflict: 'area_id,inventory_item_id' });

      if (error) throw error;

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      setShowAddModal(false);
      setAddStep('select');
      setSelectedAddItem(null);
      setAddAreaSelections({});
      setAddExistingAreaIds([]);
      setForm(initialForm);
      setNewItemEmoji('');
      fetchInventoryStock();
      fetchItems();
      Alert.alert('Success', 'Item added to selected areas.');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to add item');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    addAreaSelections,
    selectedAddItem,
    newItemEmoji,
    form,
    addItem,
    user,
    fetchInventoryStock,
    fetchItems,
  ]);

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

  const bulkSelectedItems = useMemo(() => {
    return sortedItems.filter((item) => bulkSelectedIds[item.id]);
  }, [bulkSelectedIds, sortedItems]);

  const bulkSelectedCount = bulkSelectedItems.length;

  const enterBulkMode = useCallback(
    (item?: InventoryStockItem) => {
      if (locationFilter === 'all') {
        Alert.alert('Select a Location', 'Choose a specific location to use bulk edit mode.');
        return;
      }
      setIsBulkMode(true);
      if (item) {
        setBulkSelectedIds({ [item.id]: true });
      } else {
        setBulkSelectedIds({});
      }
    },
    [locationFilter]
  );

  const exitBulkMode = useCallback(() => {
    setIsBulkMode(false);
    setBulkSelectedIds({});
  }, []);

  const toggleBulkSelection = useCallback((itemId: string) => {
    setBulkSelectedIds((prev) => ({
      ...prev,
      [itemId]: !prev[itemId],
    }));
  }, []);

  const handleBulkSelectAll = useCallback(() => {
    const visibleIds = sortedItems.map((item) => item.id);
    const allSelected = visibleIds.every((id) => bulkSelectedIds[id]);
    if (allSelected) {
      setBulkSelectedIds({});
      return;
    }
    const next: Record<string, boolean> = {};
    visibleIds.forEach((id) => {
      next[id] = true;
    });
    setBulkSelectedIds(next);
  }, [sortedItems, bulkSelectedIds]);

  const handleBulkRemove = useCallback(async () => {
    if (bulkSelectedCount === 0) return;
    if (locationFilter === 'all') {
      Alert.alert('Select a Location', 'Choose a specific location to remove items.');
      return;
    }

    Alert.alert(
      'Remove Items',
      `Remove ${bulkSelectedCount} item${bulkSelectedCount !== 1 ? 's' : ''} from this location?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setIsBulkSaving(true);
            try {
              const itemIds = bulkSelectedItems.map((item) => item.inventory_item.id);
              const { data, error } = await supabase
                .from('area_items')
                .select('id, area:storage_areas(location_id)')
                .in('inventory_item_id', itemIds)
                .eq('active', true);

              if (error) throw error;
              const targetIds = (data || [])
                .filter((row: any) => row.area?.location_id === locationFilter)
                .map((row: any) => row.id);

              if (targetIds.length > 0) {
                const { error: updateError } = await supabase
                  .from('area_items')
                  .update({ active: false })
                  .in('id', targetIds);
                if (updateError) throw updateError;
              }

              showToastMessage(`✓ Removed ${bulkSelectedCount} item${bulkSelectedCount !== 1 ? 's' : ''}`);
              exitBulkMode();
              fetchInventoryStock();
            } catch (err: any) {
              Alert.alert('Remove Failed', err?.message ?? 'Unable to remove items.');
            } finally {
              setIsBulkSaving(false);
            }
          },
        },
      ]
    );
  }, [
    bulkSelectedCount,
    bulkSelectedItems,
    locationFilter,
    exitBulkMode,
    fetchInventoryStock,
    showToastMessage,
  ]);

  const openBulkMove = useCallback(async () => {
    if (bulkSelectedCount === 0) return;
    if (locationFilter === 'all') {
      Alert.alert('Select a Location', 'Choose a specific location to move items.');
      return;
    }

    if (bulkMoveAreas.length === 0) {
      const { data } = await supabase
        .from('storage_areas')
        .select('id,name,icon')
        .eq('location_id', locationFilter)
        .eq('active', true)
        .order('sort_order', { ascending: true });
      setBulkMoveAreas((data || []) as { id: string; name: string; icon?: string | null }[]);
    }

    const first = bulkSelectedItems[0];
    setBulkMoveSettings({
      unit_type: first?.unit_type || 'each',
      min: String(first?.min_quantity ?? ''),
      max: String(first?.max_quantity ?? ''),
    });
    setBulkMoveAreaId(null);
    setShowBulkMoveModal(true);
  }, [bulkSelectedCount, bulkSelectedItems, bulkMoveAreas.length, locationFilter]);

  const handleBulkMoveItems = useCallback(async () => {
    if (!bulkMoveAreaId || bulkSelectedCount === 0 || locationFilter === 'all') return;

    const min = Number(bulkMoveSettings.min) || 0;
    const max = Number(bulkMoveSettings.max) || 0;
    if (min > 0 && max > 0 && min >= max) {
      Alert.alert('Invalid Range', 'Minimum must be less than maximum.');
      return;
    }

    setIsBulkSaving(true);
    try {
      const itemIds = bulkSelectedItems.map((item) => item.inventory_item.id);
      const { data, error } = await supabase
        .from('area_items')
        .select('id, inventory_item_id, area_id, area:storage_areas(location_id)')
        .in('inventory_item_id', itemIds)
        .eq('active', true);

      if (error) throw error;
      const rows = (data || []).filter((row: any) => row.area?.location_id === locationFilter);

      const grouped = new Map<string, any[]>();
      rows.forEach((row: any) => {
        if (!grouped.has(row.inventory_item_id)) {
          grouped.set(row.inventory_item_id, []);
        }
        grouped.get(row.inventory_item_id)!.push(row);
      });

      for (const [, group] of grouped.entries()) {
        const target = group.find((row) => row.area_id === bulkMoveAreaId);
        const others = group.filter((row) => row.id !== target?.id);
        if (target) {
          const { error: updateTargetError } = await supabase
            .from('area_items')
            .update({
              unit_type: bulkMoveSettings.unit_type,
              min_quantity: min,
              max_quantity: max,
              current_quantity: 0,
            })
            .eq('id', target.id);
          if (updateTargetError) throw updateTargetError;
        } else {
          const primary = group[0];
          if (!primary) continue;
          const { error: updatePrimaryError } = await supabase
            .from('area_items')
            .update({
              area_id: bulkMoveAreaId,
              unit_type: bulkMoveSettings.unit_type,
              min_quantity: min,
              max_quantity: max,
              current_quantity: 0,
            })
            .eq('id', primary.id);
          if (updatePrimaryError) throw updatePrimaryError;
        }

        if (others.length > 0) {
          const { error: deactivateError } = await supabase
            .from('area_items')
            .update({ active: false })
            .in('id', others.map((row) => row.id));
          if (deactivateError) throw deactivateError;
        }
      }

      showToastMessage(`✓ Moved ${bulkSelectedCount} item${bulkSelectedCount !== 1 ? 's' : ''}`);
      setShowBulkMoveModal(false);
      exitBulkMode();
      fetchInventoryStock();
    } catch (err: any) {
      Alert.alert('Move Failed', err?.message ?? 'Unable to move items.');
    } finally {
      setIsBulkSaving(false);
    }
  }, [
    bulkMoveAreaId,
    bulkSelectedCount,
    bulkSelectedItems,
    bulkMoveSettings,
    locationFilter,
    exitBulkMode,
    fetchInventoryStock,
    showToastMessage,
  ]);

  const renderListItem = ({ item }: { item: InventoryStockItem }) => {
    const statusColor = STATUS_COLORS[item.status];
    const reorderQty = Math.max(item.max_quantity - item.current_quantity, 0);
    const key = `${item.inventory_item.id}-${item.location.id}`;
    const added = addedKeys[key];
    const isSelected = !!bulkSelectedIds[item.id];

    return (
      <TouchableOpacity
        activeOpacity={0.9}
        className="mb-4"
        onPress={() => (isBulkMode ? toggleBulkSelection(item.id) : openEditModal(item))}
        onLongPress={() => {
          if (!isBulkMode) enterBulkMode(item);
        }}
      >
        <View className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <View className="flex-row items-start justify-between">
            <View className="flex-row items-center flex-1 pr-2">
              {isBulkMode && (
                <Ionicons
                  name={isSelected ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={isSelected ? colors.primary[500] : colors.gray[400]}
                  style={{ marginRight: 8 }}
                />
              )}
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
            {item.status === 'critical' && reorderQty > 0 && !isBulkMode ? (
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
    const isSelected = !!bulkSelectedIds[item.id];

    return (
      <TouchableOpacity
        activeOpacity={0.9}
        className="bg-white border border-gray-100 rounded-2xl mb-2 overflow-hidden"
        onPress={() => (isBulkMode ? toggleBulkSelection(item.id) : openEditModal(item))}
        onLongPress={() => {
          if (!isBulkMode) enterBulkMode(item);
        }}
      >
        <View className="flex-row items-center px-4 py-3">
          {isBulkMode && (
            <Ionicons
              name={isSelected ? 'checkbox' : 'square-outline'}
              size={18}
              color={isSelected ? colors.primary[500] : colors.gray[400]}
              style={{ marginRight: 8 }}
            />
          )}
          <Text className="text-lg mr-2">{CATEGORY_EMOJI[item.inventory_item.category] ?? '📦'}</Text>
          <View className="flex-1">
            <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>
              {item.inventory_item.name}
            </Text>
            <Text className="text-xs text-gray-500">{item.current_quantity} / {item.max_quantity} {item.unit_type}</Text>
          </View>
          <View className="flex-row items-center">
            <View className="h-3 w-3 rounded-full mr-2" style={{ backgroundColor: statusColor }} />
            {item.status === 'critical' && reorderQty > 0 && !isBulkMode ? (
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
      <ManagerScaleContainer>
      <View className="flex-1">
        <View className="px-4 pt-4">
          {isBulkMode ? (
            <View className="flex-row items-center justify-between">
              <TouchableOpacity onPress={exitBulkMode}>
                <Text className="text-primary-500 font-semibold">Cancel</Text>
              </TouchableOpacity>
              <Text className="text-base font-semibold text-gray-900">
                {bulkSelectedCount} selected
              </Text>
              <TouchableOpacity onPress={exitBulkMode}>
                <Text className="text-primary-500 font-semibold">Done</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center">
                <TouchableOpacity
                  className="h-9 w-9 rounded-full bg-gray-100 items-center justify-center mr-2"
                  onPress={() => router.back()}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="arrow-back" size={18} color={colors.gray[700]} />
                </TouchableOpacity>
                <BrandLogo variant="header" size={28} style={{ marginRight: 8 }} />
                <Text className="text-2xl font-bold text-gray-900">Inventory</Text>
              </View>
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
          )}

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
            paddingBottom: isBulkMode
              ? BULK_BAR_HEIGHT + 16
              : stats.reorder > 0
                ? REORDER_BAR_HEIGHT + 16
                : 24,
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

        {!isBulkMode && stats.reorder > 0 && (
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

        {isBulkMode && (
          <View
            className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4"
            style={{ paddingTop: 10, paddingBottom: 10, bottom: 0 }}
          >
            <View className="flex-row items-center justify-between">
              <TouchableOpacity
                className={`flex-1 mr-2 rounded-xl border px-3 py-3 items-center ${
                  bulkSelectedCount === 0 ? 'border-gray-200 bg-gray-100' : 'border-gray-200 bg-white'
                }`}
                onPress={openBulkMove}
                disabled={bulkSelectedCount === 0}
              >
                <Text className="text-sm font-semibold text-gray-700">📍 Move</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className={`flex-1 mr-2 rounded-xl border px-3 py-3 items-center ${
                  bulkSelectedCount === 0 ? 'border-gray-200 bg-gray-100' : 'border-gray-200 bg-white'
                }`}
                onPress={handleBulkRemove}
                disabled={bulkSelectedCount === 0}
              >
                <Text className="text-sm font-semibold text-gray-700">🚫 Remove</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 rounded-xl border border-gray-200 px-3 py-3 items-center bg-white"
                onPress={handleBulkSelectAll}
              >
                <Text className="text-sm font-semibold text-gray-700">✓ Select All</Text>
              </TouchableOpacity>
            </View>
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
                    onPress={openMoveModal}
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

      {/* Move Item Modal */}
      <Modal
        visible={showMoveModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowMoveModal(false)}
      >
        <SafeAreaView className="flex-1 bg-gray-50">
          <View className="bg-white px-4 py-4 border-b border-gray-200 flex-row items-center justify-between">
            <Text className="text-lg font-bold text-gray-900">Move Item</Text>
            <TouchableOpacity onPress={() => setShowMoveModal(false)}>
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
                        Currently in: {selectedAreaItem.area.name}
                      </Text>
                    </View>
                  </View>
                </View>

                <View className="mt-5 bg-white rounded-2xl p-4 border border-gray-100">
                  <Text className="text-xs font-semibold text-gray-500 mb-3">MOVE TO</Text>
                  {areaOptions.map((area) => {
                    const isCurrent = area.id === selectedAreaItem.area_id;
                    const isSelected = area.id === moveTargetAreaId;
                    const existing = areaItemsByArea.get(area.id);
                    return (
                      <TouchableOpacity
                        key={area.id}
                        className={`border rounded-xl px-4 py-3 mb-3 ${
                          isSelected ? 'border-orange-200 bg-orange-50' : 'border-gray-200'
                        } ${isCurrent ? 'opacity-50' : ''}`}
                        onPress={() => handleSelectMoveArea(area.id)}
                        disabled={isCurrent}
                      >
                        <View className="flex-row items-center justify-between">
                          <View className="flex-row items-center">
                            <Ionicons
                              name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                              size={18}
                              color={isCurrent ? colors.gray[300] : colors.primary[500]}
                            />
                            <Text className="text-sm font-medium text-gray-900 ml-2">
                              {area.icon ?? '📦'} {area.name}
                            </Text>
                          </View>
                          {isCurrent ? (
                            <Text className="text-xs text-gray-400">Current</Text>
                          ) : null}
                        </View>
                        {existing && !isCurrent ? (
                          <View className="flex-row items-center mt-2">
                            <Ionicons name="alert-circle" size={14} color="#F59E0B" />
                            <Text className="text-xs text-amber-600 ml-1">Item already exists here</Text>
                          </View>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {moveTargetAreaId ? (
                  <View className="mt-5 bg-white rounded-2xl p-4 border border-gray-100">
                    <Text className="text-xs font-semibold text-gray-500 mb-3">
                      NEW SETTINGS FOR {moveTargetArea?.name?.toUpperCase() ?? 'AREA'}
                    </Text>

                    <Text className="text-xs text-gray-500 mb-2">Count Unit</Text>
                    <TouchableOpacity
                      className="border border-gray-200 rounded-xl px-4 py-3 flex-row items-center justify-between"
                      onPress={() => setShowMoveUnitPicker(true)}
                    >
                      <Text className="text-sm font-medium text-gray-900">{moveForm.unit_type}</Text>
                      <Ionicons name="chevron-down" size={16} color={colors.gray[400]} />
                    </TouchableOpacity>

                    <View className="mt-4">
                      <Text className="text-xs text-gray-500 mb-2">Min Quantity</Text>
                      <TextInput
                        className="border border-gray-200 rounded-xl px-4 py-3 text-gray-900"
                        keyboardType="number-pad"
                        value={moveForm.min}
                        onChangeText={(value) => setMoveForm((prev) => ({ ...prev, min: value }))}
                      />
                    </View>
                    <View className="mt-4">
                      <Text className="text-xs text-gray-500 mb-2">Max Quantity</Text>
                      <TextInput
                        className="border border-gray-200 rounded-xl px-4 py-3 text-gray-900"
                        keyboardType="number-pad"
                        value={moveForm.max}
                        onChangeText={(value) => setMoveForm((prev) => ({ ...prev, max: value }))}
                      />
                    </View>

                    <Text className="text-xs text-gray-400 mt-3">
                      Current quantity will reset to 0 for the new area.
                    </Text>

                    <View className="mt-5">
                      <Text className="text-xs font-semibold text-gray-500 mb-2">MOVE TYPE</Text>
                      <View className="flex-row">
                        <TouchableOpacity
                          className={`flex-1 border rounded-xl py-3 items-center mr-2 ${
                            moveMode === 'replace' ? 'border-orange-200 bg-orange-50' : 'border-gray-200'
                          }`}
                          onPress={() => setMoveMode('replace')}
                        >
                          <Text className={`text-sm font-semibold ${
                            moveMode === 'replace' ? 'text-orange-600' : 'text-gray-700'
                          }`}>
                            Replace Existing
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          className={`flex-1 border rounded-xl py-3 items-center ${
                            moveMode === 'duplicate' ? 'border-orange-200 bg-orange-50' : 'border-gray-200'
                          } ${moveTargetExisting ? 'opacity-50' : ''}`}
                          onPress={() => setMoveMode('duplicate')}
                          disabled={!!moveTargetExisting}
                        >
                          <Text className={`text-sm font-semibold ${
                            moveMode === 'duplicate' ? 'text-orange-600' : 'text-gray-700'
                          }`}>
                            Add Duplicate
                          </Text>
                        </TouchableOpacity>
                      </View>
                      {moveTargetExisting ? (
                        <Text className="text-xs text-amber-600 mt-2">
                          Item already exists here. Replace only.
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ) : null}
              </>
            ) : (
              <View className="items-center justify-center py-20">
                <Text className="text-gray-500">No item selected.</Text>
              </View>
            )}
          </ScrollView>

          <View className="bg-white border-t border-gray-200 px-4 py-4">
            <TouchableOpacity
              className={`rounded-xl py-4 items-center ${isMoveSaving || !moveTargetAreaId ? 'bg-orange-200' : 'bg-orange-500'}`}
              onPress={handleMoveItem}
              disabled={isMoveSaving || !moveTargetAreaId}
            >
              <Text className="text-white font-semibold">
                {isMoveSaving ? 'Moving...' : 'Move Item'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="mt-3 rounded-xl py-3 items-center border border-gray-200"
              onPress={() => setShowMoveModal(false)}
            >
              <Text className="text-sm font-semibold text-gray-700">Cancel</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Bulk Move Modal */}
      <Modal
        visible={showBulkMoveModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowBulkMoveModal(false)}
      >
        <SafeAreaView className="flex-1 bg-gray-50">
          <View className="bg-white px-4 py-4 border-b border-gray-200 flex-row items-center justify-between">
            <Text className="text-lg font-bold text-gray-900">Move Items</Text>
            <TouchableOpacity onPress={() => setShowBulkMoveModal(false)}>
              <Ionicons name="close" size={20} color={colors.gray[500]} />
            </TouchableOpacity>
          </View>

          <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
            <Text className="text-xs font-semibold text-gray-500 mb-3">MOVE TO</Text>
            {bulkMoveAreas.length === 0 && (
              <View className="items-center py-6">
                <Text className="text-sm text-gray-400">No areas available.</Text>
              </View>
            )}
            {bulkMoveAreas.map((area) => (
              <TouchableOpacity
                key={area.id}
                className={`border rounded-xl px-4 py-3 mb-3 ${
                  bulkMoveAreaId === area.id ? 'border-orange-200 bg-orange-50' : 'border-gray-200'
                }`}
                onPress={() => setBulkMoveAreaId(area.id)}
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center">
                    <Ionicons
                      name={bulkMoveAreaId === area.id ? 'radio-button-on' : 'radio-button-off'}
                      size={18}
                      color={colors.primary[500]}
                    />
                    <Text className="text-sm font-medium text-gray-900 ml-2">
                      {area.icon ?? '📦'} {area.name}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}

            <View className="mt-4 bg-white rounded-2xl p-4 border border-gray-100">
              <Text className="text-xs font-semibold text-gray-500 mb-3">NEW SETTINGS</Text>
              <Text className="text-xs text-gray-500 mb-2">Count Unit</Text>
              <TouchableOpacity
                className="border border-gray-200 rounded-xl px-4 py-3 flex-row items-center justify-between"
                onPress={() => {
                  setAddUnitPickerTarget({ areaId: 'bulk', field: 'unit' });
                  setShowAddUnitPicker(true);
                }}
              >
                <Text className="text-sm text-gray-900">{bulkMoveSettings.unit_type}</Text>
                <Ionicons name="chevron-down" size={16} color={colors.gray[400]} />
              </TouchableOpacity>

              <View className="flex-row gap-3 mt-4">
                <View className="flex-1">
                  <Text className="text-xs text-gray-500 mb-2">Min</Text>
                  <TextInput
                    className="border border-gray-200 rounded-xl px-3 py-2 text-gray-900"
                    keyboardType="number-pad"
                    value={bulkMoveSettings.min}
                    onChangeText={(value) => setBulkMoveSettings((prev) => ({ ...prev, min: value }))}
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-xs text-gray-500 mb-2">Max</Text>
                  <TextInput
                    className="border border-gray-200 rounded-xl px-3 py-2 text-gray-900"
                    keyboardType="number-pad"
                    value={bulkMoveSettings.max}
                    onChangeText={(value) => setBulkMoveSettings((prev) => ({ ...prev, max: value }))}
                  />
                </View>
              </View>
            </View>
          </ScrollView>

          <View className="bg-white border-t border-gray-200 px-4 py-4">
            <TouchableOpacity
              className={`rounded-xl py-4 items-center ${isBulkSaving || !bulkMoveAreaId ? 'bg-orange-200' : 'bg-orange-500'}`}
              onPress={handleBulkMoveItems}
              disabled={isBulkSaving || !bulkMoveAreaId}
            >
              <Text className="text-white font-semibold">
                {isBulkSaving ? 'Moving...' : 'Move Items'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="mt-3 rounded-xl py-3 items-center border border-gray-200"
              onPress={() => setShowBulkMoveModal(false)}
            >
              <Text className="text-sm font-semibold text-gray-700">Cancel</Text>
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

      {/* Move Unit Picker */}
      <Modal
        visible={showMoveUnitPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMoveUnitPicker(false)}
      >
        <View className="flex-1 bg-black/40 justify-end">
          <View className="bg-white rounded-t-2xl p-4">
            <Text className="text-base font-semibold text-gray-900 mb-2">Select Count Unit</Text>
            {COUNT_UNITS.map((unit) => (
              <TouchableOpacity
                key={unit}
                className="py-3"
                onPress={() => {
                  setMoveForm((prev) => ({ ...prev, unit_type: unit }));
                  setShowMoveUnitPicker(false);
                }}
              >
                <Text className="text-sm text-gray-700">{unit}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity className="py-3 items-center" onPress={() => setShowMoveUnitPicker(false)}>
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
                openAddFlow();
              }}
            >
              <Text className="text-base text-gray-900">Add Item</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="py-3"
              onPress={() => {
                setShowActionMenu(false);
                enterBulkMode();
              }}
            >
              <Text className="text-base text-gray-900">Select</Text>
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
        onRequestClose={() => {
          setShowAddModal(false);
          setAddStep('select');
        }}
      >
        <SafeAreaView className="flex-1 bg-gray-50">
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            className="flex-1"
          >
            <View className="bg-white px-4 py-4 border-b border-gray-200 flex-row items-center justify-between">
              <TouchableOpacity
                onPress={() => {
                  if (addStep === 'select') {
                    setShowAddModal(false);
                  } else if (addStep === 'assign' && selectedAddItem) {
                    setAddStep('select');
                  } else if (addStep === 'assign') {
                    setAddStep('create');
                  } else {
                    setAddStep('select');
                  }
                }}
              >
                <Text className="text-primary-500 font-medium">{addStep === 'select' ? 'Cancel' : 'Back'}</Text>
              </TouchableOpacity>
              <Text className="text-lg font-bold text-gray-900">
                {addStep === 'select' ? 'Add Item' : addStep === 'create' ? 'New Item' : 'Add to Areas'}
              </Text>
              <View style={{ width: 50 }} />
            </View>

            <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
              {addStep === 'select' && (
                <>
                  <View className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex-row items-center">
                    <Ionicons name="search-outline" size={18} color={colors.gray[400]} />
                    <TextInput
                      className="flex-1 ml-2 text-gray-900"
                      placeholder="Search existing items..."
                      placeholderTextColor={colors.gray[400]}
                      value={addSearchQuery}
                      onChangeText={setAddSearchQuery}
                    />
                  </View>

                  <Text className="text-xs font-semibold text-gray-500 mt-5 mb-3">EXISTING ITEMS</Text>
                  {isAddSearching && (
                    <Text className="text-xs text-gray-400 mb-2">Searching...</Text>
                  )}
                  {addSearchResults.map((result) => (
                    <TouchableOpacity
                      key={result.item.id}
                      className="bg-white border border-gray-100 rounded-xl p-4 mb-3"
                      onPress={() => handleSelectExistingItem(result.item)}
                    >
                      <View className="flex-row items-center">
                        <Text className="text-lg mr-2">{CATEGORY_EMOJI[result.item.category] ?? '📦'}</Text>
                        <View className="flex-1">
                          <Text className="text-sm font-semibold text-gray-900">{result.item.name}</Text>
                          <Text className="text-xs text-gray-500 mt-1">
                            {CATEGORY_LABELS[result.item.category]} • In {result.areaCount} area
                            {result.areaCount !== 1 ? 's' : ''}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={colors.gray[400]} />
                      </View>
                    </TouchableOpacity>
                  ))}
                  {addSearchQuery.trim().length > 0 && !isAddSearching && addSearchResults.length === 0 && (
                    <View className="items-center py-6">
                      <Text className="text-sm text-gray-400">No items found.</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    className="bg-white border border-dashed border-gray-300 rounded-xl p-4 mt-3 items-center"
                    onPress={handleStartCreateItem}
                  >
                    <Text className="text-sm font-semibold text-primary-600">+ Create New Item</Text>
                  </TouchableOpacity>
                </>
              )}

              {addStep === 'create' && (
                <>
                  <View className="mb-4">
                    <Text className="text-sm font-medium text-gray-700 mb-2">Item Name *</Text>
                    <TextInput
                      className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-900"
                      placeholder="e.g., Dragon Fruit"
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
                    <Text className="text-sm font-medium text-gray-700 mb-2">Supplier</Text>
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

                  <View className="mb-6">
                    <Text className="text-sm font-medium text-gray-700 mb-2">Emoji</Text>
                    <View className="flex-row flex-wrap gap-2">
                      {ADD_EMOJIS.map((emoji) => (
                        <TouchableOpacity
                          key={emoji}
                          className={`h-10 w-10 rounded-xl items-center justify-center ${
                            newItemEmoji === emoji ? 'bg-orange-100 border border-orange-200' : 'bg-gray-100'
                          }`}
                          onPress={() => setNewItemEmoji(emoji)}
                        >
                          <Text className="text-lg">{emoji}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </>
              )}

              {addStep === 'assign' && (
                <>
                  <View className="bg-white rounded-2xl p-4 border border-gray-100 mb-4">
                    <View className="flex-row items-center">
                      <Text className="text-2xl mr-3">
                        {selectedAddItem
                          ? CATEGORY_EMOJI[selectedAddItem.category] ?? '📦'
                          : newItemEmoji || CATEGORY_EMOJI[form.category] || '📦'}
                      </Text>
                      <View className="flex-1">
                        <Text className="text-base font-semibold text-gray-900">
                          {selectedAddItem ? selectedAddItem.name : form.name}
                        </Text>
                        <Text className="text-xs text-gray-500 mt-1">
                          {selectedAddItem ? CATEGORY_LABELS[selectedAddItem.category] : CATEGORY_LABELS[form.category]}
                        </Text>
                        {addLocationId && (
                          <Text className="text-xs text-gray-400 mt-1">
                            Location: {locations.find((loc) => loc.id === addLocationId)?.name ?? 'Selected location'}
                          </Text>
                        )}
                      </View>
                    </View>
                  </View>

                  <Text className="text-xs font-semibold text-gray-500 mb-3">SELECT STORAGE AREAS</Text>
                  {addAreaOptions.length === 0 && (
                    <View className="items-center py-8">
                      <Text className="text-sm text-gray-400">No storage areas found for this location.</Text>
                    </View>
                  )}
                  {addAreaOptions.map((area) => {
                    const settings = addAreaSelections[area.id];
                    const selected = settings?.selected;
                    const alreadyExists = addExistingAreaIds.includes(area.id);
                    return (
                      <View key={area.id} className="bg-white border border-gray-100 rounded-2xl p-4 mb-3">
                        <TouchableOpacity
                          className="flex-row items-center justify-between"
                          onPress={() => toggleAddAreaSelection(area.id)}
                          disabled={alreadyExists}
                        >
                          <View className="flex-row items-center">
                            <Ionicons
                              name={selected ? 'checkbox' : 'square-outline'}
                              size={18}
                              color={alreadyExists ? colors.gray[300] : selected ? colors.primary[500] : colors.gray[400]}
                            />
                            <Text className="text-sm font-semibold text-gray-900 ml-2">
                              {area.icon ?? '📦'} {area.name}
                            </Text>
                          </View>
                          {alreadyExists ? (
                            <Text className="text-xs text-amber-600">Already added</Text>
                          ) : null}
                        </TouchableOpacity>

                        {selected && !alreadyExists && (
                          <View className="mt-4">
                            <Text className="text-xs text-gray-500 mb-2">Count in</Text>
                            <TouchableOpacity
                              className="border border-gray-200 rounded-xl px-3 py-2 flex-row items-center justify-between"
                              onPress={() => {
                                setAddUnitPickerTarget({ areaId: area.id, field: 'unit' });
                                setShowAddUnitPicker(true);
                              }}
                            >
                              <Text className="text-sm text-gray-900">{settings?.unit_type}</Text>
                              <Ionicons name="chevron-down" size={16} color={colors.gray[400]} />
                            </TouchableOpacity>

                            <View className="flex-row gap-3 mt-3">
                              <View className="flex-1">
                                <Text className="text-xs text-gray-500 mb-2">Min</Text>
                                <TextInput
                                  className="border border-gray-200 rounded-xl px-3 py-2 text-gray-900"
                                  keyboardType="number-pad"
                                  value={settings?.min}
                                  onChangeText={(value) =>
                                    setAddAreaSelections((prev) => ({
                                      ...prev,
                                      [area.id]: { ...prev[area.id], min: value },
                                    }))
                                  }
                                />
                              </View>
                              <View className="flex-1">
                                <Text className="text-xs text-gray-500 mb-2">Max</Text>
                                <TextInput
                                  className="border border-gray-200 rounded-xl px-3 py-2 text-gray-900"
                                  keyboardType="number-pad"
                                  value={settings?.max}
                                  onChangeText={(value) =>
                                    setAddAreaSelections((prev) => ({
                                      ...prev,
                                      [area.id]: { ...prev[area.id], max: value },
                                    }))
                                  }
                                />
                              </View>
                            </View>

                            <View className="flex-row items-center gap-3 mt-3">
                              <View className="flex-1">
                                <Text className="text-xs text-gray-500 mb-2">Order in</Text>
                                <TouchableOpacity
                                  className="border border-gray-200 rounded-xl px-3 py-2 flex-row items-center justify-between"
                                  onPress={() => {
                                    setAddUnitPickerTarget({ areaId: area.id, field: 'order' });
                                    setShowAddUnitPicker(true);
                                  }}
                                >
                                  <Text className="text-sm text-gray-900">{settings?.order_unit}</Text>
                                  <Ionicons name="chevron-down" size={16} color={colors.gray[400]} />
                                </TouchableOpacity>
                              </View>
                              <View className="flex-1">
                                <Text className="text-xs text-gray-500 mb-2">Conversion</Text>
                                <TextInput
                                  className="border border-gray-200 rounded-xl px-3 py-2 text-gray-900"
                                  keyboardType="number-pad"
                                  value={settings?.conversion}
                                  onChangeText={(value) =>
                                    setAddAreaSelections((prev) => ({
                                      ...prev,
                                      [area.id]: { ...prev[area.id], conversion: value },
                                    }))
                                  }
                                />
                              </View>
                            </View>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </>
              )}
            </ScrollView>

            <View className="bg-white border-t border-gray-200 px-4 py-4">
              {addStep === 'create' && (
                <TouchableOpacity
                  className="rounded-xl py-4 items-center bg-primary-500"
                  onPress={handleContinueToAreas}
                >
                  <Text className="text-white font-bold text-lg">Continue →</Text>
                </TouchableOpacity>
              )}
              {addStep === 'assign' && (
                <TouchableOpacity
                  className={`rounded-xl py-4 items-center ${isSubmitting ? 'bg-primary-300' : 'bg-primary-500'}`}
                  onPress={handleAddItemFlow}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <SpinningFish size="small" />
                  ) : (
                    <Text className="text-white font-bold text-lg">Add Item</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* Add Item Unit Picker */}
      <Modal
        visible={showAddUnitPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAddUnitPicker(false)}
      >
        <View className="flex-1 bg-black/40 justify-end">
          <View className="bg-white rounded-t-2xl p-4">
            <Text className="text-base font-semibold text-gray-900 mb-2">
              Select {addUnitPickerTarget?.field === 'order' ? 'Order Unit' : 'Count Unit'}
            </Text>
            {(addUnitPickerTarget?.field === 'order' ? ORDER_UNITS : COUNT_UNITS).map((unit) => (
              <TouchableOpacity
                key={unit}
                className="py-3"
                onPress={() => {
                  if (!addUnitPickerTarget) return;
                  if (addUnitPickerTarget.areaId === 'bulk') {
                    setBulkMoveSettings((prev) => ({
                      ...prev,
                      unit_type: unit,
                    }));
                  } else {
                    setAddAreaSelections((prev) => ({
                      ...prev,
                      [addUnitPickerTarget.areaId]: {
                        ...(prev[addUnitPickerTarget.areaId] || {
                          selected: true,
                          unit_type: 'each',
                          min: '',
                          max: '',
                          order_unit: 'case',
                          conversion: '',
                        }),
                        [addUnitPickerTarget.field === 'order' ? 'order_unit' : 'unit_type']: unit,
                      },
                    }));
                  }
                  setShowAddUnitPicker(false);
                }}
              >
                <Text className="text-sm text-gray-700">{unit}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity className="py-3 items-center" onPress={() => setShowAddUnitPicker(false)}>
              <Text className="text-sm font-semibold text-primary-500">Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
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
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
