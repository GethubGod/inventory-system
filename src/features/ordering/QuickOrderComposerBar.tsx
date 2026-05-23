import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardEvent,
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
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
import { colors, grayScale, quickOrderAccent } from '@/theme/design';
import { isMessageSubmittable, type ComposerMode } from './quickOrderComposer';
import { ComposerSuggestionPills } from './ComposerSuggestionPills';

type QuickOrderComposerBarProps = {
  onSubmit: (text: string) => void;
  isSending: boolean;
  bottomInset: number;
  tabBarHeight: number;
  onHeightChange?: (height: number) => void;
  onBottomOffsetChange?: (bottomOffset: number) => void;
  /** Text to drop into the composer (e.g. a reorder preview). */
  prefillText?: string;
  /** Bump this to re-apply `prefillText` even if the text is unchanged. */
  prefillNonce?: number;
  placeholder?: string;
  composerMode?: ComposerMode;
  onComposerModeChange?: (mode: ComposerMode) => void;
  /** Quick-action pills rendered above the input (e.g. Last week / Recent / Usual). */
  suggestionPills?: {
    id: string;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    accent?: boolean;
  }[];
  onSuggestionPillPress?: (id: string) => void;
  voiceEnabled?: boolean;
  isVoiceListening?: boolean;
  voiceTranscript?: string;
  voiceError?: string | null;
  onStartVoice?: () => void;
  onStopVoice?: () => void;
};

const SEND_BUTTON_SIZE = 48;
const TOOL_BUTTON_SIZE = 34;
const MODE_SELECTOR_WIDTH = 238;
const MODE_SELECTOR_HEIGHT = 36;
const MODE_SELECTOR_PADDING = 3;
const MODE_THUMB_WIDTH = 96;
const MODE_INVENTORY_WIDTH = MODE_SELECTOR_WIDTH - MODE_THUMB_WIDTH - MODE_SELECTOR_PADDING * 2;
const MODE_SEGMENT_HEIGHT = MODE_SELECTOR_HEIGHT - MODE_SELECTOR_PADDING * 2;
const LINE_HEIGHT = 22;
const MIN_TEXT_INPUT_HEIGHT = LINE_HEIGHT;
const MAX_INPUT_LINES = 20;
const MAX_TEXT_INPUT_HEIGHT = LINE_HEIGHT * MAX_INPUT_LINES;
const CONTROL_EDGE_INSET = 6;
const CONTROL_ROW_HEIGHT = Math.max(SEND_BUTTON_SIZE, MODE_SELECTOR_HEIGHT);
const INPUT_BOTTOM_RESERVE = CONTROL_ROW_HEIGHT + 4;
const INPUT_WRAPPER_TOP_PADDING = 10;
const INPUT_WRAPPER_VERTICAL_SPACE =
  INPUT_WRAPPER_TOP_PADDING + INPUT_BOTTOM_RESERVE + CONTROL_EDGE_INSET;
const MAX_INPUT_HEIGHT = MAX_TEXT_INPUT_HEIGHT + INPUT_WRAPPER_VERTICAL_SPACE;
const TRANSITION_MS = 180;
const KEYBOARD_FALLBACK_MS = 220;

const AnimatedIonicons = Animated.createAnimatedComponent(Ionicons);

