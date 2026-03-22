import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  FlatList,
  InteractionManager,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useShallow } from 'zustand/react/shallow';
import {
  BrowseCategoryScroller,
  EmptyStateCard,
  FloatingLocationSelector,
  GlassSurface,
  HeaderCartButton,
  LoadingIndicator,
} from '@/components';
import { CATEGORY_LABELS, colors, SUPPLIER_CATEGORY_LABELS } from '@/constants';
import {
  categoryGlassTints,
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassSpacing,
} from '@/theme/design';
import { useEmployeeCartActions } from '@/hooks/useEmployeeCartActions';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { useResolvedActiveLocation } from '@/hooks/useResolvedActiveLocation';
import { useAuthStore, useInventoryStore, useOrderStore } from '@/store';
import type {
  InventoryItem,
  ItemCategory,
  Location,
  SupplierCategory,
} from '@/types';
import { BrowseItemRow } from './BrowseItemRow';
import { CATEGORY_ORDER } from './config';

interface EmployeeBrowseInventoryScreenProps {
  initialCategory?: ItemCategory | null;
  autoFocusSearch?: boolean;
  initialFocusItemId?: string | null;
  autoExpandFocusedItem?: boolean;
  addFocusedItemOnArrival?: boolean;
  focusRequestId?: string | null;
}

