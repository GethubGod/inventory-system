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
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import * as SMS from 'expo-sms';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore, useOrderStore, useSettingsStore } from '@/store';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';
import { GlassSurface, LoadingIndicator, StackScreenHeader } from '@/components';
import { buildSupplierConfirmationData } from '@/services/fulfillmentDataSource';
import type {
  ConfirmationRegularItemData,
  ConfirmationRemainingItemData,
} from '@/services/fulfillmentDataSource';
import { loadSupplierLookup } from '@/services/supplierResolver';
import {
  listSupplierContacts,
  type SupplierContact,
  type SupplierContactChannel,
} from '@/services/supplierContacts';
import { buildSupplierSendUrl } from '@/services/supplierSendLink';
import { findStaleConsumedOrderItemIds } from '@/services/orderItemFreshness';
import { supabase } from '@/lib/supabase';
import type { InventoryUnitInfo } from '../unitLabels';
import {
  ImpactFeedbackStyle,
  NotificationFeedbackType,
  triggerImpactHaptic,
  triggerNotificationHaptic,
  triggerSelectionHaptic,
} from '@/lib/haptics';
import {
  buildSendAllFinalizePayload,
  buildSendAllMessage,
  countUnresolvedRemaining,
} from './sendAllMessage';
import {
  createSendAllQueue,
  getSendAllQueueProgress,
  sendAllQueueReducer,
  type SendAllQueueEvent,
  type SendAllQueueState,
} from './sendAllQueue';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassSpacing,
} from '@/theme/design';
import { useScaledStyles } from '@/hooks/useScaledStyles';

interface SendAllSupplierParam {
  id: string;
  name: string;
}

interface SendAllCard {
  supplierId: string;
  supplierName: string;
  regularItems: ConfirmationRegularItemData[];
  remainingItems: ConfirmationRemainingItemData[];
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

function parseSupplierParams(raw: string | string[] | undefined): SendAllSupplierParam[] {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => ({
        id: typeof entry?.id === 'string' ? entry.id.trim() : '',
        name:
          typeof entry?.name === 'string' && entry.name.trim().length > 0
            ? entry.name.trim()
            : 'Supplier',
      }))
      .filter((entry) => entry.id.length > 0);
  } catch {
    return [];
  }
}

function assertNoReportedInSendAllMessage(message: string) {
  if (__DEV__ && /\breported\b/i.test(message)) {
    throw new Error('Send All supplier message cannot contain "reported".');
  }
}

