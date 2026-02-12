import React from 'react';
import { View, Text, TouchableOpacity, Switch, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors } from '@/constants';
import { Reminder } from '@/types/settings';
import { useDisplayStore } from '@/store';
import { useScaledStyles } from '@/hooks/useScaledStyles';

interface ReminderListItemProps {
  reminder: Reminder;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Memoized to prevent re-renders in list virtualization
function ReminderListItemInner({
  reminder,
  onToggle,
  onEdit,
  onDelete,
}: ReminderListItemProps) {
  const { hapticFeedback } = useDisplayStore();
  const ds = useScaledStyles();
  const switchScale = ds.isLarge ? 1.15 : ds.isCompact ? 0.95 : 1;

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
    <View
      className="bg-gray-50 rounded-xl"
      style={{ padding: ds.cardPad, marginBottom: ds.spacing(12), borderRadius: ds.radius(12) }}
    >
      <View className="flex-row items-start justify-between">
        <View className="flex-1" style={{ marginRight: ds.spacing(12) }}>
          <View className="flex-row items-center" style={{ marginBottom: ds.spacing(4) }}>
            <Ionicons
              name="notifications"
              size={ds.icon(18)}
              color={reminder.enabled ? colors.primary[500] : colors.gray[400]}
            />
            <Text
              className={`font-semibold ${
                reminder.enabled ? 'text-gray-900' : 'text-gray-500'
              }`}
              style={{ fontSize: ds.fontSize(16), marginLeft: ds.spacing(8) }}
            >
              {reminder.name}
            </Text>
          </View>
          <Text className="text-gray-500" style={{ fontSize: ds.fontSize(13), marginBottom: ds.spacing(4) }}>
            {formatSchedule()}
          </Text>
          <Text
            className="text-gray-400 italic"
            style={{ fontSize: ds.fontSize(13) }}
            numberOfLines={1}
          >
            {'"'}
            {reminder.message}
            {'"'}
          </Text>
        </View>

        <View className="flex-row items-center">
          <TouchableOpacity
            onPress={handleEdit}
            style={{
              width: Math.max(44, ds.icon(36)),
              height: Math.max(44, ds.icon(36)),
              marginRight: ds.spacing(4),
              alignItems: 'center',
              justifyContent: 'center',
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="pencil" size={ds.icon(18)} color={colors.gray[400]} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleDelete}
            style={{
              width: Math.max(44, ds.icon(36)),
              height: Math.max(44, ds.icon(36)),
              marginRight: ds.spacing(8),
              alignItems: 'center',
              justifyContent: 'center',
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="trash-outline" size={ds.icon(18)} color={colors.error} />
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
            style={{ transform: [{ scaleX: switchScale }, { scaleY: switchScale }] }}
          />
        </View>
      </View>
    </View>
  );
}

export const ReminderListItem = React.memo(ReminderListItemInner);
