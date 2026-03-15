import { useEffect, useState, useCallback, useRef, useMemo } from "react";
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
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import { useShallow } from "zustand/react/shallow";
import { useInventoryStore, useAuthStore, useOrderStore } from "@/store";
import {
  InventoryItem,
  ItemCategory,
  Location,
  SupplierCategory,
} from "@/types";
import { CATEGORY_LABELS, colors } from "@/constants";
import { BrandLogo, GlassSurface } from "@/components";
import { InventoryItemCard } from "@/components/InventoryItemCard";
import { useScaledStyles } from "@/hooks/useScaledStyles";
import { supabase } from "@/lib/supabase";
import { triggerPendingReminderLocalNotification } from "@/services/notificationService";
import {
  categoryGlassTints,
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassSpacing,
  glassTabBarHeight,
  glassTypography,
} from "@/design/tokens";

// Enable LayoutAnimation on Android
if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const categories: ItemCategory[] = [
  "fish",
  "protein",
  "produce",
  "dry",
  "dairy_cold",
  "frozen",
  "sauces",
  "alcohol",
  "packaging",
];

const CATEGORY_ICONS: Record<ItemCategory, keyof typeof Ionicons.glyphMap> = {
  fish: "fish-outline",
  protein: "restaurant-outline",
  produce: "leaf-outline",
  dry: "cube-outline",
  dairy_cold: "thermometer-outline",
  frozen: "snow-outline",
  sauces: "water-outline",
  alcohol: "wine-outline",
  packaging: "archive-outline",
};

const CATEGORY_ICON_THEMES: Record<
  ItemCategory,
  { background: string; icon: string }
> = categoryGlassTints;

const SUPPLIER_CATEGORIES: { value: SupplierCategory; label: string }[] = [
  { value: "fish_supplier", label: "Fish Supplier" },
  { value: "main_distributor", label: "Main Distributor" },
  { value: "asian_market", label: "Asian Market" },
];

