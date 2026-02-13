import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  ToastAndroid,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { colors } from '@/constants';
import { useAuthStore } from '@/store';
import { ManagerScaleContainer } from '@/components/ManagerScaleContainer';
import { useScaledStyles } from '@/hooks/useScaledStyles';
import { ManagedUser, listManagedUsers, setManagedUserSuspended } from '@/services/userManagement';

type UserFilter = 'all' | 'employees' | 'managers' | 'active' | 'inactive' | 'suspended';

const FILTER_OPTIONS: { key: UserFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'employees', label: 'Employees' },
  { key: 'managers', label: 'Managers' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Inactive (30d+)' },
  { key: 'suspended', label: 'Suspended' },
];

const INACTIVE_THRESHOLD_DAYS = 30;
const SEARCH_DEBOUNCE_MS = 220;
const MANAGERS_ONLY_MESSAGE = 'Managers only';
const SUSPEND_CONFIRM_MESSAGE =
  'They will be signed out and will not be able to sign in again until reinstated.';

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysSince(value: Date | null): number | null {
  if (!value) return null;
  const delta = Date.now() - value.getTime();
  if (delta < 0) return 0;
  return Math.floor(delta / (1000 * 60 * 60 * 24));
}

function formatDaysAgo(prefix: string, date: Date): string {
  const days = daysSince(date) ?? 0;
  if (days === 0) return `${prefix}: today`;
  if (days === 1) return `${prefix}: 1 day ago`;
  return `${prefix}: ${days} days ago`;
}

function getInactiveReferenceDate(user: ManagedUser): Date | null {
  return toDate(user.last_order_at) ?? toDate(user.last_active_at);
}

function isInactive30d(user: ManagedUser): boolean {
  if (user.is_suspended) return false;
  const referenceDate = getInactiveReferenceDate(user);
  const elapsedDays = daysSince(referenceDate);
  return elapsedDays !== null && elapsedDays >= INACTIVE_THRESHOLD_DAYS;
}

function formatLastActivity(user: ManagedUser): string {
  const lastOrder = toDate(user.last_order_at);
  if (lastOrder) return formatDaysAgo('Last order', lastOrder);

  const lastActive = toDate(user.last_active_at);
  if (lastActive) return formatDaysAgo('Last active', lastActive);

  const createdAt = toDate(user.created_at);
  if (createdAt) {
    return `Joined ${createdAt.toLocaleDateString()}`;
  }

  return 'No activity recorded';
}

function getInitials(user: ManagedUser): string {
  const base = user.full_name?.trim() || user.email.trim() || 'User';
  const words = base.split(/\s+/).filter(Boolean);

  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }

  return `${words[0][0] ?? ''}${words[1][0] ?? ''}`.toUpperCase();
}