export function SendAllScreen() {
  const ds = useScaledStyles();
  const params = useLocalSearchParams<{ suppliers?: string }>();
  const supplierParams = useMemo(() => parseSupplierParams(params.suppliers), [params.suppliers]);

  const { user, locations } = useAuthStore(
    useShallow((state) => ({ user: state.user, locations: state.locations }))
  );
  const exportFormat = useSettingsStore((state) => state.exportFormat);
  const { fetchPendingFulfillmentOrders, finalizeSupplierOrder, getSupplierDraftItems } =
    useOrderStore(
      useShallow((state) => ({
        fetchPendingFulfillmentOrders: state.fetchPendingFulfillmentOrders,
        finalizeSupplierOrder: state.finalizeSupplierOrder,
        getSupplierDraftItems: state.getSupplierDraftItems,
      }))
    );

  const managerLocationIds = useMemo(
    () =>
      locations
        .map((location) => (typeof location.id === 'string' ? location.id.trim() : ''))
        .filter((id) => id.length > 0),
    [locations]
  );

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cardsById, setCardsById] = useState<Record<string, SendAllCard>>({});
  const [contactsById, setContactsById] = useState<Record<string, SupplierContact>>({});
  const [queue, setQueue] = useState<SendAllQueueState | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [unitInfoById, setUnitInfoById] = useState<Record<string, InventoryUnitInfo>>({});
  const [staleSupplierIds, setStaleSupplierIds] = useState<Set<string>>(new Set());

  const queueRef = useRef<SendAllQueueState | null>(null);
  queueRef.current = queue;
  const cardsRef = useRef<Record<string, SendAllCard>>({});
  cardsRef.current = cardsById;
  const refreshInFlightRef = useRef(false);
  const finalizeInFlightRef = useRef(false);

  const dispatchQueue = useCallback((event: SendAllQueueEvent) => {
    setQueue((prev) => (prev ? sendAllQueueReducer(prev, event) : prev));
  }, []);

  const loadCards = useCallback(async (): Promise<Record<string, SendAllCard> | null> => {
    try {
      await fetchPendingFulfillmentOrders(managerLocationIds);
      const supplierLookup = await loadSupplierLookup();
      const stateOrders = (useOrderStore.getState().orders || []) as any;

      const next: Record<string, SendAllCard> = {};
      supplierParams.forEach(({ id, name }) => {
        const data = buildSupplierConfirmationData({
          supplierId: id,
          orders: stateOrders,
          supplierLookup,
          supplierDraftItems: getSupplierDraftItems(id) as any,
        });
        if (data.regularItems.length === 0 && data.remainingItems.length === 0) return;
        next[id] = {
          supplierId: id,
          supplierName: name,
          regularItems: data.regularItems,
          remainingItems: data.remainingItems,
        };
      });
      return next;
    } catch (error) {
      if (__DEV__) {
        console.warn('[Fulfillment:SendAll] Unable to load supplier payloads.', error);
      }
      return null;
    }
  }, [fetchPendingFulfillmentOrders, getSupplierDraftItems, managerLocationIds, supplierParams]);

  // Initial load: card data + supplier contacts + queue.
  useEffect(() => {
    let active = true;
    (async () => {
      setIsLoading(true);
      setLoadError(null);

      const [cards, contacts] = await Promise.all([
        loadCards(),
        listSupplierContacts().catch((error) => {
          if (__DEV__) {
            console.warn('[Fulfillment:SendAll] Unable to load supplier contacts.', error);
          }
          return [] as SupplierContact[];
        }),
      ]);

      if (!active) return;

      if (!cards) {
        setLoadError('Unable to load supplier orders. Pull back and try again.');
        setIsLoading(false);
        return;
      }

      const contactMap: Record<string, SupplierContact> = {};
      contacts.forEach((contact) => {
        contactMap[contact.supplierId] = contact;
      });

      setCardsById(cards);
      setContactsById(contactMap);
      setQueue(createSendAllQueue(supplierParams.map((entry) => entry.id).filter((id) => cards[id])));
      setIsLoading(false);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload card data and reconcile the queue. Cards that no longer have pending
  // items were archived elsewhere — mark them completed. A successful refresh
  // clears any staleness errors: the data on screen is fresh again.
  const refreshCards = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    try {
      const cards = await loadCards();
      if (!cards) return;
      setCardsById((prev) => {
        const merged: Record<string, SendAllCard> = { ...prev };
        Object.keys(prev).forEach((id) => {
          if (cards[id]) merged[id] = cards[id];
        });
        return merged;
      });
      setStaleSupplierIds((prev) => (prev.size > 0 ? new Set<string>() : prev));
      const latestQueue = queueRef.current;
      if (latestQueue) {
        latestQueue.order.forEach((id) => {
          if (latestQueue.statuses[id] === 'pending' && !cards[id]) {
            dispatchQueue({ type: 'send-completed', id });
          }
        });
      }
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [dispatchQueue, loadCards]);

  // Refresh card data when returning to this screen (e.g. after resolving
  // remaining quantities in the confirmation screen).
  useFocusEffect(
    useCallback(() => {
      if (!queueRef.current) return;
      void refreshCards();
    }, [refreshCards])
  );

  // Batch-load inventory unit info so message text resolves the same canonical
  // unit labels the confirmation screen prints (inventory base_unit/pack_unit
  // take precedence over the order item's stored label).
  const inventoryItemIdSignature = useMemo(
    () =>
      Array.from(
        new Set(
          Object.values(cardsById)
            .flatMap((card) => [
              ...card.regularItems.map((item) => item.inventoryItemId),
              ...card.remainingItems.map((item) => item.inventoryItemId),
            ])
            .map((id) => (typeof id === 'string' ? id.trim() : ''))
            .filter((id) => id.length > 0)
        )
      )
        .sort()
        .join('|'),
    [cardsById]
  );

  useEffect(() => {
    const ids = inventoryItemIdSignature
      ? inventoryItemIdSignature.split('|').filter((id) => id.length > 0)
      : [];
    if (ids.length === 0) return;

    let active = true;
    (supabase as any)
      .from('inventory_items')
      .select('id, base_unit, pack_unit, pack_size')
      .in('id', ids)
      .then(({ data }: { data: InventoryUnitInfo[] | null }) => {
        if (!active || !data) return;
        const map: Record<string, InventoryUnitInfo> = {};
        data.forEach((row) => {
          map[row.id] = row;
        });
        setUnitInfoById(map);
      });

    return () => {
      active = false;
    };
  }, [inventoryItemIdSignature]);

  const messagesById = useMemo(() => {
    const next: Record<string, string> = {};
    Object.values(cardsById).forEach((card) => {
      const message = buildSendAllMessage({
        template: exportFormat.template,
        supplierLabel: card.supplierName,
        regularItems: card.regularItems,
        remainingItems: card.remainingItems,
        unitInfoById,
      });
      assertNoReportedInSendAllMessage(message);
      next[card.supplierId] = message;
    });
    return next;
  }, [cardsById, exportFormat.template, unitInfoById]);

  const finalizeCard = useCallback(
    async (card: SendAllCard, shareMethod: 'share' | 'copy'): Promise<boolean> => {
      if (!user?.id) {
        Alert.alert('Sign In Required', 'Please sign in again to send supplier orders.');
        return false;
      }
      if (finalizeInFlightRef.current) return false;
      finalizeInFlightRef.current = true;
      try {
        const payload = buildSendAllFinalizePayload(card.regularItems, card.remainingItems);
        if (
          payload.consumedOrderItemIds.length === 0 &&
          payload.consumedDraftItemIds.length === 0
        ) {
          Alert.alert(
            'Finalize Blocked',
            'No source links were found for these items. Go back to Fulfillment, refresh, and try again.'
          );
          return false;
        }

        // Same best-effort staleness pre-check the confirmation screen runs
        // before archiving: if another device already processed any of these
        // items, mark the card errored instead of double-archiving.
        try {
          const staleIds = await findStaleConsumedOrderItemIds(payload.consumedOrderItemIds);
          if (staleIds.length > 0) {
            setStaleSupplierIds((prev) => {
              const next = new Set(prev);
              next.add(card.supplierId);
              return next;
            });
            void triggerNotificationHaptic(NotificationFeedbackType.Error);
            return false;
          }
        } catch (validationError) {
          if (__DEV__) {
            console.warn(
              '[Fulfillment:SendAll] unable to validate item freshness before finalize.',
              validationError
            );
          }
        }

        await finalizeSupplierOrder({
          supplierId: card.supplierId,
          supplierName: card.supplierName,
          createdBy: user.id,
          messageText: messagesById[card.supplierId] ?? '',
          shareMethod,
          payload: {
            regularItems: payload.regularPayload,
            remainingItems: payload.remainingPayload,
            locations: payload.locationLabels,
            sourceOrderIds: payload.sourceOrderIds,
            source_order_ids: payload.sourceOrderIds,
            sourceOrderItemIds: payload.consumedOrderItemIds,
            source_order_item_ids: payload.consumedOrderItemIds,
            totalItemCount: payload.totalItemCount,
            finalizedAt: new Date().toISOString(),
          },
          consumedOrderItemIds: payload.consumedOrderItemIds,
          consumedDraftItemIds: payload.consumedDraftItemIds,
          lineItems: payload.historyLineItems,
        });
        return true;
      } catch (error: any) {
        console.error('[Fulfillment:SendAll] finalizeSupplierOrder failed:', error);
        Alert.alert(
          'Finalize Failed',
          error?.message || `Unable to archive the ${card.supplierName} order.`
        );
        return false;
      } finally {
        finalizeInFlightRef.current = false;
      }
    },
    [finalizeSupplierOrder, messagesById, user?.id]
  );

  const completeSend = useCallback(
    async (card: SendAllCard, shareMethod: 'share' | 'copy') => {
      const finalized = await finalizeCard(card, shareMethod);
      if (finalized) {
        void triggerNotificationHaptic(NotificationFeedbackType.Success);
        dispatchQueue({ type: 'send-completed', id: card.supplierId });
      } else {
        dispatchQueue({ type: 'send-cancelled', id: card.supplierId });
      }
      return finalized;
    },
    [dispatchQueue, finalizeCard]
  );

  // Deep-link sends (sms: fallback / whatsapp) auto-advance when the app becomes
  // active again after the user returns from the messaging app.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status !== 'active') return;
      const currentQueue = queueRef.current;
      const awaitingId = currentQueue?.awaitingReturnId ?? null;
      if (!awaitingId) return;
      const card = cardsRef.current[awaitingId];
      dispatchQueue({ type: 'send-cancelled', id: awaitingId }); // clear awaiting flag
      if (!card) return;
      void completeSend(card, 'share');
    });
    return () => {
      subscription.remove();
    };
  }, [completeSend, dispatchQueue]);

  const handleShareFallback = useCallback(
    async (card: SendAllCard) => {
      const message = messagesById[card.supplierId] ?? '';
      // Mirror the confirmation screen: start finalization in parallel with the
      // share sheet so DB work happens while the user interacts with the dialog.
      const finalizePromise = finalizeCard(card, 'share');
      try {
        await Share.share({ message, title: `${card.supplierName} Order` });
      } catch {
        // Share dialog threw (rare) — finalization still running in background.
      }
      const finalized = await finalizePromise;
      if (finalized) {
        void triggerNotificationHaptic(NotificationFeedbackType.Success);
        dispatchQueue({ type: 'send-completed', id: card.supplierId });
      } else {
        dispatchQueue({ type: 'send-cancelled', id: card.supplierId });
      }
    },
    [dispatchQueue, finalizeCard, messagesById]
  );

  const launchDeepLink = useCallback(
    async (card: SendAllCard, url: string): Promise<void> => {
      const supported = await Linking.canOpenURL(url).catch(() => true);
      if (!supported) {
        Alert.alert(
          'App Unavailable',
          'The messaging app for this supplier is not available on this device. Using the share sheet instead.'
        );
        await handleShareFallback(card);
        return;
      }
      dispatchQueue({ type: 'send-launched', id: card.supplierId, awaitReturn: true });
      try {
        await Linking.openURL(url);
      } catch {
        dispatchQueue({ type: 'send-cancelled', id: card.supplierId });
        Alert.alert(
          'Unable to Open Messaging App',
          'Could not open the messaging app. Using the share sheet instead.'
        );
        await handleShareFallback(card);
      }
    },
    [dispatchQueue, handleShareFallback]
  );

  const handleSendPress = useCallback(
    async (card: SendAllCard) => {
      if (sendingId) return;
      const message = messagesById[card.supplierId] ?? '';
      const contact = contactsById[card.supplierId];
      const channel: SupplierContactChannel = contact?.contactChannel ?? 'share_sheet';
      const phone = contact?.contactPhone ?? null;

      void triggerImpactHaptic(ImpactFeedbackStyle.Medium);
      setSendingId(card.supplierId);
      try {
        if (channel === 'sms' && phone) {
          const smsAvailable = await SMS.isAvailableAsync().catch(() => false);
          if (smsAvailable) {
            // Preferred path: expo-sms compose UI — its completion result drives
            // auto-advance without waiting on an AppState round-trip.
            const { result } = await SMS.sendSMSAsync([phone], message);
            if (result === 'cancelled') {
              dispatchQueue({ type: 'send-cancelled', id: card.supplierId });
              return;
            }
            if (Platform.OS === 'android' && result === 'unknown') {
              // Android reports 'unknown' for both cancel and send, so confirm
              // with the user before archiving. iOS reports cancel correctly
              // and is unaffected.
              const wasSent = await new Promise<boolean>((resolve) => {
                Alert.alert(
                  'Confirm Send',
                  `Was the message sent to ${card.supplierName}?`,
                  [
                    { text: 'Not sent', style: 'cancel', onPress: () => resolve(false) },
                    { text: 'Send', onPress: () => resolve(true) },
                  ],
                  { cancelable: false }
                );
              });
              if (!wasSent) {
                dispatchQueue({ type: 'send-cancelled', id: card.supplierId });
                return;
              }
            }
            await completeSend(card, 'share');
            return;
          }
          const url = buildSupplierSendUrl({ channel: 'sms', phone }, message);
          if (url) {
            await launchDeepLink(card, url);
            return;
          }
          await handleShareFallback(card);
          return;
        }

        if (channel === 'whatsapp' && phone) {
          const url = buildSupplierSendUrl({ channel: 'whatsapp', phone }, message);
          if (url) {
            await launchDeepLink(card, url);
            return;
          }
          await handleShareFallback(card);
          return;
        }

        await handleShareFallback(card);
      } finally {
        setSendingId(null);
      }
    },
    [
      completeSend,
      contactsById,
      dispatchQueue,
      handleShareFallback,
      launchDeepLink,
      messagesById,
      sendingId,
    ]
  );

  const handleCopyPress = useCallback(
    async (card: SendAllCard) => {
      if (sendingId) return;
      setSendingId(card.supplierId);
      try {
        await Clipboard.setStringAsync(messagesById[card.supplierId] ?? '');
        await completeSend(card, 'copy');
      } finally {
        setSendingId(null);
      }
    },
    [completeSend, messagesById, sendingId]
  );

  const handleSharePress = useCallback(
    async (card: SendAllCard) => {
      if (sendingId) return;
      setSendingId(card.supplierId);
      try {
        await handleShareFallback(card);
      } finally {
        setSendingId(null);
      }
    },
    [handleShareFallback, sendingId]
  );

  const handleSkipPress = useCallback(
    (card: SendAllCard) => {
      if (sendingId) return;
      void triggerSelectionHaptic();
      dispatchQueue({ type: 'skip', id: card.supplierId });
    },
    [dispatchQueue, sendingId]
  );

  const handleReviewPress = useCallback((card: SendAllCard) => {
    router.push({
      pathname: '/(manager)/fulfillment-confirmation',
      params: {
        supplier: card.supplierId,
        supplierLabel: card.supplierName,
        from: 'send-all',
        items: encodeURIComponent(JSON.stringify(card.regularItems)),
        remaining: encodeURIComponent(JSON.stringify(card.remainingItems)),
      },
    } as any);
  }, []);

  const handleDonePress = useCallback(() => {
    router.replace('/(manager)/fulfillment');
  }, []);

  const progress = queue ? getSendAllQueueProgress(queue) : null;
  const activeCard = queue?.activeId ? cardsById[queue.activeId] ?? null : null;
  const activeContact = activeCard ? contactsById[activeCard.supplierId] : undefined;
  const activeChannel: SupplierContactChannel =
    activeContact?.contactChannel && activeContact.contactPhone
      ? activeContact.contactChannel
      : 'share_sheet';
  const activeUnresolvedCount = activeCard
    ? countUnresolvedRemaining(activeCard.remainingItems)
    : 0;
  const isSendingActive = Boolean(activeCard && sendingId === activeCard.supplierId);
  const isActiveStale = Boolean(activeCard && staleSupplierIds.has(activeCard.supplierId));

  const handleRefreshRetry = useCallback(() => {
    void triggerSelectionHaptic();
    void refreshCards();
  }, [refreshCards]);

  const renderFallbackButton = (
    label: string,
    icon: keyof typeof Ionicons.glyphMap,
    onPress: () => void,
    disabled: boolean
  ) => (
    <TouchableOpacity
      key={label}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.82}
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

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: glassColors.background }}
      edges={['top', 'left', 'right', 'bottom']}
    >
      <ManagerScaleContainer>
        <StackScreenHeader
          title="Send All"
          subtitle={
            progress && progress.total > 0
              ? `Supplier ${Math.min(progress.position, progress.total)} of ${progress.total}`
              : 'Send every supplier order in one pass.'
          }
          onBackPress={handleDonePress}
        />

        {isLoading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <LoadingIndicator size="small" color={glassColors.accent} />
            <Text
              style={{
                marginTop: ds.spacing(12),
                fontSize: ds.fontSize(13),
                color: glassColors.textSecondary,
              }}
            >
              Preparing supplier orders...
            </Text>
          </View>
        ) : loadError ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: glassSpacing.screen }}>
            <Ionicons name="cloud-offline-outline" size={ds.icon(28)} color={glassColors.accent} />
            <Text
              style={{
                marginTop: ds.spacing(10),
                fontSize: ds.fontSize(14),
                color: glassColors.textSecondary,
                textAlign: 'center',
              }}
            >
              {loadError}
            </Text>
          </View>
        ) : !queue || queue.order.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: glassSpacing.screen }}>
            <Ionicons name="checkmark-circle-outline" size={ds.icon(30)} color={glassColors.successText} />
            <Text
              style={{
                marginTop: ds.spacing(10),
                fontSize: ds.fontSize(15),
                fontWeight: '600',
                color: glassColors.textPrimary,
                textAlign: 'center',
              }}
            >
              Nothing left to send
            </Text>
            <Text
              style={{
                marginTop: ds.spacing(6),
                fontSize: ds.fontSize(13),
                color: glassColors.textSecondary,
                textAlign: 'center',
              }}
            >
              All supplier orders have already been handled.
            </Text>
          </View>
        ) : activeCard && progress && !progress.isComplete ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingHorizontal: glassSpacing.screen,
              paddingBottom: ds.spacing(24),
            }}
            showsVerticalScrollIndicator={false}
          >
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
                  {activeCard.supplierName}
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

              {activeContact?.contactName ? (
                <Text
                  style={{
                    marginTop: ds.spacing(4),
                    fontSize: ds.fontSize(12),
                    color: glassColors.textSecondary,
                  }}
                >
                  {activeContact.contactName}
                  {activeContact.contactPhone ? ` • ${activeContact.contactPhone}` : ''}
                </Text>
              ) : activeContact?.contactPhone ? (
                <Text
                  style={{
                    marginTop: ds.spacing(4),
                    fontSize: ds.fontSize(12),
                    color: glassColors.textSecondary,
                  }}
                >
                  {activeContact.contactPhone}
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
                    {messagesById[activeCard.supplierId]}
                  </Text>
                </ScrollView>
              </View>

              {activeUnresolvedCount > 0 ? (
                <View
                  style={{
                    marginTop: ds.spacing(12),
                    borderRadius: glassRadii.button,
                    backgroundColor: '#FFF7E6',
                    borderWidth: glassHairlineWidth,
                    borderColor: '#F5D9A8',
                    paddingHorizontal: ds.spacing(12),
                    paddingVertical: ds.spacing(10),
                  }}
                >
                  <Text style={{ fontSize: ds.fontSize(13), fontWeight: '600', color: glassColors.warningText }}>
                    {activeUnresolvedCount} remaining item{activeUnresolvedCount === 1 ? '' : 's'} need a final quantity
                  </Text>
                  <Text style={{ marginTop: ds.spacing(3), fontSize: ds.fontSize(12), color: glassColors.textSecondary }}>
                    Review this order to set quantities before sending.
                  </Text>
                </View>
              ) : null}

              {isActiveStale ? (
                <>
                  <View
                    style={{
                      marginTop: ds.spacing(12),
                      borderRadius: glassRadii.button,
                      backgroundColor: glassColors.dangerSoft,
                      borderWidth: glassHairlineWidth,
                      borderColor: glassColors.dangerText,
                      paddingHorizontal: ds.spacing(12),
                      paddingVertical: ds.spacing(10),
                    }}
                  >
                    <Text
                      style={{
                        fontSize: ds.fontSize(13),
                        fontWeight: '600',
                        color: glassColors.dangerText,
                      }}
                    >
                      Order changed on another device
                    </Text>
                    <Text
                      style={{
                        marginTop: ds.spacing(3),
                        fontSize: ds.fontSize(12),
                        color: glassColors.textSecondary,
                      }}
                    >
                      Some items were already processed elsewhere. Nothing was archived. Refresh to
                      load the latest order before sending.
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={handleRefreshRetry}
                    activeOpacity={0.82}
                    style={{
                      marginTop: ds.spacing(14),
                      minHeight: Math.max(48, ds.buttonH),
                      borderRadius: glassRadii.button,
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexDirection: 'row',
                      backgroundColor: glassColors.accent,
                    }}
                  >
                    <Ionicons name="refresh-outline" size={ds.icon(18)} color={glassColors.textOnPrimary} />
                    <Text
                      style={{
                        marginLeft: ds.spacing(8),
                        fontSize: ds.fontSize(15),
                        fontWeight: '700',
                        color: glassColors.textOnPrimary,
                      }}
                    >
                      Refresh & retry
                    </Text>
                  </TouchableOpacity>
                </>
              ) : activeUnresolvedCount > 0 ? (
                <TouchableOpacity
                  onPress={() => handleReviewPress(activeCard)}
                  activeOpacity={0.82}
                  style={{
                    marginTop: ds.spacing(14),
                    minHeight: Math.max(48, ds.buttonH),
                    borderRadius: glassRadii.button,
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'row',
                    backgroundColor: glassColors.accent,
                  }}
                >
                  <Ionicons name="create-outline" size={ds.icon(18)} color={glassColors.textOnPrimary} />
                  <Text
                    style={{
                      marginLeft: ds.spacing(8),
                      fontSize: ds.fontSize(15),
                      fontWeight: '700',
                      color: glassColors.textOnPrimary,
                    }}
                  >
                    Review & Set Quantities
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={() => void handleSendPress(activeCard)}
                  disabled={isSendingActive}
                  activeOpacity={0.82}
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
                    {isSendingActive ? 'Sending...' : `Send to ${activeCard.supplierName}`}
                  </Text>
                </TouchableOpacity>
              )}

              <View style={{ flexDirection: 'row', marginTop: ds.spacing(10), gap: ds.spacing(8) }}>
                {renderFallbackButton(
                  'Copy',
                  'copy-outline',
                  () => void handleCopyPress(activeCard),
                  isSendingActive || activeUnresolvedCount > 0 || isActiveStale
                )}
                {renderFallbackButton(
                  'Share',
                  'share-outline',
                  () => void handleSharePress(activeCard),
                  isSendingActive || activeUnresolvedCount > 0 || isActiveStale
                )}
                {renderFallbackButton(
                  'Skip',
                  'play-skip-forward-outline',
                  () => handleSkipPress(activeCard),
                  isSendingActive
                )}
              </View>
            </GlassSurface>

            <View style={{ marginTop: ds.spacing(18) }}>
              {queue.order.map((supplierId) => {
                const status = queue.statuses[supplierId];
                const isActive = supplierId === queue.activeId;
                const name = cardsById[supplierId]?.supplierName ?? supplierId;
                return (
                  <View
                    key={supplierId}
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
        ) : (
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
              Send All complete
            </Text>
            {progress ? (
              <Text
                style={{
                  marginTop: ds.spacing(6),
                  fontSize: ds.fontSize(13),
                  color: glassColors.textSecondary,
                  textAlign: 'center',
                }}
              >
                {progress.sent} sent
                {progress.skipped > 0 ? ` • ${progress.skipped} skipped` : ''}
              </Text>
            ) : null}
            <TouchableOpacity
              onPress={handleDonePress}
              activeOpacity={0.82}
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
                Back to Fulfillment
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
