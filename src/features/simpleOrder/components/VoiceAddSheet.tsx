import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '@/components/BottomSheetShell';
import { useAmplitudeBuffer } from '@/hooks/useAmplitudeBuffer';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { RollingSpectrogram } from '@/features/ordering/RollingSpectrogram';
import {
  cleanupQuickOrderVoiceFile,
  isQuickOrderVoiceTooShort,
  transcribeQuickOrderVoiceFile,
} from '@/features/ordering/quickOrderVoice';
import {
  triggerConfirmationHaptic,
  triggerImpactHaptic,
} from '@/lib/haptics';
import {
  colors,
  glassColors,
  glassHairlineWidth,
  glassRadii,
} from '@/theme/design';
import type { InventoryItem } from '@/types';
import {
  mapVoiceActionsToAdditions,
  type VoiceAddition,
} from '../catalogSearch';
import { formatQuantity } from '../checklistSelection';

interface VoiceAddSheetProps {
  visible: boolean;
  locationId: string | null;
  userId: string | null;
  inventoryItems: InventoryItem[];
  onApply: (additions: VoiceAddition[]) => void;
  onClose: () => void;
}

type VoicePhase = 'recording' | 'transcribing' | 'review' | 'error';

const MAX_RECORDING_MS = 30_000;

const RECORDING_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
  numberOfChannels: 1,
  bitRate: 64_000,
};

