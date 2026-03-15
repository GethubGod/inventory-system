import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useShallow } from 'zustand/react/shallow';
import { BrandLogo, GlassSurface, HeaderCartButton, LoadingIndicator, LocationSelectorButton } from '@/components';
import { CATEGORY_LABELS, colors, SUPPLIER_CATEGORY_LABELS } from '@/constants';
import {
  categoryGlassTints,
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassSpacing,
  glassTabBarHeight,
  glassTypography,
} from '@/design/tokens';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { useAuthStore, useInventoryStore, useOrderStore } from '@/store';
import type {
  InventoryItem,
  ItemCategory,
  Location,
  SupplierCategory,
} from '@/types';
import {
  fetchLocationOrderInsights,
  formatOrderDayLabel,
  getItemSupplierLabel,
  summarizeOrderItems,
  type HistoricalOrderSummary,
  type PredictedOrderItem,
} from '@/features/ordering/orderInsights';
import { fetchActiveLocationReminder, type LocationReminderBanner } from '@/services/locationReminderService';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const CATEGORY_ORDER: ItemCategory[] = [
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

const CATEGORY_SHORT_LABELS: Record<ItemCategory, string> = {
  fish: 'Fish',
  protein: 'Protein',
  produce: 'Produce',
  dry: 'Dry',
  dairy_cold: 'Dairy',
  frozen: 'Frozen',
  sauces: 'Sauces',
  alcohol: 'Alcohol',
  packaging: 'Packaging',
};

interface SuggestedItemCardProps {
  item: PredictedOrderItem;
  onAdd: (item: PredictedOrderItem) => void;
}

const SuggestedItemCard = memo(function SuggestedItemCard({
  item,
  onAdd,
}: SuggestedItemCardProps) {
  const ds = useScaledStyles();

  return (
    <GlassSurface
      intensity="subtle"
      style={{
        width: ds.spacing(168),
        borderRadius: glassRadii.surface,
      }}
    >
      <View style={{ padding: ds.spacing(14) }}>
        <Text
          style={{
            fontSize: ds.fontSize(15),
            fontWeight: '600',
            color: glassColors.textPrimary,
          }}
          numberOfLines={2}
        >
          {item.name}
        </Text>
        <Text
          style={{
            marginTop: ds.spacing(4),
            fontSize: ds.fontSize(12),
            color: glassColors.textSecondary,
          }}
          numberOfLines={1}
        >
          {item.quantity} {item.unitType === 'base' ? item.baseUnit : item.packUnit}
          {' · '}
          {getItemSupplierLabel(item)}
        </Text>
        <TouchableOpacity
          onPress={() => onAdd(item)}
          style={{
            marginTop: ds.spacing(12),
            minHeight: Math.max(38, ds.buttonH - ds.spacing(8)),
            borderRadius: glassRadii.button,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: glassColors.accent,
          }}
          activeOpacity={0.85}
        >
          <Text
            style={{
              color: glassColors.textOnPrimary,
              fontSize: ds.fontSize(13),
              fontWeight: '700',
            }}
          >
            Add
          </Text>
        </TouchableOpacity>
      </View>
    </GlassSurface>
  );
});

interface BrowsePreviewRowProps {
  item: InventoryItem;
  onAdd: (item: InventoryItem) => void;
}

const BrowsePreviewRow = memo(function BrowsePreviewRow({
  item,
  onAdd,
}: BrowsePreviewRowProps) {
  const ds = useScaledStyles();

  return (
    <View
      style={{
        backgroundColor: glassColors.background,
        borderWidth: glassHairlineWidth,
        borderColor: glassColors.cardBorder,
        borderRadius: glassRadii.button,
        paddingHorizontal: ds.spacing(12),
        paddingVertical: ds.spacing(10),
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <View style={{ flex: 1, paddingRight: ds.spacing(10) }}>
        <Text
          style={{
            fontSize: ds.fontSize(14),
            fontWeight: '600',
            color: glassColors.textPrimary,
          }}
          numberOfLines={1}
        >
          {item.name}
        </Text>
        <Text
          style={{
            marginTop: ds.spacing(2),
            fontSize: ds.fontSize(12),
            color: glassColors.textSecondary,
          }}
          numberOfLines={1}
        >
          {CATEGORY_SHORT_LABELS[item.category]} · per {item.pack_unit}
        </Text>
      </View>
      <TouchableOpacity
        onPress={() => onAdd(item)}
        style={{
          borderRadius: glassRadii.button,
          backgroundColor: glassColors.accent,
          paddingHorizontal: ds.spacing(14),
          paddingVertical: ds.spacing(7),
        }}
        activeOpacity={0.85}
      >
        <Text
          style={{
            color: glassColors.textOnPrimary,
            fontSize: ds.fontSize(12),
            fontWeight: '700',
          }}
        >
          Add
        </Text>
      </TouchableOpacity>
    </View>
  );
});

interface ExpandedBrowseRowProps {
  item: InventoryItem;
  onAdd: (item: InventoryItem) => void;
}

const ExpandedBrowseRow = memo(function ExpandedBrowseRow({
  item,
  onAdd,
}: ExpandedBrowseRowProps) {
  const ds = useScaledStyles();

  return (
    <GlassSurface
      intensity="subtle"
      style={{
        borderRadius: glassRadii.surface,
      }}
    >
      <View
        style={{
          paddingHorizontal: ds.spacing(14),
          paddingVertical: ds.spacing(12),
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flex: 1, paddingRight: ds.spacing(12) }}>
          <Text
            style={{
              fontSize: ds.fontSize(15),
              fontWeight: '600',
              color: glassColors.textPrimary,
            }}
            numberOfLines={2}
          >
            {item.name}
          </Text>
          <Text
            style={{
              marginTop: ds.spacing(3),
              fontSize: ds.fontSize(12),
              color: glassColors.textSecondary,
            }}
            numberOfLines={1}
          >
            {CATEGORY_LABELS[item.category]} · per {item.pack_unit}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => onAdd(item)}
          style={{
            minWidth: ds.spacing(72),
            borderRadius: glassRadii.button,
            backgroundColor: glassColors.accent,
            paddingHorizontal: ds.spacing(14),
            paddingVertical: ds.spacing(8),
            alignItems: 'center',
          }}
          activeOpacity={0.85}
        >
          <Text
            style={{
              color: glassColors.textOnPrimary,
              fontSize: ds.fontSize(13),
              fontWeight: '700',
            }}
          >
            Add
          </Text>
        </TouchableOpacity>
      </View>
    </GlassSurface>
  );
});

function getGreeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) {
    return 'Good morning';
  }
  if (hour < 18) {
    return 'Good afternoon';
  }
  return 'Good evening';
}

