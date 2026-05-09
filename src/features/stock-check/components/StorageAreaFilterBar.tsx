import React, { memo, useCallback, useMemo, useRef } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { triggerSelectionHaptic } from '@/lib/haptics';
import {
  colors,
  glassColors,
  glassHairlineWidth,
  glassRadii,
  grayScale,
} from '@/theme/design';

export interface StorageAreaFilterOption {
  id: string;
  label: string;
  badgeCount: number;
}

interface StorageAreaFilterBarProps {
  options: StorageAreaFilterOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPressMore: () => void;
}

interface FilterPillProps extends StorageAreaFilterOption {
  isSelected: boolean;
  onSelect: (id: string) => void;
}

const MORE_BUTTON_SIZE = 40;

const FilterPill = memo(function FilterPill({
  id,
  label,
  badgeCount,
  isSelected,
  onSelect,
}: FilterPillProps) {
  const ds = useScaledStyles();
  const handlePress = useCallback(() => {
    void triggerSelectionHaptic();
    onSelect(id);
  }, [id, onSelect]);

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={`${label}${badgeCount > 0 ? `, ${badgeCount} unchecked` : ''}`}
      onPress={handlePress}
      activeOpacity={0.85}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: ds.spacing(16),
        paddingVertical: ds.spacing(9),
        borderRadius: glassRadii.pill,
        backgroundColor: isSelected ? colors.black : colors.white,
        borderWidth: glassHairlineWidth,
        borderColor: isSelected ? colors.black : glassColors.cardBorder,
      }}
    >
      <Text
        style={{
          fontSize: ds.fontSize(14),
          fontWeight: isSelected ? '700' : '600',
          color: isSelected ? colors.white : glassColors.textPrimary,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
      {badgeCount > 0 ? (
        <View
          style={{
            marginLeft: ds.spacing(8),
            minWidth: 22,
            height: 22,
            paddingHorizontal: 7,
            borderRadius: glassRadii.pill,
            backgroundColor: isSelected ? grayScale[700] : grayScale[200],
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontSize: ds.fontSize(11),
              fontWeight: '700',
              color: isSelected ? colors.white : glassColors.textPrimary,
            }}
          >
            {badgeCount}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
});

interface MoreButtonProps {
  onPress: () => void;
}

const MoreButton = memo(function MoreButton({ onPress }: MoreButtonProps) {
  const ds = useScaledStyles();
  const handlePress = useCallback(() => {
    void triggerSelectionHaptic();
    onPress();
  }, [onPress]);
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Show all stations"
      accessibilityHint="Opens a list of every storage area"
      onPress={handlePress}
      activeOpacity={0.85}
      style={{
        width: MORE_BUTTON_SIZE,
        height: MORE_BUTTON_SIZE,
        borderRadius: glassRadii.round,
        backgroundColor: colors.white,
        borderWidth: glassHairlineWidth,
        borderColor: glassColors.cardBorder,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons
        name="chevron-down"
        size={ds.icon(18)}
        color={glassColors.textPrimary}
      />
    </TouchableOpacity>
  );
});

/**
 * StorageAreaFilterBar
 *
 * Layout: a horizontally scrolling rail of station pills with two affordances
 * pinned beside the rail to make overflow obvious to the user:
 *
 *   • A right-edge `LinearGradient` fades the trailing pill into the
 *     background, so the user can tell more content lives off-screen even at
 *     a glance, without scrolling.
 *   • A sticky "More" button (chevron-down) sits next to the rail and opens
 *     the full station list in a bottom sheet — the discovery escape hatch.
 *
 * The fade is hidden when the user has scrolled to the end of the content,
 * mirroring the pattern used by iOS App Store category lists.
 */
export const StorageAreaFilterBar = memo(function StorageAreaFilterBar({
  options,
  selectedId,
  onSelect,
  onPressMore,
}: StorageAreaFilterBarProps) {
  const ds = useScaledStyles();
  const scrollRef = useRef<ScrollView | null>(null);
  const fadeRef = useRef<View | null>(null);
  const lastFadeOpacityRef = useRef(1);

  // Imperative opacity update on the fade view avoids re-rendering the entire
  // pill rail on every onScroll tick — vital when the list is wide.
  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const distanceFromEnd =
        contentSize.width - (contentOffset.x + layoutMeasurement.width);
      const nextOpacity = Math.max(0, Math.min(1, distanceFromEnd / 24));
      if (Math.abs(nextOpacity - lastFadeOpacityRef.current) < 0.05) {
        return;
      }
      lastFadeOpacityRef.current = nextOpacity;
      fadeRef.current?.setNativeProps({
        style: { opacity: nextOpacity },
      });
    },
    [],
  );

  const fadeColors = useMemo(
    () => [
      'rgba(247, 245, 242, 0)',
      'rgba(247, 245, 242, 0.85)',
      'rgba(247, 245, 242, 1)',
    ],
    [],
  );

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <View style={{ flex: 1, position: 'relative' }}>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onScroll={handleScroll}
          scrollEventThrottle={32}
          contentContainerStyle={{
            gap: ds.spacing(8),
            paddingVertical: ds.spacing(2),
            paddingRight: ds.spacing(28),
          }}
        >
          {options.map((opt) => (
            <FilterPill
              key={opt.id}
              id={opt.id}
              label={opt.label}
              badgeCount={opt.badgeCount}
              isSelected={opt.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </ScrollView>

        <View
          ref={fadeRef}
          pointerEvents="none"
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: 36,
          }}
        >
          <LinearGradient
            colors={fadeColors as unknown as [string, string, ...string[]]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{ flex: 1 }}
          />
        </View>
      </View>

      <View style={{ marginLeft: ds.spacing(8) }}>
        <MoreButton onPress={onPressMore} />
      </View>
    </View>
  );
});
