import React, { useCallback, useEffect, useRef } from 'react';
import {
  FlatList,
  Keyboard,
  KeyboardEvent,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { triggerImpactHaptic, triggerSelectionHaptic } from '@/lib/haptics';
import {
  colors,
  glassColors,
  glassHairlineWidth,
  glassRadii,
} from '@/theme/design';
import type { InventoryItem } from '@/types';
import { unitForInventoryItem } from '../checklistSelection';

interface PinnedOrderBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  results: InventoryItem[];
  /** Inventory item ids already checked on the checklist. */
  selectedItemIds: Set<string>;
  onAddItem: (item: InventoryItem) => void;
  checkedCount: number;
  onPressSend: () => void;
  voiceAvailable: boolean;
  onPressMic: () => void;
  /** Resting bottom offset (tab bar clearance). */
  restingBottom: number;
  onHeightChange?: (height: number) => void;
}

const KEYBOARD_FALLBACK_MS = 220;
const MAX_RESULTS_HEIGHT = 288;

export function PinnedOrderBar({
  query,
  onQueryChange,
  results,
  selectedItemIds,
  onAddItem,
  checkedCount,
  onPressSend,
  voiceAvailable,
  onPressMic,
  restingBottom,
  onHeightChange,
}: PinnedOrderBarProps) {
  const ds = useScaledStyles();
  const inputRef = useRef<TextInput>(null);

  // Track the keyboard directly (same pattern as QuickOrderComposerBar) so
  // the bar stays in lockstep with the OS keyboard animation on iOS.
  const restingBottomRef = useRef(restingBottom);
  const keyboardBottom = useSharedValue(restingBottom);

  useEffect(() => {
    restingBottomRef.current = restingBottom;
    keyboardBottom.value = withTiming(restingBottom, {
      duration: KEYBOARD_FALLBACK_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [keyboardBottom, restingBottom]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (event: KeyboardEvent) => {
      const target = Math.max(event.endCoordinates.height, restingBottomRef.current);
      keyboardBottom.value = withTiming(target, {
        duration: event.duration && event.duration > 0 ? event.duration : KEYBOARD_FALLBACK_MS,
        easing: Easing.out(Easing.cubic),
      });
    };
    const onHide = (event: KeyboardEvent) => {
      keyboardBottom.value = withTiming(restingBottomRef.current, {
        duration: event?.duration && event.duration > 0 ? event.duration : KEYBOARD_FALLBACK_MS,
        easing: Easing.out(Easing.cubic),
      });
    };

    const showSub = Keyboard.addListener(showEvent, onShow);
    const hideSub = Keyboard.addListener(hideEvent, onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [keyboardBottom]);

  const containerAnimatedStyle = useAnimatedStyle(() => ({
    bottom: keyboardBottom.value,
  }));

  const handleAdd = useCallback(
    (item: InventoryItem) => {
      void triggerSelectionHaptic();
      onAddItem(item);
      onQueryChange('');
    },
    [onAddItem, onQueryChange],
  );

  const handleSend = useCallback(() => {
    Keyboard.dismiss();
    onPressSend();
  }, [onPressSend]);

  const handleMic = useCallback(() => {
    void triggerImpactHaptic();
    Keyboard.dismiss();
    onPressMic();
  }, [onPressMic]);

  const showResults = query.trim().length > 0;
  const sendDisabled = checkedCount === 0;

  const renderResult = useCallback(
    ({ item, index }: { item: InventoryItem; index: number }) => {
      const alreadySelected = selectedItemIds.has(item.id);
      return (
        <TouchableOpacity
          onPress={() => handleAdd(item)}
          disabled={alreadySelected}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel={
            alreadySelected ? `${item.name}, already on order` : `Add ${item.name}`
          }
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: 48,
            paddingHorizontal: ds.spacing(14),
            borderBottomWidth: index === results.length - 1 ? 0 : glassHairlineWidth,
            borderBottomColor: glassColors.divider,
          }}
        >
          <View style={{ flex: 1, paddingRight: ds.spacing(8) }}>
            <Text
              numberOfLines={1}
              style={{
                fontSize: ds.fontSize(15),
                fontWeight: '600',
                color: alreadySelected
                  ? glassColors.textMuted
                  : glassColors.textPrimary,
              }}
            >
              {item.name}
            </Text>
            <Text style={{ fontSize: ds.fontSize(11), color: glassColors.textMuted }}>
              {unitForInventoryItem(item)}
            </Text>
          </View>
          <Ionicons
            name={alreadySelected ? 'checkmark-circle' : 'add-circle-outline'}
            size={ds.icon(24)}
            color={alreadySelected ? glassColors.successText : glassColors.accent}
          />
        </TouchableOpacity>
      );
    },
    [ds, handleAdd, results.length, selectedItemIds],
  );

  return (
    <Animated.View
      pointerEvents="box-none"
      onLayout={(event) => onHeightChange?.(event.nativeEvent.layout.height)}
      style={[
        {
          position: 'absolute',
          left: ds.spacing(16),
          right: ds.spacing(16),
        },
        containerAnimatedStyle,
      ]}
    >
      {showResults ? (
        <View
          style={{
            maxHeight: MAX_RESULTS_HEIGHT,
            marginBottom: ds.spacing(8),
            backgroundColor: colors.white,
            borderRadius: glassRadii.surface,
            borderWidth: glassHairlineWidth,
            borderColor: glassColors.cardBorder,
            overflow: 'hidden',
          }}
        >
          {results.length > 0 ? (
            <FlatList
              data={results}
              keyExtractor={(item) => item.id}
              renderItem={renderResult}
              keyboardShouldPersistTaps="handled"
            />
          ) : (
            <View
              style={{
                minHeight: 56,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: ds.spacing(16),
              }}
            >
              <Text
                style={{
                  fontSize: ds.fontSize(13),
                  color: glassColors.textSecondary,
                  textAlign: 'center',
                }}
              >
                No inventory items match “{query.trim()}”.
              </Text>
            </View>
          )}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: 48,
            backgroundColor: colors.white,
            borderWidth: glassHairlineWidth,
            borderColor: glassColors.cardBorder,
            borderRadius: glassRadii.pill,
            paddingLeft: ds.spacing(14),
            paddingRight: ds.spacing(6),
            marginRight: ds.spacing(8),
          }}
        >
          <Ionicons
            name="search-outline"
            size={ds.icon(17)}
            color={glassColors.textMuted}
            style={{ marginRight: ds.spacing(8) }}
          />
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={onQueryChange}
            placeholder="Add item…"
            placeholderTextColor={glassColors.textMuted}
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search inventory to add items"
            style={{
              flex: 1,
              fontSize: ds.fontSize(15),
              color: glassColors.textPrimary,
              paddingVertical: 0,
            }}
          />
          {query.length > 0 ? (
            <TouchableOpacity
              onPress={() => onQueryChange('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
              style={{ padding: ds.spacing(6) }}
            >
              <Ionicons
                name="close-circle"
                size={ds.icon(18)}
                color={glassColors.textMuted}
              />
            </TouchableOpacity>
          ) : null}
          {voiceAvailable ? (
            <TouchableOpacity
              onPress={handleMic}
              accessibilityRole="button"
              accessibilityLabel="Add items by voice"
              hitSlop={{ top: 10, bottom: 10, left: 4, right: 6 }}
              style={{ padding: ds.spacing(6) }}
            >
              <Ionicons name="mic-outline" size={ds.icon(20)} color={glassColors.accent} />
            </TouchableOpacity>
          ) : null}
        </View>

        <TouchableOpacity
          onPress={handleSend}
          disabled={sendDisabled}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ disabled: sendDisabled }}
          accessibilityLabel={
            sendDisabled
              ? 'Send order, no items selected'
              : `Send order with ${checkedCount} ${checkedCount === 1 ? 'item' : 'items'}`
          }
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 48,
            paddingHorizontal: ds.spacing(16),
            borderRadius: glassRadii.pill,
            backgroundColor: sendDisabled ? glassColors.textMuted : colors.primary,
          }}
        >
          <Text
            style={{
              fontSize: ds.fontSize(16),
              fontWeight: '700',
              color: colors.white,
              marginRight: ds.spacing(6),
            }}
          >
            {checkedCount}
          </Text>
          <Ionicons name="arrow-up" size={ds.icon(18)} color={colors.white} />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}
