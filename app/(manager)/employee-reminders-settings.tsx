import React, { useCallback, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import {
  ReminderSystemSettings,
  getReminderSystemSettings,
  updateReminderSystemSettings,
} from '@/services';

export default function EmployeeReminderSettingsScreen() {
  const ds = useScaledStyles();

  const [settings, setSettings] = useState<ReminderSystemSettings | null>(null);
  const [overdueDays, setOverdueDays] = useState('7');
  const [rateLimitMinutes, setRateLimitMinutes] = useState('15');
  const [recurringWindowMinutes, setRecurringWindowMinutes] = useState('15');
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const row = await getReminderSystemSettings();
      setSettings(row);
      if (row) {
        setOverdueDays(String(row.overdue_threshold_days));
        setRateLimitMinutes(String(row.reminder_rate_limit_minutes));
        setRecurringWindowMinutes(String(row.recurring_window_minutes));
      }
    } catch (error: any) {
      Alert.alert('Unable to load settings', error?.message || 'Please try again.');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadSettings();
    }, [loadSettings])
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadSettings();
  }, [loadSettings]);

  const handleSave = async () => {
    if (!settings?.id) {
      Alert.alert('Missing settings row', 'Run migrations and reload settings.');
      return;
    }

    const overdue = Math.max(1, Math.min(60, Number.parseInt(overdueDays, 10) || 7));
    const rateLimit = Math.max(1, Math.min(240, Number.parseInt(rateLimitMinutes, 10) || 15));
    const recurringWindow = Math.max(1, Math.min(120, Number.parseInt(recurringWindowMinutes, 10) || 15));

    setIsSaving(true);
    try {
      const updated = await updateReminderSystemSettings({
        overdue_threshold_days: overdue,
        reminder_rate_limit_minutes: rateLimit,
        recurring_window_minutes: recurringWindow,
      });
      setSettings(updated);
      setOverdueDays(String(updated.overdue_threshold_days));
      setRateLimitMinutes(String(updated.reminder_rate_limit_minutes));
      setRecurringWindowMinutes(String(updated.recurring_window_minutes));
      Alert.alert('Saved', 'Reminder settings updated.');
    } catch (error: any) {
      Alert.alert('Unable to save settings', error?.message || 'Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const NumericField = ({
    label,
    value,
    onChange,
    helpText,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    helpText: string;
  }) => (
    <View className="bg-white border border-gray-100" style={{ borderRadius: ds.radius(14), padding: ds.spacing(14), marginBottom: ds.spacing(10) }}>
      <Text className="font-semibold text-gray-900" style={{ fontSize: ds.fontSize(15) }}>{label}</Text>
      <Text className="text-gray-500" style={{ fontSize: ds.fontSize(12), marginTop: ds.spacing(4), marginBottom: ds.spacing(10) }}>
        {helpText}
      </Text>
      <TextInput
        value={value}
        onChangeText={(text) => onChange(text.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
        className="bg-gray-50 border border-gray-200 rounded-xl text-gray-900"
        style={{ minHeight: Math.max(46, ds.buttonH - ds.spacing(4)), paddingHorizontal: ds.spacing(12), fontSize: ds.fontSize(16) }}
      />
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      <ManagerScaleContainer>
        <View className="bg-white border-b border-gray-100 flex-row items-center" style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12) }}>
          <TouchableOpacity
            onPress={() => router.replace('/(manager)/employee-reminders')}
            style={{ padding: ds.spacing(8), marginRight: ds.spacing(8), minWidth: 44, minHeight: 44, justifyContent: 'center' }}
          >
            <Ionicons name="arrow-back" size={ds.icon(20)} color={colors.gray[700]} />
          </TouchableOpacity>
          <View>
            <Text className="font-bold text-gray-900" style={{ fontSize: ds.fontSize(20) }}>Reminder Settings</Text>
            <Text className="text-gray-500" style={{ fontSize: ds.fontSize(12), marginTop: ds.spacing(2) }}>
              Configure overdue and reminder limits
            </Text>
          </View>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: ds.spacing(16), paddingBottom: ds.spacing(28) }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#F97316" />}
        >
          {isLoading ? (
            <View className="items-center" style={{ paddingVertical: ds.spacing(40) }}>
              <Text className="text-gray-500" style={{ fontSize: ds.fontSize(14) }}>
                Loading settings...
              </Text>
            </View>
          ) : (
            <>
              <NumericField
                label="Overdue Threshold (days)"
                value={overdueDays}
                onChange={setOverdueDays}
                helpText="Employee is marked overdue when no order is placed for this many days."
              />
              <NumericField
                label="Manual Reminder Rate Limit (minutes)"
                value={rateLimitMinutes}
                onChange={setRateLimitMinutes}
                helpText="Prevents reminder spam. Managers can still override when needed."
              />
              <NumericField
                label="Recurring Evaluation Window (minutes)"
                value={recurringWindowMinutes}
                onChange={setRecurringWindowMinutes}
                helpText="How long after scheduled time a recurring rule is considered due."
              />

              <View className="bg-gray-100 rounded-xl" style={{ padding: ds.spacing(12), marginTop: ds.spacing(8) }}>
                <Text className="text-gray-600" style={{ fontSize: ds.fontSize(12) }}>
                  These settings apply globally to all manager reminder workflows.
                </Text>
              </View>
            </>
          )}
        </ScrollView>

        <View className="bg-white border-t border-gray-100" style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12) }}>
          <TouchableOpacity
            className={isSaving ? 'bg-orange-300 rounded-xl items-center justify-center' : 'bg-primary-500 rounded-xl items-center justify-center'}
            style={{ minHeight: Math.max(48, ds.buttonH) }}
            onPress={handleSave}
            disabled={isSaving || isLoading}
          >
            <Text className="text-white font-semibold" style={{ fontSize: ds.fontSize(15) }}>
              {isSaving ? 'Saving...' : 'Save Settings'}
            </Text>
          </TouchableOpacity>
        </View>
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
