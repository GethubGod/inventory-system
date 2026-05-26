import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { useAmplitudeBuffer } from '@/hooks/useAmplitudeBuffer';
import { triggerSelectionHaptic } from '@/lib/haptics';
import { colors, grayScale, quickOrderAccent } from '@/theme/design';
import { isMessageSubmittable, type ComposerMode } from './quickOrderComposer';
import { ComposerSuggestionPills } from './ComposerSuggestionPills';
import { BAR_COUNT, RollingSpectrogram } from './RollingSpectrogram';

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
  voiceStatus?: 'idle' | 'recording' | 'transcribing' | 'review_ready' | 'adding_to_order' | 'added' | 'failed' | 'cancelled';
  voiceMetering?: number;
  voiceError?: string | null;
  onStartVoice?: () => void;
  /** Stop recording and immediately submit it for parsing (square + send). */
  onSubmitVoice?: () => void;
  onCancelVoice?: () => void;
  onRetryVoice?: () => void;
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
const CONTROL_EDGE_INSET = 5;
const CONTROL_ROW_HEIGHT = Math.max(SEND_BUTTON_SIZE, MODE_SELECTOR_HEIGHT);
const INPUT_BOTTOM_RESERVE = CONTROL_ROW_HEIGHT;
const INPUT_WRAPPER_TOP_PADDING = 6;
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
  voiceStatus = 'idle',
  voiceMetering,
  voiceError = null,
  onStartVoice,
  onSubmitVoice,
  onCancelVoice,
  onRetryVoice,
}: QuickOrderComposerBarProps) {
  const ds = useScaledStyles();

  const [text, setText] = useState('');
  const inputRef = useRef<TextInput>(null);
  const pressHoldActiveRef = useRef(false);
  const suppressNextVoiceTapRef = useRef(false);

  // Suggestion pills (Usual / Recent / Last week) sit above the input until the
  // user engages — they hide the moment typing starts or a pill is tapped, and
  // reappear whenever the composer empties out again (after sending or clearing
  // the order list). `awaitingPrefillRef` guards the brief gap between tapping a
  // pill and its prefill arriving so the pills don't flash back in.
  const [pillsDismissed, setPillsDismissed] = useState(false);
  const awaitingPrefillRef = useRef(false);
  const hasSuggestionPills = !!(
    suggestionPills &&
    suggestionPills.length > 0 &&
    onSuggestionPillPress
  );
  useEffect(() => {
    if (!hasSuggestionPills) {
      setPillsDismissed(false);
      awaitingPrefillRef.current = false;
      return;
    }
    if (text.length === 0 && !awaitingPrefillRef.current) {
      setPillsDismissed(false);
    }
  }, [hasSuggestionPills, text]);
  const showSuggestionPills =
    hasSuggestionPills && !pillsDismissed && text.length === 0;

  // A pill tap won't always produce a prefill (e.g. no inventory history yet);
  // once the send completes with an empty composer, drop the guard and re-show
  // the pills.
  const prevSendingRef = useRef(isSending);
  useEffect(() => {
    if (prevSendingRef.current && !isSending) {
      awaitingPrefillRef.current = false;
      if (text.length === 0) setPillsDismissed(false);
    }
    prevSendingRef.current = isSending;
  }, [isSending, text]);

  const handleSuggestionPillPress = useCallback(
    (id: string) => {
      setPillsDismissed(true);
      awaitingPrefillRef.current = true;
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
    awaitingPrefillRef.current = false;
    setText(prefillText);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [prefillNonce, prefillText]);

  const submittable = isMessageSubmittable(text, isSending);

  // Voice recording mode. While capturing (recording → transcribing) the
  // composer swaps the text input for a rolling waveform and recolors the send
  // button. `isRecording` is the live state; `isVoiceBusy` is the brief
  // stop→cleanup tail where the waveform freezes and the send shows a spinner.
  const isRecording = voiceEnabled && voiceStatus === 'recording';
  const isVoiceBusy =
    voiceEnabled && voiceStatus === 'transcribing';
  const isVoiceCapture = isRecording || isVoiceBusy;

  // Drive the send-button color transition on the UI thread so it doesn't
  // schedule a React re-render on every keystroke. Red while there's text to
  // send or while voice capture is active.
  const activeProgress = useSharedValue(0);
  useEffect(() => {
    activeProgress.value = withTiming(submittable || isVoiceCapture ? 1 : 0, {
      duration: TRANSITION_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [activeProgress, isVoiceCapture, submittable]);

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
    if (suppressNextVoiceTapRef.current) {
      suppressNextVoiceTapRef.current = false;
      return;
    }
    if (!voiceEnabled || isSending) return;
    if (isVoiceBusy) return;
    if (isRecording) {
      // Square stop: end recording and submit in one tap.
      onSubmitVoice?.();
    } else {
      onStartVoice?.();
    }
  }, [isRecording, isSending, isVoiceBusy, onStartVoice, onSubmitVoice, voiceEnabled]);

  const handleVoiceLongPress = useCallback(() => {
    if (!voiceEnabled || isSending || isVoiceCapture) {
      return;
    }
    pressHoldActiveRef.current = true;
    suppressNextVoiceTapRef.current = true;
    onStartVoice?.();
  }, [isSending, isVoiceCapture, onStartVoice, voiceEnabled]);

  const handleVoicePressOut = useCallback(() => {
    if (!pressHoldActiveRef.current) return;
    pressHoldActiveRef.current = false;
    // Push-to-talk release submits the captured audio.
    onSubmitVoice?.();
  }, [onSubmitVoice]);

  // Rolling spectrogram buffer. We push the recorder's latest metering on a
  // fixed cadence (not on every prop change) so the bars keep scrolling and
  // decay to the baseline during silence, when `metering` stops changing.
  const { amplitudes, pushAmplitude, reset: resetAmplitudes } =
    useAmplitudeBuffer(BAR_COUNT);

  // expo-audio reports `metering` in dBFS (~-60 floor .. 0 peak), updated every
  // 100ms. Normalize to 0..1 with the same window the composer already used.
  const meterRef = useRef(0);
  useEffect(() => {
    meterRef.current =
      typeof voiceMetering === 'number' && Number.isFinite(voiceMetering)
        ? Math.max(0, Math.min(1, (voiceMetering + 60) / 60))
        : 0;
  }, [voiceMetering]);

  useEffect(() => {
    if (voiceStatus !== 'recording') return;
    const id = setInterval(() => pushAmplitude(meterRef.current), 80);
    return () => clearInterval(id);
  }, [pushAmplitude, voiceStatus]);

  useEffect(() => {
    if (voiceStatus === 'idle' || voiceStatus === 'cancelled') resetAmplitudes();
  }, [resetAmplitudes, voiceStatus]);

  const handleModePress = useCallback(
    (nextMode: ComposerMode) => {
      if (nextMode === composerMode || isSending) return;
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
          paddingLeft: ds.spacing(4),
          paddingBottom: ds.spacing(INPUT_BOTTOM_RESERVE),
        },
        // Waveform occupies the same top box as the text input's first line, so
        // the card height doesn't shift when switching into recording mode.
        voiceCapture: {
          minHeight: MIN_TEXT_INPUT_HEIGHT,
          paddingLeft: ds.spacing(4),
          paddingBottom: ds.spacing(INPUT_BOTTOM_RESERVE),
          justifyContent: 'center',
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
        {voiceEnabled && voiceStatus === 'failed' ? (
          <View style={[styles.voicePreview, styles.voicePreviewFailed]}>
            <View style={styles.voicePreviewLabel}>
              <Ionicons name="alert-circle-outline" size={14} color={colors.statusAmber} />
              <Text style={styles.voicePreviewText} numberOfLines={1}>
                {voiceError || "Couldn't understand. Try again."}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry voice order"
              onPress={onRetryVoice}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              style={styles.voiceRetryButton}
            >
              <Text style={styles.voiceRetryText} allowFontScaling={false}>Retry</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Discard voice order"
              onPress={onCancelVoice}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              style={styles.voiceMiniButton}
            >
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </Pressable>
          </View>
        ) : null}
        <View style={[styles.inputWrapper, dynamicStyles.inputWrapper]}>
          {isVoiceCapture ? (
            <View
              style={[styles.voiceCapture, dynamicStyles.voiceCapture]}
              accessibilityElementsHidden
              accessibilityRole="image"
              accessibilityLabel={isRecording ? 'Recording audio' : 'Cleaning voice order'}
            >
              <View style={{ opacity: isVoiceBusy ? 0.45 : 1 }}>
                <RollingSpectrogram
                  amplitudes={amplitudes}
                  height={22}
                  barColor={colors.textPrimary}
                />
              </View>
              {isVoiceBusy ? (
                <Text style={styles.voiceCaptureText} numberOfLines={1} allowFontScaling={false}>
                  Cleaning voice order...
                </Text>
              ) : null}
            </View>
          ) : (
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
          )}
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
              {voiceEnabled && !isVoiceBusy ? (
                <Pressable
                  onPress={handleVoicePress}
                  onLongPress={handleVoiceLongPress}
                  onPressOut={handleVoicePressOut}
                  delayLongPress={180}
                  disabled={isSending}
                  accessibilityRole="button"
                  accessibilityLabel={isRecording ? 'Stop voice input' : 'Start voice input'}
                  accessibilityState={{ selected: isRecording, disabled: isSending }}
                  hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                  style={({ pressed }) => [
                    styles.voiceButton,
                    dynamicStyles.toolButton,
                    {
                      backgroundColor: isRecording ? '#F5F1E8' : grayScale[100],
                      opacity: isSending ? 0.5 : pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  {isRecording ? (
                    <View style={styles.voiceStopSquare} />
                  ) : (
                    <Ionicons name="mic-outline" size={19} color={colors.textMuted} />
                  )}
                </Pressable>
              ) : null}
              <Pressable
                onPress={isRecording ? onSubmitVoice : handleSubmit}
                disabled={isVoiceBusy || (!isRecording && !submittable)}
                accessibilityRole="button"
                accessibilityLabel="Send"
                accessibilityState={{ disabled: isVoiceBusy || (!isRecording && !submittable) }}
                hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                style={({ pressed }) => [
                  styles.sendButtonPressable,
                  dynamicStyles.sendButton,
                  { opacity: !isRecording && !submittable && !isVoiceBusy ? 1 : pressed ? 0.85 : 1 },
                ]}
              >
                <Animated.View
                  style={[styles.sendButtonFill, dynamicStyles.sendButton, sendButtonAnimatedStyle]}
                  pointerEvents="none"
                >
                  {isVoiceBusy ? (
                    <ActivityIndicator size="small" color={colors.textOnPrimary} />
                  ) : (
                    <AnimatedIonicons
                      name="arrow-up"
                      size={20}
                      style={sendIconAnimatedStyle}
                    />
                  )}
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
    justifyContent: 'space-between',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    minHeight: 42,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  voicePreviewFailed: {
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  voicePreviewLabel: {
    minWidth: 132,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  voicePreviewText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
  },
  voiceRetryButton: {
    minWidth: 56,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: quickOrderAccent,
    backgroundColor: colors.white,
  },
  voiceRetryText: {
    color: quickOrderAccent,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
  },
  voiceMiniButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: grayScale[100],
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
  // Square "stop" indicator shown inside the voice button while recording.
  voiceStopSquare: {
    width: 11,
    height: 11,
    borderRadius: 2,
    backgroundColor: '#1A1A1A',
  },
  voiceCapture: {
    width: '100%',
  },
  voiceCaptureText: {
    position: 'absolute',
    left: 4,
    right: 4,
    bottom: INPUT_BOTTOM_RESERVE - 4,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
    textAlign: 'center',
  },
  composerBottomRow: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'flex-end',
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
    prev.voiceStatus === next.voiceStatus &&
    prev.voiceMetering === next.voiceMetering &&
    prev.voiceError === next.voiceError &&
    prev.onSubmit === next.onSubmit &&
    prev.onComposerModeChange === next.onComposerModeChange &&
    prev.onStartVoice === next.onStartVoice &&
    prev.onSubmitVoice === next.onSubmitVoice &&
    prev.onCancelVoice === next.onCancelVoice &&
    prev.onRetryVoice === next.onRetryVoice &&
    prev.onHeightChange === next.onHeightChange &&
    prev.onBottomOffsetChange === next.onBottomOffsetChange,
);
