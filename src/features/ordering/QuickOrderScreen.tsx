import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  KeyboardEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTabBarBottomInset } from '@/components/navigation';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { colors, glassColors, glassHairlineWidth } from '@/theme/design';
import type { OrderingMode } from './types';

type ParsedItemStatus = 'success' | 'warning';

type ParsedQuickOrderItem = {
  id: number;
  name: string;
  quantity: string;
  status: ParsedItemStatus;
};

type QuickOrderSuggestion = {
  text: string;
  actionAdd: string;
  actionSkip: string;
};

type QuickOrderMockData = {
  timestamp: string;
  userQuery: string;
  systemResponse: {
    parsedItems: ParsedQuickOrderItem[];
    suggestion: QuickOrderSuggestion;
  };
};

const QUICK_ORDER_MOCK_DATA: QuickOrderMockData = {
  timestamp: 'Saturday · 11:31',
  userQuery: 'salmon 2, tuna 3, ginger',
  systemResponse: {
    parsedItems: [
      { id: 1, name: 'Salmon', quantity: '2 lb', status: 'success' },
      { id: 2, name: 'Tuna belly', quantity: '3 lb', status: 'success' },
      { id: 3, name: 'Ginger', quantity: 'pick unit', status: 'warning' },
    ],
    suggestion: {
      text: 'Usually order eel on Saturdays. Add 2 lb?',
      actionAdd: 'Add',
      actionSkip: 'Skip',
    },
  },
};

type QuickOrderScreenProps = {
  mode: OrderingMode;
};

