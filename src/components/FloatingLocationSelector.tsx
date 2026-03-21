import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { CartContext, CartItem } from '@/store/orderStore';
import { useOrderStore } from '@/store';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { glassColors, glassHairlineWidth, glassSpacing } from '@/design/tokens';
import type { Location } from '@/types';

const CLOSED_HEIGHT = 72;
const OPEN_HEADER_HEIGHT = 68;
const ROW_HEIGHT = 58;
const EMPTY_STATE_HEIGHT = 98;
const MAX_VISIBLE_ROWS = 5;
const CLOSED_CONFIRMATION_MS = 1200;
const SHADOW_STYLE = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 16 },
  shadowOpacity: 0.22,
  shadowRadius: 24,
  elevation: 18,
} as const;

interface FloatingLocationSelectorProps {
  locations: Location[];
  selectedLocation: Location | null;
  onSelectLocation: (location: Location) => void;
  cartContext: CartContext;
  bottomOffset: number;
  rightOffset?: number;
}

function triggerLightHaptic() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

function triggerSuccessHaptic() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

function getLocationBadge(location: Location | null): string {
  const shortCode = typeof location?.short_code === 'string' ? location.short_code.trim() : '';
  if (shortCode) {
    return shortCode.toUpperCase();
  }

  const name = typeof location?.name === 'string' ? location.name.trim() : '';
  if (!name) {
    return '?';
  }

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return initials || name.slice(0, 2).toUpperCase();
}

function getClosedLabel(location: Location | null): string {
  if (!location?.name?.trim()) {
    return 'Choose location';
  }

  return location.name.trim();
}

