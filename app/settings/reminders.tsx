import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Alert, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassSurface } from '@/components';
import { useSettingsStore } from '@/store';
import { colors } from '@/constants';
import { Reminder } from '@/types/settings';
import {
  ReminderListItem,
  ReminderModal,
  SettingToggle,
  SettingsGroup,
  SettingsScreenLayout,
  SettingsSectionLabel,
  TimePickerRow,
  settingsIconPalettes,
} from '@/components/settings';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { glassColors, glassHairlineWidth, glassRadii } from '@/design/tokens';

import {
  requestNotificationPermissions,
  scheduleReminder,
  cancelReminder,
  scheduleNoOrderTodayReminder,
  scheduleBeforeClosingReminder,
} from '@/services/notificationService';

function RemindersSection({
  onAddReminder,
  onEditReminder,
}: {
  onAddReminder: () => void;
  onEditReminder: (reminder: Reminder) => void;
}) {
  const ds = useScaledStyles();
  const {
    reminders,
    setReminderSettings,
    toggleReminder,
    deleteReminder,
  } = useSettingsStore();

  const ensureNotificationPermissions = async () => {
    const granted = await requestNotificationPermissions();
    if (!granted) {
      Alert.alert(
        'Permission Required',
        'Please enable notifications in your device settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]
      );
      return false;
    }
    return true;
  };

  const handleReminderMasterToggle = async (enabled: boolean) => {
    setReminderSettings({ enabled });

    if (!enabled) {
      await scheduleNoOrderTodayReminder(false);
      await scheduleBeforeClosingReminder(false, reminders.closingTime);
      return;
    }

    const permitted = await ensureNotificationPermissions();
    if (!permitted) return;

    if (reminders.noOrderTodayReminder) {
      await scheduleNoOrderTodayReminder(true);
    }
    if (reminders.beforeClosingReminder) {
      await scheduleBeforeClosingReminder(true, reminders.closingTime);
    }
  };

  const handleNoOrderTodayToggle = async (enabled: boolean) => {
    if (enabled) {
      const permitted = await ensureNotificationPermissions();
      if (!permitted) return;
    }
    setReminderSettings({ noOrderTodayReminder: enabled });
    await scheduleNoOrderTodayReminder(enabled);
  };

  const handleBeforeClosingToggle = async (enabled: boolean) => {
    if (enabled) {
      const permitted = await ensureNotificationPermissions();
      if (!permitted) return;
    }
    setReminderSettings({ beforeClosingReminder: enabled });
    await scheduleBeforeClosingReminder(enabled, reminders.closingTime);
  };

  const handleClosingTimeChange = async (time: string) => {
    setReminderSettings({ closingTime: time });
    if (reminders.beforeClosingReminder) {
      const permitted = await ensureNotificationPermissions();
      if (!permitted) return;
      await scheduleBeforeClosingReminder(true, time);
    }
  };

  const handleDeleteReminder = (reminder: Reminder) => {
    Alert.alert('Delete Reminder', `Delete "${reminder.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await cancelReminder(reminder.id);
          deleteReminder(reminder.id);
        },
      },
    ]);
  };

  const handleToggleReminder = async (id: string) => {
    toggleReminder(id);
    const reminder = reminders.reminders.find((r) => r.id === id);
    if (reminder) {
      if (!reminder.enabled) {
        await scheduleReminder({ ...reminder, enabled: true });
      } else {
        await cancelReminder(id);
      }
    }
  };

  return (
    <View>
      <SettingToggle
        icon="alarm"
        iconColor={settingsIconPalettes.reminders.icon}
        iconBgColor={settingsIconPalettes.reminders.background}
        title="Reminders"
        subtitle="Get reminded to place orders"
        value={reminders.enabled}
        onValueChange={handleReminderMasterToggle}
      />

      {reminders.enabled && (
        <>
          <View style={{ paddingHorizontal: ds.spacing(16), paddingTop: ds.spacing(12), paddingBottom: ds.spacing(8) }}>
            <Text style={{ fontSize: ds.fontSize(15), fontWeight: '600', color: glassColors.textPrimary }}>
              Quick Reminders
            </Text>
          </View>

          <SettingToggle
            title="No Order Today"
            subtitle="Remind at 3 PM if no order placed"
            value={reminders.noOrderTodayReminder}
            onValueChange={handleNoOrderTodayToggle}
          />

          <SettingToggle
            title="Before Closing"
            subtitle="30 minutes before store closes"
            value={reminders.beforeClosingReminder}
            onValueChange={handleBeforeClosingToggle}
          />

          {reminders.beforeClosingReminder && (
            <View style={{ paddingHorizontal: ds.spacing(16), paddingBottom: ds.spacing(8) }}>
              <GlassSurface
                intensity="medium"
                blurred={false}
                style={{ paddingHorizontal: ds.spacing(14), borderRadius: glassRadii.surface }}
              >
                <TimePickerRow
                  title="Closing Time"
                  value={reminders.closingTime}
                  onTimeChange={handleClosingTimeChange}
                />
              </GlassSurface>
            </View>
          )}

          <View
            style={{
              height: glassHairlineWidth,
              backgroundColor: glassColors.divider,
              marginHorizontal: ds.spacing(16),
              marginVertical: ds.spacing(8),
            }}
          />

          <View style={{ paddingHorizontal: ds.spacing(16), paddingTop: ds.spacing(12), paddingBottom: ds.spacing(8) }}>
            <Text style={{ fontSize: ds.fontSize(15), fontWeight: '600', color: glassColors.textPrimary }}>
              Custom Reminders
            </Text>
          </View>

          {reminders.reminders.length === 0 ? (
            <View style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(16) }}>
              <Text style={{ fontSize: ds.fontSize(14), color: glassColors.textSecondary, textAlign: 'center' }}>
                No custom reminders yet
              </Text>
            </View>
          ) : (
            reminders.reminders.map((reminder) => (
              <ReminderListItem
                key={reminder.id}
                reminder={reminder}
                onToggle={() => handleToggleReminder(reminder.id)}
                onEdit={() => onEditReminder(reminder)}
                onDelete={() => handleDeleteReminder(reminder)}
              />
            ))
          )}

          <TouchableOpacity
            onPress={onAddReminder}
            style={{
              marginHorizontal: ds.spacing(16),
              marginVertical: ds.spacing(12),
              minHeight: Math.max(48, ds.buttonH),
              borderRadius: glassRadii.surface,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              backgroundColor: glassColors.mediumFill,
              borderWidth: glassHairlineWidth,
              borderColor: glassColors.cardBorder,
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="add" size={ds.icon(20)} color={colors.primary[500]} />
            <Text style={{ marginLeft: ds.spacing(8), fontSize: ds.fontSize(15), color: glassColors.accent, fontWeight: '600' }}>
              Add Reminder
            </Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

export default function RemindersSettingsScreen() {
  const ds = useScaledStyles();
  const { addReminder, updateReminder } = useSettingsStore();
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);

  const handleSaveReminder = async (reminderData: Omit<Reminder, 'id' | 'createdAt'>) => {
    if (editingReminder) {
      updateReminder(editingReminder.id, reminderData);
      if (reminderData.enabled) {
        await scheduleReminder({
          ...reminderData,
          id: editingReminder.id,
          createdAt: editingReminder.createdAt,
        });
      } else {
        await cancelReminder(editingReminder.id);
      }
    } else {
      addReminder(reminderData);
    }
    setEditingReminder(null);
  };

  return (
    <SettingsScreenLayout title="Reminders">
      <SettingsGroup>
        <SettingsSectionLabel
          label="Control Panel"
        />
        <View
          style={{
            height: glassHairlineWidth,
            backgroundColor: glassColors.divider,
            marginHorizontal: ds.spacing(16),
          }}
        />
        <View style={{ paddingTop: ds.spacing(4) }}>
          <RemindersSection
            onAddReminder={() => {
              setEditingReminder(null);
              setShowReminderModal(true);
            }}
            onEditReminder={(reminder) => {
              setEditingReminder(reminder);
              setShowReminderModal(true);
            }}
          />
        </View>
      </SettingsGroup>

      <ReminderModal
        visible={showReminderModal}
        reminder={editingReminder}
        onClose={() => {
          setShowReminderModal(false);
          setEditingReminder(null);
        }}
        onSave={handleSaveReminder}
      />
    </SettingsScreenLayout>
  );
}
