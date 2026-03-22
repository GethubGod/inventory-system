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
import type { CartContext, CartItem } from '@/store/orderStore';
import { useOrderStore } from '@/store';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { triggerConfirmationHaptic } from '@/lib/haptics';
import { glassColors, glassHairlineWidth, glassSpacing } from '@/design/tokens';
import type { Location } from '@/types';

const CLOSED_HEIGHT = 76;
const OPEN_HEADER_HEIGHT = 62;
const ROW_HEIGHT = 72;
const ROW_GAP = 10;
const OPEN_CONTENT_TOP_PADDING = 12;
const OPEN_CONTENT_BOTTOM_PADDING = 18;
const ROWS_BOTTOM_PADDING = 12;
const EMPTY_STATE_HEIGHT = 98;
const MAX_VISIBLE_ROWS = 5;
const CLOSED_CONFIRMATION_MS = 1200;
const SELECTION_FEEDBACK_DELAY_MS = 150;
const REDUCED_MOTION_SELECTION_DELAY_MS = 90;
const SHADOW_STYLE = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 16 },
  shadowOpacity: 0.22,
  shadowRadius: 24,
  elevation: 18,
} as const;

interface FloatingLocationSelectorProps {
  locations: Location[] | null | undefined;
  selectedLocation: Location | null;
  onSelectLocation: (location: Location) => void;
  cartContext: CartContext;
  bottomOffset: number;
  rightOffset?: number;
}

type LocationTone = {
  dot: string;
  halo: string;
  border: string;
  selectedBackground: string;
  selectedBorder: string;
  surface: string;
};

function getLocationKind(location: Location | null): 'sushi' | 'poki' | 'other' {
  const locationText = `${location?.name ?? ''} ${location?.short_code ?? ''}`.toLowerCase();

  if (locationText.includes('sushi')) {
    return 'sushi';
  }

  if (
    locationText.includes('poki') ||
    locationText.includes('poke') ||
    locationText.includes('pho')
  ) {
    return 'poki';
  }

  return 'other';
}

function getLocationTone(location: Location | null): LocationTone {
  const kind = getLocationKind(location);

  if (kind === 'sushi') {
    return {
      dot: glassColors.accent,
      halo: 'rgba(232,80,58,0.18)',
      border: 'rgba(232,80,58,0.42)',
      selectedBackground: 'rgba(232,80,58,0.16)',
      selectedBorder: 'rgba(232,80,58,0.38)',
      surface: 'rgba(232,80,58,0.12)',
    };
  }

  if (kind === 'poki') {
    return {
      dot: glassColors.successText,
      halo: 'rgba(34,197,94,0.18)',
      border: 'rgba(34,197,94,0.38)',
      selectedBackground: 'rgba(34,197,94,0.14)',
      selectedBorder: 'rgba(34,197,94,0.36)',
      surface: 'rgba(34,197,94,0.12)',
    };
  }

  return {
    dot: '#FFFFFF',
    halo: 'rgba(255,255,255,0.14)',
    border: 'rgba(255,255,255,0.24)',
    selectedBackground: 'rgba(255,255,255,0.08)',
    selectedBorder: 'rgba(255,255,255,0.18)',
    surface: 'rgba(255,255,255,0.12)',
  };
}

