import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { colors } from '@/constants';
import { useAuthStore } from '@/store';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';
import {
  EmployeeReminderOverview,
  EmployeeReminderStatusRow,
  ReminderServiceError,
  listEmployeesWithReminderStatus,
  sendReminder,
} from '@/services';

type SortMode = 'overdue' | 'name' | 'location' | 'active_first';

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'overdue', label: 'Most overdue' },
  { value: 'name', label: 'Name A-Z' },
  { value: 'location', label: 'Location' },
  { value: 'active_first', label: 'Active reminder first' },
];

function formatLastOrderLabel(row: EmployeeReminderStatusRow): string {
  if (!row.lastOrderAt) return 'Last order: Never';

  const now = Date.now();
  const lastOrderTs = new Date(row.lastOrderAt).getTime();
  if (Number.isNaN(lastOrderTs)) return 'Last order: Unknown';

  const delta = now - lastOrderTs;
  const minutes = Math.floor(delta / (1000 * 60));
  const hours = Math.floor(delta / (1000 * 60 * 60));
  const days = Math.floor(delta / (1000 * 60 * 60 * 24));

  if (minutes < 1) return 'Last order: just now';
  if (minutes < 60) return `Last order: ${minutes}m ago`;
  if (hours < 24) return `Last order: ${hours}h ago`;
  return `Last order: ${days}d ago`;
}

function statusConfig(status: EmployeeReminderStatusRow['status']) {
  if (status === 'reminder_active') {
    return {
      label: 'Reminder Active',
      bg: '#FFEDD5',
      text: '#C2410C',
    };
  }

  if (status === 'overdue') {
    return {
      label: 'Overdue',
      bg: '#FEE2E2',
      text: '#B91C1C',
    };
  }

  return {
    label: 'OK',
    bg: '#DCFCE7',
    text: '#166534',
  };
}

