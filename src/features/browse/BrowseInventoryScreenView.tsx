import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
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
import { FlashList, FlashListRef } from '@shopify/flash-list';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useShallow } from 'zustand/react/shallow';
import {
  BrowseCategoryScroller,
  EmptyStateCard,
  GlassSurface,
  HeaderCartButton,
  LoadingIndicator,
  LocationSelectorButton,
} from '@/components';
import { getCategoryLabel, colors, getSupplierCategoryLabel } from '@/constants';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassSpacing,
} from '@/theme/design';
import { useOrderingCartActions } from '@/hooks/useOrderingCartActions';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { useResolvedActiveLocation } from '@/hooks/useResolvedActiveLocation';
import { useAuthStore, useInventoryStore, useOrderStore } from '@/store';
import type {
  InventoryItem,
  ItemCategory,
  Location,
} from '@/types';
import { KNOWN_SUPPLIER_CATEGORIES } from '@/types';
import type { OrderingMode } from '@/features/ordering/types';
import { LocationSwitcherDropdown } from '@/features/stock-check/components/LocationSwitcherDropdown';
import { BrowseItemRow } from './BrowseItemRow';
import { buildCategoryList } from './config';
import { normalizeInventoryPackSize } from '@/lib/inventoryUnits';

export interface BrowseInventoryScreenViewProps {
  mode: OrderingMode;
  fallbackRoute: string;
  initialCategory?: ItemCategory | null;
  autoFocusSearch?: boolean;
  initialFocusItemId?: string | null;
  autoExpandFocusedItem?: boolean;
  addFocusedItemOnArrival?: boolean;
  focusRequestId?: string | null;
}