function getRowMetaLabel(itemCount: number, isSelected: boolean): string | null {
  if (itemCount > 0) {
    return `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;
  }

  if (isSelected) {
    return 'Current';
  }

  return null;
}

function getOpenHeight(locationCount: number, maxHeight: number): number {
  if (locationCount === 0) {
    return Math.min(maxHeight, OPEN_HEADER_HEIGHT + EMPTY_STATE_HEIGHT);
  }

  const visibleRows = Math.min(locationCount, MAX_VISIBLE_ROWS);
  const helperHeight = locationCount <= 1 ? 42 : 0;
  return Math.min(maxHeight, OPEN_HEADER_HEIGHT + visibleRows * ROW_HEIGHT + helperHeight);
}

function getCartCount(items: CartItem[] | undefined): number {
  return (items ?? []).reduce((total, item) => {
    if (item.inputMode === 'quantity') {
      return total + (item.quantityRequested ?? 0);
    }

    return total + 1;
  }, 0);
}

export function FloatingLocationSelector({
  locations,
  selectedLocation,
  onSelectLocation,
  cartContext,
  bottomOffset,
  rightOffset = glassSpacing.screen,
}: FloatingLocationSelectorProps) {
  const ds = useScaledStyles();
  const { width, height } = useWindowDimensions();
  const cartByLocation = useOrderStore((state) =>
    cartContext === 'manager' ? state.managerCartByLocation : state.cartByLocation,
  );
  const progress = useRef(new Animated.Value(0)).current;
  const confirmationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [confirmedLocationId, setConfirmedLocationId] = useState<string | null>(null);

  const availableWidth = Math.max(216, width - glassSpacing.screen * 2);
  const openWidth = Math.min(332, availableWidth);
  const closedWidth = Math.min(openWidth, Math.max(220, openWidth - ds.spacing(52)));
  const maxCardHeight = Math.max(OPEN_HEADER_HEIGHT + ROW_HEIGHT, height * 0.58);
  const openHeight = getOpenHeight(locations.length, maxCardHeight);
  const activeCartCount = selectedLocation
    ? getCartCount(cartByLocation[selectedLocation.id])
    : 0;
  const pillLabel = getClosedLabel(selectedLocation);
  const badgeLabel = getLocationBadge(selectedLocation);
  const showConfirmation = Boolean(
    confirmedLocationId &&
      selectedLocation &&
      confirmedLocationId === selectedLocation.id,
  );

  const locationRows = useMemo(
    () =>
      locations.map((location) => ({
        location,
        count: getCartCount(cartByLocation[location.id]),
      })),
    [cartByLocation, locations],
  );

  const clearConfirmationTimer = useCallback(() => {
    if (!confirmationTimeoutRef.current) {
      return;
    }

    clearTimeout(confirmationTimeoutRef.current);
    confirmationTimeoutRef.current = null;
  }, []);

  const animateTo = useCallback(
    (nextOpen: boolean) => {
      progress.stopAnimation();
      if (ds.reduceMotion) {
        Animated.timing(progress, {
          toValue: nextOpen ? 1 : 0,
          duration: nextOpen ? 150 : 130,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }).start();
        return;
      }

      if (nextOpen) {
        Animated.spring(progress, {
          toValue: 1,
          damping: 20,
          stiffness: 220,
          mass: 0.9,
          overshootClamping: false,
          useNativeDriver: false,
        }).start();
        return;
      }

      Animated.timing(progress, {
        toValue: 0,
        duration: 170,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    },
    [ds.reduceMotion, progress],
  );

  const closeSelector = useCallback(() => {
    setIsOpen(false);
    animateTo(false);
  }, [animateTo]);

  const openSelector = useCallback(() => {
    Keyboard.dismiss();
    setIsOpen(true);
    animateTo(true);
  }, [animateTo]);

  const toggleSelector = useCallback(() => {
    triggerLightHaptic();
    if (isOpen) {
      closeSelector();
      return;
    }

    openSelector();
  }, [closeSelector, isOpen, openSelector]);

  const handleSelect = useCallback(
    (location: Location) => {
      if (selectedLocation?.id === location.id) {
        closeSelector();
        return;
      }

      triggerSuccessHaptic();
      onSelectLocation(location);
      setConfirmedLocationId(location.id);
      clearConfirmationTimer();
      confirmationTimeoutRef.current = setTimeout(() => {
        setConfirmedLocationId(null);
        confirmationTimeoutRef.current = null;
      }, CLOSED_CONFIRMATION_MS);
      closeSelector();
    },
    [
      clearConfirmationTimer,
      closeSelector,
      onSelectLocation,
      selectedLocation?.id,
    ],
  );

  useEffect(() => () => clearConfirmationTimer(), [clearConfirmationTimer]);

  const containerWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [closedWidth, openWidth],
  });
  const containerHeight = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [CLOSED_HEIGHT, openHeight],
  });
  const containerRadius = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [CLOSED_HEIGHT / 2, 28],
  });
  const containerTranslateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -4],
  });
  const closedOpacity = progress.interpolate({
    inputRange: [0, 0.45, 1],
    outputRange: [1, 0, 0],
  });
  const closedTranslateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 8],
  });
  const openOpacity = progress.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: [0, 0, 1],
  });
  const openTranslateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0],
  });
  const backdropOpacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.08],
  });

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View
        pointerEvents={isOpen ? 'auto' : 'none'}
        style={[
          StyleSheet.absoluteFillObject,
          {
            opacity: backdropOpacity,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close location selector"
          onPress={closeSelector}
          style={[
            StyleSheet.absoluteFillObject,
            {
              backgroundColor: '#000000',
            },
          ]}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.container,
          SHADOW_STYLE,
          {
            width: containerWidth,
            height: containerHeight,
            borderRadius: containerRadius,
            right: rightOffset,
            bottom: bottomOffset,
            transform: [{ translateY: containerTranslateY }],
          },
        ]}
      >
        <Animated.View
          pointerEvents={isOpen ? 'none' : 'auto'}
          style={[
            styles.closedContent,
            {
              opacity: closedOpacity,
              transform: [{ translateY: closedTranslateY }],
            },
          ]}
        >
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Open location selector"
            accessibilityHint="Choose the active location for add to cart"
            activeOpacity={0.88}
            onPress={toggleSelector}
            style={styles.closedPressable}
          >
            <View
              style={[
                styles.badgeBubble,
                showConfirmation ? styles.confirmedBadgeBubble : null,
              ]}
            >
              {showConfirmation ? (
                <Ionicons name="checkmark" size={18} color="#FFFFFF" />
              ) : (
                <Text style={styles.badgeBubbleText}>{badgeLabel}</Text>
              )}
            </View>

            <View style={styles.closedTextWrap}>
              <Text style={styles.closedEyebrow}>Adding To</Text>
              <Text style={styles.closedLabel} numberOfLines={1}>
                {pillLabel}
              </Text>
            </View>

            {activeCartCount > 0 ? (
              <View style={styles.countPill}>
                <Text style={styles.countPillText}>
                  {activeCartCount > 99 ? '99+' : activeCartCount}
                </Text>
              </View>
            ) : null}

            <Ionicons
              name={isOpen ? 'chevron-down' : 'chevron-up'}
              size={20}
              color="rgba(255,255,255,0.72)"
            />
          </TouchableOpacity>
        </Animated.View>

        <Animated.View
          pointerEvents={isOpen ? 'auto' : 'none'}
          style={[
            styles.openContent,
            {
              opacity: openOpacity,
              transform: [{ translateY: openTranslateY }],
            },
          ]}
        >
          <View style={styles.openHeader}>
            <View style={{ flex: 1, paddingRight: ds.spacing(12) }}>
              <Text style={styles.openTitle}>Select Location</Text>
              <Text style={styles.openSubtitle} numberOfLines={2}>
                {selectedLocation
                  ? `New items will be added under ${selectedLocation.name}.`
                  : locations.length > 0
                    ? 'Choose where new items should be added.'
                    : 'No active locations are available yet.'}
              </Text>
            </View>

            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close location selector"
              activeOpacity={0.85}
              onPress={toggleSelector}
              style={styles.headerButton}
            >
              <Ionicons name="chevron-down" size={18} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          {locationRows.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons
                name="location-outline"
                size={22}
                color="rgba(255,255,255,0.78)"
              />
              <Text style={styles.emptyStateTitle}>No locations available</Text>
              <Text style={styles.emptyStateBody}>
                Add-to-cart stays disabled until a location is assigned.
              </Text>
            </View>
          ) : (
            <ScrollView
              bounces={false}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.rowsContent}
            >
              {locationRows.map(({ location, count }) => {
                const isSelected = selectedLocation?.id === location.id;
                const metaLabel = getRowMetaLabel(count, isSelected);

                return (
                  <TouchableOpacity
                    key={location.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Switch to ${location.name}`}
                    activeOpacity={0.86}
                    onPress={() => handleSelect(location)}
                    style={[
                      styles.locationRow,
                      isSelected ? styles.selectedLocationRow : null,
                    ]}
                  >
                    <View
                      style={[
                        styles.rowBadge,
                        isSelected ? styles.selectedRowBadge : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.rowBadgeText,
                          isSelected ? styles.selectedRowBadgeText : null,
                        ]}
                      >
                        {getLocationBadge(location)}
                      </Text>
                    </View>

                    <View style={{ flex: 1, paddingRight: ds.spacing(12) }}>
                      <Text
                        style={[
                          styles.locationName,
                          isSelected ? styles.selectedLocationName : null,
                        ]}
                        numberOfLines={1}
                      >
                        {location.name}
                      </Text>
                      {metaLabel ? (
                        <Text
                          style={[
                            styles.locationMeta,
                            isSelected ? styles.selectedLocationMeta : null,
                          ]}
                        >
                          {metaLabel}
                        </Text>
                      ) : null}
                    </View>

                    {isSelected ? (
                      <View style={styles.selectedIndicator}>
                        <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                      </View>
                    ) : (
                      <Ionicons
                        name="chevron-forward"
                        size={16}
                        color="rgba(255,255,255,0.42)"
                      />
                    )}
                  </TouchableOpacity>
                );
              })}

              {locationRows.length === 1 ? (
                <Text style={styles.helperText}>
                  Only one active location is available for this account.
                </Text>
              ) : null}
            </ScrollView>
          )}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    overflow: 'hidden',
    backgroundColor: 'rgba(24, 24, 27, 0.98)',
    borderWidth: glassHairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  closedContent: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
  },
  closedPressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  badgeBubble: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    marginRight: 12,
  },
  confirmedBadgeBubble: {
    backgroundColor: glassColors.accent,
  },
  badgeBubbleText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  closedTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  closedEyebrow: {
    color: 'rgba(255,255,255,0.56)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  closedLabel: {
    marginTop: 2,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  countPill: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: 8,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginRight: 10,
  },
  countPillText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  openContent: {
    flex: 1,
    paddingTop: 8,
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  openHeader: {
    minHeight: OPEN_HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  openTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  openSubtitle: {
    marginTop: 4,
    color: 'rgba(255,255,255,0.62)',
    fontSize: 12,
    lineHeight: 17,
  },
  headerButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  rowsContent: {
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  locationRow: {
    minHeight: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    paddingHorizontal: 12,
    marginBottom: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: glassHairlineWidth,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  selectedLocationRow: {
    backgroundColor: 'rgba(232,80,58,0.22)',
    borderColor: 'rgba(232,80,58,0.42)',
  },
  rowBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginRight: 12,
  },
  selectedRowBadge: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  rowBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  selectedRowBadgeText: {
    color: '#FFFFFF',
  },
  locationName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  selectedLocationName: {
    color: '#FFFFFF',
  },
  locationMeta: {
    marginTop: 3,
    color: 'rgba(255,255,255,0.56)',
    fontSize: 12,
    fontWeight: '500',
  },
  selectedLocationMeta: {
    color: 'rgba(255,255,255,0.8)',
  },
  selectedIndicator: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: glassColors.accent,
  },
  emptyState: {
    minHeight: EMPTY_STATE_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyStateTitle: {
    marginTop: 10,
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  emptyStateBody: {
    marginTop: 6,
    color: 'rgba(255,255,255,0.58)',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  helperText: {
    color: 'rgba(255,255,255,0.54)',
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 8,
    paddingTop: 2,
    paddingBottom: 4,
  },
});