function formatHeaderDate(now: Date): string {
  return now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function formatReminderDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function EmployeeHomeScreen() {
  const ds = useScaledStyles();
  const searchInputRef = useRef<TextInput>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  const [browseExpanded, setBrowseExpanded] = useState(false);
  const [browseCategory, setBrowseCategory] = useState<ItemCategory | null>(null);
  const [browseSearchQuery, setBrowseSearchQuery] = useState('');
  const [focusSearchOnExpand, setFocusSearchOnExpand] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [predictedItems, setPredictedItems] = useState<PredictedOrderItem[]>([]);
  const [reorderOrder, setReorderOrder] = useState<HistoricalOrderSummary | null>(null);
  const [activeReminder, setActiveReminder] = useState<LocationReminderBanner | null>(null);
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState<ItemCategory>('dry');
  const [newItemSupplierCategory, setNewItemSupplierCategory] =
    useState<SupplierCategory>('main_distributor');
  const [newItemBaseUnit, setNewItemBaseUnit] = useState('');
  const [newItemPackUnit, setNewItemPackUnit] = useState('');
  const [newItemPackSize, setNewItemPackSize] = useState('');
  const [isSubmittingItem, setIsSubmittingItem] = useState(false);
  const {
    location,
    locations,
    setLocation,
    fetchLocations,
    user,
  } = useAuthStore(
    useShallow((state) => ({
      location: state.location,
      locations: state.locations,
      setLocation: state.setLocation,
      fetchLocations: state.fetchLocations,
      user: state.user,
    })),
  );
  const {
    items,
    isLoading: itemsLoading,
    fetchItems,
    addItem,
  } = useInventoryStore(
    useShallow((state) => ({
      items: state.items,
      isLoading: state.isLoading,
      fetchItems: state.fetchItems,
      addItem: state.addItem,
    })),
  );
  const {
    addToCart,
    getLocationCartTotal,
    totalCartCount,
  } = useOrderStore(
    useShallow((state) => ({
      addToCart: state.addToCart,
      getLocationCartTotal: state.getLocationCartTotal,
      totalCartCount: state.getTotalCartCount('employee'),
    })),
  );

  useEffect(() => {
    void fetchItems();
    void fetchLocations();
  }, [fetchItems, fetchLocations]);

  useEffect(() => {
    if (locations.length > 0 && !location) {
      setLocation(locations[0]);
    }
  }, [location, locations, setLocation]);

  const loadHomeData = useCallback(async () => {
    if (!location?.id) {
      setPredictedItems([]);
      setReorderOrder(null);
      setActiveReminder(null);
      setInsightsLoading(false);
      return;
    }

    setInsightsLoading(true);
    try {
      const [insights, reminder] = await Promise.all([
        fetchLocationOrderInsights(location.id),
        fetchActiveLocationReminder(location.id),
      ]);
      setPredictedItems(insights.predictedItems);
      setReorderOrder(insights.reorderOrder);
      setActiveReminder(reminder);
    } catch (error) {
      console.error('Unable to load home insights', error);
      setPredictedItems([]);
      setReorderOrder(null);
      setActiveReminder(null);
    } finally {
      setInsightsLoading(false);
    }
  }, [location?.id]);

  useFocusEffect(
    useCallback(() => {
      void loadHomeData();
    }, [loadHomeData]),
  );

  useEffect(() => {
    if (!browseExpanded || !focusSearchOnExpand) {
      return;
    }

    const timer = setTimeout(() => {
      searchInputRef.current?.focus();
      setFocusSearchOnExpand(false);
    }, 220);

    return () => clearTimeout(timer);
  }, [browseExpanded, focusSearchOnExpand]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchItems({ force: true });
    await loadHomeData();
    setRefreshing(false);
  }, [fetchItems, loadHomeData]);

  const allItemsSorted = useMemo(
    () => [...items].sort((left, right) => left.name.localeCompare(right.name)),
    [items],
  );

  const filteredBrowseItems = useMemo(
    () =>
      allItemsSorted.filter((item) => {
        const matchesCategory =
          !browseCategory || item.category === browseCategory;
        const matchesSearch =
          browseSearchQuery.trim().length === 0 ||
          item.name.toLowerCase().includes(browseSearchQuery.trim().toLowerCase());
        return matchesCategory && matchesSearch;
      }),
    [allItemsSorted, browseCategory, browseSearchQuery],
  );

  const previewItems = useMemo(
    () => filteredBrowseItems.slice(0, 2),
    [filteredBrowseItems],
  );

  const homeDate = useMemo(() => new Date(), []);
  const greeting = getGreeting(homeDate);
  const headerSubtitle = `${location?.name || 'Select Location'} · ${formatHeaderDate(homeDate)}`;
  const browseSubtitle = `${items.length} items across ${CATEGORY_ORDER.length} categories`;
  const visibleCollapsedCategories = CATEGORY_ORDER.slice(0, 4);
  const moreCategoryCount = Math.max(CATEGORY_ORDER.length - visibleCollapsedCategories.length, 0);
  const emptyBrowseResults =
    browseExpanded &&
    !itemsLoading &&
    filteredBrowseItems.length === 0 &&
    browseSearchQuery.trim().length > 0;

  const triggerLightHaptic = useCallback(() => {
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);

  const toggleLocationDropdown = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowLocationDropdown((previous) => !previous);
  }, []);

  const handleSelectLocation = useCallback(
    (selectedLocation: Location) => {
      triggerLightHaptic();
      setLocation(selectedLocation);
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setShowLocationDropdown(false);
    },
    [setLocation, triggerLightHaptic],
  );

  const handleExpandBrowse = useCallback(
    (nextCategory: ItemCategory | null = browseCategory, focusSearch = false) => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setBrowseCategory(nextCategory);
      setBrowseExpanded(true);
      setFocusSearchOnExpand(focusSearch);
      if (!focusSearch) {
        searchInputRef.current?.blur();
      }
    },
    [browseCategory],
  );

  const handleCollapseBrowse = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setBrowseExpanded(false);
    setBrowseSearchQuery('');
  }, []);

  const handleAddInventoryItem = useCallback(
    (item: InventoryItem) => {
      if (!location?.id) {
        Alert.alert('Select a location', 'Choose a location before adding items.');
        return;
      }

      addToCart(location.id, item.id, 1, 'pack', {
        context: 'employee',
        inputMode: 'quantity',
        quantityRequested: 1,
      });
      triggerLightHaptic();
    },
    [addToCart, location?.id, triggerLightHaptic],
  );

  const handleAddPredictedItem = useCallback(
    (item: PredictedOrderItem) => {
      if (!location?.id) {
        Alert.alert('Select a location', 'Choose a location before adding items.');
        return;
      }

      addToCart(location.id, item.inventoryItemId, item.quantity, item.unitType, {
        context: 'employee',
        inputMode: 'quantity',
        quantityRequested: item.quantity,
        note: item.note,
      });
      triggerLightHaptic();
    },
    [addToCart, location?.id, triggerLightHaptic],
  );

  const handleAddAllPredicted = useCallback(() => {
    predictedItems.forEach((item) => {
      handleAddPredictedItem(item);
    });
  }, [handleAddPredictedItem, predictedItems]);

  const handleReorderOrder = useCallback(
    (order: HistoricalOrderSummary) => {
      if (!location?.id) {
        Alert.alert('Select a location', 'Choose a location before reordering.');
        return;
      }

      order.items.forEach((item) => {
        addToCart(location.id, item.inventoryItemId, item.quantity, item.unitType, {
          context: 'employee',
          inputMode: 'quantity',
          quantityRequested: item.quantity,
          note: item.note,
        });
      });
      triggerLightHaptic();
    },
    [addToCart, location?.id, triggerLightHaptic],
  );

  const resetNewItemForm = useCallback(() => {
    setNewItemName(browseSearchQuery.trim());
    setNewItemCategory('dry');
    setNewItemSupplierCategory('main_distributor');
    setNewItemBaseUnit('');
    setNewItemPackUnit('');
    setNewItemPackSize('');
  }, [browseSearchQuery]);

  const handleOpenAddItemModal = useCallback(() => {
    resetNewItemForm();
    setShowAddItemModal(true);
  }, [resetNewItemForm]);

  const handleAddNewItem = useCallback(async () => {
    if (!newItemName.trim()) {
      Alert.alert('Error', 'Please enter an item name');
      return;
    }
    if (!newItemBaseUnit.trim()) {
      Alert.alert('Error', 'Please enter a base unit');
      return;
    }
    if (!newItemPackUnit.trim()) {
      Alert.alert('Error', 'Please enter a pack unit');
      return;
    }
    if (!newItemPackSize.trim() || Number.isNaN(Number.parseFloat(newItemPackSize))) {
      Alert.alert('Error', 'Please enter a valid pack size');
      return;
    }

    setIsSubmittingItem(true);
    try {
      const createdItem = await addItem({
        name: newItemName.trim(),
        category: newItemCategory,
        supplier_category: newItemSupplierCategory,
        base_unit: newItemBaseUnit.trim(),
        pack_unit: newItemPackUnit.trim(),
        pack_size: Number.parseFloat(newItemPackSize),
        created_by: user?.id,
      });

      setShowAddItemModal(false);
      setBrowseExpanded(true);
      setBrowseSearchQuery(createdItem.name);
      Alert.alert('Success', `"${createdItem.name}" has been added to the inventory.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to add item';
      Alert.alert('Error', message);
    } finally {
      setIsSubmittingItem(false);
    }
  }, [
    addItem,
    newItemBaseUnit,
    newItemCategory,
    newItemName,
    newItemPackSize,
    newItemPackUnit,
    newItemSupplierCategory,
    user?.id,
  ]);

  const renderSuggestedItem = useCallback(
    ({ item }: { item: PredictedOrderItem }) => (
      <SuggestedItemCard item={item} onAdd={handleAddPredictedItem} />
    ),
    [handleAddPredictedItem],
  );

  const renderExpandedBrowseItem = useCallback(
    ({ item }: { item: InventoryItem }) => (
      <ExpandedBrowseRow item={item} onAdd={handleAddInventoryItem} />
    ),
    [handleAddInventoryItem],
  );

  const renderExpandedHeader = useCallback(
    () => (
      <View>
        <View
          style={{
            paddingHorizontal: glassSpacing.screen,
            paddingTop: ds.spacing(8),
            paddingBottom: ds.spacing(10),
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <GlassSurface
            intensity="medium"
            style={{
              width: Math.max(44, ds.icon(40)),
              height: Math.max(44, ds.icon(40)),
              borderRadius: glassRadii.round,
            }}
          >
            <TouchableOpacity
              onPress={handleCollapseBrowse}
              className="flex-1 items-center justify-center"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons
                name="arrow-back"
                size={ds.icon(20)}
                color={glassColors.textPrimary}
              />
            </TouchableOpacity>
          </GlassSurface>
          <View style={{ flex: 1, marginLeft: ds.spacing(14) }}>
            <Text
              style={{
                fontSize: ds.fontSize(32),
                fontWeight: '800',
                color: glassColors.textPrimary,
                letterSpacing: -0.5,
              }}
            >
              Browse inventory
            </Text>
            <Text
              style={{
                marginTop: 4,
                fontSize: ds.fontSize(13),
                color: glassColors.textSecondary,
              }}
            >
              {filteredBrowseItems.length} items
              {browseCategory ? '' : ' · sorted A-Z'}
            </Text>
          </View>
          <HeaderCartButton
            count={totalCartCount}
            onPress={() => router.push('/cart')}
          />
        </View>

        <View style={{ paddingHorizontal: glassSpacing.screen }}>
          <GlassSurface
            intensity="medium"
            style={{
              borderRadius: glassRadii.search,
              paddingHorizontal: ds.spacing(20),
              height: Math.max(50, ds.buttonH + 8),
            }}
          >
            <View className="flex-1 flex-row items-center">
              <Ionicons
                name="search-outline"
                size={ds.icon(22)}
                color={glassColors.textSecondary}
              />
              <TextInput
                ref={searchInputRef}
                className="flex-1 ml-3"
                style={{
                  fontSize: ds.fontSize(16),
                  color: glassColors.textPrimary,
                }}
                placeholder="Search all items..."
                placeholderTextColor={glassColors.textMuted}
                value={browseSearchQuery}
                onChangeText={setBrowseSearchQuery}
                autoCapitalize="none"
              />
              {browseSearchQuery.length > 0 ? (
                <TouchableOpacity
                  onPress={() => setBrowseSearchQuery('')}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons
                    name="close-circle"
                    size={ds.icon(20)}
                    color={glassColors.textSecondary}
                  />
                </TouchableOpacity>
              ) : null}
            </View>
          </GlassSurface>
        </View>

        <View
          style={{
            paddingHorizontal: glassSpacing.screen,
            paddingTop: ds.spacing(14),
            paddingBottom: ds.spacing(8),
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: ds.spacing(8),
          }}
        >
          <TouchableOpacity
            onPress={() => setBrowseCategory(null)}
            style={{
              paddingHorizontal: ds.spacing(16),
              paddingVertical: ds.spacing(10),
              borderRadius: glassRadii.pill,
              backgroundColor:
                browseCategory === null
                  ? glassColors.accent
                  : glassColors.mediumFill,
            }}
          >
            <Text
              style={{
                fontSize: ds.fontSize(13),
                fontWeight: '600',
                color:
                  browseCategory === null
                    ? glassColors.textOnPrimary
                    : glassColors.textPrimary,
              }}
            >
              All
            </Text>
          </TouchableOpacity>
          {CATEGORY_ORDER.map((category) => {
            const isSelected = browseCategory === category;
            const tint = categoryGlassTints[category];
            return (
              <TouchableOpacity
                key={category}
                onPress={() => setBrowseCategory(isSelected ? null : category)}
                style={{
                  paddingHorizontal: ds.spacing(16),
                  paddingVertical: ds.spacing(10),
                  borderRadius: glassRadii.pill,
                  backgroundColor: isSelected ? tint.icon : tint.background,
                }}
              >
                <Text
                  style={{
                    fontSize: ds.fontSize(13),
                    fontWeight: '600',
                    color: isSelected ? glassColors.textOnPrimary : tint.icon,
                  }}
                >
                  {CATEGORY_LABELS[category]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {emptyBrowseResults ? (
          <View
            style={{
              paddingHorizontal: glassSpacing.screen,
              paddingTop: ds.spacing(10),
              paddingBottom: ds.spacing(16),
            }}
          >
            <GlassSurface
              intensity="subtle"
              style={{
                borderRadius: glassRadii.surface,
                padding: ds.spacing(16),
                alignItems: 'center',
              }}
            >
              <Ionicons
                name="cube-outline"
                size={ds.icon(36)}
                color={glassColors.textSecondary}
              />
              <Text
                style={{
                  marginTop: ds.spacing(12),
                  fontSize: ds.fontSize(15),
                  fontWeight: '600',
                  color: glassColors.textPrimary,
                }}
              >
                No items match your search
              </Text>
              <TouchableOpacity
                onPress={handleOpenAddItemModal}
                style={{
                  marginTop: ds.spacing(14),
                  minHeight: ds.buttonH,
                  borderRadius: glassRadii.button,
                  paddingHorizontal: ds.spacing(16),
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  backgroundColor: glassColors.accent,
                }}
              >
                <Ionicons
                  name="add-circle-outline"
                  size={ds.icon(18)}
                  color={glassColors.textOnPrimary}
                />
                <Text
                  style={{
                    marginLeft: ds.spacing(8),
                    fontSize: ds.buttonFont,
                    fontWeight: '700',
                    color: glassColors.textOnPrimary,
                  }}
                >
                  Add Missing Item
                </Text>
              </TouchableOpacity>
            </GlassSurface>
          </View>
        ) : null}
      </View>
    ),
    [
      browseCategory,
      browseSearchQuery,
      ds,
      filteredBrowseItems.length,
      handleCollapseBrowse,
      handleOpenAddItemModal,
      totalCartCount,
      emptyBrowseResults,
    ],
  );

  if ((itemsLoading && items.length === 0) || (insightsLoading && !location)) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: glassColors.background }}
        edges={['top', 'left', 'right']}
      >
        <View className="flex-1 items-center justify-center">
          <LoadingIndicator showText text="Loading home..." />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: glassColors.background }}
      edges={['top', 'left', 'right']}
    >
      {browseExpanded ? (
        <FlatList
          data={filteredBrowseItems}
          keyExtractor={(item) => item.id}
          renderItem={renderExpandedBrowseItem}
          ListHeaderComponent={renderExpandedHeader}
          contentContainerStyle={{
            paddingHorizontal: glassSpacing.screen,
            paddingBottom: glassTabBarHeight + ds.spacing(20),
            gap: ds.spacing(12),
          }}
          keyboardShouldPersistTaps="handled"
          removeClippedSubviews={Platform.OS === 'android'}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={10}
        />
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: glassSpacing.screen,
            paddingBottom: glassTabBarHeight + ds.spacing(24),
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={glassColors.accent}
            />
          }
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ paddingTop: ds.spacing(8), paddingBottom: ds.spacing(10) }}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
              }}
            >
              <View style={{ flex: 1, paddingRight: ds.spacing(12) }}>
                <Text
                  style={{
                    fontSize: ds.fontSize(32),
                    fontWeight: '800',
                    color: glassColors.textPrimary,
                    letterSpacing: -0.5,
                  }}
                >
                  {greeting}
                </Text>
                <Text
                  style={{
                    marginTop: ds.spacing(6),
                    fontSize: ds.fontSize(14),
                    color: glassColors.textSecondary,
                  }}
                >
                  {headerSubtitle}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <View
                  className="flex-row items-center"
                  style={{ marginBottom: ds.spacing(10) }}
                >
                  <LocationSelectorButton
                    label={location?.name || 'Select Location'}
                    expanded={showLocationDropdown}
                    onPress={toggleLocationDropdown}
                  />
                  <HeaderCartButton
                    count={totalCartCount}
                    onPress={() => router.push('/cart')}
                  />
                </View>
              </View>
            </View>

            {showLocationDropdown ? (
              <GlassSurface
                intensity="strong"
                style={{
                  marginTop: ds.spacing(2),
                  borderRadius: glassRadii.surface,
                }}
              >
                <View>
                  {locations.map((loc, index) => {
                    const isSelected = location?.id === loc.id;
                    const cartCount = getLocationCartTotal(loc.id);

                    return (
                      <TouchableOpacity
                        key={loc.id}
                        onPress={() => handleSelectLocation(loc)}
                        activeOpacity={0.7}
                        className="flex-row items-center justify-between"
                        style={{
                          minHeight: ds.rowH,
                          paddingHorizontal: ds.spacing(16),
                          paddingVertical: ds.spacing(12),
                          borderTopWidth: index > 0 ? glassHairlineWidth : 0,
                          borderTopColor: glassColors.divider,
                        }}
                      >
                        <View className="flex-row items-center flex-1">
                          <View
                            style={{
                              width: ds.icon(32),
                              height: ds.icon(32),
                              marginRight: ds.spacing(12),
                              borderRadius: glassRadii.round,
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: isSelected
                                ? glassColors.accentSoft
                                : glassColors.mediumFill,
                            }}
                          >
                            <BrandLogo variant="inline" size={16} colorMode="light" />
                          </View>
                          <Text
                            style={{
                              fontSize: ds.fontSize(13),
                              fontWeight: isSelected ? '500' : '400',
                              color: isSelected
                                ? glassColors.accent
                                : glassColors.textPrimary,
                            }}
                          >
                            {loc.name}
                          </Text>
                        </View>
                        <View className="flex-row items-center">
                          {cartCount > 0 ? (
                            <Text
                              style={{
                                color: glassColors.textSecondary,
                                fontSize: ds.fontSize(11),
                                marginRight: ds.spacing(8),
                              }}
                            >
                              {cartCount} items
                            </Text>
                          ) : null}
                          {isSelected ? (
                            <Ionicons
                              name="checkmark"
                              size={ds.icon(18)}
                              color={glassColors.accent}
                            />
                          ) : null}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </GlassSurface>
            ) : null}
          </View>

          {activeReminder ? (
            <GlassSurface
              intensity="medium"
              style={{
                borderRadius: glassRadii.surface,
                paddingHorizontal: ds.spacing(14),
                paddingVertical: ds.spacing(12),
                marginBottom: ds.spacing(14),
                backgroundColor: colors.primary[50],
                borderColor: colors.primary[100],
                borderWidth: 1,
              }}
            >
              <View className="flex-row items-start">
                <View
                  style={{
                    width: ds.icon(34),
                    height: ds.icon(34),
                    borderRadius: glassRadii.iconTile,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: glassColors.accentSoft,
                    marginRight: ds.spacing(12),
                  }}
                >
                  <Ionicons
                    name="notifications-outline"
                    size={ds.icon(18)}
                    color={glassColors.accent}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <View className="flex-row items-center justify-between">
                    <Text
                      style={{
                        fontSize: ds.fontSize(12),
                        fontWeight: '600',
                        color: glassColors.accent,
                        textTransform: 'uppercase',
                        letterSpacing: 0.8,
                      }}
                    >
                      Order reminder
                    </Text>
                    <Text
                      style={{
                        fontSize: ds.fontSize(11),
                        color: glassColors.textSecondary,
                      }}
                    >
                      {activeReminder.senderName || `Updated ${formatReminderDate(activeReminder.createdAt)}`}
                    </Text>
                  </View>
                  <Text
                    style={{
                      marginTop: ds.spacing(6),
                      fontSize: ds.fontSize(14),
                      color: glassColors.textPrimary,
                      lineHeight: ds.fontSize(20),
                    }}
                  >
                    {activeReminder.message}
                  </Text>
                </View>
              </View>
            </GlassSurface>
          ) : null}

          <TouchableOpacity
            onPress={() => handleExpandBrowse(browseCategory, true)}
            activeOpacity={0.85}
          >
            <GlassSurface
              intensity="medium"
              style={{
                borderRadius: glassRadii.search,
                paddingHorizontal: ds.spacing(20),
                height: Math.max(50, ds.buttonH + 8),
              }}
            >
              <View className="flex-1 flex-row items-center">
                <Ionicons
                  name="search-outline"
                  size={ds.icon(22)}
                  color={glassColors.textSecondary}
                />
                <Text
                  style={{
                    marginLeft: ds.spacing(12),
                    fontSize: ds.fontSize(16),
                    color: glassColors.textMuted,
                  }}
                >
                  Search all {items.length} items...
                </Text>
              </View>
            </GlassSurface>
          </TouchableOpacity>

          {predictedItems.length > 0 ? (
            <View style={{ marginTop: ds.spacing(20) }}>
              <View className="flex-row items-center justify-between">
                <Text
                  style={{
                    color: glassColors.textSecondary,
                    fontSize: glassTypography.sectionLabel,
                    fontWeight: '600',
                    letterSpacing: 1.5,
                    textTransform: 'uppercase',
                  }}
                >
                  Suggested For Today
                </Text>
                <TouchableOpacity onPress={handleAddAllPredicted}>
                  <Text
                    style={{
                      fontSize: ds.fontSize(13),
                      fontWeight: '600',
                      color: glassColors.accent,
                    }}
                  >
                    Add all
                  </Text>
                </TouchableOpacity>
              </View>
              <FlatList
                data={predictedItems}
                renderItem={renderSuggestedItem}
                keyExtractor={(item) => `${item.inventoryItemId}:${item.unitType}`}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                  paddingTop: ds.spacing(12),
                  gap: ds.spacing(10),
                }}
              />
            </View>
          ) : null}

          {reorderOrder ? (
            <View style={{ marginTop: ds.spacing(20) }}>
              <Text
                style={{
                  color: glassColors.textSecondary,
                  fontSize: glassTypography.sectionLabel,
                  fontWeight: '600',
                  letterSpacing: 1.5,
                  textTransform: 'uppercase',
                  marginBottom: ds.spacing(12),
                }}
              >
                Quick Actions
              </Text>
              <GlassSurface
                intensity="subtle"
                style={{ borderRadius: glassRadii.surface }}
              >
                <TouchableOpacity
                  onPress={() => handleReorderOrder(reorderOrder)}
                  className="flex-row items-center"
                  style={{
                    paddingHorizontal: ds.spacing(14),
                    paddingVertical: ds.spacing(14),
                  }}
                  activeOpacity={0.85}
                >
                  <View
                    style={{
                      width: ds.icon(36),
                      height: ds.icon(36),
                      borderRadius: glassRadii.iconTile,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: glassColors.accentSoft,
                      marginRight: ds.spacing(12),
                    }}
                  >
                    <Ionicons
                      name="star-outline"
                      size={ds.icon(18)}
                      color={glassColors.accent}
                    />
                  </View>
                  <View style={{ flex: 1, paddingRight: ds.spacing(10) }}>
                    <Text
                      style={{
                        fontSize: ds.fontSize(15),
                        fontWeight: '600',
                        color: glassColors.textPrimary,
                      }}
                    >
                      Reorder last {formatOrderDayLabel(reorderOrder.createdAt)}
                    </Text>
                    <Text
                      style={{
                        marginTop: ds.spacing(4),
                        fontSize: ds.fontSize(12),
                        color: glassColors.textSecondary,
                      }}
                      numberOfLines={1}
                    >
                      {reorderOrder.itemCount} items · {summarizeOrderItems(reorderOrder)}
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={ds.icon(18)}
                    color={glassColors.textSecondary}
                  />
                </TouchableOpacity>
              </GlassSurface>
            </View>
          ) : null}

          <View style={{ marginTop: ds.spacing(20) }}>
            <GlassSurface
              intensity="subtle"
              style={{ borderRadius: glassRadii.surface }}
            >
              <TouchableOpacity
                onPress={() => handleExpandBrowse(null, false)}
                activeOpacity={0.85}
                style={{
                  paddingHorizontal: ds.spacing(14),
                  paddingTop: ds.spacing(14),
                  paddingBottom: ds.spacing(12),
                }}
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center flex-1">
                    <View
                      style={{
                        width: ds.icon(36),
                        height: ds.icon(36),
                        borderRadius: glassRadii.iconTile,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: categoryGlassTints.produce.background,
                        marginRight: ds.spacing(12),
                      }}
                    >
                      <Ionicons
                        name="grid-outline"
                        size={ds.icon(18)}
                        color={categoryGlassTints.produce.icon}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          fontSize: ds.fontSize(16),
                          fontWeight: '600',
                          color: glassColors.textPrimary,
                        }}
                      >
                        Browse inventory
                      </Text>
                      <Text
                        style={{
                          marginTop: ds.spacing(4),
                          fontSize: ds.fontSize(13),
                          color: glassColors.textSecondary,
                        }}
                      >
                        {browseSubtitle}
                      </Text>
                    </View>
                  </View>
                  <View className="flex-row items-center">
                    <Text
                      style={{
                        fontSize: ds.fontSize(13),
                        color: glassColors.textSecondary,
                        marginRight: ds.spacing(4),
                      }}
                    >
                      Expand
                    </Text>
                    <Ionicons
                      name="chevron-down"
                      size={ds.icon(16)}
                      color={glassColors.textSecondary}
                    />
                  </View>
                </View>
              </TouchableOpacity>

              <View
                style={{
                  marginHorizontal: ds.spacing(14),
                  borderTopWidth: glassHairlineWidth,
                  borderTopColor: glassColors.divider,
                }}
              />

              <View
                style={{
                  paddingHorizontal: ds.spacing(14),
                  paddingTop: ds.spacing(12),
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: ds.spacing(8),
                }}
              >
                <TouchableOpacity
                  onPress={() => handleExpandBrowse(null, false)}
                  style={{
                    paddingHorizontal: ds.spacing(16),
                    paddingVertical: ds.spacing(9),
                    borderRadius: glassRadii.pill,
                    backgroundColor:
                      browseCategory === null
                        ? glassColors.accent
                        : glassColors.mediumFill,
                  }}
                >
                  <Text
                    style={{
                      fontSize: ds.fontSize(13),
                      fontWeight: '600',
                      color:
                        browseCategory === null
                          ? glassColors.textOnPrimary
                          : glassColors.textPrimary,
                    }}
                  >
                    All
                  </Text>
                </TouchableOpacity>
                {visibleCollapsedCategories.map((category) => {
                  const tint = categoryGlassTints[category];
                  return (
                    <TouchableOpacity
                      key={category}
                      onPress={() => handleExpandBrowse(category, false)}
                      style={{
                        paddingHorizontal: ds.spacing(16),
                        paddingVertical: ds.spacing(9),
                        borderRadius: glassRadii.pill,
                        backgroundColor: tint.background,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: ds.fontSize(13),
                          fontWeight: '600',
                          color: tint.icon,
                        }}
                      >
                        {CATEGORY_SHORT_LABELS[category]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                {moreCategoryCount > 0 ? (
                  <TouchableOpacity
                    onPress={() => handleExpandBrowse(null, false)}
                    style={{
                      paddingHorizontal: ds.spacing(16),
                      paddingVertical: ds.spacing(9),
                      borderRadius: glassRadii.pill,
                      backgroundColor: glassColors.mediumFill,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: ds.fontSize(13),
                        fontWeight: '600',
                        color: glassColors.textPrimary,
                      }}
                    >
                      +{moreCategoryCount} more
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              <View
                style={{
                  paddingHorizontal: ds.spacing(14),
                  paddingTop: ds.spacing(12),
                  gap: ds.spacing(8),
                }}
              >
                {previewItems.map((item) => (
                  <BrowsePreviewRow
                    key={item.id}
                    item={item}
                    onAdd={handleAddInventoryItem}
                  />
                ))}
              </View>

              <TouchableOpacity
                onPress={() => handleExpandBrowse(null, false)}
                activeOpacity={0.8}
                style={{
                  alignItems: 'center',
                  paddingTop: ds.spacing(12),
                  paddingBottom: ds.spacing(14),
                }}
              >
                <Text
                  style={{
                    fontSize: ds.fontSize(12),
                    color: glassColors.textSecondary,
                  }}
                >
                  Showing {previewItems.length} of {filteredBrowseItems.length}{' '}
                  <Text
                    style={{
                      color: glassColors.accent,
                      fontWeight: '600',
                    }}
                  >
                    View all
                  </Text>
                </Text>
              </TouchableOpacity>
            </GlassSurface>
          </View>
        </ScrollView>
      )}

      <Modal
        visible={showAddItemModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowAddItemModal(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: glassColors.background }}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            className="flex-1"
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: ds.spacing(16),
                paddingVertical: ds.spacing(14),
                borderBottomWidth: glassHairlineWidth,
                borderBottomColor: glassColors.divider,
                backgroundColor: glassColors.background,
              }}
            >
              <TouchableOpacity
                onPress={() => setShowAddItemModal(false)}
                style={{ minHeight: 44, justifyContent: 'center' }}
              >
                <Text
                  style={{
                    fontSize: ds.fontSize(14),
                    color: glassColors.accent,
                    fontWeight: '500',
                  }}
                >
                  Cancel
                </Text>
              </TouchableOpacity>
              <Text
                style={{
                  fontSize: ds.fontSize(24),
                  color: glassColors.textPrimary,
                  fontWeight: '700',
                }}
              >
                Add New Item
              </Text>
              <View style={{ width: ds.spacing(56) }} />
            </View>

            <ScrollView
              className="flex-1"
              contentContainerStyle={{
                padding: ds.spacing(16),
                paddingBottom: ds.spacing(40),
              }}
              keyboardShouldPersistTaps="handled"
            >
              <View style={{ marginBottom: ds.spacing(16) }}>
                <Text
                  style={{
                    fontSize: ds.fontSize(14),
                    marginBottom: ds.spacing(8),
                    color: glassColors.textPrimary,
                    fontWeight: '500',
                  }}
                >
                  Item Name *
                </Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g., Salmon (Sushi Grade)"
                  placeholderTextColor={colors.gray[400]}
                  value={newItemName}
                  onChangeText={setNewItemName}
                />
              </View>

              <View style={{ marginBottom: ds.spacing(16) }}>
                <Text
                  style={{
                    fontSize: ds.fontSize(14),
                    marginBottom: ds.spacing(8),
                    color: glassColors.textPrimary,
                    fontWeight: '500',
                  }}
                >
                  Category *
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ds.spacing(8) }}>
                  {CATEGORY_ORDER.map((category) => {
                    const isSelected = newItemCategory === category;
                    const tint = categoryGlassTints[category];
                    return (
                      <TouchableOpacity
                        key={category}
                        onPress={() => setNewItemCategory(category)}
                        style={{
                          minHeight: Math.max(40, ds.buttonH - ds.spacing(8)),
                          paddingHorizontal: ds.spacing(12),
                          paddingVertical: ds.spacing(8),
                          borderRadius: glassRadii.button,
                          backgroundColor: isSelected ? tint.icon : tint.background,
                          borderWidth: glassHairlineWidth,
                          borderColor: isSelected ? tint.icon : glassColors.cardBorder,
                          justifyContent: 'center',
                        }}
                      >
                        <Text
                          style={{
                            color: isSelected ? glassColors.textOnPrimary : tint.icon,
                            fontSize: ds.fontSize(14),
                            fontWeight: '500',
                          }}
                        >
                          {CATEGORY_LABELS[category]}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={{ marginBottom: ds.spacing(16) }}>
                <Text
                  style={{
                    fontSize: ds.fontSize(14),
                    marginBottom: ds.spacing(8),
                    color: glassColors.textPrimary,
                    fontWeight: '500',
                  }}
                >
                  Supplier *
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ds.spacing(8) }}>
                  {(
                    Object.entries(SUPPLIER_CATEGORY_LABELS) as [
                      SupplierCategory,
                      string,
                    ][]
                  ).map(([value, label]) => {
                    const isSelected = newItemSupplierCategory === value;
                    return (
                      <TouchableOpacity
                        key={value}
                        onPress={() => setNewItemSupplierCategory(value)}
                        style={{
                          minHeight: Math.max(40, ds.buttonH - ds.spacing(8)),
                          paddingHorizontal: ds.spacing(12),
                          paddingVertical: ds.spacing(8),
                          borderRadius: glassRadii.button,
                          backgroundColor: isSelected
                            ? glassColors.accent
                            : glassColors.mediumFill,
                          borderWidth: glassHairlineWidth,
                          borderColor: isSelected
                            ? glassColors.accent
                            : glassColors.cardBorder,
                          justifyContent: 'center',
                        }}
                      >
                        <Text
                          style={{
                            color: isSelected
                              ? glassColors.textOnPrimary
                              : glassColors.textPrimary,
                            fontSize: ds.fontSize(14),
                            fontWeight: '500',
                          }}
                        >
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: ds.spacing(12), marginBottom: ds.spacing(16) }}>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontSize: ds.fontSize(14),
                      marginBottom: ds.spacing(8),
                      color: glassColors.textPrimary,
                      fontWeight: '500',
                    }}
                  >
                    Base Unit *
                  </Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="e.g., lb"
                    placeholderTextColor={colors.gray[400]}
                    value={newItemBaseUnit}
                    onChangeText={setNewItemBaseUnit}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontSize: ds.fontSize(14),
                      marginBottom: ds.spacing(8),
                      color: glassColors.textPrimary,
                      fontWeight: '500',
                    }}
                  >
                    Pack Unit *
                  </Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="e.g., case"
                    placeholderTextColor={colors.gray[400]}
                    value={newItemPackUnit}
                    onChangeText={setNewItemPackUnit}
                  />
                </View>
              </View>

              <View style={{ marginBottom: ds.spacing(24) }}>
                <Text
                  style={{
                    fontSize: ds.fontSize(14),
                    marginBottom: ds.spacing(8),
                    color: glassColors.textPrimary,
                    fontWeight: '500',
                  }}
                >
                  Pack Size *
                </Text>
                <View className="flex-row items-center">
                  <TextInput
                    style={[styles.modalInput, { width: ds.spacing(104) }]}
                    placeholder="10"
                    placeholderTextColor={colors.gray[400]}
                    value={newItemPackSize}
                    onChangeText={setNewItemPackSize}
                    keyboardType="number-pad"
                  />
                  <Text
                    style={{
                      marginLeft: ds.spacing(12),
                      fontSize: ds.fontSize(14),
                      color: glassColors.textSecondary,
                    }}
                  >
                    {newItemPackSize || '1'} {newItemBaseUnit || 'units'} per {newItemPackUnit || 'pack'}
                  </Text>
                </View>
              </View>
            </ScrollView>

            <View
              style={{
                backgroundColor: glassColors.background,
                borderTopWidth: glassHairlineWidth,
                borderTopColor: glassColors.divider,
                paddingHorizontal: ds.spacing(16),
                paddingVertical: ds.spacing(14),
              }}
            >
              <TouchableOpacity
                style={{
                  minHeight: Math.max(48, ds.buttonH),
                  borderRadius: glassRadii.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  backgroundColor: isSubmittingItem
                    ? colors.primary[300]
                    : colors.primary[500],
                }}
                onPress={handleAddNewItem}
                disabled={isSubmittingItem}
              >
                <Ionicons name="add-circle" size={ds.icon(20)} color={colors.white} />
                <Text
                  style={{
                    fontSize: ds.buttonFont,
                    color: glassColors.textOnPrimary,
                    fontWeight: '700',
                    marginLeft: ds.spacing(8),
                  }}
                >
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

const styles = StyleSheet.create({
  modalInput: {
    backgroundColor: glassColors.subtleFill,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
    color: glassColors.textPrimary,
    borderRadius: glassRadii.surface,
    minHeight: 48,
    paddingHorizontal: 14,
    fontSize: 15,
  },
});