export function VoiceAddSheet({
  visible,
  locationId,
  userId,
  inventoryItems,
  onApply,
  onClose,
}: VoiceAddSheetProps) {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();

  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 100);
  const { amplitudes, pushAmplitude, reset: resetAmplitudes } = useAmplitudeBuffer();

  const [phase, setPhase] = useState<VoicePhase>('recording');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [additions, setAdditions] = useState<VoiceAddition[]>([]);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [transcript, setTranscript] = useState<string>('');

  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppingRef = useRef(false);
  const itemsRef = useRef(inventoryItems);
  itemsRef.current = inventoryItems;

  useEffect(() => {
    if (phase !== 'recording') return;
    const metering = recorderState.metering;
    if (typeof metering === 'number' && Number.isFinite(metering)) {
      pushAmplitude(Math.min(1, Math.max(0, (metering + 60) / 60)));
    }
  }, [phase, pushAmplitude, recorderState.metering]);

  const clearMaxTimer = useCallback(() => {
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
  }, []);

  const stopRecorder = useCallback(async (): Promise<{
    uri: string | null;
    durationMs: number;
  }> => {
    const durationMs = recorderState.durationMillis ?? 0;
    try {
      if (recorder.isRecording) {
        await recorder.stop();
      }
    } catch {
      // Continue with whatever URI we have.
    }
    try {
      await setAudioModeAsync({ allowsRecording: false });
    } catch {
      // Non-fatal audio session cleanup.
    }
    return { uri: recorder.uri || recorderState.url || null, durationMs };
  }, [recorder, recorderState.durationMillis, recorderState.url]);

  const handleStopAndParse = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    clearMaxTimer();
    void triggerImpactHaptic();

    const { uri, durationMs } = await stopRecorder();
    if (!uri || isQuickOrderVoiceTooShort(durationMs)) {
      await cleanupQuickOrderVoiceFile(uri);
      setErrorMessage('That was too short — hold on a moment longer and try again.');
      setPhase('error');
      stoppingRef.current = false;
      return;
    }
    if (!locationId || !userId) {
      await cleanupQuickOrderVoiceFile(uri);
      setErrorMessage('Choose a location before using voice.');
      setPhase('error');
      stoppingRef.current = false;
      return;
    }

    setPhase('transcribing');
    const response = await transcribeQuickOrderVoiceFile({
      uri,
      durationMs,
      locationId,
      userId,
      sessionId: null,
      mode: 'order',
      existingItems: [],
      recentMessages: [],
    });
    await cleanupQuickOrderVoiceFile(uri);
    stoppingRef.current = false;

    if (!response.success) {
      setErrorMessage(response.message);
      setPhase('error');
      return;
    }

    const mapped = mapVoiceActionsToAdditions(
      response.actions,
      response.unresolved,
      itemsRef.current,
    );
    setTranscript(response.rawTranscript || response.normalizedText);
    setAdditions(mapped.additions);
    setUnmatched(mapped.unmatched);
    setPhase('review');
  }, [clearMaxTimer, locationId, userId, stopRecorder]);

  const startRecording = useCallback(async () => {
    stoppingRef.current = false;
    resetAmplitudes();
    setErrorMessage(null);
    setAdditions([]);
    setUnmatched([]);
    setTranscript('');
    setPhase('recording');
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setErrorMessage('Microphone access is needed to add items by voice.');
        setPhase('error');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync(RECORDING_OPTIONS);
      recorder.record({ forDuration: MAX_RECORDING_MS / 1000 });
      clearMaxTimer();
      maxTimerRef.current = setTimeout(() => {
        void handleStopAndParse();
      }, MAX_RECORDING_MS);
    } catch {
      setErrorMessage('Voice input is unavailable right now.');
      setPhase('error');
    }
  }, [clearMaxTimer, handleStopAndParse, recorder, resetAmplitudes]);

  useEffect(() => {
    if (visible) {
      void startRecording();
    }
    // startRecording is intentionally excluded: it must run only on the
    // visible transition, not when its dependencies re-materialize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleClose = useCallback(() => {
    clearMaxTimer();
    void (async () => {
      const { uri } = await stopRecorder();
      await cleanupQuickOrderVoiceFile(uri);
    })();
    onClose();
  }, [clearMaxTimer, onClose, stopRecorder]);

  const handleApply = useCallback(() => {
    void triggerConfirmationHaptic();
    onApply(additions);
    onClose();
  }, [additions, onApply, onClose]);

  const seconds = Math.floor((recorderState.durationMillis ?? 0) / 1000);

  let body: React.ReactNode;
  if (phase === 'recording') {
    body = (
      <View style={{ alignItems: 'center' }}>
        <Text
          style={{
            fontSize: ds.fontSize(15),
            color: glassColors.textSecondary,
            marginBottom: ds.spacing(14),
            textAlign: 'center',
          }}
        >
          Say what you need — “two cases of salmon, a bag of rice”
        </Text>
        <View
          style={{
            alignSelf: 'stretch',
            alignItems: 'center',
            paddingVertical: ds.spacing(10),
            marginBottom: ds.spacing(14),
            backgroundColor: colors.glassCircle,
            borderRadius: glassRadii.button,
            borderWidth: glassHairlineWidth,
            borderColor: glassColors.controlBorder,
          }}
        >
          <RollingSpectrogram amplitudes={amplitudes} height={28} />
          <Text
            style={{
              marginTop: ds.spacing(6),
              fontSize: ds.fontSize(12),
              fontVariant: ['tabular-nums'],
              color: glassColors.textMuted,
            }}
          >
            0:{String(seconds).padStart(2, '0')}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => void handleStopAndParse()}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Stop recording and add items"
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            backgroundColor: colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="stop" size={ds.icon(28)} color={colors.white} />
        </TouchableOpacity>
        <Text
          style={{
            marginTop: ds.spacing(8),
            fontSize: ds.fontSize(12),
            color: glassColors.textMuted,
          }}
        >
          Tap when you’re done
        </Text>
      </View>
    );
  } else if (phase === 'transcribing') {
    body = (
      <View style={{ alignItems: 'center', paddingVertical: ds.spacing(28) }}>
        <ActivityIndicator color={glassColors.accent} size="large" />
        <Text
          style={{
            marginTop: ds.spacing(12),
            fontSize: ds.fontSize(14),
            color: glassColors.textSecondary,
          }}
        >
          Matching items…
        </Text>
      </View>
    );
  } else if (phase === 'error') {
    body = (
      <View style={{ alignItems: 'center' }}>
        <View
          style={{
            alignSelf: 'stretch',
            backgroundColor: glassColors.dangerSoft,
            borderRadius: glassRadii.tag,
            paddingHorizontal: ds.spacing(12),
            paddingVertical: ds.spacing(10),
            marginBottom: ds.spacing(14),
          }}
        >
          <Text style={{ fontSize: ds.fontSize(13), color: glassColors.dangerText }}>
            {errorMessage ?? 'Something went wrong.'}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => void startRecording()}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Try voice again"
          style={{
            minHeight: 48,
            paddingHorizontal: ds.spacing(24),
            borderRadius: glassRadii.pill,
            backgroundColor: colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: ds.fontSize(15), fontWeight: '700', color: colors.white }}>
            Try again
          </Text>
        </TouchableOpacity>
      </View>
    );
  } else {
    body = (
      <View>
        {transcript ? (
          <Text
            numberOfLines={2}
            style={{
              fontSize: ds.fontSize(12),
              color: glassColors.textMuted,
              fontStyle: 'italic',
              marginBottom: ds.spacing(10),
            }}
          >
            “{transcript}”
          </Text>
        ) : null}

        {additions.map((addition, index) => (
          <View
            key={addition.item.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              minHeight: 44,
              paddingVertical: ds.spacing(4),
              borderBottomWidth:
                index === additions.length - 1 ? 0 : glassHairlineWidth,
              borderBottomColor: glassColors.divider,
            }}
          >
            <Ionicons
              name="checkmark-circle"
              size={ds.icon(22)}
              color={glassColors.accent}
              style={{ marginRight: ds.spacing(10) }}
            />
            <View style={{ flex: 1 }}>
              <Text
                numberOfLines={1}
                style={{
                  fontSize: ds.fontSize(15),
                  fontWeight: '600',
                  color: glassColors.textPrimary,
                }}
              >
                {addition.item.name}
              </Text>
              {addition.spokenUnit ? (
                <Text style={{ fontSize: ds.fontSize(11), color: glassColors.warningText }}>
                  Heard “{addition.spokenUnit}” — this item orders in {addition.unit}
                </Text>
              ) : null}
            </View>
            <Text
              style={{
                fontSize: ds.fontSize(14),
                fontWeight: '700',
                color: glassColors.textPrimary,
              }}
            >
              {addition.quantity !== null ? formatQuantity(addition.quantity) : '1'}{' '}
              {addition.unit}
            </Text>
          </View>
        ))}

        {additions.length === 0 ? (
          <Text
            style={{
              paddingVertical: ds.spacing(12),
              fontSize: ds.fontSize(14),
              color: glassColors.textSecondary,
              textAlign: 'center',
            }}
          >
            No items recognized.
          </Text>
        ) : null}

        {unmatched.length > 0 ? (
          <View
            style={{
              backgroundColor: glassColors.warningSoft,
              borderRadius: glassRadii.tag,
              paddingHorizontal: ds.spacing(10),
              paddingVertical: ds.spacing(8),
              marginTop: ds.spacing(10),
            }}
          >
            <Text style={{ fontSize: ds.fontSize(12), color: glassColors.warningText }}>
              Not matched to inventory: {unmatched.join(', ')}. Use search to add
              these by hand.
            </Text>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', marginTop: ds.spacing(14) }}>
          <TouchableOpacity
            onPress={() => void startRecording()}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Record again"
            style={{
              minHeight: 48,
              paddingHorizontal: ds.spacing(16),
              borderRadius: glassRadii.pill,
              backgroundColor: colors.glassCircle,
              borderWidth: glassHairlineWidth,
              borderColor: glassColors.controlBorder,
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: ds.spacing(8),
            }}
          >
            <Ionicons name="mic-outline" size={ds.icon(20)} color={glassColors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleApply}
            disabled={additions.length === 0}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`Add ${additions.length} items to order`}
            style={{
              flex: 1,
              minHeight: 48,
              borderRadius: glassRadii.pill,
              backgroundColor:
                additions.length === 0 ? glassColors.textMuted : colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: ds.fontSize(16), fontWeight: '700', color: colors.white }}>
              {additions.length === 1
                ? 'Add 1 item'
                : `Add ${additions.length} items`}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <BottomSheetShell
      visible={visible}
      onClose={handleClose}
      bottomPadding={Math.max(insets.bottom, ds.spacing(12))}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          marginBottom: ds.spacing(10),
        }}
      >
        <Text
          style={{
            flex: 1,
            fontSize: ds.fontSize(20),
            fontWeight: '700',
            color: glassColors.textPrimary,
          }}
        >
          {phase === 'review' ? 'Heard you' : 'Add by voice'}
        </Text>
        <TouchableOpacity
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close voice input"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: colors.glassCircle,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="close" size={ds.icon(16)} color={glassColors.textPrimary} />
        </TouchableOpacity>
      </View>
      {body}
    </BottomSheetShell>
  );
}
