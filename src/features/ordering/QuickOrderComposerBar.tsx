import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardEvent,
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { triggerSelectionHaptic } from '@/lib/haptics';
import { colors, grayScale } from '@/theme/design';
import { isMessageSubmittable } from './quickOrderComposer';

type QuickOrderComposerBarProps = {
  onSubmit: (text: string) => void;
  isSending: boolean;
  bottomInset: number;
  tabBarHeight: number;
  onHeightChange?: (height: number) => void;
  placeholder?: string;
};

const SEND_BUTTON_SIZE = 36;
const LINE_HEIGHT = 22;
// Vertical padding inside the input pill. Chosen so a single line (LINE_HEIGHT
// = 22) + 2 * padding (7) equals SEND_BUTTON_SIZE (36), so the input pill is
// visually the same height as the send button at rest.
const INPUT_VERTICAL_PADDING = 7;
const MIN_INPUT_HEIGHT = LINE_HEIGHT + INPUT_VERTICAL_PADDING * 2;
const MAX_INPUT_LINES = 35;
const MAX_INPUT_HEIGHT = LINE_HEIGHT * MAX_INPUT_LINES + INPUT_VERTICAL_PADDING * 2;
const TRANSITION_MS = 180;
const KEYBOARD_FALLBACK_MS = 220;

const AnimatedIonicons = Animated.createAnimatedComponent(Ionicons);

function QuickOrderComposerBarImpl({
  onSubmit,
  isSending,
  bottomInset,
  tabBarHeight,
  onHeightChange,
  placeholder = 'Type an order…',
}: QuickOrderComposerBarProps) {
  const ds = useScaledStyles();

  const [text, setText] = useState('');

  const submittable = isMessageSubmittable(text, isSending);

  // Drive the send-button color transition on the UI thread so it doesn't
  // schedule a React re-render on every keystroke.
  const activeProgress = useSharedValue(0);
  useEffect(() => {
    activeProgress.value = withTiming(submittable ? 1 : 0, {
      duration: TRANSITION_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [activeProgress, submittable]);

  const sendButtonAnimatedStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      activeProgress.value,
      [0, 1],
      [grayScale[200], colors.primary],
    ),
  }));

  const sendIconAnimatedStyle = useAnimatedStyle(() => ({
    color: interpolateColor(
      activeProgress.value,
      [0, 1],
      [colors.textMuted, colors.textOnPrimary],
    ),
  }));

  // Track the keyboard so the composer rides above it. Listening directly
  // (instead of KeyboardAvoidingView) keeps the animation in lockstep with the
  // OS keyboard on iOS and avoids fighting Android's adjustResize.
  const restingBottomRef = useRef(tabBarHeight);
  const keyboardBottom = useSharedValue(tabBarHeight);

  useEffect(() => {
    restingBottomRef.current = tabBarHeight;
    keyboardBottom.value = withTiming(tabBarHeight, {
      duration: TRANSITION_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [keyboardBottom, tabBarHeight]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (event: KeyboardEvent) => {
      const target = Math.max(event.endCoordinates.height, restingBottomRef.current);
      const duration = event.duration && event.duration > 0
        ? event.duration
        : KEYBOARD_FALLBACK_MS;
      keyboardBottom.value = withTiming(target, {
        duration,
        easing: Easing.out(Easing.cubic),
      });
    };
    const onHide = (event: KeyboardEvent) => {
      const duration = event?.duration && event.duration > 0
        ? event.duration
        : KEYBOARD_FALLBACK_MS;
      keyboardBottom.value = withTiming(restingBottomRef.current, {
        duration,
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

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      onHeightChange?.(event.nativeEvent.layout.height);
    },
    [onHeightChange],
  );

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || isSending) return;
    void triggerSelectionHaptic();
    onSubmit(trimmed);
    setText('');
  }, [isSending, onSubmit, text]);

  const safeBottomPadding = bottomInset > 0 ? ds.spacing(8) : ds.spacing(10);

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        bar: {
          paddingHorizontal: ds.spacing(12),
          paddingTop: ds.spacing(8),
          paddingBottom: safeBottomPadding,
          gap: ds.spacing(8),
        },
        // The wrapper handles minHeight/maxHeight; the TextInput inside is
        // unsized so it auto-grows up to maxHeight, then RN's native
        // scrolling kicks in.
        inputWrapper: {
          borderRadius: ds.radius(18),
          paddingHorizontal: ds.spacing(14),
          paddingVertical: INPUT_VERTICAL_PADDING,
          minHeight: MIN_INPUT_HEIGHT,
          maxHeight: MAX_INPUT_HEIGHT,
        },
        input: {
          fontSize: ds.fontSize(16),
        },
        sendButton: {
          width: SEND_BUTTON_SIZE,
          height: SEND_BUTTON_SIZE,
          borderRadius: SEND_BUTTON_SIZE / 2,
        },
      }),
    [ds, safeBottomPadding],
  );

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.container, containerAnimatedStyle]}
      onLayout={handleLayout}
    >
      <View style={[styles.bar, dynamicStyles.bar]}>
        <View style={[styles.inputWrapper, dynamicStyles.inputWrapper]}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            multiline
            editable={!isSending}
            style={[styles.input, dynamicStyles.input]}
            accessibilityLabel="Order message"
            accessibilityHint="Type the items you want to order, then press send."
            textAlignVertical="top"
            keyboardAppearance="light"
            returnKeyType="default"
            blurOnSubmit={false}
          />
        </View>
        <Pressable
          onPress={handleSubmit}
          disabled={!submittable}
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={{ disabled: !submittable }}
          hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          style={({ pressed }) => [
            styles.sendButtonPressable,
            dynamicStyles.sendButton,
            { opacity: !submittable ? 1 : pressed ? 0.85 : 1 },
          ]}
        >
          <Animated.View
            style={[styles.sendButtonFill, dynamicStyles.sendButton, sendButtonAnimatedStyle]}
            pointerEvents="none"
          >
            <AnimatedIonicons
              name="arrow-up"
              size={20}
              style={sendIconAnimatedStyle}
            />
          </Animated.View>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: 'transparent',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  inputWrapper: {
    flex: 1,
    backgroundColor: colors.glassCircle,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: grayScale[200],
    justifyContent: 'flex-start',
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 6,
  },
  input: {
    color: colors.textPrimary,
    lineHeight: LINE_HEIGHT,
    padding: 0,
    margin: 0,
    fontWeight: '500',
  },
  sendButtonPressable: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 6,
  },
  sendButtonFill: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export const QuickOrderComposerBar = React.memo(
  QuickOrderComposerBarImpl,
  (prev, next) =>
    prev.isSending === next.isSending &&
    prev.bottomInset === next.bottomInset &&
    prev.tabBarHeight === next.tabBarHeight &&
    prev.placeholder === next.placeholder &&
    prev.onSubmit === next.onSubmit &&
    prev.onHeightChange === next.onHeightChange,
);
