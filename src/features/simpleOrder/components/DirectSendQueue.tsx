import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Platform,
  ScrollView,
  Share,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import * as SMS from 'expo-sms';
import { GlassSurface } from '@/components';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  ImpactFeedbackStyle,
  NotificationFeedbackType,
  triggerImpactHaptic,
  triggerNotificationHaptic,
  triggerSelectionHaptic,
} from '@/lib/haptics';
import { archiveDirectSend, type DirectSendGroup } from '@/services/orderChecklist';
import { buildSupplierSendUrl } from '@/services/supplierSendLink';
import type { SupplierContactChannel } from '@/services/supplierContacts';
import {
  createSendAllQueue,
  getSendAllQueueProgress,
  sendAllQueueReducer,
  type SendAllQueueEvent,
  type SendAllQueueProgress,
  type SendAllQueueState,
} from '@/features/fulfillment/sendAll/sendAllQueue';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassSpacing,
} from '@/theme/design';
import { channelForGroup, directSendGroupKey, orderGroupsForQueue } from '../directSendFlow';

/**
 * Per-supplier direct-send card queue for the simplified ordering checklist.
 * Mirrors Phase 1's Send All UX (src/features/fulfillment/sendAll/
 * SendAllScreen.tsx) and reuses its queue reducer verbatim; the differences
 * are the data source (DirectSendGroups prepared by prepareDirectSend instead
 * of pending fulfillment orders) and the archive path (archiveDirectSend per
 * completed card — skips archive nothing).
 */

interface DirectSendQueueProps {
  groups: DirectSendGroup[];
  onDone: (progress: SendAllQueueProgress) => void;
}

const CHANNEL_LABELS: Record<SupplierContactChannel, string> = {
  sms: 'Messages (SMS)',
  whatsapp: 'WhatsApp',
  share_sheet: 'Share sheet',
};

const CHANNEL_ICONS: Record<SupplierContactChannel, keyof typeof Ionicons.glyphMap> = {
  sms: 'chatbubble-outline',
  whatsapp: 'logo-whatsapp',
  share_sheet: 'share-outline',
};