function getDisplayLocationName(location: Location | null): string {
  const rawName = typeof location?.name === 'string' ? location.name.trim() : '';
  if (!rawName) {
    return 'Choose location';
  }

  const normalizedName = rawName.toLowerCase();
  if (normalizedName.includes('sushi')) {
    return 'Sushi';
  }

  if (
    normalizedName.includes('poki') ||
    normalizedName.includes('poke') ||
    normalizedName.includes('pho')
  ) {
    return 'Poki & Pho';
  }

  return rawName.replace(/^babytuna[\s-]*/i, '').trim() || rawName;
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
    return Math.min(
      maxHeight,
      OPEN_CONTENT_TOP_PADDING +
        OPEN_HEADER_HEIGHT +
        EMPTY_STATE_HEIGHT +
        OPEN_CONTENT_BOTTOM_PADDING,
    );
  }

  const visibleRows = Math.min(locationCount, MAX_VISIBLE_ROWS);
  const rowSpacing = Math.max(0, visibleRows - 1) * ROW_GAP;

  return Math.min(
    maxHeight,
    OPEN_CONTENT_TOP_PADDING +
      OPEN_HEADER_HEIGHT +
      visibleRows * ROW_HEIGHT +
      rowSpacing +
      ROWS_BOTTOM_PADDING +
      OPEN_CONTENT_BOTTOM_PADDING,
  );
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
  const safeLocations = useMemo(
    () =>
      Array.isArray(locations)
        ? locations.filter((location): location is Location => Boolean(location?.id))
        : [],
    [locations],
  );
  const normalizedCartByLocation = useMemo(() => cartByLocation ?? {}, [cartByLocation]);
  const progress = useRef(new Animated.Value(0)).current;
  const selectionProgress = useRef(new Animated.Value(0)).current;
  const confirmationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [confirmedLocationId, setConfirmedLocationId] = useState<string | null>(null);
  const [pendingSelectionId, setPendingSelectionId] = useState<string | null>(null);

  const availableWidth = Math.max(216, width - glassSpacing.screen * 2);
  const openWidth = Math.min(356, availableWidth);
  const closedWidth = Math.min(openWidth, Math.max(228, openWidth - ds.spacing(56)));
  const maxCardHeight = Math.max(OPEN_HEADER_HEIGHT + ROW_HEIGHT, height * 0.58);
  const openHeight = getOpenHeight(safeLocations.length, maxCardHeight);
  const activeCartCount = selectedLocation
    ? getCartCount(normalizedCartByLocation[selectedLocation.id])
    : 0;
  const pillLabel = getDisplayLocationName(selectedLocation);
  const selectedLocationTone = getLocationTone(selectedLocation);
  const showConfirmation = Boolean(
    confirmedLocationId &&
      selectedLocation &&
      confirmedLocationId === selectedLocation.id,
  );

  const locationRows = useMemo(
    () =>
      safeLocations.map((location) => ({
        location,
        count: getCartCount(normalizedCartByLocation[location.id]),
      })),
    [normalizedCartByLocation, safeLocations],
  );

  const clearConfirmationTimer = useCallback(() => {
    if (!confirmationTimeoutRef.current) {
      return;
    }

    clearTimeout(confirmationTimeoutRef.current);
    confirmationTimeoutRef.current = null;
  }, []);

  const clearSelectionCloseTimer = useCallback(() => {
    if (!selectionCloseTimeoutRef.current) {
      return;
    }

    clearTimeout(selectionCloseTimeoutRef.current);
    selectionCloseTimeoutRef.current = null;
  }, []);

  const resetSelectionFeedback = useCallback(() => {
    selectionProgress.stopAnimation();
    selectionProgress.setValue(0);
    setPendingSelectionId(null);
  }, [selectionProgress]);

  const animateTo = useCallback(
    (nextOpen: boolean, onComplete?: () => void) => {
      progress.stopAnimation();

      if (ds.reduceMotion) {
        Animated.timing(progress, {
          toValue: nextOpen ? 1 : 0,
          duration: nextOpen ? 150 : 160,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }).start(({ finished }) => {
          if (finished) {
            onComplete?.();
          }
        });
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
        }).start(({ finished }) => {
          if (finished) {
            onComplete?.();
          }
        });
        return;
      }

      Animated.timing(progress, {
        toValue: 0,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) {
          onComplete?.();
        }
      });
    },
    [ds.reduceMotion, progress],
  );

  const closeSelector = useCallback(() => {
    clearSelectionCloseTimer();
    setIsOpen(false);
    animateTo(false, () => {
      resetSelectionFeedback();
    });
  }, [animateTo, clearSelectionCloseTimer, resetSelectionFeedback]);

  const openSelector = useCallback(() => {
    Keyboard.dismiss();
    clearSelectionCloseTimer();
    resetSelectionFeedback();
    setIsOpen(true);
    animateTo(true);
  }, [animateTo, clearSelectionCloseTimer, resetSelectionFeedback]);

  const toggleSelector = useCallback(() => {
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

      clearSelectionCloseTimer();
      setPendingSelectionId(location.id);
      selectionProgress.stopAnimation();
      selectionProgress.setValue(0);
      Animated.timing(selectionProgress, {
        toValue: 1,
        duration: ds.reduceMotion ? 70 : 140,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();

      onSelectLocation(location);
      void triggerConfirmationHaptic();
      setConfirmedLocationId(location.id);
      clearConfirmationTimer();
      confirmationTimeoutRef.current = setTimeout(() => {
        setConfirmedLocationId(null);
        confirmationTimeoutRef.current = null;
      }, CLOSED_CONFIRMATION_MS);

      selectionCloseTimeoutRef.current = setTimeout(() => {
        closeSelector();
        selectionCloseTimeoutRef.current = null;
      }, ds.reduceMotion ? REDUCED_MOTION_SELECTION_DELAY_MS : SELECTION_FEEDBACK_DELAY_MS);
    },
    [
      clearConfirmationTimer,
      clearSelectionCloseTimer,
      closeSelector,
      ds.reduceMotion,
      onSelectLocation,
      selectedLocation?.id,
      selectionProgress,
    ],
  );

  useEffect(() => {
    return () => {
      clearConfirmationTimer();
      clearSelectionCloseTimer();
      progress.stopAnimation();
      selectionProgress.stopAnimation();
    };
  }, [
    clearConfirmationTimer,
    clearSelectionCloseTimer,
    progress,
    selectionProgress,
  ]);

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
  const pendingRowScale = selectionProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.018],
  });
  const pendingRowTranslateY = selectionProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -2],
  });
  const pendingIndicatorScale = selectionProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.08],
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
                styles.indicatorShell,
                {
                  backgroundColor: selectedLocationTone.surface,
                  borderColor: showConfirmation
                    ? selectedLocationTone.border
                    : 'rgba(255,255,255,0.06)',
                  shadowColor: selectedLocationTone.dot,
                  shadowOpacity: showConfirmation ? 0.34 : 0,
                },
              ]}
            >
              <View
                style={[
                  styles.locationDot,
                  {
                    backgroundColor: selectedLocationTone.dot,
                    shadowColor: selectedLocationTone.dot,
                    shadowOpacity: showConfirmation ? 0.48 : 0.22,
                  },
                ]}
              />
              {showConfirmation ? (
                <View
                  style={[
                    styles.confirmationRing,
                    {
                      borderColor: selectedLocationTone.border,
                      backgroundColor: selectedLocationTone.halo,
                    },
                  ]}
                />
              ) : null}
            </View>

            <View style={styles.closedTextWrap}>
              <Text style={styles.closedEyebrow}>Location</Text>
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
            <View style={{ flex: 1 }}>
              <Text style={styles.openTitle}>Select Location</Text>
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
              {locationRows.map(({ location, count }, index) => {
                const isSelected = selectedLocation?.id === location.id;
                const isPendingSelection = pendingSelectionId === location.id;
                const metaLabel = getRowMetaLabel(count, isSelected);
                const locationTone = getLocationTone(location);

                return (
                  <Animated.View
                    key={location.id}
                    style={[
                      isPendingSelection
                        ? {
                            transform: [
                              { scale: pendingRowScale },
                              { translateY: pendingRowTranslateY },
                            ],
                          }
                        : null,
                    ]}
                  >
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={`Switch to ${location.name}`}
                      activeOpacity={0.86}
                      onPress={() => handleSelect(location)}
                      style={[
                        styles.locationRow,
                        index < locationRows.length - 1 ? styles.locationRowSpacing : null,
                        isSelected
                          ? {
                              backgroundColor: locationTone.selectedBackground,
                              borderColor: locationTone.selectedBorder,
                            }
                          : null,
                      ]}
                    >
                      <Animated.View
                        style={[
                          styles.rowIndicatorShell,
                          {
                            backgroundColor: locationTone.surface,
                            borderColor: isSelected
                              ? locationTone.border
                              : 'rgba(255,255,255,0.06)',
                          },
                          isPendingSelection
                            ? { transform: [{ scale: pendingIndicatorScale }] }
                            : null,
                        ]}
                      >
                        <View
                          style={[
                            styles.rowLocationDot,
                            {
                              backgroundColor: locationTone.dot,
                              shadowColor: locationTone.dot,
                              shadowOpacity: isSelected ? 0.34 : 0.18,
                            },
                          ]}
                        />
                      </Animated.View>

                      <View style={{ flex: 1, paddingRight: ds.spacing(12) }}>
                        <Text
                          style={[
                            styles.locationName,
                            isSelected ? styles.selectedLocationName : null,
                          ]}
                          numberOfLines={1}
                        >
                          {getDisplayLocationName(location)}
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
                        <View
                          style={[
                            styles.selectedIndicator,
                            { backgroundColor: locationTone.dot },
                          ]}
                        >
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
                  </Animated.View>
                );
              })}
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
    paddingHorizontal: 18,
  },
  indicatorShell: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: glassHairlineWidth,
    marginRight: 14,
    position: 'relative',
  },
  locationDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 10,
    elevation: 2,
  },
  confirmationRing: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
  },
  closedTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  closedEyebrow: {
    color: 'rgba(255,255,255,0.56)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  closedLabel: {
    marginTop: 4,
    color: '#FFFFFF',
    fontSize: 18,
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
    paddingTop: OPEN_CONTENT_TOP_PADDING,
    paddingHorizontal: 12,
    paddingBottom: OPEN_CONTENT_BOTTOM_PADDING,
  },
  openHeader: {
    minHeight: OPEN_HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  openTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  rowsContent: {
    paddingHorizontal: 4,
    paddingBottom: ROWS_BOTTOM_PADDING,
  },
  locationRow: {
    minHeight: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 22,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: glassHairlineWidth,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  locationRowSpacing: {
    marginBottom: ROW_GAP,
  },
  rowIndicatorShell: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: glassHairlineWidth,
    marginRight: 14,
  },
  rowLocationDot: {
    width: 15,
    height: 15,
    borderRadius: 7.5,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 10,
    elevation: 2,
  },
  locationName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  selectedLocationName: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  locationMeta: {
    marginTop: 4,
    color: 'rgba(255,255,255,0.56)',
    fontSize: 13,
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
});
