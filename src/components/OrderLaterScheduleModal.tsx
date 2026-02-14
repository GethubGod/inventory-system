import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/constants';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { BottomSheetShell } from './BottomSheetShell';

type SchedulePreset = 'later_today' | 'tomorrow' | 'pick_datetime';
type PickerMode = 'later_today_time' | 'tomorrow_time' | 'custom_date' | 'custom_time' | null;

export interface OrderLaterScheduleModalProps {
  visible: boolean;
  title?: string;
  subtitle?: string;
  confirmLabel?: string;
  initialScheduledAt?: string | null;
  onClose: () => void;
  onConfirm: (scheduledAtIso: string) => Promise<void> | void;
}

function makeTime(base: Date, hours: number, minutes: number) {
  const next = new Date(base);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

function formatDateLabel(value: Date) {
  return value.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTimeLabel(value: Date) {
  return value.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function resolvePreset(initial: Date): SchedulePreset {
  const now = new Date();
  const isSameDay =
    initial.getFullYear() === now.getFullYear() &&
    initial.getMonth() === now.getMonth() &&
    initial.getDate() === now.getDate();
  if (isSameDay) return 'later_today';

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow =
    initial.getFullYear() === tomorrow.getFullYear() &&
    initial.getMonth() === tomorrow.getMonth() &&
    initial.getDate() === tomorrow.getDate();
  if (isTomorrow) return 'tomorrow';

  return 'pick_datetime';
}

export function OrderLaterScheduleModal({
  visible,
  title = 'Order Later',
  subtitle = 'Choose when this item should be ordered.',
  confirmLabel = 'Save',
  initialScheduledAt,
  onClose,
  onConfirm,
}: OrderLaterScheduleModalProps) {
  const ds = useScaledStyles();
  const insets = useSafeAreaInsets();
  const now = useMemo(() => new Date(), []);
  const parsedInitial = useMemo(() => {
    if (typeof initialScheduledAt === 'string') {
      const parsed = new Date(initialScheduledAt);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    const fallback = new Date();
    fallback.setMinutes(fallback.getMinutes() + 60);
    return fallback;
  }, [initialScheduledAt]);

  const [preset, setPreset] = useState<SchedulePreset>(() => resolvePreset(parsedInitial));
  const [laterTodayTime, setLaterTodayTime] = useState<Date>(parsedInitial);
  const [tomorrowTime, setTomorrowTime] = useState<Date>(makeTime(parsedInitial, 9, 0));
  const [customDate, setCustomDate] = useState<Date>(parsedInitial);
  const [customTime, setCustomTime] = useState<Date>(parsedInitial);
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const baseDate = parsedInitial;
    const fallbackToday = new Date(now);
    fallbackToday.setMinutes(fallbackToday.getMinutes() + 60);

    setPreset(resolvePreset(baseDate));
    setLaterTodayTime(baseDate > now ? baseDate : fallbackToday);
    setTomorrowTime(makeTime(baseDate, baseDate.getHours(), baseDate.getMinutes()));
    setCustomDate(baseDate);
    setCustomTime(baseDate);
    setPickerMode(null);
    setSubmitting(false);
  }, [now, parsedInitial, visible]);

  const handlePickerChange = (event: DateTimePickerEvent, selectedValue?: Date) => {
    if (event.type === 'dismissed') {
      setPickerMode(null);
      return;
    }

    if (!selectedValue || !pickerMode) return;

    if (pickerMode === 'later_today_time') {
      setLaterTodayTime((current) => makeTime(current, selectedValue.getHours(), selectedValue.getMinutes()));
    } else if (pickerMode === 'tomorrow_time') {
      setTomorrowTime((current) => makeTime(current, selectedValue.getHours(), selectedValue.getMinutes()));
    } else if (pickerMode === 'custom_date') {
      setCustomDate((current) => {
        const next = new Date(selectedValue);
        next.setHours(current.getHours(), current.getMinutes(), 0, 0);
        return next;
      });
    } else if (pickerMode === 'custom_time') {
      setCustomTime((current) => makeTime(current, selectedValue.getHours(), selectedValue.getMinutes()));
    }

    if (Platform.OS === 'android') {
      setPickerMode(null);
    }
  };

  const buildScheduledDate = (): Date => {
    const next = new Date();
    if (preset === 'later_today') {
      next.setHours(laterTodayTime.getHours(), laterTodayTime.getMinutes(), 0, 0);
      if (next.getTime() <= Date.now()) {
        next.setDate(next.getDate() + 1);
      }
      return next;
    }

    if (preset === 'tomorrow') {
      next.setDate(next.getDate() + 1);
      next.setHours(tomorrowTime.getHours(), tomorrowTime.getMinutes(), 0, 0);
      return next;
    }

    const custom = new Date(customDate);
    custom.setHours(customTime.getHours(), customTime.getMinutes(), 0, 0);
    return custom;
  };

  const submit = async () => {
    if (submitting) return;

    const scheduledDate = buildScheduledDate();
    if (scheduledDate.getTime() <= Date.now()) {
      return;
    }

    try {
      setSubmitting(true);
      await onConfirm(scheduledDate.toISOString());
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const renderPicker = () => {
    if (!pickerMode) return null;

    const mode = pickerMode === 'custom_date' ? 'date' : 'time';
    const value =
      pickerMode === 'later_today_time'
        ? laterTodayTime
        : pickerMode === 'tomorrow_time'
          ? tomorrowTime
          : pickerMode === 'custom_date'
            ? customDate
            : customTime;

    if (Platform.OS === 'android') {
      return (
        <DateTimePicker
          value={value}
          mode={mode}
          display="default"
          onChange={handlePickerChange}
          minimumDate={mode === 'date' ? new Date() : undefined}
        />
      );
    }

    return (
      <View
        className="rounded-2xl border border-gray-200 bg-white overflow-hidden"
        style={{ marginTop: ds.spacing(10) }}
      >
        <View
          className="flex-row items-center justify-between border-b border-gray-100"
          style={{ paddingHorizontal: ds.spacing(14), paddingVertical: ds.spacing(8) }}
        >
          <Text style={{ fontSize: ds.fontSize(14) }} className="font-semibold text-gray-900">
            {mode === 'date' ? 'Select date' : 'Select time'}
          </Text>
          <TouchableOpacity onPress={() => setPickerMode(null)}>
            <Text style={{ fontSize: ds.fontSize(13) }} className="font-semibold text-primary-600">Done</Text>
          </TouchableOpacity>
        </View>
        <DateTimePicker
          value={value}
          mode={mode}
          display="spinner"
          onChange={handlePickerChange}
          minimumDate={mode === 'date' ? new Date() : undefined}
        />
      </View>
    );
  };

  const optionCard = (
    value: SchedulePreset,
    label: string,
    description: string,
    extra?: React.ReactNode
  ) => {
    const selected = preset === value;
    return (
      <TouchableOpacity
        onPress={() => setPreset(value)}
        className={`rounded-2xl border overflow-hidden ${selected ? 'border-primary-300 bg-primary-50' : 'border-gray-200 bg-white'}`}
        style={{
          paddingHorizontal: ds.spacing(14),
          paddingVertical: ds.spacing(12),
          marginBottom: ds.spacing(8),
        }}
        activeOpacity={0.8}
      >
        <View className="flex-row items-start">
          <Ionicons
            name={selected ? 'radio-button-on' : 'radio-button-off'}
            size={ds.icon(19)}
            color={selected ? colors.primary[600] : colors.gray[400]}
            style={{ marginTop: 1 }}
          />
          <View className="flex-1" style={{ marginLeft: ds.spacing(10) }}>
            <Text
              style={{ fontSize: ds.fontSize(16) }}
              className={`font-semibold ${selected ? 'text-primary-700' : 'text-gray-900'}`}
            >
              {label}
            </Text>
            <Text
              style={{ fontSize: ds.fontSize(13), marginTop: ds.spacing(2) }}
              className={selected ? 'text-primary-700' : 'text-gray-500'}
            >
              {description}
            </Text>
            {extra}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <BottomSheetShell
      visible={visible}
      onClose={onClose}
      bottomPadding={Math.max(ds.spacing(10), insets.bottom + ds.spacing(8))}
    >
      <View style={{ paddingHorizontal: ds.spacing(6), paddingBottom: ds.spacing(10) }}>
        <Text style={{ fontSize: ds.fontSize(18) }} className="font-bold text-gray-900">
          {title}
        </Text>
        <Text style={{ fontSize: ds.fontSize(13), marginTop: ds.spacing(4) }} className="text-gray-500">
          {subtitle}
        </Text>
      </View>

      <ScrollView
        style={{ maxHeight: ds.spacing(420) }}
        contentContainerStyle={{ paddingHorizontal: ds.spacing(6), paddingBottom: ds.spacing(4) }}
        showsVerticalScrollIndicator={false}
      >
        <Text
          style={{
            fontSize: ds.fontSize(11),
            marginBottom: ds.spacing(6),
            marginLeft: ds.spacing(6),
          }}
          className="font-semibold uppercase tracking-wide text-gray-500"
        >
          Schedule
        </Text>

        {optionCard(
          'later_today',
          'Later today',
          `Time: ${formatTimeLabel(laterTodayTime)}`,
          preset === 'later_today' ? (
            <TouchableOpacity
              onPress={() => setPickerMode('later_today_time')}
              className="self-start border border-gray-200 bg-white rounded-lg"
              style={{ marginTop: ds.spacing(8), paddingHorizontal: ds.spacing(10), paddingVertical: ds.spacing(6) }}
            >
              <Text style={{ fontSize: ds.fontSize(12) }} className="font-semibold text-gray-700">Choose time</Text>
            </TouchableOpacity>
          ) : null
        )}

        {optionCard(
          'tomorrow',
          'Tomorrow',
          `Time: ${formatTimeLabel(tomorrowTime)}`,
          preset === 'tomorrow' ? (
            <TouchableOpacity
              onPress={() => setPickerMode('tomorrow_time')}
              className="self-start border border-gray-200 bg-white rounded-lg"
              style={{ marginTop: ds.spacing(8), paddingHorizontal: ds.spacing(10), paddingVertical: ds.spacing(6) }}
            >
              <Text style={{ fontSize: ds.fontSize(12) }} className="font-semibold text-gray-700">Choose time</Text>
            </TouchableOpacity>
          ) : null
        )}

        {optionCard(
          'pick_datetime',
          'Pick date & time',
          `${formatDateLabel(customDate)} at ${formatTimeLabel(customTime)}`,
          preset === 'pick_datetime' ? (
            <View className="flex-row" style={{ marginTop: ds.spacing(8) }}>
              <TouchableOpacity
                onPress={() => setPickerMode('custom_date')}
                className="border border-gray-200 bg-white rounded-lg"
                style={{ paddingHorizontal: ds.spacing(10), paddingVertical: ds.spacing(6), marginRight: ds.spacing(8) }}
              >
                <Text style={{ fontSize: ds.fontSize(12) }} className="font-semibold text-gray-700">Pick date</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setPickerMode('custom_time')}
                className="border border-gray-200 bg-white rounded-lg"
                style={{ paddingHorizontal: ds.spacing(10), paddingVertical: ds.spacing(6) }}
              >
                <Text style={{ fontSize: ds.fontSize(12) }} className="font-semibold text-gray-700">Pick time</Text>
              </TouchableOpacity>
            </View>
          ) : null
        )}

        {renderPicker()}
      </ScrollView>

      <View style={{ paddingHorizontal: ds.spacing(6), paddingTop: ds.spacing(10) }}>
        <View className="flex-row">
          <TouchableOpacity
            onPress={onClose}
            disabled={submitting}
            className="flex-1 rounded-xl border border-gray-200 bg-white items-center justify-center mr-2"
            style={{ minHeight: ds.buttonH }}
            activeOpacity={0.8}
          >
            <Text style={{ fontSize: ds.buttonFont }} className="font-semibold text-gray-700">
              Cancel
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={submit}
            disabled={submitting}
            className={`flex-1 rounded-xl items-center justify-center ${submitting ? 'bg-primary-300' : 'bg-primary-500'}`}
            style={{ minHeight: ds.buttonH }}
            activeOpacity={0.8}
          >
            {submitting ? (
              <View className="flex-row items-center">
                <ActivityIndicator color="#FFFFFF" size="small" />
                <Text
                  style={{ fontSize: ds.buttonFont, marginLeft: ds.spacing(8) }}
                  className="font-semibold text-white"
                >
                  Saving...
                </Text>
              </View>
            ) : (
              <Text style={{ fontSize: ds.buttonFont }} className="font-semibold text-white">
                {confirmLabel}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </BottomSheetShell>
  );
}
