import React, { memo, useCallback, useEffect, useMemo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { GlassSurface } from '@/components/ui';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
} from '@/theme/design';
import { LocationSwitcherDropdown } from './LocationSwitcherDropdown';
import type { Location } from '@/types';

type HeaderIconName = React.ComponentProps<typeof Ionicons>['name'];

interface StockCheckHeaderProps {
  locationLabel: string;
  locations: Location[];
  selectedLocationId: string | null;
  isDropdownOpen: boolean;
  onToggleDropdown: () => void;
  onSelectLocation: (location: Location) => void;
  onCloseDropdown: () => void;
  onPressMore?: () => void;
  moreAccessibilityLabel?: string;
  moreIconName?: HeaderIconName;
}

const ELLIPSIS_BUTTON_SIZE = 40;
const CHEVRON_TIMING = { duration: 200, easing: Easing.bezier(0.2, 0, 0.2, 1) };

/**
 * Compact, sticky-friendly header for the Stock Check screen.
 *
 * The "Stock Check" title and date subheader were removed in a prior pass —
 * this header is now a single row with two affordances:
 *   • A wide location selector pill (flex: 1) that opens an animated dropdown
 *     of all locations when tapped. The trailing chevron rotates 180° in
 *     lock-step with the dropdown's open progress for a tightly-coupled feel.
 *   • A 40×40 ellipsis-menu button beside it for future meta actions.
 *
 * The dropdown overlay is rendered as a sibling immediately below the pill so
 * it doesn't push the rest of the sticky header (progress bar, station pills)
 * down on open — the menu animates over them as a layered overlay.
 */
export const StockCheckHeader = memo(function StockCheckHeader({
  locationLabel,
  locations,
  selectedLocationId,
  isDropdownOpen,
  onToggleDropdown,
  onSelectLocation,
  onCloseDropdown,
  onPressMore,
  moreAccessibilityLabel = 'More options',
  moreIconName = 'ellipsis-horizontal',
}: StockCheckHeaderProps) {
  const ds = useScaledStyles();
  const chevronProgress = useSharedValue(isDropdownOpen ? 1 : 0);

  useEffect(() => {
    chevronProgress.value = withTiming(
      isDropdownOpen ? 1 : 0,
      CHEVRON_TIMING,
    );
  }, [chevronProgress, isDropdownOpen]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronProgress.value * 180}deg` }],
  }));

  const handlePressLocation = useCallback(() => {
    onToggleDropdown();
  }, [onToggleDropdown]);

  const handleSelect = useCallback(
    (location: Location) => {
      onSelectLocation(location);
      onCloseDropdown();
    },
    [onCloseDropdown, onSelectLocation],
  );

  const sortedLocations = useMemo(
    () => [...locations].sort((a, b) => a.name.localeCompare(b.name)),
    [locations],
  );

  return (
    <View
      style={{
        zIndex: 10,
        paddingTop: ds.spacing(2),
        paddingBottom: ds.spacing(12),
        // `position: relative` is required so the absolutely-positioned
        // dropdown overlay below anchors to THIS container, floating over
        // siblings (progress bar, station rail) instead of pushing them down.
        position: 'relative',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <GlassSurface
          intensity="medium"
          style={{
            flex: 1,
            marginRight: ds.spacing(8),
            borderRadius: glassRadii.pill,
          }}
        >
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Active location ${locationLabel}. Tap to change.`}
            accessibilityHint="Opens the location switcher"
            accessibilityState={{ expanded: isDropdownOpen }}
            onPress={handlePressLocation}
            disabled={locations.length === 0}
            activeOpacity={0.75}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              minHeight: 48,
              paddingHorizontal: ds.spacing(16),
            }}
          >
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: glassRadii.round,
                backgroundColor: glassColors.accent,
                marginRight: ds.spacing(10),
              }}
            />
            <Text
              style={{
                flex: 1,
                fontSize: ds.fontSize(16),
                fontWeight: '700',
                color: glassColors.textPrimary,
                letterSpacing: -0.2,
              }}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {locationLabel}
            </Text>
            <Animated.View style={[{ marginLeft: ds.spacing(8) }, chevronStyle]}>
              <Ionicons
                name="chevron-down"
                size={ds.icon(18)}
                color={glassColors.textSecondary}
              />
            </Animated.View>
          </TouchableOpacity>
        </GlassSurface>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={moreAccessibilityLabel}
          onPress={onPressMore}
          activeOpacity={0.7}
          hitSlop={8}
          style={{
            width: ELLIPSIS_BUTTON_SIZE,
            height: ELLIPSIS_BUTTON_SIZE,
            borderRadius: glassRadii.round,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(255, 255, 255, 1)',
            borderWidth: glassHairlineWidth,
            borderColor: glassColors.cardBorder,
          }}
        >
          <Ionicons
            name={moreIconName}
            size={ds.icon(18)}
            color={glassColors.textSecondary}
          />
        </TouchableOpacity>
      </View>

      {/*
        Dropdown floats as an absolute overlay anchored to the bottom of the
        pill row. It sits over the progress bar / station rail when open,
        instead of pushing them down. Width matches the location pill (the
        ellipsis menu sits beyond the pill, so the menu visually aligns).
      */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: ds.spacing(2) + 48 + ds.spacing(4),
          left: 0,
          right: ELLIPSIS_BUTTON_SIZE + ds.spacing(8),
        }}
      >
        <LocationSwitcherDropdown
          isOpen={isDropdownOpen}
          locations={sortedLocations}
          selectedLocationId={selectedLocationId}
          onSelect={handleSelect}
          onRequestClose={onCloseDropdown}
        />
      </View>
    </View>
  );
});
