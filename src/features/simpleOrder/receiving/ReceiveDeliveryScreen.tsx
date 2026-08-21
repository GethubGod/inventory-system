import React, { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import {
  FlatList,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyStateCard, LoadingIndicator } from '@/components';
import { getFloatingPillClearance } from '@/components/navigation';
import { useResolvedActiveLocation } from '@/hooks/useResolvedActiveLocation';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  ImpactFeedbackStyle,
  NotificationFeedbackType,
  triggerConfirmationHaptic,
  triggerImpactHaptic,
  triggerNotificationHaptic,
  triggerSelectionHaptic,
} from '@/lib/haptics';
import {
  completeReceipt,
  listReceivableOrders,
  locationGroupForLocation,
  saveReceiptLines,
  startReceipt,
  type ReceivableOrder,
  type ReceiptStatus,
} from '@/services/orderReceiving';
import {
  colors,
  glassColors,
  glassHairlineWidth,
  glassRadii,
  glassSpacing,
  tipsTheme,
} from '@/theme/design';
import { formatQuantity } from '../checklistSelection';
import { formatRecentOrderDate } from '../recentOrders';
import {
  buildSaveLines,
  countFlaggedLines,
  EMPTY_RECEIVE_STATE,
  isLineFlagged,
  receiveReducer,
  type ReceiveLine,
} from './receiveLineState';

/**
 * Phase 7a delivery receiving (deliberately simple): pick a sent order, all
 * items start checked, tap what didn't arrive (optionally a short quantity +
 * note), save. Happy path is "open, glance, save" — big rows, minimal input.
 */

type Phase =
  | { name: 'list' }
  | { name: 'receipt' }
  | { name: 'done'; status: Extract<ReceiptStatus, 'complete' | 'partial'>; flaggedCount: number };

const STEPPER_SIZE = 40;
const CHECK_TARGET = 56;

interface ReceiveLineRowProps {
  line: ReceiveLine;
  isLast: boolean;
  onToggle: (pastOrderItemId: string) => void;
  onAdjustShortQty: (pastOrderItemId: string, delta: number) => void;
  onSetNote: (pastOrderItemId: string, note: string) => void;
}

