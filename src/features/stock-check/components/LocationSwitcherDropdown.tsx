import React, { memo, useCallback, useEffect } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  colors,
  glassColors,
  glassHairlineWidth,
  glassRadii,
  grayScale,
} from '@/theme/design';
import type { Location } from '@/types';

/**
 * Visual tone of the dropdown surface.
 *  - `surface` (default): white card, used by the Stock Check / Browse headers.
 *  - `muted`: a solid gray card so it reads as distinct when it floats over
 *    another white card (the Quick Order list).
 */
type DropdownTone = 'surface' | 'muted';

interface LocationSwitcherDropdownProps {
  isOpen: boolean;
  locations: Location[];
  selectedLocationId: string | null;
  onSelect: (location: Location) => void;
  /**
   * Reserved for the parent — the dropdown itself doesn't render a tap-outside
   * scrim (that would require a screen-spanning overlay outside this
   * component's parent's coordinate space). The screen view dismisses on
   * scroll-begin and on chevron-toggle instead.
   */
  onRequestClose: () => void;
  tone?: DropdownTone;
}

const ROW_HEIGHT = 52;
const VERTICAL_PADDING = 8;
const MAX_VISIBLE_ROWS = 5;

const TIMING_OPEN = { duration: 220, easing: Easing.bezier(0.2, 0, 0.2, 1) };
const TIMING_CLOSE = { duration: 180, easing: Easing.bezier(0.4, 0, 0.6, 1) };

interface LocationRowProps {
  location: Location;
  isSelected: boolean;
  isLast: boolean;
  onSelect: (location: Location) => void;
  isMuted?: boolean;
}

const LocationRow = memo(function LocationRow({
  location,
  isSelected,
  isLast,
  onSelect,
  isMuted = false,
}: LocationRowProps) {
  const ds = useScaledStyles();
  const handlePress = useCallback(() => onSelect(location), [location, onSelect]);
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={`Switch to ${location.name}`}
      onPress={handlePress}
      activeOpacity={0.75}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        height: ROW_HEIGHT,
        paddingHorizontal: ds.spacing(16),
        borderBottomWidth: isLast ? 0 : glassHairlineWidth,
        borderBottomColor: isMuted ? grayScale[300] : glassColors.divider,
      }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: glassRadii.round,
          backgroundColor: isSelected ? glassColors.accent : glassColors.textMuted,
          marginRight: ds.spacing(12),
        }}
      />
      <Text
        style={{
          flex: 1,
          fontSize: ds.fontSize(15),
          fontWeight: isSelected ? '700' : '600',
          color: glassColors.textPrimary,
        }}
        numberOfLines={1}
      >
        {location.name}
      </Text>
      {isSelected ? (
        <Ionicons
          name="checkmark"
          size={ds.icon(18)}
          color={glassColors.accent}
        />
      ) : null}
    </TouchableOpacity>
  );
});

/**
 * LocationSwitcherDropdown
 *
 * Anchored, animated dropdown that drops down from beneath the location pill.
 * Uses Reanimated's worklet-driven animations so opening/closing never blocks
 * the JS thread (the parent header chevron can rotate in lock-step).
 *
 * Layout strategy:
 *  - The dropdown is rendered inside the sticky header. We animate its
 *    `maxHeight` from 0 → naturalMaxHeight on open and back on close. This
 *    avoids absolute positioning gymnastics across safe areas.
 *  - A subtle scrim fades behind the menu so the user understands it's modal-
 *    like (a tap outside dismisses it).
 *  - Once `naturalMaxHeight` is reached the inner ScrollView handles overflow
 *    if there are more than `MAX_VISIBLE_ROWS` locations.
 */
export const LocationSwitcherDropdown = memo(function LocationSwitcherDropdown({
  isOpen,
  locations,
  selectedLocationId,
  onSelect,
  onRequestClose,
  tone = 'surface',
}: LocationSwitcherDropdownProps) {
  const isMuted = tone === 'muted';
  const progress = useSharedValue(isOpen ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(
      isOpen ? 1 : 0,
      isOpen ? TIMING_OPEN : TIMING_CLOSE,
    );
  }, [isOpen, progress]);

  const visibleRowCount = Math.min(locations.length, MAX_VISIBLE_ROWS);
  const naturalHeight =
    visibleRowCount * ROW_HEIGHT + VERTICAL_PADDING * 2;

  const containerStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    // Grow out from the pill: with the transform origin pinned to the top-right
    // (where the pill sits), the menu starts at roughly pill size and expands
    // downward + outward, so it reads as the pill itself enlarging. The top-right
    // corner stays put, so it never rises above where the pill was.
    transform: [{ scale: 0.38 + progress.value * 0.62 }],
  }));

  const isClosed = !isOpen;

  return (
    <Animated.View
      pointerEvents={isClosed ? 'none' : 'auto'}
      style={[
        {
          // Same pale tone as the collapsed location pill so the open menu reads
          // as that pill grown larger, not a separate surface.
          backgroundColor: isMuted ? '#F2F2F7' : colors.white,
          alignSelf: 'flex-end',
          minWidth: 280,
          borderRadius: glassRadii.surface,
          borderWidth: isMuted ? 0 : glassHairlineWidth,
          borderColor: glassColors.cardBorder,
          overflow: 'hidden',
          // Pin growth to the top-right corner — where the pill lives — so the
          // expansion appears to originate from the pill.
          transformOrigin: 'top right',
          shadowColor: 'rgba(15, 23, 42, 0.35)',
          shadowOpacity: isMuted ? 0.22 : 0.16,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 12 },
          elevation: 6,
        },
        containerStyle,
      ]}
    >
      <ScrollView
        style={{ maxHeight: naturalHeight }}
        contentContainerStyle={{ paddingVertical: VERTICAL_PADDING }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {locations.map((loc, index) => (
          <LocationRow
            key={loc.id}
            location={loc}
            isSelected={loc.id === selectedLocationId}
            isLast={index === locations.length - 1}
            onSelect={onSelect}
            isMuted={isMuted}
          />
        ))}
      </ScrollView>
    </Animated.View>
  );
});
