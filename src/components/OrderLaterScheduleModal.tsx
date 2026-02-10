import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants';

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
  const now = useMemo(() => new Date(), [visible]);
  const parsedInitial = useMemo(() => {
    if (typeof initialScheduledAt === 'string') {
      const parsed = new Date(initialScheduledAt);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    const fallback = new Date();
    fallback.setMinutes(fallback.getMinutes() + 60);
    return fallback;
  }, [initialScheduledAt, visible]);

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
      <View className="mt-3 rounded-xl border border-gray-200 bg-white">
        <View className="flex-row items-center justify-between px-3 py-2 border-b border-gray-100">
          <Text className="text-sm font-semibold text-gray-900">
            {mode === 'date' ? 'Select date' : 'Select time'}
          </Text>
          <TouchableOpacity onPress={() => setPickerMode(null)}>
            <Text className="text-sm font-semibold text-primary-600">Done</Text>
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
        className={`rounded-xl border px-3 py-3 mb-2 ${selected ? 'border-primary-300 bg-primary-50' : 'border-gray-200 bg-white'}`}
        activeOpacity={0.8}
      >
        <View className="flex-row items-start">
          <Ionicons
            name={selected ? 'radio-button-on' : 'radio-button-off'}
            size={18}
            color={selected ? colors.primary[600] : colors.gray[400]}
            style={{ marginTop: 1 }}
          />
          <View className="ml-2 flex-1">
            <Text className={`text-sm font-semibold ${selected ? 'text-primary-700' : 'text-gray-900'}`}>
              {label}
            </Text>
            <Text className={`text-xs mt-0.5 ${selected ? 'text-primary-700' : 'text-gray-500'}`}>
              {description}
            </Text>
            {extra}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/35 justify-end" onPress={onClose}>
        <Pressable className="bg-gray-50 rounded-t-3xl px-4 pt-4 pb-5" onPress={(e) => e.stopPropagation()}>
          <View className="flex-row items-center justify-between mb-3">
            <View className="flex-1 pr-2">
              <Text className="text-lg font-bold text-gray-900">{title}</Text>
              <Text className="text-xs text-gray-500 mt-0.5">{subtitle}</Text>
            </View>
            <TouchableOpacity onPress={onClose} className="p-2">
              <Ionicons name="close" size={20} color={colors.gray[500]} />
            </TouchableOpacity>
          </View>

          {optionCard(
            'later_today',
            'Later today',
            `Time: ${formatTimeLabel(laterTodayTime)}`,
            preset === 'later_today' ? (
              <TouchableOpacity
                onPress={() => setPickerMode('later_today_time')}
                className="self-start mt-2 px-2.5 py-1.5 rounded-md bg-white border border-gray-200"
              >
                <Text className="text-[11px] font-semibold text-gray-700">Choose time</Text>
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
                className="self-start mt-2 px-2.5 py-1.5 rounded-md bg-white border border-gray-200"
              >
                <Text className="text-[11px] font-semibold text-gray-700">Choose time</Text>
              </TouchableOpacity>
            ) : null
          )}

          {optionCard(
            'pick_datetime',
            'Pick date & time',
            `${formatDateLabel(customDate)} at ${formatTimeLabel(customTime)}`,
            preset === 'pick_datetime' ? (
              <View className="flex-row mt-2">
                <TouchableOpacity
                  onPress={() => setPickerMode('custom_date')}
                  className="px-2.5 py-1.5 rounded-md bg-white border border-gray-200 mr-2"
                >
                  <Text className="text-[11px] font-semibold text-gray-700">Pick date</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setPickerMode('custom_time')}
                  className="px-2.5 py-1.5 rounded-md bg-white border border-gray-200"
                >
                  <Text className="text-[11px] font-semibold text-gray-700">Pick time</Text>
                </TouchableOpacity>
              </View>
            ) : null
          )}

          {renderPicker()}

          <View className="flex-row mt-4">
            <TouchableOpacity
              onPress={onClose}
              className="flex-1 py-3 rounded-xl bg-gray-100 items-center justify-center mr-2"
            >
              <Text className="font-semibold text-gray-700">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={submit}
              disabled={submitting}
              className={`flex-1 py-3 rounded-xl items-center justify-center ${submitting ? 'bg-gray-300' : 'bg-primary-500'}`}
            >
              <Text className={`font-semibold ${submitting ? 'text-gray-500' : 'text-white'}`}>
                {confirmLabel}
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