function ReceiveLineRow({
  line,
  isLast,
  onToggle,
  onAdjustShortQty,
  onSetNote,
}: ReceiveLineRowProps) {
  const ds = useScaledStyles();
  const checkSize = Math.max(28, ds.icon(28));
  const stepperSize = Math.max(STEPPER_SIZE, ds.icon(STEPPER_SIZE));
  const flagged = isLineFlagged(line);
  const arrivedQty = line.shortQty ?? 0;

  return (
    <View
      style={{
        paddingVertical: ds.spacing(8),
        borderBottomWidth: isLast ? 0 : glassHairlineWidth,
        borderBottomColor: glassColors.divider,
      }}
    >
      <TouchableOpacity
        onPress={() => {
          void triggerSelectionHaptic();
          onToggle(line.pastOrderItemId);
        }}
        activeOpacity={0.6}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: line.checked }}
        accessibilityLabel={`${line.itemName}, ${line.checked ? 'arrived' : 'flagged'}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: Math.max(CHECK_TARGET, ds.rowH),
        }}
      >
        <Ionicons
          name={line.checked ? 'checkmark-circle' : 'alert-circle'}
          size={checkSize}
          color={line.checked ? glassColors.successText : glassColors.warningText}
          style={{ marginRight: ds.spacing(12) }}
        />
        <View style={{ flex: 1, paddingRight: ds.spacing(8) }}>
          <Text
            numberOfLines={2}
            style={{
              fontSize: ds.fontSize(16),
              fontWeight: '600',
              color: glassColors.textPrimary,
            }}
          >
            {line.itemName}
          </Text>
          <Text
            style={{
              marginTop: 1,
              fontSize: ds.fontSize(12),
              color: glassColors.textMuted,
            }}
          >
            Ordered {formatQuantity(line.orderedQty)}
            {line.unit ? ` ${line.unit}` : ''}
            {line.checked ? '' : flagged ? ' • didn’t arrive in full' : ' • arrived in full'}
          </Text>
        </View>
      </TouchableOpacity>

      {!line.checked ? (
        <View style={{ paddingLeft: checkSize + ds.spacing(12) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text
              style={{
                flex: 1,
                fontSize: ds.fontSize(13),
                color: glassColors.textSecondary,
              }}
            >
              Arrived: {formatQuantity(arrivedQty)}
              {line.unit ? ` ${line.unit}` : ''}
            </Text>
            <TouchableOpacity
              onPress={() => {
                void triggerImpactHaptic(ImpactFeedbackStyle.Light);
                onAdjustShortQty(line.pastOrderItemId, -1);
              }}
              disabled={arrivedQty <= 0}
              accessibilityRole="button"
              accessibilityLabel={`Decrease arrived quantity of ${line.itemName}`}
              style={{
                width: stepperSize,
                height: stepperSize,
                borderRadius: stepperSize / 2,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: glassHairlineWidth,
                borderColor: glassColors.controlBorder,
                backgroundColor: colors.glassCircle,
                opacity: arrivedQty <= 0 ? 0.4 : 1,
              }}
            >
              <Ionicons name="remove" size={ds.icon(20)} color={glassColors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                void triggerImpactHaptic(ImpactFeedbackStyle.Light);
                onAdjustShortQty(line.pastOrderItemId, 1);
              }}
              disabled={arrivedQty >= line.orderedQty}
              accessibilityRole="button"
              accessibilityLabel={`Increase arrived quantity of ${line.itemName}`}
              style={{
                width: stepperSize,
                height: stepperSize,
                borderRadius: stepperSize / 2,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: glassHairlineWidth,
                borderColor: glassColors.controlBorder,
                backgroundColor: colors.glassCircle,
                marginLeft: ds.spacing(8),
                opacity: arrivedQty >= line.orderedQty ? 0.4 : 1,
              }}
            >
              <Ionicons name="add" size={ds.icon(20)} color={glassColors.textPrimary} />
            </TouchableOpacity>
          </View>

          {flagged ? (
            <TextInput
              value={line.note}
              onChangeText={(text) => onSetNote(line.pastOrderItemId, text)}
              placeholder="Add note (optional)"
              placeholderTextColor={glassColors.textMuted}
              accessibilityLabel={`Note for ${line.itemName}`}
              style={{
                marginTop: ds.spacing(8),
                minHeight: 40,
                paddingHorizontal: ds.spacing(12),
                paddingVertical: ds.spacing(8),
                borderRadius: glassRadii.button,
                borderWidth: glassHairlineWidth,
                borderColor: glassColors.controlBorder,
                backgroundColor: glassColors.subtleFill,
                fontSize: ds.fontSize(14),
                color: glassColors.textPrimary,
              }}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function ReceiveDeliveryScreen() {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();
  const { location } = useResolvedActiveLocation();

  const locationGroup = useMemo(
    () => locationGroupForLocation(location?.name, location?.short_code),
    [location?.name, location?.short_code],
  );

  const [phase, setPhase] = useState<Phase>({ name: 'list' });
  const [orders, setOrders] = useState<ReceivableOrder[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [openingOrderId, setOpeningOrderId] = useState<string | null>(null);
  const [receiptSupplier, setReceiptSupplier] = useState<string>('');
  const [state, dispatch] = useReducer(receiveReducer, EMPTY_RECEIVE_STATE);
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    setListError(null);
    setOrders(null);
    try {
      setOrders(await listReceivableOrders(locationGroup));
    } catch (error) {
      setListError(
        error instanceof Error ? error.message : 'Could not load deliveries to receive.',
      );
    }
  }, [locationGroup]);

  useEffect(() => {
    setPhase({ name: 'list' });
    void loadOrders();
  }, [loadOrders]);

  const handleOpenOrder = useCallback(async (order: ReceivableOrder) => {
    if (openingOrderId) return;
    void triggerImpactHaptic(ImpactFeedbackStyle.Light);
    setOpeningOrderId(order.id);
    setActionError(null);
    try {
      const receipt = await startReceipt(order.id);
      dispatch({ type: 'init', receipt });
      setReceiptSupplier(receipt.pastOrder?.supplierName ?? order.supplierName);
      setPhase({ name: 'receipt' });
    } catch (error) {
      void triggerNotificationHaptic(NotificationFeedbackType.Error);
      setActionError(
        error instanceof Error ? error.message : 'Could not open this delivery.',
      );
    } finally {
      setOpeningOrderId(null);
    }
  }, [openingOrderId]);

  const handleToggle = useCallback((pastOrderItemId: string) => {
    dispatch({ type: 'toggle', pastOrderItemId });
  }, []);

  const handleAdjustShortQty = useCallback((pastOrderItemId: string, delta: number) => {
    dispatch({ type: 'adjustShortQty', pastOrderItemId, delta });
  }, []);

  const handleSetNote = useCallback((pastOrderItemId: string, note: string) => {
    dispatch({ type: 'setNote', pastOrderItemId, note });
  }, []);

  const handleSave = useCallback(async () => {
    if (isSaving || !state.receiptId) return;
    setIsSaving(true);
    setActionError(null);
    try {
      await saveReceiptLines(state.receiptId, buildSaveLines(state));
      const receipt = await completeReceipt(state.receiptId);
      void triggerConfirmationHaptic();
      setPhase({
        name: 'done',
        status: receipt.status === 'partial' ? 'partial' : 'complete',
        flaggedCount: countFlaggedLines(state),
      });
    } catch (error) {
      void triggerNotificationHaptic(NotificationFeedbackType.Error);
      setActionError(
        error instanceof Error ? error.message : 'Could not save this receipt.',
      );
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, state]);

  const handleDone = useCallback(() => {
    setPhase({ name: 'list' });
    void loadOrders();
  }, [loadOrders]);

  const handleBack = useCallback(() => {
    if (phase.name === 'receipt') {
      // The receipt stays in_progress; reopening the order resumes it.
      setPhase({ name: 'list' });
      setActionError(null);
      void loadOrders();
      return;
    }
    router.back();
  }, [loadOrders, phase.name]);

  const flaggedCount = countFlaggedLines(state);
  // Clear the floating pill toolbar (it stays visible on this screen with the
  // dots button appended).
  const bottomInset = getFloatingPillClearance(insets.bottom);
  const saveButtonHeight = Math.max(56, ds.buttonH);

  let content: React.ReactNode;
  if (phase.name === 'done') {
    const complete = phase.status === 'complete';
    content = (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons
          name={complete ? 'checkmark-circle' : 'alert-circle'}
          size={ds.icon(72)}
          color={complete ? glassColors.successText : glassColors.warningText}
          style={{ marginBottom: ds.spacing(12) }}
        />
        <Text
          style={{
            fontSize: ds.fontSize(22),
            fontWeight: '700',
            color: glassColors.textPrimary,
            marginBottom: ds.spacing(4),
          }}
        >
          {complete ? 'Delivery received' : 'Saved with issues'}
        </Text>
        <Text
          style={{
            fontSize: ds.fontSize(15),
            color: glassColors.textSecondary,
            textAlign: 'center',
            paddingHorizontal: ds.spacing(32),
            marginBottom: ds.spacing(20),
          }}
        >
          {complete
            ? 'Everything on this order arrived.'
            : `${phase.flaggedCount} item${phase.flaggedCount === 1 ? '' : 's'} flagged as missing or short. Your manager can see this.`}
        </Text>
        <TouchableOpacity
          onPress={handleDone}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Done receiving"
          style={{
            minHeight: 52,
            paddingHorizontal: ds.spacing(28),
            borderRadius: glassRadii.submitButton,
            backgroundColor: colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: ds.fontSize(17), fontWeight: '700', color: colors.white }}>
            Done
          </Text>
        </TouchableOpacity>
      </View>
    );
  } else if (phase.name === 'receipt') {
    content = (
      <>
        <FlatList
          data={state.lines}
          keyExtractor={(line) => line.pastOrderItemId}
          renderItem={({ item, index }) => (
            <ReceiveLineRow
              line={item}
              isLast={index === state.lines.length - 1}
              onToggle={handleToggle}
              onAdjustShortQty={handleAdjustShortQty}
              onSetNote={handleSetNote}
            />
          )}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingBottom: saveButtonHeight + bottomInset + ds.spacing(32),
          }}
          ListHeaderComponent={
            <Text
              style={{
                paddingVertical: ds.spacing(8),
                fontSize: ds.fontSize(13),
                color: glassColors.textSecondary,
              }}
            >
              Everything is marked as arrived. Tap anything that didn’t arrive in full.
            </Text>
          }
        />
        <View
          style={{
            position: 'absolute',
            left: glassSpacing.screen,
            right: glassSpacing.screen,
            bottom: bottomInset,
          }}
        >
          {actionError ? (
            <Text
              style={{
                marginBottom: ds.spacing(8),
                fontSize: ds.fontSize(13),
                color: glassColors.dangerText,
                textAlign: 'center',
              }}
            >
              {actionError}
            </Text>
          ) : null}
          <TouchableOpacity
            onPress={() => void handleSave()}
            disabled={isSaving}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={
              flaggedCount > 0
                ? `Save receipt with ${flaggedCount} flagged items`
                : 'Save receipt, everything arrived'
            }
            style={{
              minHeight: saveButtonHeight,
              borderRadius: glassRadii.submitButton,
              backgroundColor: colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: isSaving ? 0.6 : 1,
              shadowColor: colors.black,
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.12,
              shadowRadius: 12,
              elevation: 4,
            }}
          >
            <Text style={{ fontSize: ds.fontSize(17), fontWeight: '700', color: colors.white }}>
              {isSaving
                ? 'Saving…'
                : flaggedCount > 0
                  ? `Save (${flaggedCount} flagged)`
                  : 'Save — all arrived'}
            </Text>
          </TouchableOpacity>
        </View>
      </>
    );
  } else if (listError) {
    content = (
      <View style={{ paddingTop: ds.spacing(24) }}>
        <EmptyStateCard
          icon="alert-circle-outline"
          title="Deliveries unavailable"
          message={listError}
          actionLabel="Try again"
          onPressAction={() => void loadOrders()}
        />
      </View>
    );
  } else if (orders === null) {
    content = <LoadingIndicator />;
  } else if (orders.length === 0) {
    content = (
      <View style={{ paddingTop: ds.spacing(24) }}>
        <EmptyStateCard
          icon="cube-outline"
          title="Nothing to receive"
          message="Orders sent in the last 30 days show up here until they are checked in."
        />
      </View>
    );
  } else {
    content = (
      <FlatList
        data={orders}
        keyExtractor={(order) => order.id}
        contentContainerStyle={{ paddingBottom: bottomInset + ds.spacing(24) }}
        ListHeaderComponent={
          actionError ? (
            <Text
              style={{
                paddingVertical: ds.spacing(8),
                fontSize: ds.fontSize(13),
                color: glassColors.dangerText,
              }}
            >
              {actionError}
            </Text>
          ) : null
        }
        renderItem={({ item, index }) => (
          <TouchableOpacity
            onPress={() => void handleOpenOrder(item)}
            disabled={openingOrderId !== null}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Receive ${item.supplierName} delivery`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              minHeight: 64,
              paddingVertical: ds.spacing(10),
              borderBottomWidth:
                index === orders.length - 1 ? 0 : glassHairlineWidth,
              borderBottomColor: glassColors.divider,
              opacity: openingOrderId !== null && openingOrderId !== item.id ? 0.5 : 1,
            }}
          >
            <View style={{ flex: 1, paddingRight: ds.spacing(8) }}>
              <Text
                numberOfLines={1}
                style={{
                  fontSize: ds.fontSize(16),
                  fontWeight: '600',
                  color: glassColors.textPrimary,
                }}
              >
                {item.supplierName}
              </Text>
              <Text
                style={{
                  marginTop: 1,
                  fontSize: ds.fontSize(12),
                  color: glassColors.textMuted,
                }}
              >
                {formatRecentOrderDate(item.createdAt)} • {item.itemCount} item
                {item.itemCount === 1 ? '' : 's'}
              </Text>
            </View>
            {openingOrderId === item.id ? (
              <LoadingIndicator size="small" color={glassColors.accent} />
            ) : (
              <Ionicons
                name="chevron-forward"
                size={ds.icon(16)}
                color={glassColors.textMuted}
              />
            )}
          </TouchableOpacity>
        )}
      />
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: tipsTheme.page }}>
      <View style={{ flex: 1, paddingHorizontal: glassSpacing.screen }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingTop: ds.spacing(2),
            paddingBottom: ds.spacing(12),
          }}
        >
          {phase.name !== 'done' ? (
            <TouchableOpacity
              onPress={handleBack}
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ marginRight: ds.spacing(10) }}
            >
              <Ionicons name="chevron-back" size={ds.icon(24)} color={glassColors.textPrimary} />
            </TouchableOpacity>
          ) : null}
          <View style={{ flex: 1 }}>
            <Text
              numberOfLines={1}
              style={{
                fontSize: ds.fontSize(20),
                fontWeight: '700',
                color: glassColors.textPrimary,
              }}
            >
              {phase.name === 'receipt' && receiptSupplier
                ? receiptSupplier
                : 'Receive delivery'}
            </Text>
            {phase.name === 'receipt' ? (
              <Text style={{ fontSize: ds.fontSize(12), color: glassColors.textMuted }}>
                Check the delivery against the order
              </Text>
            ) : null}
          </View>
        </View>

        {content}
      </View>
    </SafeAreaView>
  );
}
