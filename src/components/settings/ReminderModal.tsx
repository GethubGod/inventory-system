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
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors } from '@/constants';
import { Reminder, RepeatType } from '@/types/settings';
import { useSettingsStore } from '@/store';
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
  const { hapticFeedback } = useSettingsStore();

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
            className="bg-white rounded-t-3xl max-h-[90%]"
            onPress={(e) => e.stopPropagation()}
          >
            {/* Handle */}
            <View className="items-center pt-3 pb-2">
              <View className="w-10 h-1 bg-gray-300 rounded-full" />
            </View>

            {/* Header */}
            <View className="flex-row justify-between items-center px-4 py-3 border-b border-gray-100">
              <TouchableOpacity onPress={handleClose}>
                <Text className="text-gray-500 text-base">Cancel</Text>
              </TouchableOpacity>
              <Text className="text-lg font-semibold text-gray-900">
                {isEditing ? 'Edit Reminder' : 'New Reminder'}
              </Text>
              <View style={{ width: 50 }} />
            </View>

            <ScrollView
              className="px-4 py-4"
              contentContainerStyle={{ paddingBottom: 40 }}
              keyboardShouldPersistTaps="handled"
            >
              {/* Name */}
              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-2">
                  Reminder Name
                </Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g., Daily Order Reminder"
                  placeholderTextColor={colors.gray[400]}
                  className="bg-gray-100 rounded-xl px-4 py-3 text-base text-gray-900"
                />
              </View>

              {/* Message */}
              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-2">
                  Message
                </Text>
                <TextInput
                  value={message}
                  onChangeText={setMessage}
                  placeholder="e.g., Time to submit your inventory order!"
                  placeholderTextColor={colors.gray[400]}
                  className="bg-gray-100 rounded-xl px-4 py-3 text-base text-gray-900"
                  multiline
                  numberOfLines={2}
                  style={{ minHeight: 60, textAlignVertical: 'top' }}
                />
              </View>

              {/* Repeat Type */}
              <View className="mb-4">
                <Text className="text-sm font-medium text-gray-700 mb-2">
                  Repeat
                </Text>
                <View className="flex-row">
                  {REPEAT_OPTIONS.map((option) => (
                    <TouchableOpacity
                      key={option.value}
                      onPress={() => handleRepeatTypeChange(option.value)}
                      className={`flex-1 py-3 rounded-xl items-center border-2 mr-2 last:mr-0 ${
                        repeatType === option.value
                          ? 'border-primary-500 bg-primary-50'
                          : 'border-gray-200 bg-gray-50'
                      }`}
                      activeOpacity={0.7}
                    >
                      <Text
                        className={`text-sm font-medium ${
                          repeatType === option.value
                            ? 'text-primary-600'
                            : 'text-gray-600'
                        }`}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Day Selection (only for weekly/custom) */}
              {repeatType !== 'daily' && (
                <View className="mb-4">
                  <Text className="text-sm font-medium text-gray-700 mb-2">
                    Days
                  </Text>
                  <View className="flex-row justify-between">
                    {DAY_LABELS.map((label, index) => {
                      const isSelected = selectedDays.includes(index);
                      return (
                        <TouchableOpacity
                          key={index}
                          onPress={() => toggleDay(index)}
                          className={`w-10 h-10 rounded-full items-center justify-center ${
                            isSelected
                              ? 'bg-primary-500'
                              : 'bg-gray-100'
                          }`}
                          activeOpacity={0.7}
                        >
                          <Text
                            className={`text-sm font-semibold ${
                              isSelected ? 'text-white' : 'text-gray-600'
                            }`}
                          >
                            {label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text className="text-xs text-gray-400 mt-2">
                    Selected: {selectedDays
                      .sort((a, b) => a - b)
                      .map((d) => DAY_FULL_LABELS[d])
                      .join(', ')}
                  </Text>
                </View>
              )}

              {/* Time */}
              <View className="mb-6">
                <Text className="text-sm font-medium text-gray-700 mb-2">
                  Time
                </Text>
                <View className="bg-gray-100 rounded-xl px-4">
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
                className="bg-primary-500 py-4 rounded-xl items-center"
                activeOpacity={0.8}
              >
                <Text className="text-white font-semibold text-base">
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