function QuickOrderComposerBarImpl({
  onSubmit,
  isSending,
  bottomInset,
  tabBarHeight,
  onHeightChange,
  onBottomOffsetChange,
  prefillText = '',
  prefillNonce = 0,
  placeholder = 'Add to order...',
  composerMode = 'order',
  onComposerModeChange,
  suggestionPills,
  onSuggestionPillPress,
  voiceEnabled = false,
  isVoiceListening = false,
  voiceTranscript = '',
  voiceError = null,
  onStartVoice,
  onStopVoice,
}: QuickOrderComposerBarProps) {
  const ds = useScaledStyles();

  const [text, setText] = useState('');
  const inputRef = useRef<TextInput>(null);

  // Suggestion pills (Usual / Recent / Last week) sit above the input until the
  // user engages — they hide the moment typing starts or a pill is tapped, and
  // reappear only when the parent re-offers them (e.g. a fresh welcome state).
  const [pillsDismissed, setPillsDismissed] = useState(false);
  const hasSuggestionPills = !!(
    suggestionPills &&
    suggestionPills.length > 0 &&
    onSuggestionPillPress
  );
  useEffect(() => {
    if (!hasSuggestionPills) setPillsDismissed(false);
  }, [hasSuggestionPills]);
  const showSuggestionPills =
    hasSuggestionPills && !pillsDismissed && text.length === 0;

  const handleSuggestionPillPress = useCallback(
    (id: string) => {
      setPillsDismissed(true);
      onSuggestionPillPress?.(id);
    },
    [onSuggestionPillPress],
  );

  const handleChangeText = useCallback((next: string) => {
    setText(next);
    if (next.length > 0) setPillsDismissed(true);
  }, []);

  // Drop preview/reorder text into the composer (and focus it) when the parent
  // bumps `prefillNonce`. Keyed on the nonce so re-tapping Preview re-applies
  // even when the text is identical. Skip the initial mount (nonce 0).
  const lastPrefillNonceRef = useRef(prefillNonce);
  useEffect(() => {
    if (prefillNonce === lastPrefillNonceRef.current) return;
    lastPrefillNonceRef.current = prefillNonce;
    setText(prefillText);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [prefillNonce, prefillText]);

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
      [grayScale[200], quickOrderAccent],
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
  const reportedBottomOffsetRef = useRef(tabBarHeight);
  const keyboardBottom = useSharedValue(tabBarHeight);

  const reportBottomOffset = useCallback(
    (next: number) => {
      const safeNext = Number.isFinite(next) ? Math.max(0, next) : 0;
      if (Math.abs(reportedBottomOffsetRef.current - safeNext) < 1) return;
      reportedBottomOffsetRef.current = safeNext;
      onBottomOffsetChange?.(safeNext);
    },
    [onBottomOffsetChange],
  );

  useEffect(() => {
    restingBottomRef.current = tabBarHeight;
    reportBottomOffset(tabBarHeight);
    keyboardBottom.value = withTiming(tabBarHeight, {
      duration: TRANSITION_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [keyboardBottom, reportBottomOffset, tabBarHeight]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (event: KeyboardEvent) => {
      const target = Math.max(event.endCoordinates.height, restingBottomRef.current);
      const duration = event.duration && event.duration > 0
        ? event.duration
        : KEYBOARD_FALLBACK_MS;
      reportBottomOffset(target);
      keyboardBottom.value = withTiming(target, {
        duration,
        easing: Easing.out(Easing.cubic),
      });
    };
    const onHide = (event: KeyboardEvent) => {
      const duration = event?.duration && event.duration > 0
        ? event.duration
        : KEYBOARD_FALLBACK_MS;
      reportBottomOffset(restingBottomRef.current);
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
  }, [keyboardBottom, reportBottomOffset]);

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

  const handleVoicePress = useCallback(() => {
    if (!voiceEnabled || isSending) return;
    if (isVoiceListening) {
      onStopVoice?.();
    } else {
      onStartVoice?.();
    }
  }, [isSending, isVoiceListening, onStartVoice, onStopVoice, voiceEnabled]);

  const handleModePress = useCallback(
    (nextMode: ComposerMode) => {
      if (nextMode === composerMode || isSending) return;
      Keyboard.dismiss();
      void triggerSelectionHaptic();
      onComposerModeChange?.(nextMode);
    },
    [composerMode, isSending, onComposerModeChange],
  );

  const safeBottomPadding = bottomInset > 0 ? ds.spacing(8) : ds.spacing(10);

  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        bar: {
          paddingHorizontal: ds.spacing(14),
          paddingTop: ds.spacing(6),
          paddingBottom: safeBottomPadding,
          gap: ds.spacing(6),
        },
        // The TextInput auto-grows naturally up to this wrapper cap. Once the
        // content is taller than 20 lines, native multiline scrolling takes over.
        inputWrapper: {
          borderRadius: ds.radius(28),
          paddingHorizontal: ds.spacing(14),
          paddingTop: ds.spacing(INPUT_WRAPPER_TOP_PADDING),
          paddingBottom: ds.spacing(CONTROL_EDGE_INSET),
          minHeight:
            ds.spacing(INPUT_WRAPPER_TOP_PADDING) +
            MIN_TEXT_INPUT_HEIGHT +
            INPUT_BOTTOM_RESERVE +
            ds.spacing(CONTROL_EDGE_INSET),
          maxHeight: MAX_INPUT_HEIGHT,
        },
        input: {
          fontSize: 18,
          minHeight: MIN_TEXT_INPUT_HEIGHT,
          maxHeight: MAX_TEXT_INPUT_HEIGHT,
          paddingBottom: ds.spacing(INPUT_BOTTOM_RESERVE),
        },
        sendButton: {
          width: SEND_BUTTON_SIZE,
          height: SEND_BUTTON_SIZE,
          borderRadius: SEND_BUTTON_SIZE / 2,
        },
        toolButton: {
          width: TOOL_BUTTON_SIZE,
          height: TOOL_BUTTON_SIZE,
          borderRadius: TOOL_BUTTON_SIZE / 2,
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
        {showSuggestionPills ? (
          <ComposerSuggestionPills
            pills={suggestionPills!}
            onPress={handleSuggestionPillPress}
            disabled={isSending}
          />
        ) : null}
        {voiceEnabled && (voiceTranscript || voiceError || isVoiceListening) ? (
          <View style={styles.voicePreview}>
            <Ionicons
              name={voiceError ? 'alert-circle-outline' : isVoiceListening ? 'mic' : 'mic-outline'}
              size={14}
              color={voiceError ? colors.statusAmber : quickOrderAccent}
            />
            <Text style={styles.voicePreviewText} numberOfLines={1}>
              {voiceError || voiceTranscript || 'Listening...'}
            </Text>
          </View>
        ) : null}
        <View style={[styles.inputWrapper, dynamicStyles.inputWrapper]}>
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={handleChangeText}
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
            allowFontScaling={false}
          />
          <View
            style={[
              styles.composerBottomRow,
              {
                bottom: ds.spacing(CONTROL_EDGE_INSET),
                left: ds.spacing(CONTROL_EDGE_INSET),
                right: ds.spacing(CONTROL_EDGE_INSET),
                minHeight: ds.spacing(CONTROL_ROW_HEIGHT),
              },
            ]}
          >
            <View
              accessibilityRole="tablist"
              style={[
                styles.modeSelector,
                {
                  borderRadius: ds.radius(999),
                  width: ds.spacing(MODE_SELECTOR_WIDTH),
                  height: ds.spacing(MODE_SELECTOR_HEIGHT),
                  padding: ds.spacing(MODE_SELECTOR_PADDING),
                },
              ]}
            >
              {(['order', 'inventory'] as ComposerMode[]).map((modeOption) => {
                const selected = composerMode === modeOption;
                return (
                  <Pressable
                    key={modeOption}
                    accessibilityRole="tab"
                    accessibilityLabel={modeOption === 'order' ? 'Order mode' : 'Inventory mode'}
                    accessibilityState={{ selected, disabled: isSending }}
                    disabled={isSending}
                    hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                    onPress={() => handleModePress(modeOption)}
                    style={[
                      styles.modeSegmentPressable,
                      {
                        height: ds.spacing(MODE_SEGMENT_HEIGHT),
                        width: ds.spacing(
                          modeOption === 'order' ? MODE_THUMB_WIDTH : MODE_INVENTORY_WIDTH,
                        ),
                        borderRadius: ds.radius(999),
                        backgroundColor: selected ? quickOrderAccent : 'transparent',
                        opacity: isSending ? 0.55 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.modeSegmentText,
                        {
                          color: selected ? colors.textOnPrimary : colors.textSecondary,
                        },
                      ]}
                      numberOfLines={1}
                      allowFontScaling={false}
                    >
                      {modeOption === 'order' ? 'Order' : 'Inventory'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View
              style={[
                styles.actionCluster,
                {
                  gap: ds.spacing(8),
                },
              ]}
            >
              {voiceEnabled ? (
                <Pressable
                  onPress={handleVoicePress}
                  disabled={isSending}
                  accessibilityRole="button"
                  accessibilityLabel={isVoiceListening ? 'Stop voice input' : 'Start voice input'}
                  accessibilityState={{ selected: isVoiceListening, disabled: isSending }}
                  hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                  style={({ pressed }) => [
                    styles.voiceButton,
                    dynamicStyles.toolButton,
                    {
                      backgroundColor: isVoiceListening ? quickOrderAccent : grayScale[100],
                      opacity: isSending ? 0.5 : pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Ionicons
                    name={isVoiceListening ? 'stop' : 'mic-outline'}
                    size={19}
                    color={isVoiceListening ? colors.textOnPrimary : colors.textMuted}
                  />
                </Pressable>
              ) : null}
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
          </View>
        </View>
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
    zIndex: 20,
    ...(Platform.OS === 'android'
      ? { elevation: 0 }
      : { elevation: 20 }),
  },
  bar: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  voicePreview: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 6,
    paddingBottom: 2,
  },
  voicePreviewText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
  },
  inputWrapper: {
    backgroundColor: colors.white,
    borderWidth: 0,
    justifyContent: 'flex-start',
    overflow: 'hidden',
    ...(Platform.OS === 'android'
      ? { elevation: 0, shadowOpacity: 0 }
      : {
          shadowColor: colors.textPrimary,
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.08,
          shadowRadius: 16,
          elevation: 8,
        }),
  },
  input: {
    color: colors.textPrimary,
    lineHeight: LINE_HEIGHT,
    padding: 0,
    margin: 0,
    fontWeight: '500',
    zIndex: 0,
  },
  sendButtonPressable: {
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'android'
      ? { elevation: 0, shadowOpacity: 0 }
      : {
          shadowColor: colors.textPrimary,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.18,
          shadowRadius: 8,
          elevation: 6,
        }),
  },
  voiceButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerBottomRow: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modeSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    backgroundColor: '#F1EDE6',
    overflow: 'hidden',
    ...(Platform.OS === 'android' ? { elevation: 0, shadowOpacity: 0 } : null),
  },
  modeSegmentPressable: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeSegmentText: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0,
  },
  actionCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    ...(Platform.OS === 'android' ? { elevation: 0, shadowOpacity: 0 } : null),
  },
  sendButtonFill: {
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'android' ? { elevation: 0, shadowOpacity: 0 } : null),
  },
});

export const QuickOrderComposerBar = React.memo(
  QuickOrderComposerBarImpl,
  (prev, next) =>
    prev.isSending === next.isSending &&
    prev.prefillNonce === next.prefillNonce &&
    prev.bottomInset === next.bottomInset &&
    prev.tabBarHeight === next.tabBarHeight &&
    prev.placeholder === next.placeholder &&
    prev.composerMode === next.composerMode &&
    prev.suggestionPills === next.suggestionPills &&
    prev.onSuggestionPillPress === next.onSuggestionPillPress &&
    prev.voiceEnabled === next.voiceEnabled &&
    prev.isVoiceListening === next.isVoiceListening &&
    prev.voiceTranscript === next.voiceTranscript &&
    prev.voiceError === next.voiceError &&
    prev.onSubmit === next.onSubmit &&
    prev.onComposerModeChange === next.onComposerModeChange &&
    prev.onStartVoice === next.onStartVoice &&
    prev.onStopVoice === next.onStopVoice &&
    prev.onHeightChange === next.onHeightChange &&
    prev.onBottomOffsetChange === next.onBottomOffsetChange,
);
