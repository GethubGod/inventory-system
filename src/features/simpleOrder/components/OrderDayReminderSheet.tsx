import React, { useCallback, useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetShell } from '@/components/BottomSheetShell';
import { LoadingIndicator } from '@/components';
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
  deleteRecurringReminderRule,
  listRecurringReminderRules,
  upsertMyChecklistOrderDayReminderRule,
  type RecurringReminderRule,
} from '@/services/employeeReminders';
import {
  colors,
  glassColors,
  glassHairlineWidth,
  glassRadii,
} from '@/theme/design';
import {
  buildOrderDayReminderInput,
  defaultOrderDayReminderForm,
  findMyChecklistOrderDayRule,
  formatTimeLabel,
  mapRuleToOrderDayForm,
  REMINDER_TIME_STEP_MINUTES,
  shiftTime,
  summarizeOrderDayRule,
  toggleDay,
  WEEKDAY_LABELS,
  type OrderDayReminderFormState,
} from '../orderDayReminder';

/**
 * Employee self-serve order-day reminder sheet (Phase 5c). Sets, edits, or
 * removes the caller's own checklist order-day recurring rule for the active
 * location group. Deliberately minimal: days of week + time, nothing else.
 */

interface OrderDayReminderSheetProps {
  visible: boolean;
  locationGroup: 'sushi' | 'poki';
  onClose: () => void;
  /** Lets the host screen refresh its bell state after save/remove. */
  onRuleChanged?: (rule: RecurringReminderRule | null) => void;
}