export default function EmployeeRemindersScreen() {
  const ds = useScaledStyles();
  const { locations, fetchLocations } = useAuthStore();

  const [overview, setOverview] = useState<EmployeeReminderOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('overdue');
  const [isSendingUserId, setIsSendingUserId] = useState<string | null>(null);

  const [showLocationMenu, setShowLocationMenu] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const loadOverview = useCallback(async () => {
    try {
      const data = await listEmployeesWithReminderStatus({
        locationId: selectedLocationId,
      });
      setOverview(data);
    } catch (error: any) {
      Alert.alert('Unable to load reminders', error?.message || 'Please try again.');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [selectedLocationId]);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  useFocusEffect(
    useCallback(() => {
      loadOverview();
    }, [loadOverview])
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadOverview();
  }, [loadOverview]);

  const executeReminder = useCallback(
    async (row: EmployeeReminderStatusRow, overrideRateLimit = false) => {
      setIsSendingUserId(row.userId);
      try {
        await sendReminder({
          employeeId: row.userId,
          locationId: selectedLocationId ?? row.locationId,
          overrideRateLimit,
          source: row.activeReminder ? 'manual_repeat' : 'manual',
          channels: {
            push: row.notificationsEnabled,
            in_app: true,
          },
        });

        Alert.alert(
          'Reminder sent',
          row.activeReminder
            ? `Reminder sent again to ${row.name}.`
            : `Reminder sent to ${row.name}.`
        );

        await loadOverview();
      } catch (error: any) {
        const reminderError = error as ReminderServiceError;

        if (!overrideRateLimit && reminderError?.code === 'RATE_LIMITED') {
          Alert.alert(
            'Reminder sent recently',
            reminderError.message || 'This employee was reminded recently.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Send Anyway',
                onPress: () => {
                  executeReminder(row, true);
                },
              },
            ]
          );
          return;
        }

        Alert.alert('Unable to send reminder', reminderError?.message || 'Please try again.');
      } finally {
        setIsSendingUserId(null);
      }
    },
    [loadOverview, selectedLocationId]
  );

  const handleReminderPress = useCallback(
    (row: EmployeeReminderStatusRow) => {
      const actionLabel = row.activeReminder ? 'Send reminder again' : 'Send reminder';
      const deliveryHint = row.notificationsOff
        ? 'Push notifications are OFF. This will deliver in-app only.'
        : 'This will send push (if available) and in-app notifications.';

      Alert.alert(actionLabel, `${deliveryHint}\n\nSend to ${row.name}?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: row.activeReminder ? 'Remind Again' : 'Remind', onPress: () => executeReminder(row) },
      ]);
    },
    [executeReminder]
  );

  const filteredEmployees = useMemo(() => {
    const base = overview?.employees ?? [];
    const query = searchQuery.trim().toLowerCase();

    const searched = query
      ? base.filter((row) => {
          const haystack = `${row.name} ${row.email} ${row.locationName}`.toLowerCase();
          return haystack.includes(query);
        })
      : base;

    return [...searched].sort((a, b) => {
      if (sortMode === 'name') {
        return a.name.localeCompare(b.name);
      }

      if (sortMode === 'location') {
        const byLocation = a.locationName.localeCompare(b.locationName);
        return byLocation === 0 ? a.name.localeCompare(b.name) : byLocation;
      }

      if (sortMode === 'active_first') {
        const aActive = a.status === 'reminder_active' ? 0 : 1;
        const bActive = b.status === 'reminder_active' ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
      }

      const aDays = a.daysSinceLastOrder ?? Number.POSITIVE_INFINITY;
      const bDays = b.daysSinceLastOrder ?? Number.POSITIVE_INFINITY;
      if (aDays !== bDays) return bDays - aDays;

      return a.name.localeCompare(b.name);
    });
  }, [overview?.employees, searchQuery, sortMode]);

  const selectedSortLabel = SORT_OPTIONS.find((option) => option.value === sortMode)?.label || 'Most overdue';
  const selectedLocationName =
    selectedLocationId == null
      ? 'All Locations'
      : locations.find((entry) => entry.id === selectedLocationId)?.name || 'Selected Location';

  const stats = overview?.stats ?? {
    pendingReminders: 0,
    overdueEmployees: 0,
    notificationsOff: 0,
  };

  const renderRow = (row: EmployeeReminderStatusRow) => {
    const status = statusConfig(row.status);
    const isSending = isSendingUserId === row.userId;
    const actionLabel = row.notificationsOff
      ? row.activeReminder
        ? 'Remind Again'
        : 'Notify Anyway'
      : row.activeReminder
        ? 'Remind Again'
        : 'Remind';

    return (
      <View
        key={row.userId}
        className="bg-white border border-gray-100"
        style={{
          borderRadius: ds.radius(16),
          paddingHorizontal: ds.spacing(14),
          paddingVertical: ds.spacing(12),
          marginBottom: ds.spacing(10),
        }}
      >
        <View className="flex-row items-start">
          <View
            className="items-center justify-center bg-gray-100"
            style={{
              width: Math.max(40, ds.icon(42)),
              height: Math.max(40, ds.icon(42)),
              borderRadius: ds.radius(999),
              marginRight: ds.spacing(10),
            }}
          >
            <Text className="font-semibold text-gray-700" style={{ fontSize: ds.fontSize(16) }}>
              {row.name.charAt(0).toUpperCase()}
            </Text>
          </View>

          <View className="flex-1 pr-2">
            <Text className="font-semibold text-gray-900" style={{ fontSize: ds.fontSize(16) }}>
              {row.name}
            </Text>
            <Text className="text-gray-500" style={{ fontSize: ds.fontSize(13), marginTop: ds.spacing(2) }}>
              {row.locationName} • {formatLastOrderLabel(row)}
            </Text>

            <View className="flex-row items-center flex-wrap" style={{ marginTop: ds.spacing(8), gap: ds.spacing(6) }}>
              <View
                style={{
                  backgroundColor: status.bg,
                  paddingHorizontal: ds.spacing(8),
                  paddingVertical: ds.spacing(3),
                  borderRadius: ds.radius(999),
                }}
              >
                <Text style={{ color: status.text, fontSize: ds.fontSize(11), fontWeight: '700' }}>
                  {status.label}
                </Text>
              </View>

              {row.notificationsOff && (
                <View
                  style={{
                    backgroundColor: '#E5E7EB',
                    paddingHorizontal: ds.spacing(8),
                    paddingVertical: ds.spacing(3),
                    borderRadius: ds.radius(999),
                  }}
                >
                  <Text style={{ color: '#374151', fontSize: ds.fontSize(11), fontWeight: '700' }}>
                    Notifications OFF
                  </Text>
                </View>
              )}
            </View>

            {row.activeReminder && (
              <Text className="text-orange-700" style={{ fontSize: ds.fontSize(12), marginTop: ds.spacing(6) }}>
                Active reminder count: {row.activeReminder.reminderCount}
              </Text>
            )}
          </View>

          <TouchableOpacity
            onPress={() => handleReminderPress(row)}
            className={isSending ? 'bg-orange-300 items-center justify-center' : 'bg-primary-500 items-center justify-center'}
            style={{
              minHeight: Math.max(42, ds.buttonH - ds.spacing(6)),
              minWidth: Math.max(106, ds.buttonPadH * 4),
              borderRadius: ds.radius(12),
              paddingHorizontal: ds.spacing(10),
            }}
            disabled={isSending}
          >
            <Text className="text-white font-semibold" style={{ fontSize: ds.fontSize(13) }}>
              {isSending ? 'Sending...' : actionLabel}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      <ManagerScaleContainer>
        <View
          className="bg-white border-b border-gray-100 flex-row items-center justify-between"
          style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12) }}
        >
          <View className="flex-row items-center flex-1">
            <TouchableOpacity
              onPress={() => router.replace('/(manager)')}
              style={{ padding: ds.spacing(8), marginRight: ds.spacing(8), minWidth: 44, minHeight: 44, justifyContent: 'center' }}
            >
              <Ionicons name="arrow-back" size={ds.icon(20)} color={colors.gray[700]} />
            </TouchableOpacity>
            <View className="flex-1">
              <Text className="font-bold text-gray-900" style={{ fontSize: ds.fontSize(20) }}>
                Employee Reminders
              </Text>
              <Text className="text-gray-500" style={{ fontSize: ds.fontSize(12), marginTop: ds.spacing(2) }}>
                Send and track reminders by employee
              </Text>
            </View>
          </View>

          <TouchableOpacity
            onPress={() => setShowMoreMenu(true)}
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="ellipsis-horizontal" size={18} color={colors.gray[700]} />
          </TouchableOpacity>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: ds.spacing(16), paddingBottom: ds.spacing(28) }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#F97316" />}
        >
          <View className="flex-row" style={{ columnGap: ds.spacing(8), marginBottom: ds.spacing(12) }}>
            <View className="flex-1 bg-white rounded-xl border border-gray-100" style={{ padding: ds.spacing(10) }}>
              <Text className="text-xs text-gray-500">Pending</Text>
              <Text className="font-bold text-gray-900" style={{ fontSize: ds.fontSize(22), marginTop: ds.spacing(4) }}>
                {stats.pendingReminders}
              </Text>
            </View>
            <View className="flex-1 bg-white rounded-xl border border-gray-100" style={{ padding: ds.spacing(10) }}>
              <Text className="text-xs text-gray-500">Overdue</Text>
              <Text className="font-bold text-gray-900" style={{ fontSize: ds.fontSize(22), marginTop: ds.spacing(4) }}>
                {stats.overdueEmployees}
              </Text>
            </View>
            <View className="flex-1 bg-white rounded-xl border border-gray-100" style={{ padding: ds.spacing(10) }}>
              <Text className="text-xs text-gray-500">Notif Off</Text>
              <Text className="font-bold text-gray-900" style={{ fontSize: ds.fontSize(22), marginTop: ds.spacing(4) }}>
                {stats.notificationsOff}
              </Text>
            </View>
          </View>

          <View className="flex-row" style={{ columnGap: ds.spacing(8), marginBottom: ds.spacing(10) }}>
            <TouchableOpacity
              className="flex-1 bg-white border border-gray-200 rounded-xl flex-row items-center justify-between"
              style={{ paddingHorizontal: ds.spacing(12), minHeight: Math.max(44, ds.buttonH - ds.spacing(6)) }}
              onPress={() => setShowLocationMenu(true)}
            >
              <Text className="text-gray-700" numberOfLines={1} style={{ fontSize: ds.fontSize(13), flex: 1 }}>
                {selectedLocationName}
              </Text>
              <Ionicons name="chevron-down" size={ds.icon(16)} color={colors.gray[500]} />
            </TouchableOpacity>

            <TouchableOpacity
              className="flex-1 bg-white border border-gray-200 rounded-xl flex-row items-center justify-between"
              style={{ paddingHorizontal: ds.spacing(12), minHeight: Math.max(44, ds.buttonH - ds.spacing(6)) }}
              onPress={() => setShowSortMenu(true)}
            >
              <Text className="text-gray-700" numberOfLines={1} style={{ fontSize: ds.fontSize(13), flex: 1 }}>
                {selectedSortLabel}
              </Text>
              <Ionicons name="swap-vertical" size={ds.icon(16)} color={colors.gray[500]} />
            </TouchableOpacity>
          </View>

          <View
            className="bg-white border border-gray-200 rounded-xl flex-row items-center"
            style={{
              paddingHorizontal: ds.spacing(12),
              minHeight: Math.max(46, ds.buttonH - ds.spacing(4)),
              marginBottom: ds.spacing(14),
            }}
          >
            <Ionicons name="search" size={ds.icon(18)} color={colors.gray[400]} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search employees"
              placeholderTextColor={colors.gray[400]}
              style={{
                flex: 1,
                marginLeft: ds.spacing(8),
                fontSize: ds.fontSize(15),
                color: colors.gray[900],
              }}
            />
          </View>

          {isLoading ? (
            <View className="items-center" style={{ paddingVertical: ds.spacing(40) }}>
              <Text className="text-gray-500" style={{ fontSize: ds.fontSize(14) }}>
                Loading employees...
              </Text>
            </View>
          ) : filteredEmployees.length === 0 ? (
            <View className="bg-white rounded-2xl border border-gray-100 items-center" style={{ paddingVertical: ds.spacing(36), paddingHorizontal: ds.spacing(14) }}>
              <Ionicons name="people-outline" size={ds.icon(34)} color={colors.gray[300]} />
              <Text className="text-gray-700 font-semibold" style={{ fontSize: ds.fontSize(16), marginTop: ds.spacing(8) }}>
                No employees found
              </Text>
              <Text className="text-gray-500 text-center" style={{ fontSize: ds.fontSize(13), marginTop: ds.spacing(4) }}>
                Try changing filters or search terms.
              </Text>
            </View>
          ) : (
            filteredEmployees.map(renderRow)
          )}
        </ScrollView>

        <Modal transparent animationType="fade" visible={showLocationMenu} onRequestClose={() => setShowLocationMenu(false)}>
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setShowLocationMenu(false)}
            style={{ flex: 1, backgroundColor: 'rgba(17,24,39,0.35)', justifyContent: 'flex-end' }}
          >
            <View className="bg-white" style={{ borderTopLeftRadius: ds.radius(20), borderTopRightRadius: ds.radius(20), paddingBottom: ds.spacing(20) }}>
              <Text className="font-semibold text-gray-900" style={{ fontSize: ds.fontSize(16), padding: ds.spacing(16) }}>
                Filter by Location
              </Text>
              <TouchableOpacity
                style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12) }}
                onPress={() => {
                  setSelectedLocationId(null);
                  setShowLocationMenu(false);
                }}
              >
                <Text className="text-gray-900" style={{ fontSize: ds.fontSize(15) }}>All Locations</Text>
              </TouchableOpacity>
              {locations.map((entry) => (
                <TouchableOpacity
                  key={entry.id}
                  style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12) }}
                  onPress={() => {
                    setSelectedLocationId(entry.id);
                    setShowLocationMenu(false);
                  }}
                >
                  <Text className="text-gray-900" style={{ fontSize: ds.fontSize(15) }}>{entry.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        </Modal>

        <Modal transparent animationType="fade" visible={showSortMenu} onRequestClose={() => setShowSortMenu(false)}>
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setShowSortMenu(false)}
            style={{ flex: 1, backgroundColor: 'rgba(17,24,39,0.35)', justifyContent: 'flex-end' }}
          >
            <View className="bg-white" style={{ borderTopLeftRadius: ds.radius(20), borderTopRightRadius: ds.radius(20), paddingBottom: ds.spacing(20) }}>
              <Text className="font-semibold text-gray-900" style={{ fontSize: ds.fontSize(16), padding: ds.spacing(16) }}>
                Sort Employees
              </Text>
              {SORT_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={{
                    paddingHorizontal: ds.spacing(16),
                    paddingVertical: ds.spacing(12),
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                  onPress={() => {
                    setSortMode(option.value);
                    setShowSortMenu(false);
                  }}
                >
                  <Text className="text-gray-900" style={{ fontSize: ds.fontSize(15) }}>{option.label}</Text>
                  {sortMode === option.value && <Ionicons name="checkmark" size={ds.icon(18)} color="#F97316" />}
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        </Modal>

        <Modal transparent animationType="fade" visible={showMoreMenu} onRequestClose={() => setShowMoreMenu(false)}>
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setShowMoreMenu(false)}
            style={{ flex: 1, backgroundColor: 'rgba(17,24,39,0.35)', justifyContent: 'flex-end' }}
          >
            <View className="bg-white" style={{ borderTopLeftRadius: ds.radius(20), borderTopRightRadius: ds.radius(20), paddingBottom: ds.spacing(20) }}>
              <Text className="font-semibold text-gray-900" style={{ fontSize: ds.fontSize(16), padding: ds.spacing(16) }}>
                More
              </Text>

              <TouchableOpacity
                style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12) }}
                onPress={() => {
                  setShowMoreMenu(false);
                  router.push('/(manager)/employee-reminders-recurring');
                }}
              >
                <Text className="text-gray-900" style={{ fontSize: ds.fontSize(15) }}>Recurring Reminders</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12) }}
                onPress={() => {
                  setShowMoreMenu(false);
                  router.push('/(manager)/employee-reminders-settings');
                }}
              >
                <Text className="text-gray-900" style={{ fontSize: ds.fontSize(15) }}>Reminder Settings</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12) }}
                onPress={() => {
                  setShowMoreMenu(false);
                  router.push('/(manager)/employee-reminders-delivery');
                }}
              >
                <Text className="text-gray-900" style={{ fontSize: ds.fontSize(15) }}>Notification Delivery Status</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