export function DirectSendQueue({ groups, onDone }: DirectSendQueueProps) {
  const ds = useScaledStyles();

  const orderedGroups = useMemo(() => orderGroupsForQueue(groups), [groups]);
  const groupsByKey = useMemo(() => {
    const map: Record<string, DirectSendGroup> = {};
    orderedGroups.forEach((group) => {
      map[directSendGroupKey(group)] = group;
    });
    return map;
  }, [orderedGroups]);

  const [queue, setQueue] = useState<SendAllQueueState>(() =>
    createSendAllQueue(orderedGroups.map(directSendGroupKey)),
  );
  const [sendingKey, setSendingKey] = useState<string | null>(null);

  const queueRef = useRef<SendAllQueueState>(queue);
  queueRef.current = queue;
  const groupsByKeyRef = useRef(groupsByKey);
  groupsByKeyRef.current = groupsByKey;
  const archiveInFlightRef = useRef(false);

  const dispatchQueue = useCallback((event: SendAllQueueEvent) => {
    setQueue((prev) => sendAllQueueReducer(prev, event));
  }, []);

  const archiveCard = useCallback(
    async (group: DirectSendGroup, shareMethod: 'share' | 'copy'): Promise<boolean> => {
      if (archiveInFlightRef.current) return false;
      archiveInFlightRef.current = true;
      try {
        await archiveDirectSend(group, shareMethod);
        return true;
      } catch (error) {
        console.error('[SimpleOrder:DirectSend] archiveDirectSend failed:', error);
        Alert.alert(
          'Could Not Save Order',
          error instanceof Error
            ? error.message
            : `The ${group.supplierName} order could not be saved to history. Try again.`,
        );
        return false;
      } finally {
        archiveInFlightRef.current = false;
      }
    },
    [],
  );

  const completeSend = useCallback(
    async (group: DirectSendGroup, shareMethod: 'share' | 'copy') => {
      const key = directSendGroupKey(group);
      const archived = await archiveCard(group, shareMethod);
      if (archived) {
        void triggerNotificationHaptic(NotificationFeedbackType.Success);
        dispatchQueue({ type: 'send-completed', id: key });
      } else {
        dispatchQueue({ type: 'send-cancelled', id: key });
      }
      return archived;
    },
    [archiveCard, dispatchQueue],
  );

  // Deep-link sends (sms: fallback / whatsapp) auto-advance when the app
  // becomes active again after the user returns from the messaging app.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status !== 'active') return;
      const awaitingKey = queueRef.current.awaitingReturnId;
      if (!awaitingKey) return;
      const group = groupsByKeyRef.current[awaitingKey];
      dispatchQueue({ type: 'send-cancelled', id: awaitingKey }); // clear awaiting flag
      if (!group) return;
      void completeSend(group, 'share');
    });
    return () => {
      subscription.remove();
    };
  }, [completeSend, dispatchQueue]);

  const handleShareFallback = useCallback(
    async (group: DirectSendGroup) => {
      // Mirror Send All: archive in parallel with the share sheet so DB work
      // happens while the user interacts with the dialog.
      const archivePromise = archiveCard(group, 'share');
      try {
        await Share.share({ message: group.messageText, title: `${group.supplierName} Order` });
      } catch {
        // Share dialog threw (rare) — archive still running in background.
      }
      const archived = await archivePromise;
      const key = directSendGroupKey(group);
      if (archived) {
        void triggerNotificationHaptic(NotificationFeedbackType.Success);
        dispatchQueue({ type: 'send-completed', id: key });
      } else {
        dispatchQueue({ type: 'send-cancelled', id: key });
      }
    },
    [archiveCard, dispatchQueue],
  );

  const launchDeepLink = useCallback(
    async (group: DirectSendGroup, url: string): Promise<void> => {
      const key = directSendGroupKey(group);
      const supported = await Linking.canOpenURL(url).catch(() => true);
      if (!supported) {
        Alert.alert(
          'App Unavailable',
          'The messaging app for this supplier is not available on this device. Using the share sheet instead.',
        );
        await handleShareFallback(group);
        return;
      }
      dispatchQueue({ type: 'send-launched', id: key, awaitReturn: true });
      try {
        await Linking.openURL(url);
      } catch {
        dispatchQueue({ type: 'send-cancelled', id: key });
        Alert.alert(
          'Unable to Open Messaging App',
          'Could not open the messaging app. Using the share sheet instead.',
        );
        await handleShareFallback(group);
      }
    },
    [dispatchQueue, handleShareFallback],
  );

  const handleSendPress = useCallback(
    async (group: DirectSendGroup) => {
      if (sendingKey) return;
      const key = directSendGroupKey(group);
      const channel = channelForGroup(group);
      const phone = group.contact?.contactPhone ?? null;

      void triggerImpactHaptic(ImpactFeedbackStyle.Medium);
      setSendingKey(key);
      try {
        if (channel === 'sms' && phone) {
          const smsAvailable = await SMS.isAvailableAsync().catch(() => false);
          if (smsAvailable) {
            // Preferred path: expo-sms compose UI — its completion result
            // drives auto-advance without an AppState round-trip.
            const { result } = await SMS.sendSMSAsync([phone], group.messageText);
            if (result === 'cancelled') {
              dispatchQueue({ type: 'send-cancelled', id: key });
              return;
            }
            if (Platform.OS === 'android' && result === 'unknown') {
              // Android reports 'unknown' for both cancel and send, so confirm
              // with the user before archiving. iOS reports cancel correctly.
              const wasSent = await new Promise<boolean>((resolve) => {
                Alert.alert(
                  'Confirm Send',
                  `Was the message sent to ${group.supplierName}?`,
                  [
                    { text: 'Not sent', style: 'cancel', onPress: () => resolve(false) },
                    { text: 'Sent', onPress: () => resolve(true) },
                  ],
                  { cancelable: false },
                );
              });
              if (!wasSent) {
                dispatchQueue({ type: 'send-cancelled', id: key });
                return;
              }
            }
            await completeSend(group, 'share');
            return;
          }
          const url = buildSupplierSendUrl({ channel: 'sms', phone }, group.messageText);
          if (url) {
            await launchDeepLink(group, url);
            return;
          }
          await handleShareFallback(group);
          return;
        }

        if (channel === 'whatsapp' && phone) {
          const url = buildSupplierSendUrl({ channel: 'whatsapp', phone }, group.messageText);
          if (url) {
            await launchDeepLink(group, url);
            return;
          }
          await handleShareFallback(group);
          return;
        }

        await handleShareFallback(group);
      } finally {
        setSendingKey(null);
      }
    },
    [completeSend, dispatchQueue, handleShareFallback, launchDeepLink, sendingKey],
  );

  const handleCopyPress = useCallback(
    async (group: DirectSendGroup) => {
      if (sendingKey) return;
      setSendingKey(directSendGroupKey(group));
      try {
        await Clipboard.setStringAsync(group.messageText);
        await completeSend(group, 'copy');
      } finally {
        setSendingKey(null);
      }
    },
    [completeSend, sendingKey],
  );

  const handleSharePress = useCallback(
    async (group: DirectSendGroup) => {
      if (sendingKey) return;
      setSendingKey(directSendGroupKey(group));
      try {
        await handleShareFallback(group);
      } finally {
        setSendingKey(null);
      }
    },
    [handleShareFallback, sendingKey],
  );

  const handleSkipPress = useCallback(
    (group: DirectSendGroup) => {
      if (sendingKey) return;
      void triggerSelectionHaptic();
      // Skip archives nothing — the card is simply passed over.
      dispatchQueue({ type: 'skip', id: directSendGroupKey(group) });
    },
    [dispatchQueue, sendingKey],
  );

  const progress = getSendAllQueueProgress(queue);
  const activeGroup = queue.activeId ? groupsByKey[queue.activeId] ?? null : null;
  const activeChannel: SupplierContactChannel = activeGroup
    ? channelForGroup(activeGroup)
    : 'share_sheet';
  const activeContact = activeGroup?.contact ?? null;
  const isSendingActive = Boolean(activeGroup && sendingKey === directSendGroupKey(activeGroup));

  const handleDonePress = useCallback(() => {
    onDone(getSendAllQueueProgress(queueRef.current));
  }, [onDone]);

  const renderFallbackButton = (
    label: string,
    icon: keyof typeof Ionicons.glyphMap,
    onPress: () => void,
    disabled: boolean,
  ) => (
    <TouchableOpacity
      key={label}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.82}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        flex: 1,
        minHeight: Math.max(44, ds.buttonH - 6),
        borderRadius: glassRadii.button,
        borderWidth: glassHairlineWidth,
        borderColor: glassColors.controlBorder,
        backgroundColor: glassColors.mediumFill,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Ionicons name={icon} size={ds.icon(15)} color={glassColors.textPrimary} />
      <Text
        style={{
          marginLeft: ds.spacing(6),
          fontSize: ds.fontSize(13),
          fontWeight: '600',
          color: glassColors.textPrimary,
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  if (!activeGroup || progress.isComplete) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: glassSpacing.screen }}>
        <Ionicons name="checkmark-circle" size={ds.icon(40)} color={glassColors.successText} />
        <Text
          style={{
            marginTop: ds.spacing(12),
            fontSize: ds.fontSize(18),
            fontWeight: '700',
            color: glassColors.textPrimary,
            textAlign: 'center',
          }}
        >
          Orders sent
        </Text>
        <Text
          style={{
            marginTop: ds.spacing(6),
            fontSize: ds.fontSize(13),
            color: glassColors.textSecondary,
            textAlign: 'center',
          }}
        >
          {progress.sent} of {progress.total} supplier{progress.total === 1 ? '' : 's'} sent
          {progress.skipped > 0 ? ` • ${progress.skipped} skipped` : ''}
        </Text>
        <TouchableOpacity
          onPress={handleDonePress}
          activeOpacity={0.82}
          accessibilityRole="button"
          accessibilityLabel="Back to checklist"
          style={{
            marginTop: ds.spacing(20),
            minHeight: Math.max(48, ds.buttonH),
            borderRadius: glassRadii.button,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: ds.spacing(28),
            backgroundColor: glassColors.accent,
          }}
        >
          <Text
            style={{
              fontSize: ds.fontSize(15),
              fontWeight: '700',
              color: glassColors.textOnPrimary,
            }}
          >
            Done
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: ds.spacing(24) }}
      showsVerticalScrollIndicator={false}
    >
      <Text
        style={{
          fontSize: ds.fontSize(13),
          color: glassColors.textSecondary,
          marginBottom: ds.spacing(10),
        }}
      >
        Supplier {Math.min(progress.position, progress.total)} of {progress.total}
      </Text>

      <GlassSurface
        intensity="subtle"
        blurred={false}
        style={{
          borderRadius: glassRadii.surface,
          padding: ds.spacing(16),
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text
            style={{
              flex: 1,
              fontSize: ds.fontSize(18),
              fontWeight: '700',
              color: glassColors.textPrimary,
              letterSpacing: -0.3,
            }}
            numberOfLines={1}
          >
            {activeGroup.supplierName}
          </Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: ds.spacing(10),
              paddingVertical: ds.spacing(5),
              borderRadius: glassRadii.pill,
              backgroundColor: glassColors.accentSoft,
              borderWidth: glassHairlineWidth,
              borderColor: glassColors.accentBorder,
            }}
          >
            <Ionicons
              name={CHANNEL_ICONS[activeChannel]}
              size={ds.icon(12)}
              color={glassColors.accent}
            />
            <Text
              style={{
                marginLeft: ds.spacing(5),
                fontSize: ds.fontSize(11),
                fontWeight: '700',
                color: glassColors.accent,
              }}
            >
              {CHANNEL_LABELS[activeChannel]}
            </Text>
          </View>
        </View>

        {activeContact?.contactName || activeContact?.contactPhone ? (
          <Text
            style={{
              marginTop: ds.spacing(4),
              fontSize: ds.fontSize(12),
              color: glassColors.textSecondary,
            }}
          >
            {[activeContact.contactName, activeContact.contactPhone]
              .filter(Boolean)
              .join(' • ')}
          </Text>
        ) : null}

        <View
          style={{
            marginTop: ds.spacing(14),
            borderRadius: glassRadii.button,
            borderWidth: glassHairlineWidth,
            borderColor: glassColors.cardBorder,
            backgroundColor: glassColors.subtleFill,
            paddingHorizontal: ds.spacing(14),
            paddingVertical: ds.spacing(12),
            maxHeight: 320,
          }}
        >
          <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
            <Text
              style={{
                fontSize: ds.fontSize(13),
                lineHeight: ds.fontSize(19),
                color: glassColors.textPrimary,
              }}
            >
              {activeGroup.messageText}
            </Text>
          </ScrollView>
        </View>

        <TouchableOpacity
          onPress={() => void handleSendPress(activeGroup)}
          disabled={isSendingActive}
          activeOpacity={0.82}
          accessibilityRole="button"
          accessibilityLabel={`Send to ${activeGroup.supplierName}`}
          style={{
            marginTop: ds.spacing(14),
            minHeight: Math.max(48, ds.buttonH),
            borderRadius: glassRadii.button,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            backgroundColor: glassColors.accent,
            opacity: isSendingActive ? 0.6 : 1,
          }}
        >
          <Ionicons name="paper-plane-outline" size={ds.icon(18)} color={glassColors.textOnPrimary} />
          <Text
            style={{
              marginLeft: ds.spacing(8),
              fontSize: ds.fontSize(15),
              fontWeight: '700',
              color: glassColors.textOnPrimary,
            }}
            numberOfLines={1}
          >
            {isSendingActive ? 'Sending...' : `Send to ${activeGroup.supplierName}`}
          </Text>
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', marginTop: ds.spacing(10), gap: ds.spacing(8) }}>
          {renderFallbackButton(
            'Copy',
            'copy-outline',
            () => void handleCopyPress(activeGroup),
            isSendingActive,
          )}
          {renderFallbackButton(
            'Share',
            'share-outline',
            () => void handleSharePress(activeGroup),
            isSendingActive,
          )}
          {renderFallbackButton(
            'Skip',
            'play-skip-forward-outline',
            () => handleSkipPress(activeGroup),
            isSendingActive,
          )}
        </View>
      </GlassSurface>

      <View style={{ marginTop: ds.spacing(18) }}>
        {queue.order.map((key) => {
          const status = queue.statuses[key];
          const isActive = key === queue.activeId;
          const name = groupsByKey[key]?.supplierName ?? key;
          return (
            <View
              key={key}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: ds.spacing(8),
                paddingHorizontal: ds.spacing(4),
              }}
            >
              <Ionicons
                name={
                  status === 'sent'
                    ? 'checkmark-circle'
                    : status === 'skipped'
                      ? 'remove-circle-outline'
                      : isActive
                        ? 'ellipse'
                        : 'ellipse-outline'
                }
                size={ds.icon(16)}
                color={
                  status === 'sent'
                    ? glassColors.successText
                    : status === 'skipped'
                      ? glassColors.textMuted
                      : isActive
                        ? glassColors.accent
                        : glassColors.textMuted
                }
              />
              <Text
                style={{
                  marginLeft: ds.spacing(10),
                  fontSize: ds.fontSize(13),
                  fontWeight: isActive ? '700' : '500',
                  color: isActive ? glassColors.textPrimary : glassColors.textSecondary,
                }}
                numberOfLines={1}
              >
                {name}
              </Text>
              {status === 'skipped' ? (
                <Text
                  style={{
                    marginLeft: ds.spacing(8),
                    fontSize: ds.fontSize(11),
                    color: glassColors.textMuted,
                  }}
                >
                  Skipped
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}