export default function OrderScreen() {
  const ds = useScaledStyles();
  const { location, locations, setLocation, fetchLocations, user } =
    useAuthStore(
      useShallow((state) => ({
        location: state.location,
        locations: state.locations,
        setLocation: state.setLocation,
        fetchLocations: state.fetchLocations,
        user: state.user,
      })),
    );
  const {
    fetchItems,
    getFilteredItems,
    items,
    selectedCategory,
    setSelectedCategory,
    searchQuery,
    setSearchQuery,
    addItem,
  } = useInventoryStore(
    useShallow((state) => ({
      fetchItems: state.fetchItems,
      getFilteredItems: state.getFilteredItems,
      items: state.items,
      selectedCategory: state.selectedCategory,
      setSelectedCategory: state.setSelectedCategory,
      searchQuery: state.searchQuery,
      setSearchQuery: state.setSearchQuery,
      addItem: state.addItem,
    })),
  );
  const { getLocationCartTotal, totalCartCount } = useOrderStore(
    useShallow((state) => ({
      getLocationCartTotal: state.getLocationCartTotal,
      totalCartCount: state.getTotalCartCount("employee"),
    })),
  );

  const [refreshing, setRefreshing] = useState(false);
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  const [showAddItemModal, setShowAddItemModal] = useState(false);

  // New item form state
  const [newItemName, setNewItemName] = useState("");
  const [newItemCategory, setNewItemCategory] = useState<ItemCategory>("dry");
  const [newItemSupplierCategory, setNewItemSupplierCategory] =
    useState<SupplierCategory>("main_distributor");
  const [newItemBaseUnit, setNewItemBaseUnit] = useState("");
  const [newItemPackUnit, setNewItemPackUnit] = useState("");
  const [newItemPackSize, setNewItemPackSize] = useState("");
  const [isSubmittingItem, setIsSubmittingItem] = useState(false);
  const [unreadReminderCount, setUnreadReminderCount] = useState(0);
  const [latestReminderMessage, setLatestReminderMessage] = useState<
    string | null
  >(null);
  const lastNotifiedReminderIdRef = useRef<string | null>(null);
  const headerIconButtonSize = Math.max(44, ds.icon(40));
  const headerLogoSize = Math.max(34, ds.icon(36));
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
      .from("notifications")
      .select("id, title, body, created_at")
      .eq("user_id", user.id)
      .eq("notification_type", "employee_reminder")
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      console.error("Unable to load unread reminders", error);
      return;
    }

    const rows = data ?? [];
    const latestReminderId =
      typeof rows[0]?.id === "string" && rows[0].id.trim().length > 0
        ? rows[0].id
        : null;
    setUnreadReminderCount(rows.length);
    setLatestReminderMessage(rows[0]?.body ?? null);

    // Trigger a local notification so employees see it even if they backgrounded the app
    if (
      rows.length > 0 &&
      latestReminderId &&
      latestReminderId !== lastNotifiedReminderIdRef.current
    ) {
      lastNotifiedReminderIdRef.current = latestReminderId;
      triggerPendingReminderLocalNotification(rows[0]?.body).catch(() => {});
    } else if (rows.length === 0) {
      lastNotifiedReminderIdRef.current = null;
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadUnreadReminderNotifications();
    }, [loadUnreadReminderNotifications]),
  );

  // Realtime: reload reminder banner when notifications table changes for this user
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`employee-reminder-notifs-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          loadUnreadReminderNotifications();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
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
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("notification_type", "employee_reminder")
      .is("read_at", null);

    if (error) {
      Alert.alert(
        "Unable to mark reminders as read",
        error.message || "Please try again.",
      );
      return;
    }

    setUnreadReminderCount(0);
    setLatestReminderMessage(null);
    lastNotifiedReminderIdRef.current = null;
  }, [unreadReminderCount, user?.id]);

  const toggleLocationDropdown = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowLocationDropdown((prev) => !prev);
  }, []);

  const handleSelectLocation = useCallback(
    (selectedLocation: Location) => {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      setLocation(selectedLocation);
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setShowLocationDropdown(false);
    },
    [setLocation],
  );

  const handleSelectCategory = useCallback(
    (category: ItemCategory) => {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      setSelectedCategory(category);
      setSearchQuery("");
    },
    [setSelectedCategory, setSearchQuery],
  );

  const handleBackToCategories = useCallback(() => {
    setSelectedCategory(null);
    setSearchQuery("");
  }, [setSelectedCategory, setSearchQuery]);

  const filteredItems = getFilteredItems();
  const categoryItemCounts = useMemo(
    () =>
      categories.reduce(
        (result, category) => {
          result[category] = items.filter((item) => item.category === category).length;
          return result;
        },
        {} as Record<ItemCategory, number>,
      ),
    [items],
  );
  const showCategoryGrid = !selectedCategory && !searchQuery.trim();

  const resetNewItemForm = () => {
    setNewItemName(searchQuery); // Pre-fill with search query
    setNewItemCategory("dry");
    setNewItemSupplierCategory("main_distributor");
    setNewItemBaseUnit("");
    setNewItemPackUnit("");
    setNewItemPackSize("");
  };

  const handleOpenAddItemModal = () => {
    resetNewItemForm();
    setShowAddItemModal(true);
  };

  const handleAddNewItem = async () => {
    if (!newItemName.trim()) {
      Alert.alert("Error", "Please enter an item name");
      return;
    }
    if (!newItemBaseUnit.trim()) {
      Alert.alert("Error", "Please enter a base unit (e.g., lb, oz, each)");
      return;
    }
    if (!newItemPackUnit.trim()) {
      Alert.alert("Error", "Please enter a pack unit (e.g., case, bag, box)");
      return;
    }
    if (!newItemPackSize.trim() || isNaN(parseFloat(newItemPackSize))) {
      Alert.alert("Error", "Please enter a valid pack size number");
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

      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      setShowAddItemModal(false);
      setSearchQuery(newItemName.trim()); // Search for the new item
      Alert.alert(
        "Success",
        `"${newItemName}" has been added to the inventory`,
      );
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to add item");
    } finally {
      setIsSubmittingItem(false);
    }
  };

  const renderItem = ({ item }: { item: InventoryItem }) => (
    <InventoryItemCard item={item} locationId={location?.id || ""} hideCategory={!!selectedCategory} />
  );

  const CategoryPicker = ({
    value,
    onChange,
  }: {
    value: ItemCategory;
    onChange: (v: ItemCategory) => void;
  }) => (
    <View
      className="flex-row flex-wrap"
      style={{ columnGap: ds.spacing(8), rowGap: ds.spacing(8) }}
    >
      {categories.map((cat) => {
        const isSelected = value === cat;
        const tint = categoryGlassTints[cat];
        return (
          <TouchableOpacity
            key={cat}
            style={{
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: isSelected ? tint.icon : tint.background,
              borderWidth: glassHairlineWidth,
              borderColor: isSelected ? tint.icon : glassColors.cardBorder,
              borderRadius: glassRadii.button,
              minHeight: Math.max(40, ds.buttonH - ds.spacing(8)),
              paddingHorizontal: ds.spacing(12),
              paddingVertical: ds.spacing(6),
            }}
            onPress={() => onChange(cat)}
          >
            <Text
              style={{
                color: isSelected ? glassColors.textOnPrimary : tint.icon,
                fontSize: ds.fontSize(14),
                fontWeight: "500",
              }}
            >
              {CATEGORY_LABELS[cat]}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const SupplierPicker = ({
    value,
    onChange,
  }: {
    value: SupplierCategory;
    onChange: (v: SupplierCategory) => void;
  }) => (
    <View
      className="flex-row flex-wrap"
      style={{ columnGap: ds.spacing(8), rowGap: ds.spacing(8) }}
    >
      {SUPPLIER_CATEGORIES.map((sup) => {
        const isSelected = value === sup.value;
        return (
          <TouchableOpacity
            key={sup.value}
            style={{
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: isSelected
                ? glassColors.accent
                : glassColors.mediumFill,
              borderWidth: glassHairlineWidth,
              borderColor: isSelected
                ? glassColors.accent
                : glassColors.cardBorder,
              borderRadius: glassRadii.button,
              minHeight: Math.max(40, ds.buttonH - ds.spacing(8)),
              paddingHorizontal: ds.spacing(12),
              paddingVertical: ds.spacing(6),
            }}
            onPress={() => onChange(sup.value)}
          >
            <Text
              style={{
                fontSize: ds.fontSize(14),
                fontWeight: "500",
                color: isSelected
                  ? glassColors.textOnPrimary
                  : glassColors.textPrimary,
              }}
            >
              {sup.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: glassColors.background }}
      edges={["top", "left", "right"]}
    >
      {/* Header */}
      <View
        style={{
          backgroundColor: glassColors.background,
          paddingHorizontal: glassSpacing.screen,
          paddingTop: ds.spacing(8),
          paddingBottom: ds.spacing(10),
        }}
      >
        <View
          className="flex-row items-center justify-between"
          style={{
            columnGap: glassSpacing.gap,
          }}
        >
          <GlassSurface
            intensity="medium"
            style={{
              width: headerIconButtonSize,
              height: headerIconButtonSize,
              borderRadius: glassRadii.round,
            }}
          >
            <View className="flex-1 items-center justify-center">
              <BrandLogo variant="header" size={headerLogoSize} />
            </View>
          </GlassSurface>

          <View
            className="flex-row items-center flex-1 justify-end"
            style={{ marginLeft: glassSpacing.gap }}
          >
            <GlassSurface
              intensity="medium"
              style={{
                flexShrink: 1,
                marginRight: glassSpacing.gap,
                borderRadius: glassRadii.pill,
              }}
            >
              <TouchableOpacity
                onPress={toggleLocationDropdown}
                className="flex-row items-center"
                style={{
                  minHeight: headerIconButtonSize,
                  paddingHorizontal: ds.spacing(14),
                }}
                activeOpacity={0.7}
              >
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: glassRadii.round,
                    backgroundColor: glassColors.accent,
                    marginRight: ds.spacing(8),
                  }}
                />
                <Text
                  style={{
                    fontSize: ds.fontSize(14),
                    fontWeight: "600",
                    color: glassColors.textPrimary,
                    marginRight: ds.spacing(6),
                    maxWidth: ds.spacing(170),
                  }}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {location?.name || "Select Location"}
                </Text>
                <Ionicons
                  name={showLocationDropdown ? "chevron-up" : "chevron-down"}
                  size={ds.icon(13)}
                  color={glassColors.textSecondary}
                />
              </TouchableOpacity>
            </GlassSurface>

            <View style={{ width: headerIconButtonSize, height: headerIconButtonSize }}>
              <GlassSurface
                intensity="medium"
                style={{
                  ...StyleSheet.absoluteFillObject,
                  borderRadius: glassRadii.round,
                }}
              >
                <View />
              </GlassSurface>
              <TouchableOpacity
                onPress={() => router.push("/cart" as any)}
                className="absolute inset-0 items-center justify-center"
                activeOpacity={0.8}
              >
                <Ionicons
                  name="bag-handle-outline"
                  size={ds.icon(20)}
                  color={glassColors.textPrimary}
                />
              </TouchableOpacity>
              {totalCartCount > 0 && (
                <View
                  style={{
                    position: "absolute",
                    top: -6,
                    right: -6,
                    minWidth: ds.spacing(20),
                    height: ds.spacing(20),
                    paddingHorizontal: 4,
                    borderRadius: glassRadii.round,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: glassColors.accent,
                    borderWidth: 2,
                    borderColor: '#FFFFFF',
                    zIndex: 10,
                  }}
                >
                  <Text
                    style={{
                      color: glassColors.textOnPrimary,
                      fontSize: ds.fontSize(10),
                      fontWeight: "700",
                    }}
                  >
                    {totalCartCount > 99 ? "99+" : totalCartCount}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Location Dropdown Menu */}
        {showLocationDropdown && (
          <GlassSurface
            intensity="strong"
            style={{
              marginTop: ds.spacing(10),
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
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: isSelected
                            ? glassColors.accentSoft
                            : glassColors.mediumFill,
                        }}
                      >
                        <BrandLogo
                          variant="inline"
                          size={16}
                          colorMode="light"
                        />
                      </View>
                      <Text
                        style={{
                          fontSize: ds.fontSize(13),
                          fontWeight: isSelected ? "500" : "400",
                          color: isSelected
                            ? glassColors.accent
                            : glassColors.textPrimary,
                        }}
                      >
                        {loc.name}
                      </Text>
                    </View>
                    <View className="flex-row items-center">
                      {cartCount > 0 && (
                        <Text
                          style={{
                            color: glassColors.textSecondary,
                            fontSize: ds.fontSize(11),
                            marginRight: ds.spacing(8),
                          }}
                        >
                          {cartCount} items
                        </Text>
                      )}
                      {isSelected && (
                        <Ionicons
                          name="checkmark"
                          size={ds.icon(18)}
                          color={glassColors.accent}
                        />
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </GlassSurface>
        )}
      </View>

      {unreadReminderCount > 0 && (
        <View
          style={{
            paddingHorizontal: glassSpacing.screen,
            paddingBottom: ds.spacing(10),
          }}
        >
          <GlassSurface
            intensity="medium"
            style={{
              borderRadius: glassRadii.surface,
              paddingHorizontal: ds.spacing(12),
              paddingVertical: ds.spacing(10),
            }}
          >
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-2">
                <Text
                  style={{
                    fontSize: ds.fontSize(11),
                    fontWeight: "500",
                    color: glassColors.accent,
                    textTransform: "uppercase",
                    letterSpacing: 0.8,
                  }}
                >
                  Reminder waiting ({unreadReminderCount})
                </Text>
                <Text
                  style={{
                    color: glassColors.textPrimary,
                    fontSize: ds.fontSize(12),
                    marginTop: ds.spacing(2),
                  }}
                >
                  {latestReminderMessage ||
                    "A manager reminded you to place an order."}
                </Text>
              </View>
              <TouchableOpacity
                onPress={handleMarkReminderNotificationsRead}
                style={{
                  paddingHorizontal: ds.spacing(10),
                  paddingVertical: ds.spacing(6),
                  borderRadius: glassRadii.pill,
                  backgroundColor: glassColors.accentSoft,
                }}
              >
                <Text
                  style={{
                    color: glassColors.accent,
                    fontSize: ds.fontSize(11),
                    fontWeight: "500",
                  }}
                >
                  Mark Read
                </Text>
              </TouchableOpacity>
            </View>
          </GlassSurface>
        </View>
      )}

      {/* Search Bar */}
      <View
        style={{
          paddingHorizontal: glassSpacing.screen,
          paddingVertical: ds.spacing(12),
        }}
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
          <TextInput
            className="flex-1 ml-3"
            style={{
              fontSize: ds.fontSize(16),
              color: glassColors.textPrimary,
            }}
            placeholder="Search inventory..."
            placeholderTextColor={glassColors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery("")}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons
                name="close-circle"
                size={ds.icon(20)}
                color={glassColors.textSecondary}
              />
            </TouchableOpacity>
          )}
          </View>
        </GlassSurface>
      </View>

      {showCategoryGrid ? (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: glassSpacing.screen,
            paddingTop: ds.spacing(4),
            paddingBottom: glassTabBarHeight + ds.spacing(20),
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={glassColors.accent}
            />
          }
        >
          <Text
            style={{
              color: glassColors.textSecondary,
              fontSize: glassTypography.sectionLabel,
              fontWeight: "600",
              letterSpacing: 1.5,
              textTransform: "uppercase",
              marginBottom: ds.spacing(16),
            }}
          >
            Browse by Category
          </Text>
          <View
            className="flex-row flex-wrap justify-between"
            style={{ gap: glassSpacing.gap }}
          >
            {categories.map((cat) => {
              const iconTheme = categoryGlassTints[cat] || CATEGORY_ICON_THEMES[cat];
              return (
                <GlassSurface
                  key={cat}
                  style={{
                    width: "48%",
                    borderRadius: glassRadii.surface,
                  }}
                >
                  <TouchableOpacity
                    onPress={() => handleSelectCategory(cat)}
                    style={{
                      paddingHorizontal: ds.spacing(12),
                      paddingVertical: ds.spacing(14),
                    }}
                    activeOpacity={0.85}
                  >
                    <View
                      className="items-center justify-center"
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: glassRadii.iconTile,
                        backgroundColor: iconTheme.background,
                        marginBottom: ds.spacing(8),
                      }}
                    >
                      <Ionicons
                        name={CATEGORY_ICONS[cat]}
                        size={ds.icon(18)}
                        color={iconTheme.icon}
                      />
                    </View>
                    <Text
                      style={{
                        fontSize: ds.fontSize(15),
                        fontWeight: "600",
                        color: glassColors.textPrimary,
                      }}
                    >
                      {CATEGORY_LABELS[cat]}
                    </Text>
                    <Text
                      style={{
                        fontSize: ds.fontSize(13),
                        color: glassColors.textSecondary,
                        marginTop: ds.spacing(4),
                        fontWeight: "400",
                      }}
                    >
                      {categoryItemCounts[cat] ?? 0} items
                    </Text>
                  </TouchableOpacity>
                </GlassSurface>
              );
            })}
          </View>
        </ScrollView>
      ) : (
        <>
          <View
            className="flex-row items-center justify-center"
            style={{
              marginHorizontal: glassSpacing.screen,
              marginBottom: ds.spacing(20),
              minHeight: 44,
              position: 'relative',
            }}
          >
            <TouchableOpacity
              onPress={handleBackToCategories}
              style={{
                position: 'absolute',
                left: 0,
                width: 44,
                height: 44,
                borderRadius: glassRadii.round,
                backgroundColor: glassColors.mediumFill,
                alignItems: "center",
                justifyContent: "center",
                zIndex: 10,
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons
                name="chevron-back"
                size={ds.icon(22)}
                color={glassColors.textPrimary}
              />
            </TouchableOpacity>
            
            {selectedCategory ? (
              <Text
                style={{
                  fontSize: ds.fontSize(22),
                  fontWeight: "700",
                  color: glassColors.textPrimary,
                  textAlign: "center",
                }}
              >
                {CATEGORY_LABELS[selectedCategory]}
              </Text>
            ) : (
              <Text
                style={{
                  fontSize: ds.fontSize(22),
                  fontWeight: "700",
                  color: glassColors.textPrimary,
                }}
              >
                Search Results
              </Text>
            )}
          </View>

          {/* Inventory List */}
          <FlatList
            data={filteredItems}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            removeClippedSubviews={true}
            initialNumToRender={8}
            maxToRenderPerBatch={10}
            windowSize={11}
            contentContainerStyle={{
              paddingHorizontal: glassSpacing.screen,
              paddingBottom: glassTabBarHeight + ds.spacing(20),
            }}
            ItemSeparatorComponent={() => (
              <View style={{ height: ds.spacing(14) }} />
            )}
            ListEmptyComponent={() => (
              <View className="flex-1 items-center justify-center py-12">
                <Ionicons
                  name="cube-outline"
                  size={48}
                  color={glassColors.textSecondary}
                />
                <Text
                  style={{
                    marginTop: ds.spacing(12),
                    color: glassColors.textSecondary,
                    textAlign: "center",
                  }}
                >
                  {searchQuery || selectedCategory
                    ? "No items match your search"
                    : "No inventory items found"}
                </Text>
                {(searchQuery || selectedCategory) && (
                  <TouchableOpacity
                    onPress={handleOpenAddItemModal}
                    className="mt-4 flex-row items-center"
                    style={{
                      backgroundColor: glassColors.accent,
                      paddingHorizontal: ds.spacing(16),
                      paddingVertical: ds.spacing(10),
                      borderRadius: glassRadii.button,
                    }}
                  >
                    <Ionicons
                      name="add-circle-outline"
                      size={20}
                      color={glassColors.textOnPrimary}
                    />
                    <Text
                      style={{
                        color: glassColors.textOnPrimary,
                        fontWeight: "600",
                        marginLeft: ds.spacing(8),
                      }}
                    >
                      Add Missing Item
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={glassColors.accent}
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
        <SafeAreaView style={{ flex: 1, backgroundColor: glassColors.background }}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            className="flex-1"
          >
            {/* Modal Header */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: ds.spacing(16),
                paddingVertical: ds.spacing(14),
                borderBottomWidth: glassHairlineWidth,
                borderBottomColor: glassColors.divider,
                backgroundColor: glassColors.background,
              }}
            >
              <TouchableOpacity
                onPress={() => setShowAddItemModal(false)}
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                <Text
                  style={{ fontSize: ds.fontSize(14), color: glassColors.accent, fontWeight: "500" }}
                >
                  Cancel
                </Text>
              </TouchableOpacity>
              <Text
                style={{ fontSize: ds.fontSize(24), color: glassColors.textPrimary, fontWeight: "700" }}
              >
                Add New Item
              </Text>
              <View style={{ width: ds.spacing(56) }} />
            </View>

            <ScrollView
              className="flex-1"
              contentContainerStyle={{
                padding: ds.spacing(16),
                paddingBottom: modalBodyBottomPadding,
              }}
              showsVerticalScrollIndicator
              keyboardShouldPersistTaps="handled"
            >
              {/* Name */}
              <View style={{ marginBottom: ds.spacing(16) }}>
                <Text
                  style={{
                    fontSize: ds.fontSize(14),
                    marginBottom: ds.spacing(8),
                    color: glassColors.textPrimary,
                    fontWeight: "500",
                  }}
                >
                  Item Name *
                </Text>
                <TextInput
                  style={{
                    backgroundColor: glassColors.subtleFill,
                    borderWidth: glassHairlineWidth,
                    borderColor: glassColors.cardBorder,
                    color: glassColors.textPrimary,
                    borderRadius: glassRadii.surface,
                    minHeight: modalInputHeight,
                    paddingHorizontal: ds.spacing(14),
                    fontSize: ds.fontSize(15),
                  }}
                  placeholder="e.g., Salmon (Sushi Grade)"
                  placeholderTextColor={colors.gray[400]}
                  value={newItemName}
                  onChangeText={setNewItemName}
                />
              </View>

              {/* Category */}
              <View style={{ marginBottom: ds.spacing(16) }}>
                <Text
                  style={{
                    fontSize: ds.fontSize(14),
                    marginBottom: ds.spacing(8),
                    color: glassColors.textPrimary,
                    fontWeight: "500",
                  }}
                >
                  Category *
                </Text>
                <CategoryPicker
                  value={newItemCategory}
                  onChange={setNewItemCategory}
                />
              </View>

              {/* Supplier Category */}
              <View style={{ marginBottom: ds.spacing(16) }}>
                <Text
                  style={{
                    fontSize: ds.fontSize(14),
                    marginBottom: ds.spacing(8),
                    color: glassColors.textPrimary,
                    fontWeight: "500",
                  }}
                >
                  Supplier *
                </Text>
                <SupplierPicker
                  value={newItemSupplierCategory}
                  onChange={setNewItemSupplierCategory}
                />
              </View>

              {/* Units Row */}
              <View
                className="flex-row"
                style={{
                  columnGap: ds.spacing(12),
                  marginBottom: ds.spacing(16),
                }}
              >
                <View className="flex-1">
                  <Text
                    style={{
                      fontSize: ds.fontSize(14),
                      marginBottom: ds.spacing(8),
                      color: glassColors.textPrimary,
                      fontWeight: "500",
                    }}
                  >
                    Base Unit *
                  </Text>
                  <TextInput
                    style={{
                      backgroundColor: glassColors.subtleFill,
                      borderWidth: glassHairlineWidth,
                      borderColor: glassColors.cardBorder,
                      color: glassColors.textPrimary,
                      borderRadius: glassRadii.surface,
                      minHeight: modalInputHeight,
                      paddingHorizontal: ds.spacing(14),
                      fontSize: ds.fontSize(15),
                    }}
                    placeholder="e.g., lb"
                    placeholderTextColor={colors.gray[400]}
                    value={newItemBaseUnit}
                    onChangeText={setNewItemBaseUnit}
                  />
                </View>
                <View className="flex-1">
                  <Text
                    style={{
                      fontSize: ds.fontSize(14),
                      marginBottom: ds.spacing(8),
                      color: glassColors.textPrimary,
                      fontWeight: "500",
                    }}
                  >
                    Pack Unit *
                  </Text>
                  <TextInput
                    style={{
                      backgroundColor: glassColors.subtleFill,
                      borderWidth: glassHairlineWidth,
                      borderColor: glassColors.cardBorder,
                      color: glassColors.textPrimary,
                      borderRadius: glassRadii.surface,
                      minHeight: modalInputHeight,
                      paddingHorizontal: ds.spacing(14),
                      fontSize: ds.fontSize(15),
                    }}
                    placeholder="e.g., case"
                    placeholderTextColor={colors.gray[400]}
                    value={newItemPackUnit}
                    onChangeText={setNewItemPackUnit}
                  />
                </View>
              </View>

              {/* Pack Size */}
              <View style={{ marginBottom: ds.spacing(24) }}>
                <Text
                  style={{
                    fontSize: ds.fontSize(14),
                    marginBottom: ds.spacing(8),
                    color: glassColors.textPrimary,
                    fontWeight: "500",
                  }}
                >
                  Pack Size *
                </Text>
                <View className="flex-row items-center">
                  <TextInput
                    style={{
                      width: ds.spacing(104),
                      backgroundColor: glassColors.subtleFill,
                      borderWidth: glassHairlineWidth,
                      borderColor: glassColors.cardBorder,
                      color: glassColors.textPrimary,
                      borderRadius: glassRadii.surface,
                      minHeight: modalInputHeight,
                      paddingHorizontal: ds.spacing(14),
                      fontSize: ds.fontSize(15),
                    }}
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
                    {newItemBaseUnit || "units"} per {newItemPackUnit || "pack"}
                  </Text>
                </View>
              </View>

              {/* Preview */}
              {newItemName && (
                <GlassSurface
                  intensity="subtle"
                  style={{
                    padding: ds.spacing(16),
                    marginBottom: ds.spacing(24),
                    borderRadius: glassRadii.surface,
                  }}
                >
                  <Text
                    style={{
                      fontSize: ds.fontSize(13),
                      marginBottom: ds.spacing(8),
                      color: glassColors.accent,
                      fontWeight: "500",
                    }}
                  >
                    Preview
                  </Text>
                  <Text
                    style={{ fontSize: ds.fontSize(15), color: glassColors.textPrimary, fontWeight: "600" }}
                  >
                    {newItemName}
                  </Text>
                  <Text
                    style={{ fontSize: ds.fontSize(13), color: glassColors.textMuted, marginTop: ds.spacing(4) }}
                  >
                    {CATEGORY_LABELS[newItemCategory]} •{" "}
                    {
                      SUPPLIER_CATEGORIES.find(
                        (s) => s.value === newItemSupplierCategory,
                      )?.label
                    }
                  </Text>
                  <Text
                    style={{ fontSize: ds.fontSize(13), color: glassColors.textSecondary, marginTop: ds.spacing(4) }}
                  >
                    {newItemPackSize || "1"} {newItemBaseUnit || "units"} per{" "}
                    {newItemPackUnit || "pack"}
                  </Text>
                </GlassSurface>
              )}
            </ScrollView>

            {/* Submit Button */}
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
                  minHeight: modalInputHeight,
                  borderRadius: glassRadii.surface,
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "row",
                  backgroundColor: isSubmittingItem
                    ? colors.primary[300]
                    : colors.primary[500],
                }}
                onPress={handleAddNewItem}
                disabled={isSubmittingItem}
              >
                <Ionicons name="add-circle" size={ds.icon(20)} color={colors.white} />
                <Text
                  style={{ fontSize: ds.buttonFont, color: glassColors.textOnPrimary, fontWeight: "700", marginLeft: ds.spacing(8) }}
                >
                  {isSubmittingItem ? "Adding..." : "Add Item"}
                </Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
