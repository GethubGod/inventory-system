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
import { glassHairlineWidth, radii, tipsTheme } from '@/theme/design';
import type { InventoryItem } from '@/types';
import { unitForInventoryItem } from '../checklistSelection';

/**
 * Pinned bottom stack, floating above the pill toolbar: optional note chip →
 * search results card while typing → the add-item bar (search field with the
 * mic inside, red send circle with a count badge; gray at zero). Send opens
 * the Review order sheet.
 */

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
  /** Note chip above the bar ("Note added · edit"). */
  hasNote: boolean;
  onPressNote: () => void;
  /** Resting bottom offset (pill toolbar clearance). */
  restingBottom: number;
  onHeightChange?: (height: number) => void;
}

const KEYBOARD_FALLBACK_MS = 220;
const MAX_RESULTS_HEIGHT = 288;
const SEND_SIZE = 46;

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
  hasNote,
  onPressNote,
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
      const target = Math.max(event.endCoordinates.height + 12, restingBottomRef.current);
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
            borderBottomColor: 'rgba(0, 0, 0, 0.05)',
          }}
        >
          <View style={{ flex: 1, paddingRight: ds.spacing(8) }}>
            <Text
              numberOfLines={1}
              style={{
                fontSize: ds.fontSize(14),
                fontWeight: '600',
                color: alreadySelected ? tipsTheme.ink3 : tipsTheme.ink,
              }}
            >
              {item.name}
            </Text>
            <Text style={{ fontSize: ds.fontSize(11), color: tipsTheme.ink3 }}>
              {unitForInventoryItem(item)}
            </Text>
          </View>
          <Ionicons
            name={alreadySelected ? 'checkmark' : 'add'}
            size={ds.icon(20)}
            color={alreadySelected ? '#22883E' : tipsTheme.accent}
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
          left: ds.spacing(14),
          right: ds.spacing(14),
        },
        containerAnimatedStyle,
      ]}
    >
      {hasNote ? (
        <TouchableOpacity
          onPress={onPressNote}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Note added, edit"
          style={{
            alignSelf: 'flex-start',
            flexDirection: 'row',
            alignItems: 'center',
            gap: ds.spacing(7),
            backgroundColor: tipsTheme.card,
            borderWidth: glassHairlineWidth,
            borderColor: 'rgba(0, 0, 0, 0.08)',
            borderRadius: radii.pill,
            paddingHorizontal: ds.spacing(13),
            paddingVertical: ds.spacing(7),
            marginBottom: ds.spacing(10),
          }}
        >
          <Ionicons name="create-outline" size={ds.icon(14)} color={tipsTheme.accent} />
          <Text style={{ fontSize: ds.fontSize(12), fontWeight: '600', color: tipsTheme.ink }}>
            Note added · edit
          </Text>
        </TouchableOpacity>
      ) : null}

      {showResults ? (
        <View
          style={{
            maxHeight: MAX_RESULTS_HEIGHT,
            marginBottom: ds.spacing(10),
            backgroundColor: tipsTheme.card,
            borderRadius: 18,
            borderWidth: glassHairlineWidth,
            borderColor: 'rgba(0, 0, 0, 0.08)',
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
                  color: tipsTheme.ink2,
                  textAlign: 'center',
                }}
              >
                No items match “{query.trim()}”
              </Text>
            </View>
          )}
        </View>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: ds.spacing(8),
          backgroundColor: tipsTheme.card,
          borderWidth: glassHairlineWidth,
          borderColor: 'rgba(0, 0, 0, 0.07)',
          borderRadius: 24,
          padding: ds.spacing(8),
          shadowColor: '#14120E',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.1,
          shadowRadius: 24,
          elevation: Platform.OS === 'android' ? 8 : 0,
        }}
      >
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: SEND_SIZE,
            backgroundColor: tipsTheme.page,
            borderRadius: radii.pill,
            paddingLeft: ds.spacing(15),
            paddingRight: ds.spacing(6),
          }}
        >
          <Ionicons
            name="search-outline"
            size={ds.icon(17)}
            color={tipsTheme.ink3}
            style={{ marginRight: ds.spacing(8) }}
          />
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={onQueryChange}
            placeholder="Add item"
            placeholderTextColor={tipsTheme.ink3}
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search inventory to add items"
            style={{
              flex: 1,
              fontSize: ds.fontSize(14),
              color: tipsTheme.ink,
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
              <Ionicons name="close-circle" size={ds.icon(18)} color={tipsTheme.ink3} />
            </TouchableOpacity>
          ) : null}
          {voiceAvailable ? (
            <TouchableOpacity
              onPress={handleMic}
              accessibilityRole="button"
              accessibilityLabel="Add items by voice"
              hitSlop={{ top: 10, bottom: 10, left: 4, right: 6 }}
              style={{
                width: 36,
                height: 36,
                borderRadius: radii.circle,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="mic-outline" size={ds.icon(20)} color={tipsTheme.accent} />
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
            width: SEND_SIZE,
            height: SEND_SIZE,
            borderRadius: radii.circle,
            backgroundColor: sendDisabled ? tipsTheme.disabled : tipsTheme.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="arrow-up" size={ds.icon(20)} color="#FFFFFF" />
          {checkedCount > 0 ? (
            <View
              style={{
                position: 'absolute',
                top: -4,
                right: -4,
                minWidth: 20,
                height: 18,
                paddingHorizontal: 6,
                borderRadius: radii.pill,
                backgroundColor: tipsTheme.ink,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text
                style={{ fontSize: ds.fontSize(10.5), fontWeight: '700', color: '#FFFFFF' }}
                numberOfLines={1}
              >
                {checkedCount}
              </Text>
            </View>
          ) : null}
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}
