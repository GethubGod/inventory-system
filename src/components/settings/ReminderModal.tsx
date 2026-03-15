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
import { colors, hairline, radii } from '@/theme/design';
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
        style={{ flex: 1 }}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' }}
          onPress={handleClose}
        >
          <Pressable
            style={{ backgroundColor: colors.white, borderTopLeftRadius: radii.card, borderTopRightRadius: radii.card, maxHeight: '90%' }}
            onPress={(e) => e.stopPropagation()}
          >
            {/* Handle */}
            <View style={{ alignItems: 'center', paddingTop: ds.spacing(12), paddingBottom: ds.spacing(8) }}>
              <View style={{ width: ds.spacing(40), height: 4, borderRadius: 2, backgroundColor: colors.textMuted }} />
            </View>

            {/* Header */}
            <View
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: hairline, borderBottomColor: colors.divider, paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12) }}
            >
              <TouchableOpacity onPress={handleClose} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text style={{ fontSize: ds.fontSize(16), color: colors.textSecondary }}>Cancel</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: ds.fontSize(18), fontWeight: '600', color: colors.textPrimary }}>
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
                <Text style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8), fontWeight: '500', color: colors.textPrimary }}>
                  Reminder Name
                </Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g., Daily Order Reminder"
                  placeholderTextColor={colors.textMuted}
                  style={{
                    backgroundColor: colors.background,
                    borderRadius: radii.stepper,
                    minHeight: Math.max(48, ds.buttonH),
                    paddingHorizontal: ds.spacing(14),
                    fontSize: ds.fontSize(15),
                    color: colors.textPrimary,
                  }}
                />
              </View>

              {/* Message */}
              <View style={{ marginBottom: ds.spacing(16) }}>
                <Text style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8), fontWeight: '500', color: colors.textPrimary }}>
                  Message
                </Text>
                <TextInput
                  value={message}
                  onChangeText={setMessage}
                  placeholder="e.g., Time to submit your inventory order!"
                  placeholderTextColor={colors.textMuted}
                  multiline
                  numberOfLines={2}
                  style={{
                    minHeight: Math.max(68, ds.spacing(68)),
                    textAlignVertical: 'top',
                    borderRadius: radii.stepper,
                    paddingHorizontal: ds.spacing(14),
                    paddingVertical: ds.spacing(10),
                    fontSize: ds.fontSize(15),
                    backgroundColor: colors.background,
                    color: colors.textPrimary,
                  }}
                />
              </View>

              {/* Repeat Type */}
              <View style={{ marginBottom: ds.spacing(16) }}>
                <Text style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8), fontWeight: '500', color: colors.textPrimary }}>
                  Repeat
                </Text>
                <View style={{ flexDirection: 'row' }}>
                  {REPEAT_OPTIONS.map((option) => (
                    <TouchableOpacity
                      key={option.value}
                      onPress={() => handleRepeatTypeChange(option.value)}
                      style={{
                        flex: 1,
                        borderRadius: radii.submitButton,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderWidth: repeatType === option.value ? 2 : hairline,
                        borderColor: repeatType === option.value ? colors.primary : colors.glassBorder,
                        backgroundColor: repeatType === option.value ? colors.primaryPale : colors.background,
                        minHeight: Math.max(44, ds.buttonH - ds.spacing(4)),
                        marginRight: option.value === 'custom' ? 0 : ds.spacing(8),
                      }}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={{
                          fontSize: ds.fontSize(14),
                          fontWeight: '500',
                          color: repeatType === option.value ? colors.primary : colors.textSecondary,
                        }}
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
                  <Text style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8), fontWeight: '500', color: colors.textPrimary }}>
                    Days
                  </Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    {DAY_LABELS.map((label, index) => {
                      const isSelected = selectedDays.includes(index);
                      return (
                        <TouchableOpacity
                          key={index}
                          onPress={() => toggleDay(index)}
                          style={{
                            borderRadius: radii.circle,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: isSelected ? colors.primary : colors.background,
                            width: Math.max(40, ds.icon(40)),
                            height: Math.max(40, ds.icon(40)),
                          }}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={{
                              fontSize: ds.fontSize(13),
                              fontWeight: '600',
                              color: isSelected ? colors.white : colors.textSecondary,
                            }}
                          >
                            {label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text style={{ fontSize: ds.fontSize(12), marginTop: ds.spacing(8), color: colors.textMuted }}>
                    Selected: {selectedDays
                      .sort((a, b) => a - b)
                      .map((d) => DAY_FULL_LABELS[d])
                      .join(', ')}
                  </Text>
                </View>
              )}

              {/* Time */}
              <View style={{ marginBottom: ds.spacing(24) }}>
                <Text style={{ fontSize: ds.fontSize(14), marginBottom: ds.spacing(8), fontWeight: '500', color: colors.textPrimary }}>
                  Time
                </Text>
                <View style={{ backgroundColor: colors.background, borderRadius: radii.stepper, paddingHorizontal: ds.spacing(14) }}>
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
                style={{
                  backgroundColor: colors.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: Math.max(48, ds.buttonH),
                  borderRadius: radii.submitButton,
                }}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: ds.buttonFont, fontWeight: '600', color: colors.white }}>
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