export function BrowseInventoryScreenView({
  mode,
  fallbackRoute,
  initialCategory = null,
  autoFocusSearch = false,
  initialFocusItemId = null,
  autoExpandFocusedItem = false,
  addFocusedItemOnArrival = false,
  focusRequestId = null,
}: BrowseInventoryScreenViewProps) {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();
  const searchInputRef = useRef<TextInput>(null);
  const browseListRef = useRef<FlashListRef<InventoryItem>>(null);
  const scrollRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastProcessedFocusRequestRef = useRef<string | null>(null);
  const lastScrolledFocusRequestRef = useRef<string | null>(null);
  const previousActiveLocationIdRef = useRef<string | null>(null);
  const pendingScrollRequestRef = useRef<{
    requestKey: string;
    index: number;
  } | null>(null);
  const [browseCategory, setBrowseCategory] = useState<string | null>(initialCategory ?? null);
  const [browseCategoriesExpanded, setBrowseCategoriesExpanded] = useState(false);
  const [browseSearchQuery, setBrowseSearchQuery] = useState('');
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState<string>('dry');
  const [newItemSupplierCategory, setNewItemSupplierCategory] =
    useState<string>('main_distributor');
  const [newItemBaseUnit, setNewItemBaseUnit] = useState('');
  const [newItemPackUnit, setNewItemPackUnit] = useState('');
  const [newItemPackSize, setNewItemPackSize] = useState('');
  const [isSubmittingItem, setIsSubmittingItem] = useState(false);
  const [activeEditingItemId, setActiveEditingItemId] = useState<string | null>(null);
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);
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
    error: itemsError,
    isLoading: itemsLoading,
    fetchItems,
    addItem,
  } = useInventoryStore(
    useShallow((state) => ({
      items: state.items,
      error: state.error,
      isLoading: state.isLoading,
      fetchItems: state.fetchItems,
      addItem: state.addItem,
    })),
  );
  const {
    totalCartCount,
  } = useOrderStore(
    useShallow((state) => ({
      totalCartCount: state.getTotalCartCount(mode.scope),
    })),
  );
  const { activeLocationId, addInventoryItem } = useOrderingCartActions(mode.scope);
  const tabBarSafeBottomPadding =
    60 + Math.max(insets.bottom, glassSpacing.tabBarBottom) + ds.spacing(24);
  const headerBackButtonSize = Math.max(48, ds.icon(44));
  const headerCartButtonSize = headerBackButtonSize;
  const scrollToItemViewOffset = ds.spacing(4);

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
  const dynamicCategories = useMemo(() => buildCategoryList(items), [items]);
  const sortedLocations = useMemo(
    () => [...locations].sort((a, b) => a.name.localeCompare(b.name)),
    [locations],
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

    router.replace(fallbackRoute as any);
  }, [fallbackRoute]);

  const handleRetryInventory = useCallback(() => {
    void fetchItems({ force: true });
  }, [fetchItems]);

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
    if (!newItemBaseUnit.trim() && !newItemPackUnit.trim()) {
      Alert.alert('Error', 'Please enter at least one unit');
      return;
    }
    if (
      newItemPackSize.trim().length > 0 &&
      (!Number.isFinite(Number(newItemPackSize)) || Number(newItemPackSize) <= 0)
    ) {
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
        pack_size: newItemPackSize.trim().length > 0
          ? normalizeInventoryPackSize(newItemPackSize)
          : undefined,
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

  const scrollToItemById = useCallback(
    (itemId: string) => {
      const index = filteredBrowseItems.findIndex((i) => i.id === itemId);
      if (index < 0) {
        return;
      }

      // Wait for the layout animation to settle before scrolling
      setTimeout(() => {
        browseListRef.current?.scrollToIndex({
          index,
          animated: !ds.reduceMotion,
          viewPosition: 0,
          viewOffset: scrollToItemViewOffset,
        });
      }, 300);
    },
    [ds.reduceMotion, filteredBrowseItems, scrollToItemViewOffset],
  );

  const handleActivateEditor = useCallback(
    (itemId: string) => {
      setActiveEditingItemId(itemId);
      scrollToItemById(itemId);
    },
    [scrollToItemById],
  );

  const addAndOpenEditorForItem = useCallback(
    (item: InventoryItem) => {
      const didAdd = addInventoryItem(item);
      if (!didAdd) {
        return false;
      }

      setActiveEditingItemId(item.id);
      scrollToItemById(item.id);
      return true;
    },
    [addInventoryItem, scrollToItemById],
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
      setLocationDropdownOpen(false);

      if (selectedLocation.id === location?.id) {
        return;
      }

      setActiveEditingItemId(null);
      setLocation(selectedLocation);
    },
    [location?.id, setLocation],
  );

  const handleToggleLocationDropdown = useCallback(() => {
    setLocationDropdownOpen((current) => !current);
  }, []);

  const handleCloseLocationDropdown = useCallback(() => {
    setLocationDropdownOpen(false);
  }, []);

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

    if (itemsError) {
      return (
        <View style={{ paddingTop: ds.spacing(12) }}>
          <EmptyStateCard
            icon="cloud-offline-outline"
            title="Unable to load inventory"
            message={itemsError}
            actionLabel="Try Again"
            onPressAction={handleRetryInventory}
          />
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
            message={`Switch filters or add a new ${getCategoryLabel(browseCategory).toLowerCase()} item.`}
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
    handleRetryInventory,
    itemsError,
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
              alignItems: 'center',
              position: 'relative',
              zIndex: 10,
            }}
          >
            <GlassSurface
              intensity="medium"
              style={{
                width: headerBackButtonSize,
                height: headerBackButtonSize,
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
                marginRight: ds.spacing(12),
              }}
            >
              <LocationSelectorButton
                label={location?.name ?? 'Select location'}
                expanded={locationDropdownOpen}
                onPress={handleToggleLocationDropdown}
              />
            </View>
            <View>
              <HeaderCartButton
                count={totalCartCount}
                onPress={() => router.push(mode.cartRoute as any)}
                size={headerCartButtonSize}
                iconSize={ds.icon(22)}
              />
            </View>
            <View
              pointerEvents="box-none"
              style={{
                position: 'absolute',
                top: headerCartButtonSize + ds.spacing(4),
                left: headerBackButtonSize + ds.spacing(12),
                right: headerCartButtonSize + ds.spacing(12),
              }}
            >
              <LocationSwitcherDropdown
                isOpen={locationDropdownOpen}
                locations={sortedLocations}
                selectedLocationId={location?.id ?? null}
                onSelect={handleLocationChange}
                onRequestClose={handleCloseLocationDropdown}
              />
            </View>
          </View>

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
                style={{
                  flex: 1,
                  marginLeft: ds.spacing(12),
                  fontSize: ds.fontSize(16),
                  color: glassColors.textPrimary,
                }}
                placeholder="Search inventory..."
                placeholderTextColor={glassColors.textSecondary}
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

        <View style={{ paddingHorizontal: glassSpacing.screen }}>
          <BrowseCategoryScroller
            categories={dynamicCategories}
            selectedCategory={browseCategory}
            onSelectCategory={setBrowseCategory}
            expanded={browseCategoriesExpanded}
            onToggleExpanded={() => setBrowseCategoriesExpanded((current) => !current)}
          />
        </View>

        <FlashList
          ref={browseListRef}
          data={filteredBrowseItems}
          renderItem={renderExpandedBrowseItem}
          keyExtractor={(item: InventoryItem) => item.id}
          contentContainerStyle={{
            paddingHorizontal: glassSpacing.screen,
            paddingTop: ds.spacing(12),
            paddingBottom: tabBarSafeBottomPadding,
            flexGrow: filteredBrowseItems.length === 0 ? 1 : 0,
          }}
          ItemSeparatorComponent={() => (
            <View style={{ height: ds.spacing(8) }} />
          )}
          ListEmptyComponent={renderListEmpty}
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={handleCloseLocationDropdown}
          {...({ onScrollToIndexFailed: handleScrollToIndexFailed } as any)}
        />
      </View>

      <Modal
        visible={showAddItemModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAddItemModal(false)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalKeyboardAvoider}
          >
            <View
              style={[
                styles.modalSheet,
                {
                  backgroundColor: glassColors.background,
                  paddingBottom: Math.max(insets.bottom, ds.spacing(16)),
                },
              ]}
            >
              <View
                style={{
                  paddingHorizontal: glassSpacing.screen,
                  paddingTop: ds.spacing(14),
                  paddingBottom: ds.spacing(12),
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: glassColors.cardBorder,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <Text
                  style={{
                    fontSize: ds.fontSize(18),
                    fontWeight: '700',
                    color: glassColors.textPrimary,
                  }}
                >
                  Add Missing Item
                </Text>
                <TouchableOpacity
                  onPress={() => setShowAddItemModal(false)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons
                    name="close"
                    size={ds.icon(20)}
                    color={glassColors.textSecondary}
                  />
                </TouchableOpacity>
              </View>

              <ScrollView
                contentContainerStyle={{
                  paddingHorizontal: glassSpacing.screen,
                  paddingTop: ds.spacing(16),
                  gap: ds.spacing(14),
                }}
                keyboardShouldPersistTaps="handled"
              >
                <View>
                  <Text
                    style={{
                      fontSize: ds.fontSize(12),
                      fontWeight: '700',
                      color: glassColors.textSecondary,
                      textTransform: 'uppercase',
                      letterSpacing: 0.8,
                      marginBottom: ds.spacing(8),
                    }}
                  >
                    Item Name
                  </Text>
                  <GlassSurface
                    intensity="medium"
                    style={{
                      borderRadius: glassRadii.search,
                      paddingHorizontal: ds.spacing(14),
                      minHeight: ds.buttonH,
                      justifyContent: 'center',
                    }}
                  >
                    <TextInput
                      value={newItemName}
                      onChangeText={setNewItemName}
                      placeholder="Example: Salmon belly"
                      placeholderTextColor={glassColors.textSecondary}
                      style={{
                        fontSize: ds.fontSize(14),
                        color: glassColors.textPrimary,
                      }}
                    />
                  </GlassSurface>
                </View>

                <View>
                  <Text
                    style={{
                      fontSize: ds.fontSize(12),
                      fontWeight: '700',
                      color: glassColors.textSecondary,
                      textTransform: 'uppercase',
                      letterSpacing: 0.8,
                      marginBottom: ds.spacing(8),
                    }}
                  >
                    Category
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ds.spacing(8) }}>
                    {dynamicCategories.map((category) => {
                      const isSelected = newItemCategory === category;
                      return (
                        <TouchableOpacity
                          key={category}
                          onPress={() => setNewItemCategory(category)}
                          style={{
                            paddingHorizontal: ds.spacing(14),
                            paddingVertical: ds.spacing(10),
                            borderRadius: glassRadii.pill,
                            backgroundColor: isSelected
                              ? glassColors.accentSoft
                              : colors.gray[100],
                            borderWidth: glassHairlineWidth,
                            borderColor: isSelected
                              ? glassColors.accent
                              : glassColors.cardBorder,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: ds.fontSize(13),
                              fontWeight: isSelected ? '700' : '600',
                              color: isSelected
                                ? glassColors.accent
                                : glassColors.textPrimary,
                            }}
                          >
                            {getCategoryLabel(category)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                <View>
                  <Text
                    style={{
                      fontSize: ds.fontSize(12),
                      fontWeight: '700',
                      color: glassColors.textSecondary,
                      textTransform: 'uppercase',
                      letterSpacing: 0.8,
                      marginBottom: ds.spacing(8),
                    }}
                  >
                    Supplier Category
                  </Text>
                  <View style={{ gap: ds.spacing(8) }}>
                    {(KNOWN_SUPPLIER_CATEGORIES as readonly string[]).map(
                      (supplierCategory) => {
                        const isSelected = newItemSupplierCategory === supplierCategory;
                        return (
                          <TouchableOpacity
                            key={supplierCategory}
                            onPress={() => setNewItemSupplierCategory(supplierCategory)}
                            style={{
                              paddingHorizontal: ds.spacing(14),
                              paddingVertical: ds.spacing(12),
                              borderRadius: glassRadii.surface,
                              backgroundColor: isSelected
                                ? glassColors.accentSoft
                                : colors.gray[100],
                              borderWidth: glassHairlineWidth,
                              borderColor: isSelected
                                ? glassColors.accent
                                : glassColors.cardBorder,
                            }}
                          >
                            <Text
                              style={{
                                fontSize: ds.fontSize(14),
                                fontWeight: isSelected ? '700' : '600',
                                color: isSelected
                                  ? glassColors.accent
                                  : glassColors.textPrimary,
                              }}
                            >
                              {getSupplierCategoryLabel(supplierCategory)}
                            </Text>
                          </TouchableOpacity>
                        );
                      },
                    )}
                  </View>
                </View>

                <View style={{ flexDirection: 'row', gap: ds.spacing(10) }}>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontSize: ds.fontSize(12),
                        fontWeight: '700',
                        color: glassColors.textSecondary,
                        textTransform: 'uppercase',
                        letterSpacing: 0.8,
                        marginBottom: ds.spacing(8),
                      }}
                    >
                      Base Unit
                    </Text>
                    <GlassSurface
                      intensity="medium"
                      style={{
                        borderRadius: glassRadii.search,
                        paddingHorizontal: ds.spacing(14),
                        minHeight: ds.buttonH,
                        justifyContent: 'center',
                      }}
                    >
                      <TextInput
                        value={newItemBaseUnit}
                        onChangeText={setNewItemBaseUnit}
                        placeholder="lb"
                        placeholderTextColor={glassColors.textSecondary}
                        style={{
                          fontSize: ds.fontSize(14),
                          color: glassColors.textPrimary,
                        }}
                      />
                    </GlassSurface>
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontSize: ds.fontSize(12),
                        fontWeight: '700',
                        color: glassColors.textSecondary,
                        textTransform: 'uppercase',
                        letterSpacing: 0.8,
                        marginBottom: ds.spacing(8),
                      }}
                    >
                      Pack Unit
                    </Text>
                    <GlassSurface
                      intensity="medium"
                      style={{
                        borderRadius: glassRadii.search,
                        paddingHorizontal: ds.spacing(14),
                        minHeight: ds.buttonH,
                        justifyContent: 'center',
                      }}
                    >
                      <TextInput
                        value={newItemPackUnit}
                        onChangeText={setNewItemPackUnit}
                        placeholder="case"
                        placeholderTextColor={glassColors.textSecondary}
                        style={{
                          fontSize: ds.fontSize(14),
                          color: glassColors.textPrimary,
                        }}
                      />
                    </GlassSurface>
                  </View>
                </View>

                <View>
                  <Text
                    style={{
                      fontSize: ds.fontSize(12),
                      fontWeight: '700',
                      color: glassColors.textSecondary,
                      textTransform: 'uppercase',
                      letterSpacing: 0.8,
                      marginBottom: ds.spacing(8),
                    }}
                  >
                    Pack Size
                  </Text>
                  <GlassSurface
                    intensity="medium"
                    style={{
                      borderRadius: glassRadii.search,
                      paddingHorizontal: ds.spacing(14),
                      minHeight: ds.buttonH,
                      justifyContent: 'center',
                    }}
                  >
                    <TextInput
                      value={newItemPackSize}
                      onChangeText={setNewItemPackSize}
                      placeholder="1"
                      placeholderTextColor={glassColors.textSecondary}
                      keyboardType="decimal-pad"
                      style={{
                        fontSize: ds.fontSize(14),
                        color: glassColors.textPrimary,
                      }}
                    />
                  </GlassSurface>
                </View>
              </ScrollView>

              <View
                style={{
                  paddingHorizontal: glassSpacing.screen,
                  paddingTop: ds.spacing(12),
                }}
              >
                <TouchableOpacity
                  onPress={() => {
                    void handleAddNewItem();
                  }}
                  disabled={isSubmittingItem}
                  style={{
                    minHeight: ds.buttonH,
                    borderRadius: glassRadii.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: isSubmittingItem
                      ? glassColors.accentSoft
                      : glassColors.accent,
                  }}
                  activeOpacity={0.85}
                >
                  <Text
                    style={{
                      fontSize: ds.buttonFont,
                      fontWeight: '700',
                      color: isSubmittingItem
                        ? glassColors.accent
                        : glassColors.textOnPrimary,
                    }}
                  >
                    {isSubmittingItem ? 'Adding...' : 'Add to Inventory'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    justifyContent: 'flex-end',
  },
  modalKeyboardAvoider: {
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '88%',
    overflow: 'hidden',
  },
});