export function QuickOrderScreen({ mode }: QuickOrderScreenProps) {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();
  const tabBarHeight = 60 + getTabBarBottomInset(insets.bottom);
  const closedComposerOffset = tabBarHeight + ds.spacing(14);

  const [inputValue, setInputValue] = useState('');
  const [composerHeight, setComposerHeight] = useState(0);
  const [scrollBottomOffset, setScrollBottomOffset] = useState(closedComposerOffset);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [suggestionVisible, setSuggestionVisible] = useState(true);
  const [suggestionHeight, setSuggestionHeight] = useState(0);

  const userBubbleProgress = useSharedValue(0);
  const systemCardProgress = useSharedValue(0);
  const composerBottomOffset = useSharedValue(closedComposerOffset);
  const suggestionProgress = useSharedValue(1);

  const parsedItems = QUICK_ORDER_MOCK_DATA.systemResponse.parsedItems;
  const suggestion = QUICK_ORDER_MOCK_DATA.systemResponse.suggestion;

  useEffect(() => {
    userBubbleProgress.value = withTiming(1, {
      duration: 320,
      easing: Easing.out(Easing.cubic),
    });
    systemCardProgress.value = withDelay(
      180,
      withTiming(1, {
        duration: 360,
        easing: Easing.out(Easing.cubic),
      }),
    );
  }, [systemCardProgress, userBubbleProgress]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const moveComposer = (event: KeyboardEvent) => {
      const keyboardHeight = event.endCoordinates.height;
      const nextOffset =
        Platform.OS === 'ios'
          ? ds.spacing(8)
          : Math.max(keyboardHeight - insets.bottom, 0) + ds.spacing(8);

      composerBottomOffset.value = withTiming(nextOffset, {
        duration: event.duration ?? 240,
        easing: Easing.out(Easing.cubic),
      });
      setKeyboardVisible(true);
      setScrollBottomOffset(nextOffset);
    };

    const resetComposer = (event: KeyboardEvent) => {
      composerBottomOffset.value = withTiming(closedComposerOffset, {
        duration: event.duration ?? 220,
        easing: Easing.out(Easing.cubic),
      });
      setKeyboardVisible(false);
      setScrollBottomOffset(closedComposerOffset);
    };

    const showSubscription = Keyboard.addListener(showEvent, moveComposer);
    const hideSubscription = Keyboard.addListener(hideEvent, resetComposer);

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [closedComposerOffset, composerBottomOffset, ds, insets.bottom]);

  useEffect(() => {
    if (!keyboardVisible) {
      composerBottomOffset.value = closedComposerOffset;
      setScrollBottomOffset(closedComposerOffset);
    }
  }, [closedComposerOffset, composerBottomOffset, keyboardVisible]);

  const handleBackPress = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    if (mode.backBehavior !== 'back') {
      router.replace(mode.backBehavior.replace as never);
      return;
    }

    router.replace(mode.browseRoute as never);
  }, [mode.backBehavior, mode.browseRoute]);

  const handleClear = useCallback(() => {
    Keyboard.dismiss();
    setInputValue('');
    setSuggestionVisible(true);
    suggestionProgress.value = 1;
  }, [suggestionProgress]);

  const dismissSuggestion = useCallback(() => {
    suggestionProgress.value = withTiming(
      0,
      {
        duration: 220,
        easing: Easing.out(Easing.cubic),
      },
      (finished) => {
        if (finished) {
          runOnJS(setSuggestionVisible)(false);
        }
      },
    );
  }, [suggestionProgress]);

  const handleSubmitMore = useCallback(() => {
    if (!inputValue.trim()) {
      return;
    }

    Keyboard.dismiss();
    setInputValue('');
  }, [inputValue]);

  const handlePlaceOrder = useCallback(() => {
    Keyboard.dismiss();
  }, []);

  const userBubbleAnimatedStyle = useAnimatedStyle(() => ({
    opacity: userBubbleProgress.value,
    transform: [
      {
        translateX: interpolate(
          userBubbleProgress.value,
          [0, 1],
          [34, 0],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  const systemCardAnimatedStyle = useAnimatedStyle(() => ({
    opacity: systemCardProgress.value,
    transform: [
      {
        translateX: interpolate(
          systemCardProgress.value,
          [0, 1],
          [-18, 0],
          Extrapolation.CLAMP,
        ),
      },
      {
        translateY: interpolate(
          systemCardProgress.value,
          [0, 1],
          [24, 0],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  const composerAnimatedStyle = useAnimatedStyle(() => ({
    bottom: composerBottomOffset.value,
  }));

  const suggestionAnimatedStyle = useAnimatedStyle(() => ({
    height:
      suggestionHeight > 0
        ? interpolate(
            suggestionProgress.value,
            [0, 1],
            [0, suggestionHeight],
            Extrapolation.CLAMP,
          )
        : undefined,
    opacity: suggestionProgress.value,
    marginTop: interpolate(
      suggestionProgress.value,
      [0, 1],
      [0, 20],
      Extrapolation.CLAMP,
    ),
  }));

  const chatContentStyle = useMemo(
    () => ({
      paddingBottom: composerHeight + scrollBottomOffset + ds.spacing(24),
    }),
    [composerHeight, ds, scrollBottomOffset],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardAvoider}
      >
        <View style={styles.screen}>
          <View style={[styles.header, { paddingHorizontal: ds.spacing(20) }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hitSlop={12}
              onPress={handleBackPress}
              style={styles.headerIconButton}
            >
              <Ionicons name="chevron-back" size={30} color={colors.textPrimary} />
            </Pressable>

            <Text
              style={[styles.headerTitle, { fontSize: ds.fontSize(28) }]}
              numberOfLines={1}
            >
              Quick order
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear quick order"
              hitSlop={12}
              onPress={handleClear}
              style={styles.headerIconButton}
            >
              <Ionicons name="trash-outline" size={24} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.chatContent,
              { paddingHorizontal: ds.spacing(28) },
              chatContentStyle,
            ]}
          >
            <Text style={[styles.timestamp, { fontSize: ds.fontSize(20) }]}>
              {QUICK_ORDER_MOCK_DATA.timestamp}
            </Text>

            <Animated.View
              style={[
                styles.userBubble,
                {
                  borderRadius: ds.radius(28),
                  paddingHorizontal: ds.spacing(22),
                  paddingVertical: ds.spacing(14),
                },
                userBubbleAnimatedStyle,
              ]}
            >
              <Text style={[styles.userBubbleText, { fontSize: ds.fontSize(22) }]}>
                {QUICK_ORDER_MOCK_DATA.userQuery}
              </Text>
            </Animated.View>

            <Animated.View
              style={[
                styles.systemCard,
                {
                  borderRadius: ds.radius(24),
                  padding: ds.spacing(20),
                },
                systemCardAnimatedStyle,
              ]}
            >
              <View style={styles.cardHeader}>
                <Ionicons name="sparkles-outline" size={20} color={colors.textSecondary} />
                <Text style={[styles.cardHeaderText, { fontSize: ds.fontSize(22) }]}>
                  Got these
                </Text>
              </View>

              <View style={{ marginTop: ds.spacing(12) }}>
                {parsedItems.map((item) => (
                  <View key={item.id} style={[styles.parsedItemRow, { minHeight: ds.spacing(36) }]}>
                    <Ionicons
                      name={item.status === 'success' ? 'checkmark' : 'alert-circle-outline'}
                      size={22}
                      color={item.status === 'success' ? '#18A957' : '#FF9F0A'}
                    />
                    <Text style={[styles.parsedItemText, { fontSize: ds.fontSize(22) }]}>
                      {item.name} · {item.quantity}
                    </Text>
                  </View>
                ))}
              </View>

              {suggestionVisible && (
                <Animated.View
                  style={[styles.suggestionClip, suggestionAnimatedStyle]}
                >
                  <View
                    onLayout={(event) => setSuggestionHeight(event.nativeEvent.layout.height)}
                    style={[
                      styles.suggestionBox,
                      {
                        borderRadius: ds.radius(18),
                        padding: ds.spacing(20),
                      },
                    ]}
                  >
                    <Text style={[styles.suggestionText, { fontSize: ds.fontSize(22) }]}>
                      {suggestion.text}
                    </Text>
                    <View style={[styles.suggestionActions, { marginTop: ds.spacing(16) }]}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={suggestion.actionAdd}
                        onPress={dismissSuggestion}
                        style={({ pressed }) => [
                          styles.suggestionPrimaryButton,
                          {
                            minHeight: ds.spacing(50),
                            borderRadius: ds.radius(24),
                            opacity: pressed ? 0.82 : 1,
                          },
                        ]}
                      >
                        <Text style={[styles.suggestionPrimaryText, { fontSize: ds.fontSize(20) }]}>
                          {suggestion.actionAdd}
                        </Text>
                      </Pressable>

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={suggestion.actionSkip}
                        onPress={dismissSuggestion}
                        style={({ pressed }) => [
                          styles.suggestionSecondaryButton,
                          {
                            minHeight: ds.spacing(50),
                            borderRadius: ds.radius(24),
                            opacity: pressed ? 0.82 : 1,
                          },
                        ]}
                      >
                        <Text style={[styles.suggestionSecondaryText, { fontSize: ds.fontSize(20) }]}>
                          {suggestion.actionSkip}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                </Animated.View>
              )}
            </Animated.View>
          </ScrollView>

          <Animated.View
            onLayout={(event) => setComposerHeight(event.nativeEvent.layout.height)}
            style={[
              styles.composer,
              {
                left: ds.spacing(28),
                right: ds.spacing(28),
              },
              composerAnimatedStyle,
            ]}
          >
            <View
              style={[
                styles.inputPill,
                {
                  minHeight: ds.spacing(56),
                  borderRadius: ds.radius(28),
                  paddingLeft: ds.spacing(28),
                  paddingRight: ds.spacing(12),
                },
              ]}
            >
              <TextInput
                value={inputValue}
                onChangeText={setInputValue}
                placeholder="Add more..."
                placeholderTextColor="#A8A8A2"
                returnKeyType="send"
                onSubmitEditing={handleSubmitMore}
                style={[styles.input, { fontSize: ds.fontSize(22) }]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add more"
                onPress={handleSubmitMore}
                hitSlop={8}
                style={styles.sendButton}
              >
                <Ionicons name="arrow-up" size={25} color={colors.textPrimary} />
              </Pressable>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Place order"
              onPress={handlePlaceOrder}
              style={({ pressed }) => [
                styles.placeOrderButton,
                {
                  minHeight: ds.spacing(70),
                  borderRadius: ds.radius(35),
                  marginTop: ds.spacing(14),
                  opacity: pressed ? 0.88 : 1,
                },
              ]}
            >
              <Text style={[styles.placeOrderText, { fontSize: ds.fontSize(24) }]}>
                Place order  -&gt;
              </Text>
            </Pressable>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardAvoider: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    height: 62,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIconButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    color: colors.textPrimary,
    fontWeight: '700',
    marginLeft: 4,
  },
  chatContent: {
    paddingTop: 14,
  },
  timestamp: {
    alignSelf: 'center',
    color: '#8D8D88',
    fontWeight: '700',
    marginBottom: 18,
  },
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '88%',
    backgroundColor: colors.primary,
  },
  userBubbleText: {
    color: colors.textOnPrimary,
    fontWeight: '700',
    letterSpacing: 0,
  },
  systemCard: {
    marginTop: 18,
    backgroundColor: colors.white,
    shadowColor: '#111111',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 2,
    borderWidth: glassHairlineWidth,
    borderColor: glassColors.cardBorder,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardHeaderText: {
    color: '#8B8B86',
    fontWeight: '700',
    marginLeft: 8,
    letterSpacing: 0,
  },
  parsedItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  parsedItemText: {
    marginLeft: 12,
    color: colors.textPrimary,
    fontWeight: '500',
    letterSpacing: 0,
  },
  suggestionClip: {
    overflow: 'hidden',
  },
  suggestionBox: {
    backgroundColor: '#FFF2D9',
  },
  suggestionText: {
    color: '#704612',
    fontWeight: '600',
    lineHeight: 30,
    letterSpacing: 0,
  },
  suggestionActions: {
    flexDirection: 'row',
    gap: 12,
  },
  suggestionPrimaryButton: {
    flex: 1,
    backgroundColor: colors.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionSecondaryButton: {
    flex: 1,
    backgroundColor: '#EEE5D4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionPrimaryText: {
    color: colors.white,
    fontWeight: '800',
    letterSpacing: 0,
  },
  suggestionSecondaryText: {
    color: colors.black,
    fontWeight: '800',
    letterSpacing: 0,
  },
  composer: {
    position: 'absolute',
  },
  inputPill: {
    backgroundColor: colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#111111',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.03,
    shadowRadius: 12,
    elevation: 1,
  },
  input: {
    flex: 1,
    color: colors.textPrimary,
    fontWeight: '600',
    minHeight: 44,
    letterSpacing: 0,
  },
  sendButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeOrderButton: {
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeOrderText: {
    color: colors.textOnPrimary,
    fontWeight: '800',
    letterSpacing: 0,
  },
});
