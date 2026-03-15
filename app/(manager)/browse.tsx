import { useState, useCallback, useEffect, useMemo } from "react";
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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useShallow } from "zustand/react/shallow";
import { useInventoryStore, useAuthStore, useOrderStore } from "@/store";
import { InventoryItem, ItemCategory, Location } from "@/types";
import { CATEGORY_LABELS } from "@/constants";
import { BrandLogo, GlassSurface } from "@/components";
import { InventoryItemCard } from "@/components/InventoryItemCard";
import { useScaledStyles } from "@/hooks/useScaledStyles";
import {
  categoryGlassTints,
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassSpacing,
  glassTabBarHeight,
  glassTypography,
} from "@/design/tokens";

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

export default function ManagerBrowseScreen() {
  const ds = useScaledStyles();
  const { location, locations, setLocation, fetchLocations } = useAuthStore(
    useShallow((state) => ({
      location: state.location,
      locations: state.locations,
      setLocation: state.setLocation,
      fetchLocations: state.fetchLocations,
    })),
  );
  const { items, fetchItems } = useInventoryStore(
    useShallow((state) => ({
      items: state.items,
      fetchItems: state.fetchItems,
    })),
  );
  const totalCartCount = useOrderStore((state) =>
    state.getTotalCartCount("manager"),
  );
  const getLocationCartTotal = useOrderStore(
    (state) => state.getLocationCartTotal,
  );

  // Local state for category/search — independent from employee browse
  const [selectedCategory, setSelectedCategory] = useState<ItemCategory | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
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
      const matchesCategory =
        !selectedCategory || item.category === selectedCategory;
      const matchesSearch =
        !searchQuery ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase());
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

  const handleSelectCategory = useCallback((category: ItemCategory) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setSelectedCategory(category);
    setSearchQuery("");
  }, []);

  const handleBackToCategories = useCallback(() => {
    setSelectedCategory(null);
    setSearchQuery("");
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: InventoryItem }) => (
      <InventoryItemCard
        item={item}
        locationId={location?.id || ""}
        cartContext="manager"
      />
    ),
    [location?.id],
  );

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: glassColors.background }}
      edges={["top", "left", "right"]}
    >
      <View
        style={{
          backgroundColor: glassColors.background,
          paddingHorizontal: glassSpacing.screen,
          paddingTop: ds.spacing(8),
          paddingBottom: ds.spacing(10),
        }}
      >
        <View className="flex-row items-center" style={{ columnGap: glassSpacing.gap }}>
          <GlassSurface
            intensity="medium"
            style={{
              width: headerIconButtonSize,
              height: headerIconButtonSize,
              borderRadius: glassRadii.round,
            }}
          >
            <TouchableOpacity
              onPress={() => router.replace("/(manager)" as any)}
              className="flex-1 items-center justify-center"
            >
              <Ionicons
                name="arrow-back"
                size={ds.icon(22)}
                color={glassColors.textPrimary}
              />
            </TouchableOpacity>
          </GlassSurface>

          <View className="flex-1" />

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
                  width: 6,
                  height: 6,
                  borderRadius: glassRadii.round,
                  backgroundColor: glassColors.accent,
                  marginRight: ds.spacing(8),
                }}
              />
              <Text
                style={{
                  fontSize: ds.fontSize(13),
                  fontWeight: "500",
                  color: glassColors.textPrimary,
                  marginRight: ds.spacing(6),
                  maxWidth: ds.spacing(160),
                }}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {location?.name || "Select Location"}
              </Text>
              <Ionicons
                name={showLocationDropdown ? "chevron-up" : "chevron-down"}
                size={ds.icon(14)}
                color={glassColors.textSecondary}
              />
            </TouchableOpacity>
          </GlassSurface>

          <GlassSurface
            intensity="medium"
            style={{
              width: headerIconButtonSize,
              height: headerIconButtonSize,
              borderRadius: glassRadii.round,
            }}
          >
            <TouchableOpacity
              onPress={() => router.push("/(manager)/cart" as any)}
              className="flex-1 items-center justify-center"
              activeOpacity={0.8}
            >
              <Ionicons
                name="bag-handle-outline"
                size={ds.icon(18)}
                color={glassColors.textPrimary}
              />
              {totalCartCount > 0 && (
                <View
                  style={{
                    position: "absolute",
                    top: -2,
                    right: -2,
                    minWidth: badgeSize,
                    height: badgeSize,
                    paddingHorizontal: ds.spacing(4),
                    borderRadius: glassRadii.round,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: glassColors.accent,
                  }}
                >
                  <Text
                    style={{
                      color: glassColors.textOnPrimary,
                      fontSize: ds.fontSize(11),
                      fontWeight: "600",
                    }}
                  >
                    {totalCartCount > 99 ? "99+" : totalCartCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </GlassSurface>
        </View>

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
                const cartCount = getLocationCartTotal(loc.id, "manager");

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
            paddingHorizontal: ds.spacing(14),
            height: ds.buttonH,
          }}
        >
          <View className="flex-1 flex-row items-center">
            <Ionicons
              name="search-outline"
              size={ds.icon(20)}
              color={glassColors.textSecondary}
            />
            <TextInput
              className="flex-1 ml-2"
              style={{
                fontSize: ds.fontSize(13),
                color: glassColors.textPrimary,
              }}
              placeholder="Search inventory..."
              placeholderTextColor={glassColors.textSecondary}
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
              fontWeight: "500",
              letterSpacing: 0.8,
              textTransform: "uppercase",
              marginBottom: ds.spacing(8),
            }}
          >
            Browse by Category
          </Text>
          <View
            className="flex-row flex-wrap justify-between"
            style={{ gap: glassSpacing.gap }}
          >
            {categories.map((cat) => {
              const iconTheme = categoryGlassTints[cat];
              const itemCount = items.filter((item) => item.category === cat).length;

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
                      numberOfLines={1}
                      style={{
                        fontSize: ds.fontSize(13),
                        fontWeight: "500",
                        color: glassColors.textPrimary,
                      }}
                    >
                      {CATEGORY_LABELS[cat]}
                    </Text>
                    <Text
                      style={{
                        fontSize: ds.fontSize(10),
                        color: glassColors.textSecondary,
                        marginTop: ds.spacing(4),
                      }}
                    >
                      {itemCount} items
                    </Text>
                  </TouchableOpacity>
                </GlassSurface>
              );
            })}
          </View>
        </ScrollView>
      ) : (
        <>
          <GlassSurface
            intensity="subtle"
            style={{
              marginHorizontal: glassSpacing.screen,
              marginBottom: ds.spacing(8),
              borderRadius: glassRadii.surface,
            }}
          >
            <View
              className="flex-row items-center justify-between"
              style={{
                paddingHorizontal: ds.spacing(14),
                paddingVertical: ds.spacing(10),
              }}
            >
              <TouchableOpacity
                onPress={handleBackToCategories}
                className="flex-row items-center"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons
                  name="arrow-back"
                  size={ds.icon(16)}
                  color={glassColors.textSecondary}
                />
                <Text
                  style={{
                    fontSize: ds.fontSize(11),
                    fontWeight: "500",
                    color: glassColors.textSecondary,
                    marginLeft: ds.spacing(6),
                    textTransform: "uppercase",
                    letterSpacing: 0.8,
                  }}
                >
                  Categories
                </Text>
              </TouchableOpacity>
              {selectedCategory ? (
                <Text
                  style={{
                    fontSize: ds.fontSize(13),
                    fontWeight: "500",
                    color: glassColors.textPrimary,
                  }}
                >
                  {CATEGORY_LABELS[selectedCategory]}
                </Text>
              ) : (
                <Text
                  style={{
                    fontSize: ds.fontSize(11),
                    color: glassColors.textSecondary,
                    textTransform: "uppercase",
                    letterSpacing: 0.8,
                  }}
                >
                  Search Results
                </Text>
              )}
            </View>
          </GlassSurface>

          <FlatList
            data={filteredItems}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{
              paddingHorizontal: glassSpacing.screen,
              paddingBottom: glassTabBarHeight + ds.spacing(20),
            }}
            ItemSeparatorComponent={() => (
              <View style={{ height: ds.spacing(12) }} />
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
              </View>
            )}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={glassColors.accent}
              />
            }
            removeClippedSubviews={Platform.OS === "android"}
            initialNumToRender={10}
            maxToRenderPerBatch={8}
            windowSize={8}
          />
        </>
      )}
    </SafeAreaView>
  );
}