export function OrderDayReminderSheet({
  visible,
  locationGroup,
  onClose,
  onRuleChanged,
}: OrderDayReminderSheetProps) {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [existingRule, setExistingRule] = useState<RecurringReminderRule | null>(null);
  const [form, setForm] = useState<OrderDayReminderFormState>(defaultOrderDayReminderForm());
  const [isSaving, setIsSaving] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setIsLoading(true);
    setLoadError(null);
    setSaveError(null);
    listRecurringReminderRules()
      .then((rules) => {
        if (!active) return;
        const rule = findMyChecklistOrderDayRule(rules, locationGroup);
        setExistingRule(rule);
        setForm(rule ? mapRuleToOrderDayForm(rule) : defaultOrderDayReminderForm());
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(
          error instanceof Error ? error.message : 'Could not load your reminder.',
        );
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [locationGroup, visible]);

  const handleToggleDay = useCallback((day: number) => {
    void triggerSelectionHaptic();
    setForm((prev) => ({ ...prev, daysOfWeek: toggleDay(prev.daysOfWeek, day) }));
  }, []);

  const handleShiftTime = useCallback((deltaMinutes: number) => {
    void triggerImpactHaptic(ImpactFeedbackStyle.Light);
    setForm((prev) => ({ ...prev, timeOfDay: shiftTime(prev.timeOfDay, deltaMinutes) }));
  }, []);

  const handleSave = useCallback(async () => {
    if (isSaving || isRemoving) return;
    const { input, error } = buildOrderDayReminderInput(
      form,
      locationGroup,
      existingRule?.id ?? null,
    );
    if (!input) {
      setSaveError(error);
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const saved = await upsertMyChecklistOrderDayReminderRule(input);
      void triggerConfirmationHaptic();
      setExistingRule(saved);
      onRuleChanged?.(saved);
      onClose();
    } catch (err) {
      void triggerNotificationHaptic(NotificationFeedbackType.Error);
      setSaveError(
        err instanceof Error ? err.message : 'Could not save your reminder.',
      );
    } finally {
      setIsSaving(false);
    }
  }, [existingRule?.id, form, isRemoving, isSaving, locationGroup, onClose, onRuleChanged]);

  const handleRemove = useCallback(async () => {
    if (isSaving || isRemoving || !existingRule) return;
    setIsRemoving(true);
    setSaveError(null);
    try {
      await deleteRecurringReminderRule(existingRule.id);
      void triggerConfirmationHaptic();
      setExistingRule(null);
      setForm(defaultOrderDayReminderForm());
      onRuleChanged?.(null);
      onClose();
    } catch (err) {
      void triggerNotificationHaptic(NotificationFeedbackType.Error);
      setSaveError(
        err instanceof Error ? err.message : 'Could not remove your reminder.',
      );
    } finally {
      setIsRemoving(false);
    }
  }, [existingRule, isRemoving, isSaving, onClose, onRuleChanged]);

  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <View style={{ paddingVertical: ds.spacing(24), alignItems: 'center' }}>
        <LoadingIndicator size="small" color={glassColors.accent} />
      </View>
    );
  } else if (loadError) {
    body = (
      <Text
        style={{
          paddingVertical: ds.spacing(20),
          fontSize: ds.fontSize(14),
          color: glassColors.dangerText,
          textAlign: 'center',
        }}
      >
        {loadError}
      </Text>
    );
  } else {
    body = (
      <View>
        {existingRule ? (
          <Text
            style={{
              fontSize: ds.fontSize(13),
              color: glassColors.textSecondary,
              marginBottom: ds.spacing(12),
            }}
          >
            Currently: {summarizeOrderDayRule(existingRule)}
            {existingRule.enabled === false ? ' (paused)' : ''}
          </Text>
        ) : (
          <Text
            style={{
              fontSize: ds.fontSize(13),
              color: glassColors.textSecondary,
              marginBottom: ds.spacing(12),
            }}
          >
            Get a push on your order days if you have not sent an order yet.
          </Text>
        )}

        <Text
          style={{
            fontSize: ds.fontSize(12),
            fontWeight: '700',
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            color: glassColors.textSecondary,
            marginBottom: ds.spacing(8),
          }}
        >
          Remind me on
        </Text>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginBottom: ds.spacing(16),
          }}
        >
          {WEEKDAY_LABELS.map((label, day) => {
            const selected = form.daysOfWeek.includes(day);
            return (
              <TouchableOpacity
                key={label}
                onPress={() => handleToggleDay(day)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Remind on ${label}`}
                style={{
                  width: ds.spacing(42),
                  minHeight: ds.spacing(42),
                  borderRadius: glassRadii.button,
                  borderWidth: glassHairlineWidth,
                  borderColor: selected
                    ? glassColors.accentBorder
                    : glassColors.controlBorder,
                  backgroundColor: selected ? colors.primaryPale : colors.glassCircle,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text
                  style={{
                    fontSize: ds.fontSize(13),
                    fontWeight: '700',
                    color: selected ? glassColors.accent : glassColors.textSecondary,
                  }}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text
          style={{
            fontSize: ds.fontSize(12),
            fontWeight: '700',
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            color: glassColors.textSecondary,
            marginBottom: ds.spacing(8),
          }}
        >
          At
        </Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            minHeight: 52,
            borderRadius: glassRadii.button,
            borderWidth: glassHairlineWidth,
            borderColor: glassColors.controlBorder,
            backgroundColor: colors.glassCircle,
            paddingHorizontal: ds.spacing(8),
            marginBottom: ds.spacing(16),
          }}
        >
          <TouchableOpacity
            onPress={() => handleShiftTime(-REMINDER_TIME_STEP_MINUTES)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Earlier reminder time"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{
              width: ds.spacing(40),
              minHeight: ds.spacing(40),
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons
              name="remove-circle-outline"
              size={ds.icon(22)}
              color={glassColors.accent}
            />
          </TouchableOpacity>
          <Text
            style={{
              fontSize: ds.fontSize(17),
              fontWeight: '700',
              color: glassColors.textPrimary,
            }}
          >
            {formatTimeLabel(form.timeOfDay)}
          </Text>
          <TouchableOpacity
            onPress={() => handleShiftTime(REMINDER_TIME_STEP_MINUTES)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Later reminder time"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{
              width: ds.spacing(40),
              minHeight: ds.spacing(40),
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons
              name="add-circle-outline"
              size={ds.icon(22)}
              color={glassColors.accent}
            />
          </TouchableOpacity>
        </View>

        {saveError ? (
          <Text
            style={{
              fontSize: ds.fontSize(13),
              color: glassColors.dangerText,
              marginBottom: ds.spacing(10),
            }}
          >
            {saveError}
          </Text>
        ) : null}

        <TouchableOpacity
          onPress={() => void handleSave()}
          disabled={isSaving || isRemoving}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={existingRule ? 'Update reminder' : 'Set reminder'}
          style={{
            minHeight: 52,
            borderRadius: glassRadii.submitButton,
            backgroundColor: colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: isSaving || isRemoving ? 0.6 : 1,
          }}
        >
          <Text
            style={{
              fontSize: ds.fontSize(16),
              fontWeight: '700',
              color: colors.white,
            }}
          >
            {isSaving
              ? 'Saving…'
              : existingRule
                ? 'Update reminder'
                : 'Set reminder'}
          </Text>
        </TouchableOpacity>

        {existingRule ? (
          <TouchableOpacity
            onPress={() => void handleRemove()}
            disabled={isSaving || isRemoving}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Remove reminder"
            style={{
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: ds.spacing(6),
              opacity: isSaving || isRemoving ? 0.6 : 1,
            }}
          >
            <Text
              style={{
                fontSize: ds.fontSize(15),
                fontWeight: '600',
                color: glassColors.dangerText,
              }}
            >
              {isRemoving ? 'Removing…' : 'Remove reminder'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  return (
    <BottomSheetShell
      visible={visible}
      onClose={onClose}
      bottomPadding={Math.max(insets.bottom, ds.spacing(12))}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          marginBottom: ds.spacing(10),
        }}
      >
        <Ionicons
          name="notifications-outline"
          size={ds.icon(20)}
          color={glassColors.textPrimary}
          style={{ marginRight: ds.spacing(8) }}
        />
        <Text
          style={{
            fontSize: ds.fontSize(20),
            fontWeight: '700',
            color: glassColors.textPrimary,
          }}
        >
          Order-day reminder
        </Text>
      </View>

      {body}
    </BottomSheetShell>
  );
}
