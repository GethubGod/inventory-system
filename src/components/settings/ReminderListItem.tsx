import React from 'react';
import { View, Text, TouchableOpacity, Switch, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors } from '@/constants';
import { Reminder } from '@/types/settings';
import { useSettingsStore } from '@/store';

interface ReminderListItemProps {
  reminder: Reminder;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function ReminderListItem({
  reminder,
  onToggle,
  onEdit,
  onDelete,
}: ReminderListItemProps) {
  const { hapticFeedback } = useSettingsStore();

  const formatTime = (time: string): string => {
    const [hours, minutes] = time.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  const formatSchedule = (): string => {
    if (reminder.repeatType === 'daily') {
      return `Every day at ${formatTime(reminder.time)}`;
    }

    const days = reminder.selectedDays
      .sort((a, b) => a - b)
      .map((d) => DAY_LABELS[d])
      .join(', ');
    return `${days} at ${formatTime(reminder.time)}`;
  };

  const handleToggle = (value: boolean) => {
    if (hapticFeedback && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onToggle();
  };

  const handleEdit = () => {
    if (hapticFeedback && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onEdit();
  };

  const handleDelete = () => {
    if (hapticFeedback && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    onDelete();
  };

  return (
    <View className="bg-gray-50 rounded-xl p-4 mb-3 mx-4">
      <View className="flex-row items-start justify-between">
        <View className="flex-1 mr-3">
          <View className="flex-row items-center mb-1">
            <Ionicons
              name="notifications"
              size={18}
              color={reminder.enabled ? colors.primary[500] : colors.gray[400]}
            />
            <Text
              className={`text-base font-semibold ml-2 ${
                reminder.enabled ? 'text-gray-900' : 'text-gray-500'
              }`}
            >
              {reminder.name}
            </Text>
          </View>
          <Text className="text-sm text-gray-500 mb-1">{formatSchedule()}</Text>
          <Text
            className="text-sm text-gray-400 italic"
            numberOfLines={1}
          >
            "{reminder.message}"
          </Text>
        </View>

        <View className="flex-row items-center">
          <TouchableOpacity
            onPress={handleEdit}
            className="p-2 mr-1"
            activeOpacity={0.7}
          >
            <Ionicons name="pencil" size={18} color={colors.gray[400]} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleDelete}
            className="p-2 mr-2"
            activeOpacity={0.7}
          >
            <Ionicons name="trash-outline" size={18} color={colors.error} />
          </TouchableOpacity>
          <Switch
            value={reminder.enabled}
            onValueChange={handleToggle}
            trackColor={{ false: colors.gray[200], true: colors.primary[500] }}
            thumbColor={
              Platform.OS === 'android'
                ? reminder.enabled
                  ? colors.primary[600]
                  : colors.gray[50]
                : undefined
            }
            ios_backgroundColor={colors.gray[200]}
          />
        </View>
      </View>
    </View>
  );
}
