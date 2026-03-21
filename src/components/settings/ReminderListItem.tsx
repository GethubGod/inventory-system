import React from 'react';
import { View, Text, TouchableOpacity, Switch, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants';
import { Reminder } from '@/types/settings';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  glassColors,
  glassHairlineWidth,
  glassRadii,
} from '@/design/tokens';

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

  const handleToggle = () => {
    onToggle();
  };

  return (
    <View
      style={{
        padding: ds.cardPad,
        marginBottom: ds.spacing(12),
        borderRadius: glassRadii.surface,
        borderWidth: glassHairlineWidth,
        borderColor: glassColors.cardBorder,
        backgroundColor: glassColors.subtleFill,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
        }}
      >
        <View className="flex-1" style={{ marginRight: ds.spacing(12) }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginBottom: ds.spacing(4),
            }}
          >
            <Ionicons
              name="notifications"
              size={ds.icon(18)}
              color={reminder.enabled ? glassColors.accent : glassColors.textMuted}
            />
            <Text
              style={{
                fontSize: ds.fontSize(16),
                marginLeft: ds.spacing(8),
                fontWeight: '600',
                color: reminder.enabled
                  ? glassColors.textPrimary
                  : glassColors.textSecondary,
              }}
            >
              {reminder.name}
            </Text>
          </View>
          <Text
            style={{
              fontSize: ds.fontSize(13),
              marginBottom: ds.spacing(4),
              color: glassColors.textSecondary,
            }}
          >
            {formatSchedule()}
          </Text>
          <Text
            style={{
              fontSize: ds.fontSize(12),
              color: glassColors.textSecondary,
              fontStyle: 'italic',
            }}
            numberOfLines={1}
          >
            {'"'}
            {reminder.message}
            {'"'}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity
            onPress={onEdit}
            style={{
              width: Math.max(44, ds.icon(36)),
              height: Math.max(44, ds.icon(36)),
              marginRight: ds.spacing(4),
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: glassRadii.stepper,
              backgroundColor: glassColors.mediumFill,
            }}
            activeOpacity={0.82}
          >
            <Ionicons
              name="pencil"
              size={ds.icon(18)}
              color={glassColors.textSecondary}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onDelete}
            style={{
              width: Math.max(44, ds.icon(36)),
              height: Math.max(44, ds.icon(36)),
              marginRight: ds.spacing(8),
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: glassRadii.stepper,
              backgroundColor: glassColors.dangerSoft,
            }}
            activeOpacity={0.82}
          >
            <Ionicons
              name="trash-outline"
              size={ds.icon(18)}
              color={glassColors.dangerText}
            />
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