export function EmployeeBrowseInventoryScreen({
  initialCategory = null,
  autoFocusSearch = false,
  initialFocusItemId = null,
  autoExpandFocusedItem = false,
  addFocusedItemOnArrival = false,
  focusRequestId = null,
}: EmployeeBrowseInventoryScreenProps) {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();
  const searchInputRef = useRef<TextInput>(null);
  const browseListRef = useRef<FlatList<InventoryItem>>(null);
  const scrollRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastProcessedFocusRequestRef = useRef<string | null>(null);
  const lastScrolledFocusRequestRef = useRef<string | null>(null);
  const previousActiveLocationIdRef = useRef<string | null>(null);
  const pendingScrollRequestRef = useRef<{
    requestKey: string;
    index: number;
  } | null>(null);
  const [browseCategory, setBrowseCategory] = useState<ItemCategory | null>(initialCategory);
  const [browseCategoriesExpanded, setBrowseCategoriesExpanded] = useState(false);
  const [browseSearchQuery, setBrowseSearchQuery] = useState('');
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState<ItemCategory>('dry');
  const [newItemSupplierCategory, setNewItemSupplierCategory] =
    useState<SupplierCategory>('main_distributor');
  const [newItemBaseUnit, setNewItemBaseUnit] = useState('');
  const [newItemPackUnit, setNewItemPackUnit] = useState('');
  const [newItemPackSize, setNewItemPackSize] = useState('');
  const [isSubmittingItem, setIsSubmittingItem] = useState(false);
  const [activeEditingItemId, setActiveEditingItemId] = useState<string | null>(null);
  const { location, locations, setLocation } = useResolvedActiveLocation();
  const {
    fetchLocations,
    user,
  } = useAuthStore(
    useShallow((state) => ({
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
    totalCartCount,
  } = useOrderStore(
    useShallow((state) => ({
      totalCartCount: state.getTotalCartCount('employee'),
    })),
  );
  const { activeLocationId, addInventoryItem } = useEmployeeCartActions();
  const floatingSelectorBottomOffset =
    Math.max(insets.bottom, ds.spacing(12)) + ds.spacing(12);
  const floatingSelectorReservedSpace =
    floatingSelectorBottomOffset + ds.spacing(96);

  useEffect(() => {
    void fetchItems();
    void fetchLocations();
  }, [fetchItems, fetchLocations]);

  useEffect(() => {
    setBrowseCategory(initialCategory);
  }, [initialCategory]);

  useEffect(() => {
    if (!autoFocusSearch) {
      return;
    }

    const timer = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 180);

    return () => clearTimeout(timer);
  }, [autoFocusSearch]);

  const allItemsSorted = useMemo(
    () => [...items].sort((left, right) => left.name.localeCompare(right.name)),
    [items],
  );
  const focusRequestKey = useMemo(() => {
    if (!initialFocusItemId) {
      return null;
    }

    return (
      focusRequestId ??
      `${initialFocusItemId}:${autoExpandFocusedItem ? 'expand' : 'focus'}:${addFocusedItemOnArrival ? 'add' : 'view'}`
    );
  }, [
    addFocusedItemOnArrival,
    autoExpandFocusedItem,
    focusRequestId,
    initialFocusItemId,
  ]);
  const focusTargetItem = useMemo(
    () =>
      initialFocusItemId
        ? allItemsSorted.find((item) => item.id === initialFocusItemId) ?? null
        : null,
    [allItemsSorted, initialFocusItemId],
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
  const focusedBrowseItemIndex = useMemo(
    () =>
      initialFocusItemId
        ? filteredBrowseItems.findIndex((item) => item.id === initialFocusItemId)
        : -1,
    [filteredBrowseItems, initialFocusItemId],
  );

  useEffect(() => {
    if (
      activeEditingItemId &&
      !filteredBrowseItems.some((item) => item.id === activeEditingItemId)
    ) {
      setActiveEditingItemId(null);
    }
  }, [activeEditingItemId, filteredBrowseItems]);

  useEffect(() => {
    if (
      previousActiveLocationIdRef.current &&
      activeLocationId &&
      previousActiveLocationIdRef.current !== activeLocationId
    ) {
      setActiveEditingItemId(null);
    }

    previousActiveLocationIdRef.current = activeLocationId;
  }, [activeLocationId]);

  const emptyBrowseResults =
    !itemsLoading &&
    filteredBrowseItems.length === 0 &&
    browseSearchQuery.trim().length > 0;
  const emptyCategoryResults =
    !itemsLoading &&
    filteredBrowseItems.length === 0 &&
    browseSearchQuery.trim().length === 0;

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/(tabs)');
  }, []);

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

  const handleActivateEditor = useCallback((itemId: string) => {
    setActiveEditingItemId(itemId);
  }, []);

  const addAndOpenEditorForItem = useCallback(
    (item: InventoryItem) => {
      const didAdd = addInventoryItem(item);
      if (!didAdd) {
        return false;
      }

      setActiveEditingItemId(item.id);
      return true;
    },
    [addInventoryItem],
  );

  const handleAddAndEdit = useCallback(
    (item: InventoryItem) => {
      addAndOpenEditorForItem(item);
    },
    [addAndOpenEditorForItem],
  );

  const handleItemRemoved = useCallback((itemId: string) => {
    setActiveEditingItemId((current) => (current === itemId ? null : current));
  }, []);

  const handleLocationChange = useCallback(
    (selectedLocation: Location) => {
      if (selectedLocation.id === location?.id) {
        return;
      }

      setActiveEditingItemId(null);
      setLocation(selectedLocation);
    },
    [location?.id, setLocation],
  );

  useEffect(() => {
    if (!focusRequestKey) {
      lastProcessedFocusRequestRef.current = null;
      lastScrolledFocusRequestRef.current = null;
      pendingScrollRequestRef.current = null;
      return;
    }

    if (!focusTargetItem) {
      return;
    }

    if (lastProcessedFocusRequestRef.current === focusRequestKey) {
      return;
    }

    if (addFocusedItemOnArrival) {
      addAndOpenEditorForItem(focusTargetItem);
    } else if (autoExpandFocusedItem) {
      setActiveEditingItemId(focusTargetItem.id);
    }

    lastProcessedFocusRequestRef.current = focusRequestKey;
  }, [
    addAndOpenEditorForItem,
    addFocusedItemOnArrival,
    autoExpandFocusedItem,
    focusRequestKey,
    focusTargetItem,
  ]);

  const scrollToFocusedItem = useCallback(
    (index: number) => {
      if (!focusRequestKey || index < 0) {
        return;
      }

      pendingScrollRequestRef.current = {
        requestKey: focusRequestKey,
        index,
      };
      browseListRef.current?.scrollToIndex({
        index,
        animated: !ds.reduceMotion,
        viewPosition: 0.16,
      });
    },
    [ds.reduceMotion, focusRequestKey],
  );

  useEffect(() => {
    if (!focusRequestKey || focusedBrowseItemIndex < 0) {
      return;
    }

    if (lastScrolledFocusRequestRef.current === focusRequestKey) {
      return;
    }

    let cancelled = false;
    lastScrolledFocusRequestRef.current = focusRequestKey;
    const interaction = InteractionManager.runAfterInteractions(() => {
      if (cancelled) {
        return;
      }

      requestAnimationFrame(() => {
        if (cancelled) {
          return;
        }

        scrollToFocusedItem(focusedBrowseItemIndex);
      });
    });

    return () => {
      cancelled = true;
      interaction.cancel();
    };
  }, [focusRequestKey, focusedBrowseItemIndex, scrollToFocusedItem]);

  useEffect(() => {
    return () => {
      if (scrollRetryTimeoutRef.current) {
        clearTimeout(scrollRetryTimeoutRef.current);
      }
    };
  }, []);

  const handleScrollToIndexFailed = useCallback(
    (info: {
      index: number;
      averageItemLength: number;
      highestMeasuredFrameIndex: number;
    }) => {
      const pendingRequest = pendingScrollRequestRef.current;
      if (!pendingRequest) {
        return;
      }

      browseListRef.current?.scrollToOffset({
        offset: Math.max(0, info.averageItemLength * info.index - ds.spacing(32)),
        animated: false,
      });

      if (scrollRetryTimeoutRef.current) {
        clearTimeout(scrollRetryTimeoutRef.current);
      }

      scrollRetryTimeoutRef.current = setTimeout(() => {
        if (
          !pendingScrollRequestRef.current ||
          pendingScrollRequestRef.current.requestKey !== pendingRequest.requestKey
        ) {
          return;
        }

        browseListRef.current?.scrollToIndex({
          index: pendingRequest.index,
          animated: !ds.reduceMotion,
          viewPosition: 0.16,
        });
      }, ds.reduceMotion ? 0 : 120);
    },
    [ds],
  );

  const renderExpandedBrowseItem = useCallback(
    ({ item }: { item: InventoryItem }) => (
      <BrowseItemRow
        item={item}
        locationId={activeLocationId}
        isActiveEditor={activeEditingItemId === item.id}
        onActivateEditor={handleActivateEditor}
        onAddAndEdit={handleAddAndEdit}
        onItemRemoved={handleItemRemoved}
      />
    ),
    [
      activeEditingItemId,
      activeLocationId,
      handleActivateEditor,
      handleAddAndEdit,
      handleItemRemoved,
    ],
  );

  const renderListEmpty = useCallback(() => {
    if (itemsLoading) {
      return (
        <View style={{ paddingTop: ds.spacing(24) }}>
          <LoadingIndicator showText text="Loading inventory..." />
        </View>
      );
    }

    if (emptyBrowseResults) {
      return (
        <View style={{ paddingTop: ds.spacing(12) }}>
          <EmptyStateCard
            icon="cube-outline"
            title="No items match your search"
            message="Try a different search or add the missing item to inventory."
            actionLabel="Add Missing Item"
            onPressAction={handleOpenAddItemModal}
          />
        </View>
      );
    }

    if (emptyCategoryResults && browseCategory) {
      return (
        <View style={{ paddingTop: ds.spacing(12) }}>
          <EmptyStateCard
            icon="layers-outline"
            title="No items in this category yet"
            message={`Switch filters or add a new ${CATEGORY_LABELS[browseCategory].toLowerCase()} item.`}
            actionLabel="Add Missing Item"
            onPressAction={handleOpenAddItemModal}
          />
        </View>
      );
    }

    return (
      <View style={{ paddingTop: ds.spacing(12) }}>
        <EmptyStateCard
          icon="cube-outline"
          title="Inventory is empty"
          message="Items will appear here once inventory is available."
        />
      </View>
    );
  }, [
    browseCategory,
    ds,
    emptyBrowseResults,
    emptyCategoryResults,
    handleOpenAddItemModal,
    itemsLoading,
  ]);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: glassColors.background }}
      edges={['top', 'left', 'right']}
    >
      <View style={{ flex: 1 }}>
        <View
          style={{
            paddingHorizontal: glassSpacing.screen,
            paddingTop: ds.spacing(4),
            paddingBottom: ds.spacing(12),
            backgroundColor: glassColors.background,
          }}
        >
          <View
            style={{
              paddingBottom: ds.spacing(8),
              flexDirection: 'row',
              alignItems: 'flex-start',
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
                onPress={handleBack}
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
            <View
              style={{
                flex: 1,
                marginLeft: ds.spacing(12),
                paddingTop: ds.spacing(2),
              }}
            >
              <Text
                style={{
                  fontSize: ds.fontSize(28),
                  fontWeight: '700',
                  color: glassColors.textPrimary,
                  letterSpacing: -0.5,
                }}
              >
                Browse
              </Text>
              <Text
                style={{
                  marginTop: ds.spacing(4),
                  fontSize: ds.fontSize(12),
                  color: glassColors.textSecondary,
                }}
              >
                {filteredBrowseItems.length} items
                {browseCategory ? '' : ' · sorted A-Z'}
              </Text>
            </View>
            <View style={{ paddingTop: ds.spacing(2) }}>
              <HeaderCartButton
                count={totalCartCount}
                onPress={() => router.push('/(tabs)/cart')}
              />
            </View>
          </View>

          <GlassSurface
            intensity="medium"
            style={{
              borderRadius: glassRadii.search,
              paddingHorizontal: ds.spacing(18),
              height: Math.max(48, ds.buttonH + 6),
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

          <View
            style={{
              paddingTop: ds.spacing(12),
            }}
          >
            <BrowseCategoryScroller
              categories={CATEGORY_ORDER}
              selectedCategory={browseCategory}
              onSelectCategory={setBrowseCategory}
              expanded={browseCategoriesExpanded}
              onToggleExpanded={() =>
                setBrowseCategoriesExpanded((previous) => !previous)
              }
            />
          </View>
        </View>

        <FlatList
          ref={browseListRef}
          data={filteredBrowseItems}
          keyExtractor={(item) => item.id}
          renderItem={renderExpandedBrowseItem}
          ListEmptyComponent={renderListEmpty}
          onScrollToIndexFailed={handleScrollToIndexFailed}
          contentContainerStyle={{
            paddingHorizontal: glassSpacing.screen,
            paddingTop: ds.spacing(8),
            paddingBottom: floatingSelectorReservedSpace,
            gap: ds.spacing(12),
            flexGrow: filteredBrowseItems.length === 0 ? 1 : 0,
          }}
          keyboardShouldPersistTaps="handled"
          removeClippedSubviews={Platform.OS === 'android'}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={10}
        />
      </View>

      <FloatingLocationSelector
        locations={locations}
        selectedLocation={location}
        onSelectLocation={handleLocationChange}
        cartContext="employee"
        bottomOffset={floatingSelectorBottomOffset}
      />

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
