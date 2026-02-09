import React, { useCallback, useMemo, useState } from 'react';
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
import { ReminderDeliveryEvent, listReminderDeliveryEvents } from '@/services';

function formatEventTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';

  const now = Date.now();
  const delta = now - date.getTime();
  const minutes = Math.floor(delta / (1000 * 60));
  const hours = Math.floor(delta / (1000 * 60 * 60));
  const days = Math.floor(delta / (1000 * 60 * 60 * 24));

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function formatEventType(type: string) {
  if (type === 'sent') return 'Sent';
  if (type === 'reminded_again') return 'Reminded Again';
  if (type === 'auto_resolved') return 'Auto Resolved';
  if (type === 'cancelled') return 'Cancelled';
  return type;
}

export default function EmployeeReminderDeliveryStatusScreen() {
  const ds = useScaledStyles();

  const [events, setEvents] = useState<ReminderDeliveryEvent[]>([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadEvents = useCallback(async () => {
    try {
      const rows = await listReminderDeliveryEvents(120);
      setEvents(rows);
    } catch (error: any) {
      Alert.alert('Unable to load delivery status', error?.message || 'Please try again.');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadEvents();
    }, [loadEvents])
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadEvents();
  }, [loadEvents]);

  const filteredEvents = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return events;

    return events.filter((entry) => {
      const employee = (entry.reminder.employee_name || '').toLowerCase();
      const eventType = entry.event_type.toLowerCase();
      const pushStatus = String((entry.delivery_result as any)?.push?.status || '').toLowerCase();
      return employee.includes(term) || eventType.includes(term) || pushStatus.includes(term);
    });
  }, [events, query]);

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
            <Text className="font-bold text-gray-900" style={{ fontSize: ds.fontSize(20) }}>Delivery Status</Text>
            <Text className="text-gray-500" style={{ fontSize: ds.fontSize(12), marginTop: ds.spacing(2) }}>
              Push and in-app reminder delivery history
            </Text>
          </View>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: ds.spacing(16), paddingBottom: ds.spacing(28) }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#F97316" />}
        >
          <View
            className="bg-white border border-gray-200 rounded-xl flex-row items-center"
            style={{
              paddingHorizontal: ds.spacing(12),
              minHeight: Math.max(46, ds.buttonH - ds.spacing(4)),
              marginBottom: ds.spacing(12),
            }}
          >
            <Ionicons name="search" size={ds.icon(18)} color={colors.gray[400]} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search by employee or status"
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
                Loading events...
              </Text>
            </View>
          ) : filteredEvents.length === 0 ? (
            <View className="bg-white rounded-2xl border border-gray-100 items-center" style={{ paddingVertical: ds.spacing(36), paddingHorizontal: ds.spacing(16) }}>
              <Ionicons name="notifications-off-outline" size={ds.icon(34)} color={colors.gray[300]} />
              <Text className="text-gray-700 font-semibold" style={{ fontSize: ds.fontSize(16), marginTop: ds.spacing(8) }}>
                No delivery events found
              </Text>
              <Text className="text-gray-500 text-center" style={{ fontSize: ds.fontSize(13), marginTop: ds.spacing(4) }}>
                Send a reminder first to see delivery history.
              </Text>
            </View>
          ) : (
            filteredEvents.map((entry) => {
              const pushStatus = (entry.delivery_result as any)?.push?.status || 'unknown';
              const channels = entry.channels_attempted.length > 0 ? entry.channels_attempted : ['none'];
              const employeeName = entry.reminder.employee_name || entry.reminder.employee_id || 'Unknown employee';

              return (
                <View
                  key={entry.id}
                  className="bg-white border border-gray-100"
                  style={{
                    borderRadius: ds.radius(16),
                    paddingHorizontal: ds.spacing(14),
                    paddingVertical: ds.spacing(12),
                    marginBottom: ds.spacing(10),
                  }}
                >
                  <View className="flex-row items-center justify-between">
                    <Text className="font-semibold text-gray-900" style={{ fontSize: ds.fontSize(16), flex: 1, paddingRight: ds.spacing(8) }}>
                      {employeeName}
                    </Text>
                    <Text className="text-gray-500" style={{ fontSize: ds.fontSize(12) }}>
                      {formatEventTime(entry.sent_at)}
                    </Text>
                  </View>

                  <Text className="text-gray-700" style={{ fontSize: ds.fontSize(13), marginTop: ds.spacing(4) }}>
                    {formatEventType(entry.event_type)}
                  </Text>

                  <View className="flex-row flex-wrap" style={{ gap: ds.spacing(6), marginTop: ds.spacing(8) }}>
                    {channels.map((channel) => (
                      <View
                        key={`${entry.id}-${channel}`}
                        style={{
                          backgroundColor: '#E5E7EB',
                          paddingHorizontal: ds.spacing(8),
                          paddingVertical: ds.spacing(3),
                          borderRadius: ds.radius(999),
                        }}
                      >
                        <Text style={{ color: '#374151', fontSize: ds.fontSize(11), fontWeight: '700' }}>{channel}</Text>
                      </View>
                    ))}

                    <View
                      style={{
                        backgroundColor:
                          pushStatus === 'sent'
                            ? '#DCFCE7'
                            : pushStatus === 'not_delivered_push_disabled'
                              ? '#E5E7EB'
                              : '#FEE2E2',
                        paddingHorizontal: ds.spacing(8),
                        paddingVertical: ds.spacing(3),
                        borderRadius: ds.radius(999),
                      }}
                    >
                      <Text
                        style={{
                          color:
                            pushStatus === 'sent'
                              ? '#166534'
                              : pushStatus === 'not_delivered_push_disabled'
                                ? '#374151'
                                : '#B91C1C',
                          fontSize: ds.fontSize(11),
                          fontWeight: '700',
                        }}
                      >
                        Push: {pushStatus}
                      </Text>
                    </View>
                  </View>

                  <Text className="text-gray-400" style={{ fontSize: ds.fontSize(11), marginTop: ds.spacing(8) }}>
                    {new Date(entry.sent_at).toLocaleString()}
                  </Text>
                </View>
              );
            })
          )}
        </ScrollView>
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