export default function UserManagementScreen() {
  const ds = useScaledStyles();
  const { user: currentUser, profile, session, isInitialized } = useAuthStore();

  const metadataRole =
    typeof session?.user?.user_metadata?.role === 'string'
      ? session.user.user_metadata.role
      : typeof session?.user?.app_metadata?.role === 'string'
        ? session.user.app_metadata.role
        : null;

  const resolvedRole = currentUser?.role ?? profile?.role ?? metadataRole;
  const isManager = resolvedRole === 'manager';
  const currentUserId = currentUser?.id ?? session?.user?.id ?? null;

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<UserFilter>('all');
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  const redirectedForManagerGuardRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim().toLowerCase());
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!noticeMessage) return;

    const timer = setTimeout(() => {
      setNoticeMessage(null);
    }, 2200);

    return () => clearTimeout(timer);
  }, [noticeMessage]);

  useEffect(() => {
    if (!isInitialized || !session || isManager || redirectedForManagerGuardRef.current) {
      return;
    }

    redirectedForManagerGuardRef.current = true;

    if (Platform.OS === 'android') {
      ToastAndroid.show(MANAGERS_ONLY_MESSAGE, ToastAndroid.SHORT);
    } else {
      Alert.alert(MANAGERS_ONLY_MESSAGE);
    }

    router.replace('/(tabs)/settings');
  }, [isInitialized, isManager, session]);

  const loadUsers = useCallback(
    async (isRefresh = false) => {
      if (!isManager) {
        setIsLoading(false);
        setRefreshing(false);
        return;
      }

      if (!isRefresh) {
        setIsLoading(true);
      }

      setErrorMessage(null);

      try {
        const rows = await listManagedUsers();
        setUsers(rows);
      } catch (error: any) {
        console.error('Failed to load user management list', error);
        setErrorMessage(error?.message || 'Unable to load users.');
      } finally {
        setIsLoading(false);
        setRefreshing(false);
      }
    },
    [isManager]
  );

  useFocusEffect(
    useCallback(() => {
      if (!isManager) return;
      loadUsers();
    }, [isManager, loadUsers])
  );

  const filteredUsers = useMemo(() => {
    return users.filter((candidate) => {
      const matchesSearch =
        debouncedSearch.length === 0 ||
        candidate.email.toLowerCase().includes(debouncedSearch) ||
        (candidate.full_name ?? '').toLowerCase().includes(debouncedSearch);

      if (!matchesSearch) return false;

      switch (selectedFilter) {
        case 'employees':
          return candidate.role === 'employee';
        case 'managers':
          return candidate.role === 'manager';
        case 'active':
          return !candidate.is_suspended;
        case 'inactive':
          return isInactive30d(candidate);
        case 'suspended':
          return candidate.is_suspended;
        case 'all':
        default:
          return true;
      }
    });
  }, [debouncedSearch, selectedFilter, users]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadUsers(true);
  }, [loadUsers]);

  const applySuspensionUpdate = useCallback(
    async (targetUser: ManagedUser, nextSuspended: boolean) => {
      if (targetUser.id === currentUserId) {
        Alert.alert('Action blocked', 'You cannot suspend your own account.');
        return;
      }

      setUpdatingUserId(targetUser.id);

      try {
        await setManagedUserSuspended({
          userId: targetUser.id,
          isSuspended: nextSuspended,
        });

        setUsers((previous) =>
          previous.map((entry) => {
            if (entry.id !== targetUser.id) {
              return entry;
            }

            return {
              ...entry,
              is_suspended: nextSuspended,
              suspended_at: nextSuspended ? new Date().toISOString() : null,
              suspended_by: nextSuspended ? currentUserId : null,
            };
          })
        );

        setNoticeMessage(nextSuspended ? 'Employee suspended.' : 'Employee reinstated.');
      } catch (error: any) {
        console.error('Failed to change suspension state', error);
        Alert.alert('Update failed', error?.message || 'Unable to update suspension state.');
      } finally {
        setUpdatingUserId(null);
      }
    },
    [currentUserId]
  );

  const handleSuspensionPress = useCallback(
    (targetUser: ManagedUser) => {
      const nextSuspended = !targetUser.is_suspended;

      if (nextSuspended) {
        Alert.alert('Suspend employee?', SUSPEND_CONFIRM_MESSAGE, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Suspend',
            style: 'destructive',
            onPress: () => {
              applySuspensionUpdate(targetUser, true);
            },
          },
        ]);
        return;
      }

      Alert.alert('Reinstate employee?', 'They will be able to sign in again.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reinstate',
          onPress: () => {
            applySuspensionUpdate(targetUser, false);
          },
        },
      ]);
    },
    [applySuspensionUpdate]
  );

  const renderRow = ({ item }: { item: ManagedUser }) => {
    const isUpdating = updatingUserId === item.id;
    const inactive = isInactive30d(item);

    const roleStyle =
      item.role === 'manager'
        ? { label: 'Manager', bg: '#EDE9FE', text: '#6D28D9' }
        : { label: 'Employee', bg: '#DBEAFE', text: '#1D4ED8' };

    const statusStyle = item.is_suspended
      ? { label: 'Suspended', bg: '#FEE2E2', text: '#B91C1C' }
      : inactive
        ? { label: 'Inactive', bg: '#FEF3C7', text: '#B45309' }
        : { label: 'Active', bg: '#DCFCE7', text: '#166534' };

    return (
      <View
        className="bg-white border border-gray-100"
        style={{
          borderRadius: ds.radius(16),
          marginBottom: ds.spacing(10),
          paddingHorizontal: ds.spacing(14),
          paddingVertical: ds.spacing(12),
        }}
      >
        <View className="flex-row items-start">
          <View
            className="items-center justify-center bg-gray-100"
            style={{
              width: ds.icon(42),
              height: ds.icon(42),
              borderRadius: ds.radius(999),
              marginRight: ds.spacing(10),
            }}
          >
            <Text className="font-semibold text-gray-700" style={{ fontSize: ds.fontSize(13) }}>
              {getInitials(item)}
            </Text>
          </View>

          <View className="flex-1" style={{ paddingRight: ds.spacing(8) }}>
            <Text className="font-semibold text-gray-900" style={{ fontSize: ds.fontSize(16) }}>
              {item.full_name || 'Unnamed User'}
            </Text>
            <Text className="text-gray-500" style={{ fontSize: ds.fontSize(13), marginTop: ds.spacing(2) }}>
              {item.email || 'No email on file'}
            </Text>
            <Text className="text-gray-500" style={{ fontSize: ds.fontSize(12), marginTop: ds.spacing(4) }}>
              {formatLastActivity(item)}
            </Text>
          </View>

          <View className="items-end">
            <View
              style={{
                backgroundColor: roleStyle.bg,
                borderRadius: ds.radius(999),
                paddingHorizontal: ds.spacing(10),
                paddingVertical: ds.spacing(4),
                marginBottom: ds.spacing(6),
              }}
            >
              <Text className="font-semibold" style={{ fontSize: ds.fontSize(11), color: roleStyle.text }}>
                {roleStyle.label}
              </Text>
            </View>
            <View
              style={{
                backgroundColor: statusStyle.bg,
                borderRadius: ds.radius(999),
                paddingHorizontal: ds.spacing(10),
                paddingVertical: ds.spacing(4),
              }}
            >
              <Text className="font-semibold" style={{ fontSize: ds.fontSize(11), color: statusStyle.text }}>
                {statusStyle.label}
              </Text>
            </View>
          </View>
        </View>

        {item.role === 'employee' ? (
          <TouchableOpacity
            className={item.is_suspended ? 'bg-green-50 border border-green-200' : 'bg-orange-50 border border-orange-200'}
            style={{
              marginTop: ds.spacing(12),
              borderRadius: ds.radius(12),
              minHeight: Math.max(42, ds.buttonH - ds.spacing(6)),
              alignItems: 'center',
              justifyContent: 'center',
              opacity: isUpdating ? 0.7 : 1,
            }}
            disabled={isUpdating}
            onPress={() => handleSuspensionPress(item)}
            activeOpacity={0.75}
          >
            <Text
              className="font-semibold"
              style={{
                fontSize: ds.fontSize(14),
                color: item.is_suspended ? '#166534' : '#C2410C',
              }}
            >
              {isUpdating ? 'Saving...' : item.is_suspended ? 'Reinstate' : 'Suspend'}
            </Text>
          </TouchableOpacity>
        ) : (
          <View
            className="bg-gray-50 border border-gray-200 items-center justify-center"
            style={{
              marginTop: ds.spacing(12),
              borderRadius: ds.radius(12),
              minHeight: Math.max(42, ds.buttonH - ds.spacing(6)),
            }}
          >
            <Text className="text-gray-500 font-medium" style={{ fontSize: ds.fontSize(13) }}>
              Manager account
            </Text>
          </View>
        )}
      </View>
    );
  };

  if (!isInitialized) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="small" color={colors.primary[500]} />
        </View>
      </SafeAreaView>
    );
  }

  if (session && !isManager) {
    return null;
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top', 'left', 'right']}>
      <ManagerScaleContainer>
        <View
          className="bg-white border-b border-gray-100 flex-row items-center"
          style={{ paddingHorizontal: ds.spacing(16), paddingVertical: ds.spacing(12) }}
        >
          <TouchableOpacity
            onPress={() => router.back()}
            style={{
              padding: ds.spacing(8),
              marginRight: ds.spacing(8),
              minWidth: 44,
              minHeight: 44,
              justifyContent: 'center',
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={ds.icon(20)} color={colors.gray[700]} />
          </TouchableOpacity>
          <Text className="font-bold text-gray-900" style={{ fontSize: ds.fontSize(18) }}>
            User Management
          </Text>
        </View>

        <View style={{ paddingHorizontal: ds.spacing(16), paddingTop: ds.spacing(16) }}>
          <View
            className="bg-white border border-gray-200 flex-row items-center"
            style={{
              borderRadius: ds.radius(12),
              minHeight: Math.max(46, ds.buttonH),
              paddingHorizontal: ds.spacing(12),
            }}
          >
            <Ionicons name="search-outline" size={ds.icon(18)} color={colors.gray[400]} />
            <TextInput
              className="flex-1 text-gray-900"
              style={{ marginLeft: ds.spacing(8), fontSize: ds.fontSize(15) }}
              placeholder="Search by name or email"
              placeholderTextColor={colors.gray[400]}
              value={searchInput}
              onChangeText={setSearchInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchInput.length > 0 ? (
              <TouchableOpacity onPress={() => setSearchInput('')}>
                <Ionicons name="close-circle" size={ds.icon(18)} color={colors.gray[400]} />
              </TouchableOpacity>
            ) : null}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              paddingTop: ds.spacing(10),
              paddingBottom: ds.spacing(2),
              paddingRight: ds.spacing(8),
            }}
          >
            {FILTER_OPTIONS.map((option) => {
              const selected = option.key === selectedFilter;

              return (
                <TouchableOpacity
                  key={option.key}
                  onPress={() => setSelectedFilter(option.key)}
                  style={{
                    marginRight: ds.spacing(8),
                    borderRadius: ds.radius(999),
                    borderWidth: 1,
                    borderColor: selected ? colors.primary[500] : colors.gray[200],
                    backgroundColor: selected ? colors.primary[500] : '#FFFFFF',
                    paddingHorizontal: ds.spacing(12),
                    paddingVertical: ds.spacing(6),
                  }}
                >
                  <Text
                    className="font-semibold"
                    style={{
                      fontSize: ds.fontSize(12),
                      color: selected ? '#FFFFFF' : colors.gray[600],
                    }}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {noticeMessage ? (
          <View
            className="bg-green-100"
            style={{
              marginHorizontal: ds.spacing(16),
              marginTop: ds.spacing(8),
              borderRadius: ds.radius(12),
              paddingHorizontal: ds.spacing(12),
              paddingVertical: ds.spacing(10),
            }}
          >
            <Text className="font-medium text-green-800" style={{ fontSize: ds.fontSize(13) }}>
              {noticeMessage}
            </Text>
          </View>
        ) : null}

        {errorMessage ? (
          <View
            className="bg-red-100"
            style={{
              marginHorizontal: ds.spacing(16),
              marginTop: ds.spacing(8),
              borderRadius: ds.radius(12),
              paddingHorizontal: ds.spacing(12),
              paddingVertical: ds.spacing(10),
            }}
          >
            <Text className="text-red-700" style={{ fontSize: ds.fontSize(13) }}>
              {errorMessage}
            </Text>
            <TouchableOpacity
              onPress={() => loadUsers()}
              className="self-start"
              style={{ marginTop: ds.spacing(8) }}
            >
              <Text className="font-semibold text-red-700" style={{ fontSize: ds.fontSize(13) }}>
                Retry
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {isLoading && users.length === 0 ? (
          <View className="flex-1 items-center justify-center" style={{ paddingHorizontal: ds.spacing(16) }}>
            <ActivityIndicator size="small" color={colors.primary[500]} />
            <Text className="text-gray-500" style={{ marginTop: ds.spacing(10), fontSize: ds.fontSize(14) }}>
              Loading users...
            </Text>
          </View>
        ) : (
          <FlatList
            data={filteredUsers}
            renderItem={renderRow}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{
              paddingHorizontal: ds.spacing(16),
              paddingTop: ds.spacing(10),
              paddingBottom: ds.spacing(24),
              flexGrow: 1,
            }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={colors.primary[500]}
              />
            }
            ListEmptyComponent={
              <View className="items-center justify-center" style={{ paddingTop: ds.spacing(80) }}>
                <Ionicons name="people-outline" size={ds.icon(34)} color={colors.gray[300]} />
                <Text className="font-semibold text-gray-700" style={{ marginTop: ds.spacing(10), fontSize: ds.fontSize(15) }}>
                  No users found
                </Text>
                <Text
                  className="text-gray-500 text-center"
                  style={{ marginTop: ds.spacing(4), fontSize: ds.fontSize(13) }}
                >
                  Try adjusting your search or filters.
                </Text>
              </View>
            }
          />
        )}
      </ManagerScaleContainer>
    </SafeAreaView>
  );
}
