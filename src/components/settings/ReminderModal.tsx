import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors } from '@/constants';
import { Reminder, RepeatType } from '@/types/settings';
import { useDisplayStore } from '@/store';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { TimePickerRow } from './TimePickerRow';

interface ReminderModalProps {
  visible: boolean;
  onClose: () => void;
  reminder?: Reminder | null;
  onSave: (reminder: Omit<Reminder, 'id' | 'createdAt'>) => void;
}

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_FULL_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const REPEAT_OPTIONS: { value: RepeatType; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'custom', label: 'Custom' },
];

export function ReminderModal({
  visible,
  onClose,
  reminder,
  onSave,
}: ReminderModalProps) {
  const { hapticFeedback } = useDisplayStore();
  const ds = useScaledStyles();

  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [repeatType, setRepeatType] = useState<RepeatType>('daily');
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]); // Mon-Fri
  const [time, setTime] = useState('14:00');

  const isEditing = !!reminder;

  useEffect(() => {
    if (reminder) {
      setName(reminder.name);
      setMessage(reminder.message);
      setRepeatType(reminder.repeatType);
      setSelectedDays(reminder.selectedDays);
      setTime(reminder.time);
    } else {
      // Reset to defaults for new reminder
      setName('');
      setMessage('');
      setRepeatType('daily');
      setSelectedDays([1, 2, 3, 4, 5]);
      setTime('14:00');
    }
  }, [reminder, visible]);

  const handleClose = () => {
    onClose();
  };

  const toggleDay = (day: number) => {
    if (hapticFeedback && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    if (selectedDays.includes(day)) {
      // Don't allow removing all days
      if (selectedDays.length > 1) {
        setSelectedDays(selectedDays.filter((d) => d !== day));
      }
    } else {
      setSelectedDays([...selectedDays, day]);
    }
  };

  const handleRepeatTypeChange = (type: RepeatType) => {
    if (hapticFeedback && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setRepeatType(type);
    // Reset days when switching to daily
    if (type === 'daily') {
      setSelectedDays([0, 1, 2, 3, 4, 5, 6]);
    }
  };

  const handleSave = () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter a reminder name');
      return;
    }

    if (!message.trim()) {
      Alert.alert('Error', 'Please enter a reminder message');
      return;
    }

    if (hapticFeedback && Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    onSave({
      name: name.trim(),
      message: message.trim(),
      enabled: reminder?.enabled ?? true,
      repeatType,
      selectedDays: repeatType === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : selectedDays,
      time,
    });

    handleClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <Pressable
          className="flex-1 bg-black/50 justify-end"
          onPress={handleClose}
        >
          <Pressable
            className="bg-white rounded-t-3xl"
            style={{ maxHeight: '90%' }}
            onPress={(e) => e.stopPropagation()}
          >
            {/* Handle */}
            <View className="items-center" style={{ paddingTop: ds.spacing(12), paddingBottom: ds.spacing(8) }}>
              <View style={{ width: ds.spacing(40), height: ds.spacing(4), borderRadius: ds.radius(999) }} className="bg-gray-300" />
            </View>

            {/* Header */}
            <View
              className="flex-row justify-between items-center border-b border-gray-100"
              style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12) }}
            >
              <TouchableOpacity onPress={handleClose} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text className="text-gray-500" style={{ fontSize: ds.fontSize(16) }}>Cancel</Text>
              </TouchableOpacity>
              <Text className="font-semibold text-gray-900" style={{ fontSize: ds.fontSize(18) }}>
                {isEditing ? 'Edit Reminder' : 'New Reminder'}
              </Text>
              <View style={{ width: ds.spacing(56) }} />
            </View>

            <ScrollView
              contentContainerStyle={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(16), paddingBottom: ds.spacing(40) }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              {/* Name */}
              <View style={{ marginBottom: ds.spacing(16) }}>
                <Text className="font-medium text-gray-700" style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8) }}>
                  Reminder Name
                </Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g., Daily Order Reminder"
                  placeholderTextColor={colors.gray[400]}
                  className="bg-gray-100 text-gray-900"
                  style={{
                    borderRadius: ds.radius(12),
                    minHeight: Math.max(48, ds.buttonH),
                    paddingHorizontal: ds.spacing(14),
                    fontSize: ds.fontSize(15),
                  }}
                />
              </View>

              {/* Message */}
              <View style={{ marginBottom: ds.spacing(16) }}>
                <Text className="font-medium text-gray-700" style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8) }}>
                  Message
                </Text>
                <TextInput
                  value={message}
                  onChangeText={setMessage}
                  placeholder="e.g., Time to submit your inventory order!"
                  placeholderTextColor={colors.gray[400]}
                  className="bg-gray-100 text-gray-900"
                  multiline
                  numberOfLines={2}
                  style={{
                    minHeight: Math.max(68, ds.spacing(68)),
                    textAlignVertical: 'top',
                    borderRadius: ds.radius(12),
                    paddingHorizontal: ds.spacing(14),
                    paddingVertical: ds.spacing(10),
                    fontSize: ds.fontSize(15),
                  }}
                />
              </View>

              {/* Repeat Type */}
              <View style={{ marginBottom: ds.spacing(16) }}>
                <Text className="font-medium text-gray-700" style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8) }}>
                  Repeat
                </Text>
                <View className="flex-row">
                  {REPEAT_OPTIONS.map((option) => (
                    <TouchableOpacity
                      key={option.value}
                      onPress={() => handleRepeatTypeChange(option.value)}
                      className={`flex-1 rounded-xl items-center justify-center border-2 ${
                        repeatType === option.value
                          ? 'border-primary-500 bg-primary-50'
                          : 'border-gray-200 bg-gray-50'
                      }`}
                      style={{
                        minHeight: Math.max(44, ds.buttonH - ds.spacing(4)),
                        marginRight: option.value === 'custom' ? 0 : ds.spacing(8),
                      }}
                      activeOpacity={0.7}
                    >
                      <Text
                        className={`font-medium ${
                          repeatType === option.value
                            ? 'text-primary-600'
                            : 'text-gray-600'
                        }`}
                        style={{ fontSize: ds.fontSize(14) }}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Day Selection (only for weekly/custom) */}
              {repeatType !== 'daily' && (
                <View style={{ marginBottom: ds.spacing(16) }}>
                  <Text className="font-medium text-gray-700" style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8) }}>
                    Days
                  </Text>
                  <View className="flex-row justify-between">
                    {DAY_LABELS.map((label, index) => {
                      const isSelected = selectedDays.includes(index);
                      return (
                        <TouchableOpacity
                          key={index}
                          onPress={() => toggleDay(index)}
                          className={`rounded-full items-center justify-center ${
                            isSelected
                              ? 'bg-primary-500'
                              : 'bg-gray-100'
                          }`}
                          style={{ width: Math.max(40, ds.icon(40)), height: Math.max(40, ds.icon(40)) }}
                          activeOpacity={0.7}
                        >
                          <Text
                            className={`font-semibold ${
                              isSelected ? 'text-white' : 'text-gray-600'
                            }`}
                            style={{ fontSize: ds.fontSize(13) }}
                          >
                            {label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text className="text-gray-400" style={{ fontSize: ds.fontSize(12), marginTop: ds.spacing(8) }}>
                    Selected: {selectedDays
                      .sort((a, b) => a - b)
                      .map((d) => DAY_FULL_LABELS[d])
                      .join(', ')}
                  </Text>
                </View>
              )}

              {/* Time */}
              <View style={{ marginBottom: ds.spacing(24) }}>
                <Text className="font-medium text-gray-700" style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8) }}>
                  Time
                </Text>
                <View className="bg-gray-100" style={{ borderRadius: ds.radius(12), paddingHorizontal: ds.spacing(14) }}>
                  <TimePickerRow
                    title="Reminder Time"
                    value={time}
                    onTimeChange={setTime}
                  />
                </View>
              </View>

              {/* Save Button */}
              <TouchableOpacity
                onPress={handleSave}
                className="bg-primary-500 items-center justify-center"
                style={{ minHeight: Math.max(48, ds.buttonH), borderRadius: ds.radius(12) }}
                activeOpacity={0.8}
              >
                <Text className="text-white font-semibold" style={{ fontSize: ds.buttonFont }}>
                  {isEditing ? 'Save Changes' : 'Add Reminder'}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
